import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from '../src/retrieval/hybrid.js';

describe('reciprocalRankFusion', () => {
  it('ranks items by summed reciprocal rank and breaks ties by best rank then id', () => {
    const bm25 = [
      { chunkId: 1, score: 0.9 },
      { chunkId: 2, score: 0.8 },
      { chunkId: 3, score: 0.7 },
    ];
    const dense = [
      { chunkId: 2, score: 0.95 },
      { chunkId: 1, score: 0.9 },
      { chunkId: 4, score: 0.5 },
    ];
    const fused = reciprocalRankFusion([bm25, dense], 4, 60);

    // id 1 and 2 both get 1/61 + 1/62; id 1 wins the tie because its best rank is 1 on the first list.
    expect(fused.map((item) => item.chunkId)).toEqual([1, 2, 3, 4]);
    expect(fused[0]?.score).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(fused[2]?.score).toBeCloseTo(1 / 63, 10);
    // id 4 is rank 3 in the dense list, so it also gets 1/63 and loses the id tiebreak.
    expect(fused[3]?.score).toBeCloseTo(1 / 63, 10);
  });

  it('respects k and deduplicates ids across lists', () => {
    const fused = reciprocalRankFusion(
      [
        [{ chunkId: 7, score: 1 }],
        [
          { chunkId: 7, score: 1 },
          { chunkId: 8, score: 1 },
        ],
      ],
      2,
      60,
    );
    expect(fused).toHaveLength(2);
    expect(fused[0]?.chunkId).toBe(7);
    expect(fused[0]?.score).toBeCloseTo(1 / 61 + 1 / 61, 10);
  });
});
