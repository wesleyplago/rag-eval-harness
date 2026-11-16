import knex, { type Knex } from 'knex';
import { config } from '../config.js';

let instance: Knex | undefined;

export const db = (): Knex => {
  if (!instance) {
    instance = knex({
      client: 'pg',
      connection: config.DATABASE_URL,
      pool: { min: 0, max: 10 },
    });
  }
  return instance;
};

export const closeDb = async (): Promise<void> => {
  if (instance) {
    await instance.destroy();
    instance = undefined;
  }
};
