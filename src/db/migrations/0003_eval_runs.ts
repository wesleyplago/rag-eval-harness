import type { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('eval_runs', (table) => {
    table.increments('id').primary();
    table.text('run_id').notNullable();
    table.text('config').notNullable();
    table.text('model').notNullable();
    table.jsonb('metrics').notNullable();
    table.decimal('cost_usd', 12, 6).notNullable().defaultTo(0);
    table.integer('p50_ms').notNullable().defaultTo(0);
    table.integer('p95_ms').notNullable().defaultTo(0);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE INDEX eval_runs_run_id_idx ON eval_runs (run_id)');
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('eval_runs');
};
