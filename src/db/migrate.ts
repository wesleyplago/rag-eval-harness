import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger.js';
import { db } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));
const directory = join(here, 'migrations');

export const runMigrations = async (): Promise<string[]> => {
  const [batch, migrations] = await db().migrate.latest({ directory, extension: 'ts' });
  logger.info('migrations up to date', { batch, migrations });
  return migrations;
};

export const rollbackMigrations = async (): Promise<void> => {
  const [batch, migrations] = await db().migrate.rollback({ directory, extension: 'ts' }, true);
  logger.info('rolled back', { batch, migrations });
};
