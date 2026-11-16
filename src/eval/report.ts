import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getChunksByIds } from '../db/queries.js';
import { CONFIG_NAMES, type EvalResults, renderSliceTable, renderTable } from './runner.js';

const fmt = (value: number | null, digits = 3): string =>
  value === null || Number.isNaN(value) ? 'n/a' : value.toFixed(digits);

const latestResultsPath = async (): Promise<string> => {
  const dir = join(process.cwd(), 'results');
  const files = (await readdir(dir))
    .filter((file) => /^results-.*\.json$/.test(file))
    .sort()
    .reverse();
  const file = files[0];
  if (!file) throw new Error('no results/results-*.json found: run pnpm eval first');
  return join(dir, file);
};

interface FailureExplanation {
  questionId: string;
  question: string;
  category: string;
  expected: number[];
  top: Array<{ chunkId: number; sectionPath: string; documentSlug: string }>;
  hypothesis: string;
}

const explainFailures = async (results: EvalResults): Promise<FailureExplanation[]> => {
  const config = results.configs.hybrid;
  if (config?.status !== 'ok') return [];
  const failures = config.perQuestion.filter((question) => {
    if (question.expected.length === 0) return false;
    const top = new Set(question.retrieved);
    return question.expected.every((id) => !top.has(id));
  });
  const explanations: FailureExplanation[] = [];
  for (const failure of failures.slice(0, 10)) {
    const chunks = await getChunksByIds(failure.retrieved.slice(0, 3));
    let hypothesis =
      'termo da pergunta não aparece no chunk esperado; BM25 e denso concordam no erro';
    if (failure.abstained)
      hypothesis = 'o sistema abstém: score do topo abaixo do limiar calibrado';
    else if (failure.category === 'identifier')
      hypothesis = 'identificador não foi detectado ou não está no chunk esperado';
    else if (failure.category === 'temporal')
      hypothesis =
        'duas datas/vigências concorrentes na mesma seção; o modelo recupera a versão errada';
    else if (chunks.some((chunk) => chunk.sectionPath === chunks[0]?.sectionPath))
      hypothesis =
        'chunks vizinhos da mesma seção competem e empurram o chunk correto para fora do top-10';
    explanations.push({
      questionId: failure.id,
      question: questionsById.get(failure.id) ?? failure.id,
      category: failure.category,
      expected: failure.expected,
      top: chunks.map((chunk) => ({
        chunkId: chunk.id,
        sectionPath: chunk.sectionPath,
        documentSlug: chunk.documentSlug,
      })),
      hypothesis,
    });
  }
  return explanations;
};

const questionsById = new Map<string, string>();

export const generateReport = async (): Promise<string> => {
  const path = await latestResultsPath();
  const raw = await readFile(path, 'utf8');
  const results = JSON.parse(raw) as EvalResults;

  try {
    const goldenRaw = await readFile(join(process.cwd(), 'golden', 'questions.jsonl'), 'utf8');
    for (const line of goldenRaw.split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { id: string; question: string };
      questionsById.set(row.id, row.question);
    }
  } catch {
    // The report can still be produced without question text.
  }
  const failures = await explainFailures(results);
  const lines: string[] = [
    '# Evaluation report',
    '',
    `- Run: \`${results.runId}\` (${results.createdAt})`,
    `- Corpus: ${results.corpus.documents} documents, ${results.corpus.chunks} chunks`,
    `- Golden set: ${results.golden.total} questions (${Object.entries(results.golden.byCategory)
      .map(([category, count]) => `${count} ${category}`)
      .join(', ')})`,
    `- Retrieval metric: recall/MRR/nDCG at ${results.k}, binary relevance on expected_chunk_ids`,
    `- Confidence intervals: paired bootstrap, ${results.bootstrapSamples} resamples, 95%`,
    '',
    '## Headline',
    '',
    renderTable(results),
    '',
    '## By slice',
    '',
    renderSliceTable(results),
    '',
    '## Confidence intervals (overall)',
    '',
    '| config | recall@10 [95% CI] | MRR@10 [95% CI] | nDCG@10 [95% CI] |',
    '| --- | --- | --- | --- |',
  ];

  for (const name of CONFIG_NAMES) {
    const config = results.configs[name];
    if (config?.status !== 'ok') continue;
    const overall = config.metrics.overall;
    lines.push(
      `| ${name} | ${fmt(overall.recallAt10)} [${fmt(overall.recallCI.low)}, ${fmt(
        overall.recallCI.high,
      )}] | ${fmt(overall.mrrAt10)} [${fmt(overall.mrrCI.low)}, ${fmt(overall.mrrCI.high)}] | ${fmt(
        overall.ndcgAt10,
      )} [${fmt(overall.ndcgCI.low)}, ${fmt(overall.ndcgCI.high)}] |`,
    );
  }

  lines.push(
    '',
    '## Cost per 1,000 queries',
    '',
    '| config | $/1k | embedding $/query | rerank $/query | avg rerank input tokens | rerank fallbacks |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const name of CONFIG_NAMES) {
    const config = results.configs[name];
    if (config?.status !== 'ok') continue;
    const embeddingPerQuery = config.cost.embeddingUsd / Math.max(1, results.golden.total);
    const rerankPerQuery = config.cost.rerankUsd / Math.max(1, results.golden.total);
    lines.push(
      `| ${name} | $${fmt(config.cost.per1kQueriesUsd, 2)} | $${fmt(embeddingPerQuery, 5)} | $${fmt(rerankPerQuery, 5)} | ${Math.round(
        config.cost.avgRerankInputTokens,
      )} | ${config.cost.rerankFallbacks} |`,
    );
  }

  lines.push(
    '',
    '## Abstention',
    '',
    '| config | precision | recall | F1 | false abstention rate |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const name of CONFIG_NAMES) {
    const config = results.configs[name];
    if (config?.status !== 'ok') continue;
    lines.push(
      `| ${name} | ${fmt(config.abstention.precision)} | ${fmt(config.abstention.recall)} | ${fmt(
        config.abstention.f1,
      )} | ${fmt(config.abstention.falseAbstentionRate)} |`,
    );
  }

  if (results.routerAblation) {
    lines.push(
      '',
      '## Router ablation (identifier slice)',
      '',
      `- hybrid without exact lookup: recall@10 ${fmt(results.routerAblation.withoutRouter.recallAt10)}`,
      `- hybrid with exact lookup: recall@10 ${fmt(results.routerAblation.withRouter.recallAt10)}`,
    );
  }

  lines.push('', '## Failure gallery (10 queries still wrong on hybrid)', '');
  for (const failure of failures) {
    lines.push(
      `### ${failure.questionId} — ${failure.category}`,
      '',
      `**Question:** ${failure.question}`,
      '',
      `**Expected chunk ids:** ${failure.expected.join(', ')}`,
      '',
      `**Retrieved top-3:** ${failure.top.map((item) => `${item.chunkId} (${item.documentSlug} › ${item.sectionPath})`).join('; ') || '—'}`,
      '',
      `**Hypothesis:** ${failure.hypothesis}`,
      '',
    );
  }

  const report = `${lines.join('\n')}\n`;
  await writeFile(join(process.cwd(), 'results', 'REPORT.md'), report, 'utf8');
  return report;
};

export const setQuestionIndex = (questions: Array<{ id: string; question: string }>): void => {
  for (const question of questions) questionsById.set(question.id, question.question);
};
