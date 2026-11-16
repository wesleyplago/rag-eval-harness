import { z } from 'zod';
import { getChunksByIds } from '../db/queries.js';
import { RerankError } from '../errors.js';
import { countTokens } from '../ingest/tokens.js';
import { logger } from '../logger.js';
import type { HybridRetriever } from './hybrid.js';
import {
  emptyStats,
  type RetrievalResult,
  type RetrievalRunStats,
  type Retriever,
} from './types.js';

const ResponseSchema = z.object({ ids: z.array(z.number().int()) });
const ArraySchema = z.array(z.number().int());

export interface RerankOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  candidates: number;
}

export const buildRerankPrompt = (
  question: string,
  candidates: Array<{ chunkId: number; content: string }>,
  k: number,
): string => {
  const list = candidates
    .map((candidate, index) => {
      // Cap per-candidate text so 50 chunks fit comfortably in a 200k window.
      const text = candidate.content.slice(0, 3000);
      return `[${index + 1}] id=${candidate.chunkId}\n${text}`;
    })
    .join('\n\n---\n\n');

  return `Pergunta: ${question}

Abaixo estão ${candidates.length} trechos candidatos de normas do Banco Central do Brasil.
Cada trecho tem um campo "id" numérico. Avalie a relevância de cada trecho para responder à pergunta.

${list}

Retorne SOMENTE um JSON válido, sem markdown e sem explicação, no formato:
{"ids": [id1, id2, ...]}

Regras:
- No máximo ${k} ids, ordenados do mais relevante para o menos relevante.
- Use exclusivamente ids que aparecem na lista acima.
- Se nenhum trecho responder à pergunta, retorne {"ids": []}.`;
};

const parseIds = (content: string): number[] | null => {
  const cleaned = content
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    const parsed: unknown = JSON.parse(candidate);
    const object = ResponseSchema.safeParse(parsed);
    if (object.success) return object.data.ids;
    const array = ArraySchema.safeParse(parsed);
    if (array.success) return array.data;
    return null;
  } catch {
    return null;
  }
};

const readChatContent = (
  payload: unknown,
): { content: string; inputTokens: number; outputTokens: number } | null => {
  if (typeof payload !== 'object' || payload === null) return null;
  const data = payload as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;
  return {
    content,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
};

const parseSse = (body: string): { content: string; inputTokens: number; outputTokens: number } => {
  let content = '';
  let inputTokens = 0;
  let outputTokens = 0;
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      content += parsed.choices?.[0]?.delta?.content ?? '';
      inputTokens = parsed.usage?.prompt_tokens ?? inputTokens;
      outputTokens = parsed.usage?.completion_tokens ?? outputTokens;
    } catch {
      // Ignore keep-alive or malformed SSE frames.
    }
  }
  return { content, inputTokens, outputTokens };
};

const callReranker = async (
  options: RerankOptions,
  question: string,
  candidates: Array<{ chunkId: number; content: string }>,
  k: number,
): Promise<{ ids: number[]; inputTokens: number; outputTokens: number }> => {
  const prompt = buildRerankPrompt(question, candidates, k);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: options.model,
        temperature: 0,
        max_tokens: 400,
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              'You are a precise retrieval reranker. You always answer with a single JSON object and nothing else.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new RerankError(`reranker HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    const text = await response.text();
    const parsed = text.trimStart().startsWith('data:')
      ? parseSse(text)
      : (() => {
          const json = readChatContent(JSON.parse(text) as unknown);
          return json;
        })();
    if (!parsed) throw new RerankError('reranker returned an unexpected payload');
    const ids = parseIds(parsed.content);
    if (ids === null)
      throw new RerankError(`reranker returned invalid JSON: ${parsed.content.slice(0, 200)}`);
    return {
      ids,
      inputTokens: parsed.inputTokens || countTokens(prompt),
      outputTokens: parsed.outputTokens || countTokens(parsed.content),
    };
  } catch (error: unknown) {
    if (error instanceof RerankError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new RerankError(`reranker call failed: ${message}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Applies the reranker's order to the fused list.
 *
 * Ids the model invents or repeats are dropped; remaining slots are filled in
 * fused order. Returns null when no usable id came back (caller falls back).
 *
 * Scores: the reranker decides the ORDER, not the CONFIDENCE. Position i gets
 * the i-th best fused score, so the top-1 score is the same signal the hybrid
 * configuration uses for abstention. Giving the reranked top-1 its own (lower)
 * fused score made abstention fire on answerable questions it had not fired on
 * for hybrid — 19 lost hits in the 2026-10-23 run, all from that bug.
 */
export const applyRerankOrder = (
  fused: RetrievalResult[],
  ids: number[],
  k: number,
): RetrievalResult[] | null => {
  const allowed = new Set(fused.map((item) => item.chunkId));
  const ranked: number[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (allowed.has(id) && !seen.has(id)) {
      ranked.push(id);
      seen.add(id);
    }
  }
  if (ranked.length === 0) return null;
  for (const item of fused) {
    if (ranked.length >= k) break;
    if (!seen.has(item.chunkId)) {
      ranked.push(item.chunkId);
      seen.add(item.chunkId);
    }
  }
  const scores = fused.map((item) => item.score).sort((a, b) => b - a);
  return ranked.slice(0, k).map((chunkId, index) => ({ chunkId, score: scores[index] ?? 0 }));
};

/**
 * LLM listwise rerank: take the top-N fused candidates, ask the model for the
 * best k ids, validate the answer with Zod and drop ids that were never offered.
 * Any failure falls back to the fused order — the eval must never crash because
 * a provider hiccuped.
 */
export class RerankRetriever implements Retriever {
  readonly name = 'hybrid+rerank';
  readonly model: string;
  private readonly hybrid: HybridRetriever;
  private readonly options: RerankOptions;
  private counters = emptyStats();

  constructor(hybrid: HybridRetriever, options: RerankOptions) {
    this.hybrid = hybrid;
    this.options = options;
    this.model = options.model;
  }

  async retrieve(query: string, k: number): Promise<RetrievalResult[]> {
    const fused = await this.hybrid.retrieve(query, this.options.candidates);
    if (fused.length === 0) return [];

    const chunks = await getChunksByIds(fused.map((item) => item.chunkId));
    const candidates = fused
      .map((item) => {
        const chunk = chunks.find((entry) => entry.id === item.chunkId);
        return chunk ? { chunkId: chunk.id, content: chunk.content } : undefined;
      })
      .filter((item): item is { chunkId: number; content: string } => item !== undefined);

    const fallback = (): RetrievalResult[] => fused.slice(0, k);

    try {
      this.counters.rerankCalls += 1;
      const result = await callReranker(this.options, query, candidates, k);
      this.counters.rerankPromptTokens += result.inputTokens;
      this.counters.rerankCompletionTokens += result.outputTokens;

      const offered = new Set(candidates.map((candidate) => candidate.chunkId));
      const reordered = applyRerankOrder(
        fused.filter((item) => offered.has(item.chunkId)),
        result.ids,
        k,
      );
      if (reordered === null) {
        this.counters.rerankFallbacks += 1;
        return fallback();
      }
      return reordered;
    } catch (error: unknown) {
      this.counters.rerankFallbacks += 1;
      logger.warn('rerank failed, falling back to fused order', {
        error: error instanceof Error ? error.message : String(error),
      });
      return fallback();
    }
  }

  stats(): RetrievalRunStats {
    const own = { ...this.counters };
    const hybrid = this.hybrid.stats();
    return {
      ...own,
      embeddingTokens: hybrid.embeddingTokens,
      exactLookups: hybrid.exactLookups,
    };
  }

  resetStats(): void {
    this.counters = emptyStats();
    this.hybrid.resetStats();
  }
}
