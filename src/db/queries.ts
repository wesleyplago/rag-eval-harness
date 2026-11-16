import type { Knex } from 'knex';
import { db } from './client.js';

export interface DocumentInput {
  slug: string;
  title: string;
  sourceUrl: string;
  retrievedAt: string;
  licenseNote: string;
}

export interface ChunkInput {
  id: number;
  documentId: number;
  sectionPath: string;
  chunkIndex: number;
  content: string;
  isTable: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  embedding: number[];
}

export interface ChunkRecord {
  id: number;
  documentId: number;
  documentSlug: string;
  documentTitle: string;
  sectionPath: string;
  chunkIndex: number;
  content: string;
  isTable: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface ScoredChunk {
  chunkId: number;
  score: number;
}

export interface GoldenQuestion {
  id: string;
  question: string;
  category: 'semantic' | 'identifier' | 'temporal' | 'unanswerable';
  expected_chunk_ids: number[];
  unanswerable: boolean;
}

const toVector = (embedding: number[]): string => `[${embedding.join(',')}]`;

export const upsertDocument = async (input: DocumentInput): Promise<number> => {
  const [row] = await db()('documents')
    .insert({
      slug: input.slug,
      title: input.title,
      source_url: input.sourceUrl,
      retrieved_at: input.retrievedAt,
      license_note: input.licenseNote,
    })
    .onConflict('slug')
    .merge({
      title: input.title,
      source_url: input.sourceUrl,
      retrieved_at: input.retrievedAt,
      license_note: input.licenseNote,
    })
    .returning('id');
  const id = (row as { id?: number } | undefined)?.id;
  if (typeof id !== 'number') throw new Error(`could not upsert document ${input.slug}`);
  return id;
};

export const deleteChunksForDocument = async (documentId: number): Promise<void> => {
  await db()('chunks').where({ document_id: documentId }).delete();
};

export const insertChunks = async (chunks: ChunkInput[], trx?: Knex.Transaction): Promise<void> => {
  const runner = trx ?? db();
  const batchSize = 50;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize).map((chunk) => ({
      id: chunk.id,
      document_id: chunk.documentId,
      section_path: chunk.sectionPath,
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      is_table: chunk.isTable,
      effective_from: chunk.effectiveFrom,
      effective_to: chunk.effectiveTo,
      embedding: db().raw('?::vector', [toVector(chunk.embedding)]),
    }));
    await runner('chunks').insert(batch);
  }
};

export const countChunks = async (): Promise<number> => {
  const result = await db()('chunks').count<{ count: string }[]>('id as count');
  return Number(result[0]?.count ?? 0);
};

export const countDocuments = async (): Promise<number> => {
  const result = await db()('documents').count<{ count: string }[]>('id as count');
  return Number(result[0]?.count ?? 0);
};

export const chunkStats = async (): Promise<{
  total: number;
  tables: number;
  documents: number;
  minTokens: number;
  maxTokens: number;
}> => {
  const result = await db().raw<{
    rows: Array<{ total: string; tables: string; documents: string }>;
  }>(`
    SELECT count(*)::text AS total,
           count(*) FILTER (WHERE is_table)::text AS tables,
           count(DISTINCT document_id)::text AS documents
    FROM chunks
  `);
  const row = result.rows[0];
  return {
    total: Number(row?.total ?? 0),
    tables: Number(row?.tables ?? 0),
    documents: Number(row?.documents ?? 0),
    minTokens: 0,
    maxTokens: 0,
  };
};

export const listChunks = async (limit = 10_000): Promise<ChunkRecord[]> => {
  const rows = await db()('chunks as c')
    .join('documents as d', 'd.id', 'c.document_id')
    .select(
      'c.id',
      'c.document_id as documentId',
      'd.slug as documentSlug',
      'd.title as documentTitle',
      'c.section_path as sectionPath',
      'c.chunk_index as chunkIndex',
      'c.content',
      'c.is_table as isTable',
      'c.effective_from as effectiveFrom',
      'c.effective_to as effectiveTo',
    )
    .orderBy('c.id', 'asc')
    .limit(limit);
  return rows as ChunkRecord[];
};

export const getChunksByIds = async (ids: number[]): Promise<ChunkRecord[]> => {
  if (ids.length === 0) return [];
  const rows = await db()('chunks as c')
    .join('documents as d', 'd.id', 'c.document_id')
    .select(
      'c.id',
      'c.document_id as documentId',
      'd.slug as documentSlug',
      'd.title as documentTitle',
      'c.section_path as sectionPath',
      'c.chunk_index as chunkIndex',
      'c.content',
      'c.is_table as isTable',
      'c.effective_from as effectiveFrom',
      'c.effective_to as effectiveTo',
    )
    .whereIn('c.id', ids);
  const byId = new Map((rows as ChunkRecord[]).map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is ChunkRecord => row !== undefined);
};

export const bm25Search = async (query: string, k: number): Promise<ScoredChunk[]> => {
  // plainto_tsquery ANDs every term. Natural-language questions ("como funciona
  // o bloqueio cautelar?") therefore match zero chunks, because no single section
  // contains every word. Keep the strict query first (it is the precise one) and
  // relax `&` to `|` only to fill the remaining slots. Documented in the README.
  const strict = await db().raw<{ rows: Array<{ id: number; score: string }> }>(
    `
    SELECT id, ts_rank_cd(tsv, plainto_tsquery('portuguese', ?)) AS score
    FROM chunks
    WHERE tsv @@ plainto_tsquery('portuguese', ?)
    ORDER BY score DESC, id ASC
    LIMIT ?
    `,
    [query, query, k],
  );
  const strictRows = strict.rows.map((row) => ({ chunkId: row.id, score: Number(row.score) }));
  if (strictRows.length >= k) return strictRows;

  const relaxed = await db().raw<{ rows: Array<{ id: number; score: string }> }>(
    `
    SELECT id, ts_rank_cd(tsv, relaxed_query) AS score
    FROM chunks,
         LATERAL (SELECT (replace(plainto_tsquery('portuguese', ?)::text, ' & ', ' | '))::tsquery AS relaxed_query) q
    WHERE tsv @@ relaxed_query
    ORDER BY score DESC, id ASC
    LIMIT ?
    `,
    [query, k],
  );
  const seen = new Set(strictRows.map((row) => row.chunkId));
  const merged = [...strictRows];
  for (const row of relaxed.rows) {
    if (merged.length >= k) break;
    if (seen.has(row.id)) continue;
    merged.push({ chunkId: row.id, score: Number(row.score) });
  }
  return merged;
};

export const denseSearch = async (embedding: number[], k: number): Promise<ScoredChunk[]> => {
  const result = await db().raw<{ rows: Array<{ id: number; score: string }> }>(
    `
    SELECT id, 1 - (embedding <=> ?::vector) AS score
    FROM chunks
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ?::vector
    LIMIT ?
    `,
    [toVector(embedding), toVector(embedding), k],
  );
  return result.rows.map((row) => ({ chunkId: row.id, score: Number(row.score) }));
};

/**
 * Exact/lexical lookup for identifiers (TXID, linha digitável, CNPJ, nosso número).
 * The corpus is small enough that a sequential scan over normalized text is honest
 * and fast; an ANN index would happily miss the one chunk containing the identifier.
 */
export const identifierSearch = async (
  value: string,
  mode: 'digits' | 'alphanumeric',
  k: number,
): Promise<ScoredChunk[]> => {
  const normalized = mode === 'digits' ? value.replace(/\D/g, '') : value.toUpperCase();
  if (normalized.length === 0) return [];
  const result = await db().raw<{ rows: Array<{ id: number; score: string }> }>(
    `
    SELECT id, 1.0::float AS score
    FROM chunks
    WHERE (
      CASE WHEN ? = 'digits'
        THEN regexp_replace(content, '[^0-9]', '', 'g')
        ELSE upper(content)
      END
    ) LIKE '%' || ? || '%'
    ORDER BY length(content) ASC
    LIMIT ?
    `,
    [mode, normalized, k],
  );
  return result.rows.map((row) => ({ chunkId: row.id, score: Number(row.score) }));
};

export const listGoldenQuestions = async (): Promise<GoldenQuestion[]> => {
  const rows = await db()('golden_questions').select(
    'id',
    'question',
    'category',
    'expected_chunk_ids as expected_chunk_ids',
    'unanswerable',
  );
  return rows as GoldenQuestion[];
};

export const insertEvalRun = async (input: {
  runId: string;
  config: string;
  model: string;
  metrics: unknown;
  costUsd: number;
  p50Ms: number;
  p95Ms: number;
}): Promise<void> => {
  await db()('eval_runs').insert({
    run_id: input.runId,
    config: input.config,
    model: input.model,
    metrics: JSON.stringify(input.metrics),
    cost_usd: input.costUsd,
    p50_ms: Math.round(input.p50Ms),
    p95_ms: Math.round(input.p95Ms),
  });
};

export const latestEvalRun = async (): Promise<
  { run_id: string; created_at: string } | undefined
> => {
  const [row] = await db()('eval_runs')
    .select('run_id', 'created_at')
    .orderBy('created_at', 'desc')
    .limit(1);
  return row as { run_id: string; created_at: string } | undefined;
};
