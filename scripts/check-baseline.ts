import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Metrics {
  recallAt10: number;
  mrrAt10: number;
  ndcgAt10: number;
}

interface Baseline {
  configs: Record<string, Metrics>;
}

interface RunResults {
  configs: Record<string, { status: string; metrics?: { overall: Metrics } }>;
}

const MAX_DROP = 0.02;

const dir = join(process.cwd(), 'results');
const baselineRaw = await readFile(join(dir, 'baseline.json'), 'utf8');
const baseline = JSON.parse(baselineRaw) as Baseline;

const files = (await readdir(dir))
  .filter((file) => /^results-.*\.json$/.test(file))
  .sort()
  .reverse();
const latest = files[0];
if (!latest) {
  console.error('No results/results-*.json found.');
  process.exit(1);
}
const results = JSON.parse(await readFile(join(dir, latest), 'utf8')) as RunResults;

let failed = false;
for (const [name, expected] of Object.entries(baseline.configs)) {
  const current = results.configs[name];
  if (current?.status === 'skipped') {
    // CI has no rerank endpoint; a skipped config is reported, not compared.
    console.log(`- ${name}: skipped in this run, not compared`);
    continue;
  }
  if (current?.status !== 'ok' || !current.metrics) {
    console.error(`✗ ${name}: missing from the eval run`);
    failed = true;
    continue;
  }
  const recall = current.metrics.overall.recallAt10;
  const delta = recall - expected.recallAt10;
  const status = delta < -MAX_DROP ? '✗' : '✓';
  console.log(
    `${status} ${name}: recall@10 ${recall.toFixed(4)} vs baseline ${expected.recallAt10.toFixed(4)} (${delta >= 0 ? '+' : ''}${delta.toFixed(4)})`,
  );
  if (delta < -MAX_DROP) failed = true;
}

if (failed) {
  console.error(`\nRecall@10 dropped more than ${MAX_DROP} points against results/baseline.json.`);
  process.exit(1);
}
console.log('\nNo regression beyond the 2-point recall budget.');
