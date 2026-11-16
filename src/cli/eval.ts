import { closeDb } from '../db/client.js';
import { renderAblationTable, runAblation } from '../eval/ablation.js';
import { generateReport } from '../eval/report.js';
import { renderSliceTable, renderTable, runEval } from '../eval/runner.js';
import { logger } from '../logger.js';

const main = async (): Promise<void> => {
  if (process.argv.includes('--ablation')) {
    const rows = await runAblation();
    console.log(renderAblationTable(rows));
    console.log('\nAblation is BM25-only: chunking changes the index, and re-embedding six');
    console.log('variants would multiply the eval cost. See docs/adr/0001-chunking.md.');
    await closeDb();
    return;
  }

  const results = await runEval();
  console.log(
    `\nRun ${results.runId} — ${results.corpus.documents} documents, ${results.corpus.chunks} chunks`,
  );
  console.log(renderTable(results));
  console.log('\nBy slice\n');
  console.log(renderSliceTable(results));

  if (results.routerAblation) {
    console.log('\nRouter ablation (identifier slice)');
    console.log(
      `- hybrid without exact lookup: recall@10 ${results.routerAblation.withoutRouter.recallAt10.toFixed(3)}`,
    );
    console.log(
      `- hybrid with exact lookup: recall@10 ${results.routerAblation.withRouter.recallAt10.toFixed(3)}`,
    );
    const diff = results.routerAblation.recallDiffCI;
    if (diff) {
      console.log(
        `- paired difference: ${diff.mean.toFixed(3)} [95% CI ${diff.low.toFixed(3)}, ${diff.high.toFixed(3)}]`,
      );
    }
  }

  const report = await generateReport();
  logger.info('report generated', { chars: report.length });
  await closeDb();
};

main().catch(async (error: unknown) => {
  logger.error('eval failed', { error: error instanceof Error ? error.message : String(error) });
  await closeDb();
  process.exitCode = 1;
});
