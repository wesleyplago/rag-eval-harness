import { closeDb } from '../db/client.js';
import { rollbackMigrations, runMigrations } from '../db/migrate.js';
import { logger } from '../logger.js';

const command = process.argv[2] ?? 'latest';

const run = async (): Promise<void> => {
  if (command === 'rollback') await rollbackMigrations();
  else await runMigrations();
  await closeDb();
};

run().catch(async (error: unknown) => {
  logger.error('migration failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  await closeDb();
  process.exitCode = 1;
});
