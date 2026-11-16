import { describe, expect, it } from 'vitest';
import { applyRerankOrder } from '../src/retrieval/rerank.js';

const fused = [
  { chunkId: 1, score: 0.9 },
  { chunkId: 2, score: 0.8 },
  { chunkId: 3, score: 0.7 },
  { chunkId: 4, score: 0.6 },
];

describe('applyRerankOrder', () => {
  it('reorders by the model, drops invented and repeated ids, fills from fused order', () => {
    const result = applyRerankOrder(fused, [3, 99, 3, 1], 3);
    expect(result?.map((r) => r.chunkId)).toEqual([3, 1, 2]);
  });

  it('keeps the fused score distribution so abstention sees the same top-1 score', () => {
    const result = applyRerankOrder(fused, [4], 2);
    expect(result).toEqual([
      { chunkId: 4, score: 0.9 },
      { chunkId: 1, score: 0.8 },
    ]);
  });

  it('returns null when the model gave no usable id', () => {
    expect(applyRerankOrder(fused, [], 3)).toBeNull();
    expect(applyRerankOrder(fused, [42], 3)).toBeNull();
  });
});
