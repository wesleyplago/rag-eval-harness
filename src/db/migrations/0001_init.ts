import type { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS vector');

  await knex.schema.createTable('documents', (table) => {
    table.increments('id').primary();
    table.text('slug').notNullable().unique();
    table.text('title').notNullable();
    table.text('source_url').notNullable();
    table.date('retrieved_at').notNullable();
    table.text('license_note').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('chunks', (table) => {
    // Deterministic 31-bit hash of (slug, chunk_index, content): golden questions
    // stay valid across re-ingests and across CI subsets.
    table.integer('id').primary();
    table
      .integer('document_id')
      .notNullable()
      .references('id')
      .inTable('documents')
      .onDelete('CASCADE');
    table.text('section_path').notNullable();
    table.integer('chunk_index').notNullable();
    table.text('content').notNullable();
    table.boolean('is_table').notNullable().defaultTo(false);
    table.date('effective_from');
    table.date('effective_to');
    table.specificType('embedding', 'vector(1024)');
    table.unique(['document_id', 'chunk_index']);
  });

  // Generated column: cannot drift from content, one less write path to get wrong.
  await knex.raw(`
    ALTER TABLE chunks
    ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED
  `);
  await knex.raw('CREATE INDEX chunks_tsv_gin ON chunks USING GIN (tsv)');
  await knex.raw(
    'CREATE INDEX chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops)',
  );
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('chunks');
  await knex.schema.dropTableIfExists('documents');
};
