import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeDb } from '../src/db/client.js';
import { listGoldenQuestions } from '../src/db/queries.js';
import { calibrateThreshold } from '../src/retrieval/abstain.js';
import { Bm25Retriever } from '../src/retrieval/bm25.js';
import { DenseRetriever } from '../src/retrieval/dense.js';
import { HybridRetriever } from '../src/retrieval/hybrid.js';
import type { Retriever } from '../src/retrieval/types.js';

const questions = await listGoldenQuestions();
const retrievers: Array<[string, Retriever]> = [
  ['bm25', new Bm25Retriever()],
  ['dense', new DenseRetriever('local:bge-m3')],
  ['hybrid', new HybridRetriever('local:bge-m3')],
];

const thresholds: Record<string, number> = {};
const report: string[] = [
  '# Abstention calibration',
  '',
  'Thresholds chosen by sweeping cut-offs over the 140 golden questions, maximizing',
  'recall on unanswerable questions subject to a false-abstention rate <= 15% on',
  'answerable ones. Produced by `scripts/calibrate-scores.ts`.',
  '',
  '| config | threshold | precision | recall | F1 | false abstention |',
  '| --- | --- | --- | --- | --- | --- |',
];

for (const [name, retriever] of retrievers) {
  const candidates: Array<{ score: number; answerable: boolean }> = [];
  for (const question of questions) {
    const results = await retriever.retrieve(question.question, 10);
    const top = results[0]?.score;
    if (top === undefined) continue;
    candidates.push({ score: top, answerable: !question.unanswerable });
  }
  const { threshold, metrics } = calibrateThreshold(candidates, 0.15);
  thresholds[name] = Number(threshold.toFixed(4));
  report.push(
    `| ${name} | ${threshold.toFixed(4)} | ${metrics.precision?.toFixed(3) ?? 'n/a'} | ${
      metrics.recall?.toFixed(3) ?? 'n/a'
    } | ${metrics.f1?.toFixed(3) ?? 'n/a'} | ${metrics.falseAbstentionRate?.toFixed(3) ?? 'n/a'} |`,
  );
  console.log(name, threshold, metrics);
}

// The reranked list keeps the fused scores (only the order changes), so the
// hybrid threshold is the correct one for hybrid+rerank as well.
thresholds['hybrid+rerank'] = thresholds.hybrid ?? 0;

await mkdir(join(process.cwd(), 'config'), { recursive: true });
await writeFile(
  join(process.cwd(), 'config', 'abstention.json'),
  `${JSON.stringify(thresholds, null, 2)}\n`,
);
await writeFile(join(process.cwd(), 'config', 'ABSTENTION.md'), `${report.join('\n')}\n`);
console.log('thresholds', thresholds);
await closeDb();
