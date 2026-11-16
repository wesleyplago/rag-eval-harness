import type { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('golden_questions', (table) => {
    table.text('id').primary();
    table.text('question').notNullable();
    table
      .text('category')
      .notNullable()
      .checkIn(['semantic', 'identifier', 'temporal', 'unanswerable']);
    table.specificType('expected_chunk_ids', 'integer[]').notNullable().defaultTo('{}');
    table.boolean('unanswerable').notNullable().defaultTo(false);
    table.text('source_chunk_id').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('golden_questions');
};
