import { bm25Search, denseSearch, identifierSearch } from '../db/queries.js';
import { embedQuery } from '../ingest/embed.js';
import { countTokens } from '../ingest/tokens.js';
import { detectIdentifier } from './router.js';
import {
  emptyStats,
  type RetrievalResult,
  type RetrievalRunStats,
  type Retriever,
} from './types.js';

export const RRF_K = 60;

/**
 * Reciprocal Rank Fusion. Pure function so the synthetic test can reason about
 * the exact ordering without a database. Ties are broken by the best rank the
 * item achieved, then by id, to keep results deterministic.
 */
export const reciprocalRankFusion = (
  lists: RetrievalResult[][],
  k: number,
  rrfK = RRF_K,
): RetrievalResult[] => {
  const scores = new Map<number, { score: number; bestRank: number }>();
  for (const list of lists) {
    list.forEach((item, index) => {
      const rank = index + 1;
      const current = scores.get(item.chunkId);
      const contribution = 1 / (rrfK + rank);
      if (current) {
        current.score += contribution;
        current.bestRank = Math.min(current.bestRank, rank);
      } else {
        scores.set(item.chunkId, { score: contribution, bestRank: rank });
      }
    });
  }
  return [...scores.entries()]
    .map(([chunkId, value]) => ({ chunkId, score: value.score, bestRank: value.bestRank }))
    .sort((a, b) => b.score - a.score || a.bestRank - b.bestRank || a.chunkId - b.chunkId)
    .slice(0, k)
    .map(({ chunkId, score }) => ({ chunkId, score }));
};

export interface HybridOptions {
  rrfK?: number;
  candidates?: number;
  useRouter?: boolean;
}

/**
 * Hybrid retrieval = BM25 + dense fused with RRF.
 *
 * When the query contains an identifier, exact lookup runs first and the fused
 * semantic results only fill the remaining slots. That is the only difference
 * from `hybridNoRouter`, which exists so the eval can measure the router's gain.
 */
export class HybridRetriever implements Retriever {
  readonly name: string;
  readonly model: string;
  private readonly options: Required<HybridOptions>;
  private counters = emptyStats();

  constructor(model: string, options?: HybridOptions) {
    this.model = model;
    this.options = {
      rrfK: options?.rrfK ?? RRF_K,
      candidates: options?.candidates ?? 50,
      useRouter: options?.useRouter ?? true,
    };
    this.name = this.options.useRouter ? 'hybrid' : 'hybrid-no-router';
  }

  protected async fuse(query: string, k: number): Promise<RetrievalResult[]> {
    const [lexical, semantic] = await Promise.all([
      bm25Search(query, this.options.candidates),
      embedQuery(query).then((embedding) => {
        this.counters.embeddingTokens += countTokens(query);
        return denseSearch(embedding, this.options.candidates);
      }),
    ]);
    return reciprocalRankFusion([lexical, semantic], k, this.options.rrfK);
  }

  async retrieve(query: string, k: number): Promise<RetrievalResult[]> {
    const fused = await this.fuse(query, k);

    if (!this.options.useRouter) return fused;

    const identifier = detectIdentifier(query);
    if (!identifier) return fused;

    this.counters.exactLookups += 1;
    const exact = await identifierSearch(identifier.value, identifier.mode, k);
    if (exact.length === 0) {
      // The identifier is not in the corpus: do not pretend. Fall back to fusion.
      return fused;
    }
    const seen = new Set(exact.map((item) => item.chunkId));
    const complement = fused.filter((item) => !seen.has(item.chunkId));
    return [...exact, ...complement].slice(0, k);
  }

  stats(): RetrievalRunStats {
    return { ...this.counters };
  }

  resetStats(): void {
    this.counters = emptyStats();
  }
}
