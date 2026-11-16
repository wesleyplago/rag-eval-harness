import { denseSearch } from '../db/queries.js';
import { embedQuery } from '../ingest/embed.js';
import { countTokens } from '../ingest/tokens.js';
import {
  emptyStats,
  type RetrievalResult,
  type RetrievalRunStats,
  type Retriever,
} from './types.js';

export class DenseRetriever implements Retriever {
  readonly name = 'dense';
  readonly model: string;
  private counters = emptyStats();

  constructor(model: string) {
    this.model = model;
  }

  async retrieve(query: string, k: number): Promise<RetrievalResult[]> {
    const embedding = await embedQuery(query);
    this.counters.embeddingTokens += countTokens(query);
    return denseSearch(embedding, k);
  }

  stats(): RetrievalRunStats {
    return { ...this.counters };
  }

  resetStats(): void {
    this.counters = emptyStats();
  }
}
