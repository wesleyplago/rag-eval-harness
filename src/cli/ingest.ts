import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { closeDb, db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import {
  countChunks,
  deleteChunksForDocument,
  insertChunks,
  upsertDocument,
} from '../db/queries.js';
import { chunkMarkdown } from '../ingest/chunk.js';
import { normalizeCorpus, readSources } from '../ingest/corpus.js';
import { embedTexts } from '../ingest/embed.js';
import { fetchRawCorpus } from '../ingest/fetch.js';
import { countTokens } from '../ingest/tokens.js';
import { logger } from '../logger.js';

const GoldenSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(10),
  category: z.enum(['semantic', 'identifier', 'temporal', 'unanswerable']),
  expected_chunk_ids: z.array(z.number().int()),
  unanswerable: z.boolean(),
});

const EMBED_BATCH = 8;

const seedGolden = async (): Promise<number> => {
  const path = join(process.cwd(), 'golden', 'questions.jsonl');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    logger.warn('golden questions not found, skipping seed', { path });
    return 0;
  }
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const questions = lines.map((line, index) => {
    const parsed = GoldenSchema.safeParse(JSON.parse(line));
    if (!parsed.success) {
      throw new Error(`invalid golden question at line ${index + 1}: ${parsed.error.message}`);
    }
    return parsed.data;
  });

  await db()('golden_questions').delete();
  for (let i = 0; i < questions.length; i += 100) {
    await db()('golden_questions').insert(
      questions.slice(i, i + 100).map((question) => ({
        id: question.id,
        question: question.question,
        category: question.category,
        expected_chunk_ids: question.expected_chunk_ids,
        unanswerable: question.unanswerable,
      })),
    );
  }
  return questions.length;
};

const ingestDocument = async (source: {
  slug: string;
  title: string;
  sourceUrl: string;
  retrievedAt: string;
  licenseNote: string;
}): Promise<{ chunks: number; tokens: number; tables: number }> => {
  const markdown = await readFile(
    join(process.cwd(), 'data', 'corpus', `${source.slug}.md`),
    'utf8',
  );
  const chunks = chunkMarkdown(markdown, source.slug);
  if (chunks.length === 0) throw new Error(`no chunks produced for ${source.slug}`);

  const embedded: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await embedTexts(batch.map((chunk) => chunk.content));
    embedded.push(...vectors);
    logger.info('embedded chunks', {
      slug: source.slug,
      done: Math.min(i + EMBED_BATCH, chunks.length),
      total: chunks.length,
    });
  }

  const documentId = await upsertDocument({
    slug: source.slug,
    title: source.title,
    sourceUrl: source.sourceUrl,
    retrievedAt: source.retrievedAt,
    licenseNote: source.licenseNote,
  });
  await deleteChunksForDocument(documentId);

  await db().transaction(async (trx) => {
    await insertChunks(
      chunks.map((chunk, index) => ({
        id: chunk.id,
        documentId,
        sectionPath: chunk.sectionPath,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        isTable: chunk.isTable,
        effectiveFrom: chunk.effectiveFrom,
        effectiveTo: chunk.effectiveTo,
        embedding: embedded[index] as number[],
      })),
      trx,
    );
  });

  const tokens = chunks.reduce((sum, chunk) => sum + chunk.tokens, 0);
  const sourceTokens = countTokens(markdown);
  if (tokens < sourceTokens) {
    throw new Error(
      `chunking lost text in ${source.slug}: chunks=${tokens} tokens, source=${sourceTokens} tokens`,
    );
  }

  logger.info('document ingested', {
    slug: source.slug,
    chunks: chunks.length,
    tokens,
    sourceTokens,
    tables: chunks.filter((chunk) => chunk.isTable).length,
  });
  return { chunks: chunks.length, tokens, tables: chunks.filter((chunk) => chunk.isTable).length };
};

const main = async (): Promise<void> => {
  const refresh = process.argv.includes('--refresh');
  if (refresh) {
    logger.info('refreshing corpus from Banco Central API');
    await fetchRawCorpus();
    await normalizeCorpus();
  }

  await runMigrations();
  const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
  const only = onlyArg?.split('=')[1];
  const sources = (await readSources()).filter((source) => !only || source.slug === only);
  let total = 0;

  for (const source of sources) {
    const result = await ingestDocument(source);
    total += result.chunks;
  }

  const golden = await seedGolden();
  const stored = await countChunks();
  logger.info('ingest complete', {
    chunksInDb: stored,
    chunksProcessed: total,
    goldenQuestions: golden,
  });

  if (!only && stored !== total) {
    throw new Error(`db has ${stored} chunks but ingest produced ${total}`);
  }
  await closeDb();
};

main().catch(async (error: unknown) => {
  logger.error('ingest failed', { error: error instanceof Error ? error.message : String(error) });
  await closeDb();
  process.exitCode = 1;
});
