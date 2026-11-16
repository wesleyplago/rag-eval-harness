import { closeDb } from '../db/client.js';
import { generateReport } from '../eval/report.js';
import { logger } from '../logger.js';

const main = async (): Promise<void> => {
  const report = await generateReport();
  console.log(`Wrote results/REPORT.md (${report.length} chars)`);
  await closeDb();
};

main().catch(async (error: unknown) => {
  logger.error('report failed', { error: error instanceof Error ? error.message : String(error) });
  await closeDb();
  process.exitCode = 1;
});
