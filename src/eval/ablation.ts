import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../db/client.js';
import { bm25Search, listChunks, listGoldenQuestions } from '../db/queries.js';
import { chunkMarkdown } from '../ingest/chunk.js';
import { listCorpusFiles } from '../ingest/corpus.js';
import { logger } from '../logger.js';
import { mean, ndcgAtK, recallAtK, reciprocalRankAtK } from './metrics.js';

export interface AblationRow {
  size: number;
  overlap: number;
  chunks: number;
  coverage: number;
  recallAt10: number;
  mrrAt10: number;
  ndcgAt10: number;
}

const tokensOf = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-záéíóúâêôãõç0-9\s]/gi, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3),
  );

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
};

const loadCorpus = async (): Promise<Array<{ slug: string; markdown: string }>> => {
  const files = await listCorpusFiles();
  const corpus: Array<{ slug: string; markdown: string }> = [];
  for (const file of files) {
    corpus.push({
      slug: file.replace(/\.md$/, ''),
      markdown: await readFile(join(process.cwd(), 'data', 'corpus', file), 'utf8'),
    });
  }
  return corpus;
};

export const runAblation = async (): Promise<AblationRow[]> => {
  const corpus = await loadCorpus();
  const questions = await listGoldenQuestions();
  const baseChunks = await listChunks();
  const baseById = new Map(baseChunks.map((chunk) => [chunk.id, chunk]));
  const documentIds = new Map<string, number>();
  for (const chunk of baseChunks) documentIds.set(chunk.documentSlug, chunk.documentId);

  const variants = [
    { size: 700, overlap: 120 },
    { size: 700, overlap: 180 },
    { size: 850, overlap: 120 },
    { size: 850, overlap: 180 },
    { size: 1000, overlap: 120 },
    { size: 1000, overlap: 180 },
  ];
  const rows: AblationRow[] = [];

  for (const variant of variants) {
    logger.info('ablation variant', variant);
    const chunks = corpus.flatMap((doc) =>
      chunkMarkdown(doc.markdown, doc.slug, {
        min: variant.size,
        max: variant.size,
        overlap: variant.overlap,
      }),
    );

    await db().raw('DROP TABLE IF EXISTS ablation_chunks');
    await db().raw(
      'CREATE TABLE ablation_chunks (LIKE chunks INCLUDING GENERATED INCLUDING DEFAULTS INCLUDING CONSTRAINTS)',
    );

    for (let i = 0; i < chunks.length; i += 100) {
      const batch = chunks.slice(i, i + 100);
      await db()('ablation_chunks').insert(
        batch.map((chunk) => ({
          id: chunk.id,
          document_id: documentIds.get(chunk.documentSlug) ?? 1,
          section_path: chunk.sectionPath,
          chunk_index: chunk.chunkIndex,
          content: chunk.content,
          is_table: chunk.isTable,
          effective_from: chunk.effectiveFrom,
          effective_to: chunk.effectiveTo,
        })),
      );
    }

    const variantById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const tokenCache = new Map<number, Set<string>>();
    const tokensFor = (id: number): Set<string> => {
      const cached = tokenCache.get(id);
      if (cached) return cached;
      const tokens = tokensOf(variantById.get(id)?.content ?? '');
      tokenCache.set(id, tokens);
      return tokens;
    };

    const recalls: number[] = [];
    const mrrs: number[] = [];
    const ndcgs: number[] = [];
    let mappedQuestions = 0;

    for (const question of questions) {
      if (question.expected_chunk_ids.length === 0) continue;
      const expected: number[] = [];
      for (const baseId of question.expected_chunk_ids) {
        const original = baseById.get(baseId);
        if (!original) continue;
        const target = tokensOf(original.content);
        let best: { id: number; score: number } | undefined;
        for (const chunk of chunks) {
          const score = jaccard(target, tokensFor(chunk.id));
          if (!best || score > best.score) best = { id: chunk.id, score };
        }
        if (best && best.score >= 0.3) expected.push(best.id);
      }
      if (expected.length === 0) continue;
      mappedQuestions += 1;

      // Same BM25 as the main eval (strict AND, relaxed OR to fill), so the
      // ablation numbers are comparable with the bm25 row of the headline table.
      const retrieved = (await bm25Search(question.question, 10, 'ablation_chunks')).map(
        (row) => row.chunkId,
      );
      recalls.push(recallAtK(retrieved, expected, 10));
      mrrs.push(reciprocalRankAtK(retrieved, expected, 10));
      ndcgs.push(ndcgAtK(retrieved, expected, 10));
    }

    rows.push({
      size: variant.size,
      overlap: variant.overlap,
      chunks: chunks.length,
      coverage: mappedQuestions / questions.length,
      recallAt10: mean(recalls),
      mrrAt10: mean(mrrs),
      ndcgAt10: mean(ndcgs),
    });
  }

  await db().raw('DROP TABLE IF EXISTS ablation_chunks');
  await mkdir(join(process.cwd(), 'results'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(
    join(process.cwd(), 'results', `ablation-${stamp}.json`),
    `${JSON.stringify({ createdAt: new Date().toISOString(), k: 10, retriever: 'bm25', rows }, null, 2)}\n`,
    'utf8',
  );
  return rows;
};

export const renderAblationTable = (rows: AblationRow[]): string => {
  const header = '| chunk size | overlap | chunks | coverage | recall@10 | MRR@10 | nDCG@10 |';
  const separator = '| --- | --- | --- | --- | --- | --- | --- |';
  return [
    header,
    separator,
    ...rows.map(
      (row) =>
        `| ${row.size} | ${row.overlap} | ${row.chunks} | ${(row.coverage * 100).toFixed(0)}% | ${row.recallAt10.toFixed(
          3,
        )} | ${row.mrrAt10.toFixed(3)} | ${row.ndcgAt10.toFixed(3)} |`,
    ),
  ].join('\n');
};
