import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import {
  countChunks,
  countDocuments,
  type GoldenQuestion,
  insertEvalRun,
  listGoldenQuestions,
} from '../db/queries.js';
import { logger } from '../logger.js';
import { type AbstentionMetrics, decideAbstention, scoreAbstention } from '../retrieval/abstain.js';
import { Bm25Retriever } from '../retrieval/bm25.js';
import { DenseRetriever } from '../retrieval/dense.js';
import { HybridRetriever } from '../retrieval/hybrid.js';
import { RerankRetriever } from '../retrieval/rerank.js';
import type { Retriever } from '../retrieval/types.js';
import {
  bootstrapCI,
  type ConfidenceInterval,
  mean,
  ndcgAtK,
  pairedDiffCI,
  percentile,
  recallAtK,
  reciprocalRankAtK,
} from './metrics.js';
import { costUsd } from './pricing.js';

export const CONFIG_NAMES = ['bm25', 'dense', 'hybrid', 'hybrid+rerank'] as const;
export type ConfigName = (typeof CONFIG_NAMES)[number];

const K = 10;
const BOOTSTRAP_SAMPLES = 1000;

export interface QuestionResult {
  id: string;
  category: GoldenQuestion['category'];
  expected: number[];
  retrieved: number[];
  topScore: number | null;
  latencyMs: number;
  abstained: boolean;
}

export interface SliceMetrics {
  count: number;
  recallAt10: number;
  mrrAt10: number;
  ndcgAt10: number;
  recallCI: ConfidenceInterval;
  mrrCI: ConfidenceInterval;
  ndcgCI: ConfidenceInterval;
}

export interface ConfigResult {
  status: 'ok' | 'skipped';
  reason?: string;
  model: string;
  metrics: {
    overall: SliceMetrics;
    byCategory: Record<string, SliceMetrics>;
  };
  latency: { p50: number; p95: number };
  cost: {
    per1kQueriesUsd: number;
    embeddingUsd: number;
    rerankUsd: number;
    avgEmbeddingTokens: number;
    avgRerankInputTokens: number;
    rerankCalls: number;
    rerankFallbacks: number;
  };
  abstention: AbstentionMetrics;
  perQuestion: QuestionResult[];
}

export interface EvalResults {
  runId: string;
  createdAt: string;
  k: number;
  bootstrapSamples: number;
  corpus: { chunks: number; documents: number };
  golden: { total: number; byCategory: Record<string, number> };
  configs: Partial<Record<ConfigName, ConfigResult>>;
  routerAblation?: {
    withoutRouter: SliceMetrics;
    withRouter: SliceMetrics;
    recallDiffCI?: ConfidenceInterval;
  };
}

const ThresholdSchema = z.record(z.string(), z.number());
const readThresholds = async (): Promise<Record<string, number>> => {
  try {
    const raw = await readFile(join(process.cwd(), 'config', 'abstention.json'), 'utf8');
    return ThresholdSchema.parse(JSON.parse(raw));
  } catch {
    return {};
  }
};

const sliceMetrics = (
  questions: GoldenQuestion[],
  results: Map<string, QuestionResult>,
): SliceMetrics => {
  const answerable = questions.filter((question) => question.expected_chunk_ids.length > 0);
  const recalls: number[] = [];
  const mrrs: number[] = [];
  const ndcgs: number[] = [];
  for (const question of answerable) {
    const result = results.get(question.id);
    const retrieved = result?.retrieved ?? [];
    recalls.push(recallAtK(retrieved, question.expected_chunk_ids, K));
    mrrs.push(reciprocalRankAtK(retrieved, question.expected_chunk_ids, K));
    ndcgs.push(ndcgAtK(retrieved, question.expected_chunk_ids, K));
  }
  return {
    count: answerable.length,
    recallAt10: mean(recalls),
    mrrAt10: mean(mrrs),
    ndcgAt10: mean(ndcgs),
    recallCI: bootstrapCI(recalls, BOOTSTRAP_SAMPLES),
    mrrCI: bootstrapCI(mrrs, BOOTSTRAP_SAMPLES),
    ndcgCI: bootstrapCI(ndcgs, BOOTSTRAP_SAMPLES),
  };
};

const runConfig = async (
  name: ConfigName,
  retriever: Retriever | null,
  questions: GoldenQuestion[],
  threshold: number,
  skipReason?: string,
): Promise<ConfigResult> => {
  if (!retriever || skipReason) {
    return {
      status: 'skipped',
      reason:
        skipReason ??
        'RERANK_BASE_URL/RERANK_MODEL not configured; hybrid+rerank depends on an LLM',
      model: 'not-configured',
      metrics: {
        overall: emptySlice(),
        byCategory: {},
      },
      latency: { p50: 0, p95: 0 },
      cost: {
        per1kQueriesUsd: 0,
        embeddingUsd: 0,
        rerankUsd: 0,
        avgEmbeddingTokens: 0,
        avgRerankInputTokens: 0,
        rerankCalls: 0,
        rerankFallbacks: 0,
      },
      abstention: scoreAbstention([]),
      perQuestion: [],
    };
  }

  retriever.resetStats();
  const perQuestion = new Map<string, QuestionResult>();
  const latencies: number[] = [];

  for (const question of questions) {
    const started = performance.now();
    let retrieved: Array<{ chunkId: number; score: number }> = [];
    try {
      retrieved = await retriever.retrieve(question.question, K);
    } catch (error: unknown) {
      logger.error('retrieval failed', {
        config: name,
        question: question.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const latencyMs = performance.now() - started;
    latencies.push(latencyMs);
    const decision = decideAbstention(retrieved, threshold);
    perQuestion.set(question.id, {
      id: question.id,
      category: question.category,
      expected: question.expected_chunk_ids,
      retrieved: decision.answer ? retrieved.map((item) => item.chunkId) : [],
      topScore: decision.topScore,
      latencyMs,
      abstained: !decision.answer,
    });
  }

  const stats = retriever.stats();
  const rerankModel = name === 'hybrid+rerank' ? retriever.model : 'local:bge-m3';
  const embeddingModel = 'local:bge-m3';
  const embeddingUsd = costUsd(
    { inputTokens: stats.embeddingTokens, outputTokens: 0 },
    embeddingModel,
  );
  const rerankUsd =
    name === 'hybrid+rerank'
      ? costUsd(
          { inputTokens: stats.rerankPromptTokens, outputTokens: stats.rerankCompletionTokens },
          rerankModel,
        )
      : 0;
  const totalUsd = embeddingUsd + rerankUsd;
  const per1kQueriesUsd = (totalUsd / Math.max(1, questions.length)) * 1000;

  const byCategory: Record<string, SliceMetrics> = {};
  for (const category of ['semantic', 'identifier', 'temporal', 'unanswerable'] as const) {
    const subset = questions.filter((question) => question.category === category);
    byCategory[category] = sliceMetrics(subset, perQuestion);
  }

  const answerable = questions.filter((question) => question.expected_chunk_ids.length > 0);
  const abstention = scoreAbstention(
    questions.map((question) => ({
      shouldAbstain: question.unanswerable,
      abstained: perQuestion.get(question.id)?.abstained ?? false,
    })),
  );

  return {
    status: 'ok',
    model: name === 'hybrid+rerank' ? retriever.model : retriever.model,
    metrics: {
      overall: sliceMetrics(answerable, perQuestion),
      byCategory,
    },
    latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    cost: {
      per1kQueriesUsd,
      embeddingUsd,
      rerankUsd,
      avgEmbeddingTokens: stats.embeddingTokens / Math.max(1, questions.length),
      avgRerankInputTokens: stats.rerankPromptTokens / Math.max(1, questions.length),
      rerankCalls: stats.rerankCalls,
      rerankFallbacks: stats.rerankFallbacks,
    },
    abstention,
    perQuestion: [...perQuestion.values()],
  };
};

const emptySlice = (): SliceMetrics => ({
  count: 0,
  recallAt10: 0,
  mrrAt10: 0,
  ndcgAt10: 0,
  recallCI: { mean: 0, low: 0, high: 0, samples: 0 },
  mrrCI: { mean: 0, low: 0, high: 0, samples: 0 },
  ndcgCI: { mean: 0, low: 0, high: 0, samples: 0 },
});

const buildRetriever = (name: ConfigName): Retriever | null => {
  if (name === 'bm25') return new Bm25Retriever();
  if (name === 'dense') return new DenseRetriever('local:bge-m3');
  if (name === 'hybrid') return new HybridRetriever('local:bge-m3');
  if (!config.rerank.enabled || !config.rerank.baseUrl || !config.rerank.model) return null;
  return new RerankRetriever(new HybridRetriever('local:bge-m3'), {
    baseUrl: config.rerank.baseUrl,
    apiKey: config.rerank.apiKey,
    model: config.rerank.model,
    timeoutMs: config.rerank.timeoutMs,
    candidates: config.rerank.candidates,
  });
};

/**
 * A configured but unreachable reranker would make every call fall back to the
 * hybrid order, and the eval would publish hybrid numbers under the rerank
 * label. Probe once and skip the configuration instead.
 */
const probeReranker = async (): Promise<string | undefined> => {
  const baseUrl = config.rerank.baseUrl?.replace(/\/$/, '');
  if (!baseUrl || !config.rerank.model) return undefined;
  // A real one-token completion: some gateways answer /models while every
  // completion fails upstream.
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'content-type': 'application/json',
        ...(config.rerank.apiKey ? { authorization: `Bearer ${config.rerank.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.rerank.model,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Reply with: ok' }],
      }),
    });
    if (response.ok) return undefined;
    const body = (await response.text()).slice(0, 200);
    logger.warn('rerank endpoint rejected the probe, skipping hybrid+rerank', {
      status: response.status,
      body,
    });
    return `rerank endpoint rejected a probe request (HTTP ${response.status})`;
  } catch (error: unknown) {
    logger.warn('rerank endpoint unreachable, skipping hybrid+rerank', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 'rerank endpoint configured but unreachable at eval time';
  }
};

export const runEval = async (): Promise<EvalResults> => {
  const questions = await listGoldenQuestions();
  if (questions.length === 0)
    throw new Error('no golden questions in database: run pnpm ingest first');
  const thresholds = await readThresholds();
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const configs: Partial<Record<ConfigName, ConfigResult>> = {};

  for (const name of CONFIG_NAMES) {
    logger.info('running config', { config: name });
    const retriever = buildRetriever(name);
    const skipReason = retriever && name === 'hybrid+rerank' ? await probeReranker() : undefined;
    const result = await runConfig(
      name,
      retriever,
      questions,
      thresholds[name] ?? config.ABSTAIN_THRESHOLD,
      skipReason,
    );
    configs[name] = result;
    if (result.status === 'ok') {
      await insertEvalRun({
        runId,
        config: name,
        model: result.model,
        metrics: {
          overall: result.metrics.overall,
          byCategory: result.metrics.byCategory,
          abstention: result.abstention,
          cost: result.cost,
          latency: result.latency,
        },
        costUsd: result.cost.per1kQueriesUsd,
        p50Ms: result.latency.p50,
        p95Ms: result.latency.p95,
      });
      logger.info('config done', {
        config: name,
        recall: result.metrics.overall.recallAt10,
        mrr: result.metrics.overall.mrrAt10,
        p95: result.latency.p95,
      });
    }
  }

  // Router ablation: same hybrid fusion, no exact lookup, identifier slice only.
  const noRouter = new HybridRetriever('local:bge-m3', { useRouter: false });
  const withRouter = new HybridRetriever('local:bge-m3');
  const identifierQuestions = questions.filter((question) => question.category === 'identifier');
  let routerAblation: EvalResults['routerAblation'] | undefined;
  if (identifierQuestions.length > 0) {
    const runOne = async (retriever: HybridRetriever): Promise<Map<string, QuestionResult>> => {
      retriever.resetStats();
      const map = new Map<string, QuestionResult>();
      for (const question of identifierQuestions) {
        const retrieved = await retriever.retrieve(question.question, K);
        map.set(question.id, {
          id: question.id,
          category: question.category,
          expected: question.expected_chunk_ids,
          retrieved: retrieved.map((item) => item.chunkId),
          topScore: retrieved[0]?.score ?? null,
          latencyMs: 0,
          abstained: false,
        });
      }
      return map;
    };
    const without = await runOne(noRouter);
    const withR = await runOne(withRouter);
    const base = sliceMetrics(identifierQuestions, without);
    const improved = sliceMetrics(identifierQuestions, withR);
    // Paired bootstrap of the recall difference.
    const baselineValues = identifierQuestions.map((question) =>
      recallAtK(without.get(question.id)?.retrieved ?? [], question.expected_chunk_ids, K),
    );
    const routedValues = identifierQuestions.map((question) =>
      recallAtK(withR.get(question.id)?.retrieved ?? [], question.expected_chunk_ids, K),
    );
    const recallDiffCI = pairedDiffCI(routedValues, baselineValues, BOOTSTRAP_SAMPLES);
    routerAblation = { withoutRouter: base, withRouter: improved, recallDiffCI };
  }

  const chunks = await countChunks();
  const documents = await countDocuments();
  const result: EvalResults = {
    runId,
    createdAt: new Date().toISOString(),
    k: K,
    bootstrapSamples: BOOTSTRAP_SAMPLES,
    corpus: { chunks, documents },
    golden: {
      total: questions.length,
      byCategory: questions.reduce<Record<string, number>>((acc, question) => {
        acc[question.category] = (acc[question.category] ?? 0) + 1;
        return acc;
      }, {}),
    },
    configs,
    routerAblation,
  };

  await mkdir(join(process.cwd(), 'results'), { recursive: true });
  const path = join(process.cwd(), 'results', `results-${runId}.json`);
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  logger.info('results written', { path });
  return result;
};

const fmt = (value: number | null, digits = 3): string =>
  value === null || Number.isNaN(value) ? 'n/a' : value.toFixed(digits);

export const renderTable = (results: EvalResults): string => {
  const header = '| config | recall@10 | MRR@10 | nDCG@10 | $/1k | p50 | p95 |';
  const separator = '| --- | --- | --- | --- | --- | --- | --- |';
  const rows = CONFIG_NAMES.map((name) => {
    const item = results.configs[name];
    if (!item || item.status === 'skipped') {
      const cell = item ? 'skipped' : 'TODO — not measured yet';
      return `| ${name} | ${cell} | ${cell} | ${cell} | ${cell} | ${cell} | ${cell} |`;
    }
    return `| ${name} | ${fmt(item.metrics.overall.recallAt10)} | ${fmt(item.metrics.overall.mrrAt10)} | ${fmt(
      item.metrics.overall.ndcgAt10,
    )} | $${fmt(item.cost.per1kQueriesUsd, 2)} | ${Math.round(item.latency.p50)} ms | ${Math.round(
      item.latency.p95,
    )} ms |`;
  });
  return [header, separator, ...rows].join('\n');
};

export const renderSliceTable = (results: EvalResults): string => {
  const header =
    '| slice | config | recall@10 | MRR@10 | nDCG@10 | abstention precision | abstention recall |';
  const separator = '| --- | --- | --- | --- | --- | --- | --- |';
  const rows: string[] = [];
  for (const slice of ['semantic', 'identifier', 'temporal', 'unanswerable']) {
    for (const name of CONFIG_NAMES) {
      const item = results.configs[name];
      if (!item || item.status === 'skipped') continue;
      const metrics = item.metrics.byCategory[slice] ?? emptySlice();
      const precision = slice === 'unanswerable' ? item.abstention.precision : null;
      const recall = slice === 'unanswerable' ? item.abstention.recall : null;
      // Unanswerable questions have no expected chunks: retrieval metrics do not apply.
      const retrieval =
        slice === 'unanswerable'
          ? 'n/a | n/a | n/a'
          : `${fmt(metrics.recallAt10)} | ${fmt(metrics.mrrAt10)} | ${fmt(metrics.ndcgAt10)}`;
      rows.push(`| ${slice} | ${name} | ${retrieval} | ${fmt(precision)} | ${fmt(recall)} |`);
    }
  }
  return [header, separator, ...rows].join('\n');
};
