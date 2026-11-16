import { describe, expect, it } from 'vitest';
import { ndcgAtK, recallAtK, reciprocalRankAtK } from '../src/eval/metrics.js';

describe('metrics', () => {
  // Hand-computed case:
  // retrieved = [5, 3, 9]; expected = {3, 7}
  // recall@10 = 1 hit / 2 expected = 0.5
  // MRR@10   = 1 / rank(3) = 1/2
  // nDCG@10  = DCG(0 + 1/log2(3) + 0) / (1/log2(2) + 1/log2(3))
  it('matches a hand-computed recall/MRR/nDCG case', () => {
    const retrieved = [5, 3, 9];
    const expected = [3, 7];

    expect(recallAtK(retrieved, expected, 10)).toBeCloseTo(0.5, 10);
    expect(reciprocalRankAtK(retrieved, expected, 10)).toBeCloseTo(0.5, 10);

    const dcg = 1 / Math.log2(3);
    const idcg = 1 / Math.log2(2) + 1 / Math.log2(3);
    expect(ndcgAtK(retrieved, expected, 10)).toBeCloseTo(dcg / idcg, 10);
  });

  it('returns zero when nothing relevant is retrieved and ignores hits beyond k', () => {
    expect(recallAtK([1, 2], [3], 10)).toBe(0);
    expect(reciprocalRankAtK([1, 2], [3], 10)).toBe(0);
    expect(recallAtK([3], [3], 1)).toBe(1);
    expect(recallAtK([9, 3], [3], 1)).toBe(0);
    expect(typeof reciprocalRankAtK).toBe('function');
  });
});
