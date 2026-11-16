import { bm25Search } from '../db/queries.js';
import { countTokens } from '../ingest/tokens.js';
import {
  emptyStats,
  type RetrievalResult,
  type RetrievalRunStats,
  type Retriever,
} from './types.js';

export class Bm25Retriever implements Retriever {
  readonly name = 'bm25';
  readonly model = 'postgres-tsvector-pt';
  private counters = emptyStats();

  async retrieve(query: string, k: number): Promise<RetrievalResult[]> {
    this.counters.embeddingTokens += 0;
    return bm25Search(query, k);
  }

  stats(): RetrievalRunStats {
    return { ...this.counters };
  }

  resetStats(): void {
    this.counters = emptyStats();
  }
}

/** Exposed for the eval: BM25 costs zero tokens on our side (Postgres does the work). */
export const bm25TokenCost = (query: string): number => countTokens(query);
