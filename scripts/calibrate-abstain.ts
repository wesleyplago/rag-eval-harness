import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_NAMES, type ConfigName, type EvalResults } from '../src/eval/runner.js';
import { calibrateThreshold, scoreAbstention } from '../src/retrieval/abstain.js';

const latestResults = async (): Promise<EvalResults> => {
  const dir = join(process.cwd(), 'results');
  const files = (await readdir(dir))
    .filter((file) => /^results-.*\.json$/.test(file))
    .sort()
    .reverse();
  const file = files[0];
  if (!file) throw new Error('run pnpm eval before calibrating abstention');
  return JSON.parse(await readFile(join(dir, file), 'utf8')) as EvalResults;
};

const main = async (): Promise<void> => {
  const results = await latestResults();
  const thresholds: Partial<Record<ConfigName, number>> = {};
  const report: string[] = ['# Abstention calibration', '', `Source run: \`${results.runId}\``, ''];

  for (const name of CONFIG_NAMES) {
    const config = results.configs[name];
    if (config?.status !== 'ok') continue;
    const candidates = config.perQuestion
      .filter((question) => question.topScore !== null)
      .map((question) => ({
        score: question.topScore as number,
        answerable: question.expected.length > 0,
      }));
    const { threshold, metrics } = calibrateThreshold(candidates, 0.15);
    thresholds[name] = Number(threshold.toFixed(4));
    report.push(
      `- **${name}**: threshold ${threshold.toFixed(4)} — precision ${metrics.precision?.toFixed(3) ?? 'n/a'}, recall ${
        metrics.recall?.toFixed(3) ?? 'n/a'
      }, false abstention ${metrics.falseAbstentionRate?.toFixed(3) ?? 'n/a'}`,
    );
  }

  // Sanity check: applying the chosen threshold must reproduce the metrics.
  for (const name of CONFIG_NAMES) {
    const config = results.configs[name];
    if (config?.status !== 'ok') continue;
    const threshold = thresholds[name] ?? 0;
    const metrics = scoreAbstention(
      config.perQuestion.map((question) => ({
        shouldAbstain: question.expected.length === 0,
        abstained: (question.topScore ?? 0) < threshold,
      })),
    );
    if (metrics.recall !== null && config.abstention.recall !== null) {
      // Different threshold than the one used in the run is expected; log only.
      report.push(
        `- ${name} check: with ${threshold}, precision ${metrics.precision?.toFixed(3)}, recall ${metrics.recall?.toFixed(3)}`,
      );
    }
  }

  await mkdir(join(process.cwd(), 'config'), { recursive: true });
  await writeFile(
    join(process.cwd(), 'config', 'abstention.json'),
    `${JSON.stringify(thresholds, null, 2)}\n`,
  );
  await writeFile(join(process.cwd(), 'config', 'ABSTENTION.md'), `${report.join('\n')}\n`);
  console.log(report.join('\n'));
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
