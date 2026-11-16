export interface RetrievalResult {
  chunkId: number;
  score: number;
}

export interface RetrievalRunStats {
  embeddingTokens: number;
  rerankPromptTokens: number;
  rerankCompletionTokens: number;
  rerankCalls: number;
  rerankFallbacks: number;
  exactLookups: number;
  noAnswer: number;
}

export const emptyStats = (): RetrievalRunStats => ({
  embeddingTokens: 0,
  rerankPromptTokens: 0,
  rerankCompletionTokens: 0,
  rerankCalls: 0,
  rerankFallbacks: 0,
  exactLookups: 0,
  noAnswer: 0,
});

export interface Retriever {
  readonly name: string;
  readonly model: string;
  retrieve(query: string, k: number): Promise<RetrievalResult[]>;
  stats(): RetrievalRunStats;
  resetStats(): void;
}
