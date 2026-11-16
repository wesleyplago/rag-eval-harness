/**
 * Prices used to turn token counts into money. Everything is USD.
 *
 * Sources checked on 2026-10-23:
 *  - Anthropic API pricing (Claude Haiku 4.5): https://www.anthropic.com/pricing#api
 *    input $1.00 / MTok, output $5.00 / MTok.
 *    The reranker in this repo is served through Kiro (local 9router), so the
 *    marginal API cost is $0; the column reports the list-price equivalent and
 *    the report states that explicitly.
 *  - Embeddings run locally (bge-m3 via transformers.js): no per-token price.
 *    Hardware/electricity are not priced. This is why embedding cost is $0.00.
 */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  source: string;
  note?: string;
}

export const PRICES: Record<string, ModelPrice> = {
  'kr/claude-haiku-4.5': {
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
    source: 'https://www.anthropic.com/pricing#api',
    note: 'Served via Kiro/9router subscription; list price shown for comparability.',
  },
  'kr/claude-sonnet-4.5': {
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    source: 'https://www.anthropic.com/pricing#api',
  },
  'local:bge-m3': {
    inputPerMTok: 0,
    outputPerMTok: 0,
    source: 'self-hosted @huggingface/transformers',
    note: 'No API cost. Compute time is measured as latency, not priced.',
  },
};

export const priceFor = (model: string): ModelPrice => {
  const price = PRICES[model];
  if (!price) {
    throw new Error(
      `No price entry for model "${model}". Add it to src/eval/pricing.ts with a source URL.`,
    );
  }
  return price;
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export const costUsd = (usage: TokenUsage, model: string): number => {
  const price = priceFor(model);
  return (
    (usage.inputTokens / 1_000_000) * price.inputPerMTok +
    (usage.outputTokens / 1_000_000) * price.outputPerMTok
  );
};

/** Cost of running 1,000 queries with the observed average token usage. */
export const costPer1kQueries = (usage: TokenUsage, model: string): number =>
  costUsd(usage, model) * 1000;
