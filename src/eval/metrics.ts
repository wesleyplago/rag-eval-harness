export const recallAtK = (retrieved: number[], expected: number[], k: number): number => {
  if (expected.length === 0) return 0;
  const top = new Set(retrieved.slice(0, k));
  const hits = expected.filter((id) => top.has(id)).length;
  return hits / expected.length;
};

export const reciprocalRankAtK = (retrieved: number[], expected: number[], k: number): number => {
  const expectedSet = new Set(expected);
  for (let i = 0; i < Math.min(retrieved.length, k); i += 1) {
    const id = retrieved[i];
    if (id !== undefined && expectedSet.has(id)) return 1 / (i + 1);
  }
  return 0;
};

export const ndcgAtK = (retrieved: number[], expected: number[], k: number): number => {
  if (expected.length === 0) return 0;
  const expectedSet = new Set(expected);
  let dcg = 0;
  for (let i = 0; i < Math.min(retrieved.length, k); i += 1) {
    const id = retrieved[i];
    if (id !== undefined && expectedSet.has(id)) dcg += 1 / Math.log2(i + 2);
  }
  const idealHits = Math.min(expected.length, k);
  let idcg = 0;
  for (let i = 0; i < idealHits; i += 1) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
};

export const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
};

/** Deterministic PRNG so bootstrap intervals are reproducible across runs. */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface ConfidenceInterval {
  mean: number;
  low: number;
  high: number;
  samples: number;
}

/**
 * Paired bootstrap over questions: each replicate resamples the same question
 * indices for every series, so the intervals describe the same population.
 */
export const bootstrapCI = (values: number[], resamples: number, seed = 42): ConfidenceInterval => {
  if (values.length === 0) return { mean: 0, low: 0, high: 0, samples: 0 };
  const random = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) {
      const index = Math.floor(random() * values.length);
      sum += values[index] ?? 0;
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  const low = means[Math.floor(0.025 * means.length)] ?? 0;
  const high = means[Math.floor(0.975 * means.length)] ?? 0;
  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  return { mean, low, high, samples: resamples };
};

/** Paired bootstrap of the difference (a - b) between two configurations. */
export const pairedDiffCI = (
  a: number[],
  b: number[],
  resamples: number,
  seed = 42,
): ConfidenceInterval => {
  if (a.length !== b.length || a.length === 0) {
    return { mean: 0, low: 0, high: 0, samples: 0 };
  }
  const random = mulberry32(seed);
  const diffs: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) {
      const index = Math.floor(random() * a.length);
      sum += (a[index] ?? 0) - (b[index] ?? 0);
    }
    diffs.push(sum / a.length);
  }
  diffs.sort((x, y) => x - y);
  return {
    mean: a.reduce((acc, value, index) => acc + (value - (b[index] ?? 0)), 0) / a.length,
    low: diffs[Math.floor(0.025 * diffs.length)] ?? 0,
    high: diffs[Math.floor(0.975 * diffs.length)] ?? 0,
    samples: resamples,
  };
};

export const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((acc, value) => acc + value, 0) / values.length;
