import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { getChunksByIds } from '../db/queries.js';
import { CONFIG_NAMES, type EvalResults, renderSliceTable, renderTable } from './runner.js';

const fmt = (value: number | null, digits = 3): string =>
  value === null || Number.isNaN(value) ? 'n/a' : value.toFixed(digits);

const latestResultsPath = async (): Promise<string> => {
  const dir = join(process.cwd(), 'results');
  const files = (await readdir(dir))
    .filter((file) => /^results-.*\.json$/.test(file))
    .sort()
    .reverse();
  const file = files[0];
  if (!file) throw new Error('no results/results-*.json found: run pnpm eval first');
  return join(dir, file);
};

interface FailureExplanation {
  questionId: string;
  question: string;
  category: string;
  expected: number[];
  expectedSections: string[];
  top: Array<{ chunkId: number; sectionPath: string; documentSlug: string }>;
  abstained: boolean;
  hypothesis: string;
}

const explainFailures = async (results: EvalResults): Promise<FailureExplanation[]> => {
  const config = results.configs.hybrid;
  if (config?.status !== 'ok') return [];
  // Misses where the retriever returned something come first: those say more
  // about retrieval than misses caused by the abstention threshold.
  const failures = config.perQuestion
    .filter((question) => {
      if (question.expected.length === 0) return false;
      const top = new Set(question.retrieved);
      return question.expected.every((id) => !top.has(id));
    })
    .sort((a, b) => Number(a.abstained) - Number(b.abstained) || a.id.localeCompare(b.id));
  const explanations: FailureExplanation[] = [];
  for (const failure of failures.slice(0, 10)) {
    const chunks = await getChunksByIds(failure.retrieved.slice(0, 3));
    const expectedChunks = await getChunksByIds(failure.expected);
    const expectedDocs = new Set(expectedChunks.map((chunk) => chunk.documentSlug));
    const topDoc = chunks[0]?.documentSlug;
    let hypothesis: string;
    if (failure.abstained) hypothesis = 'abstained: top fused score below the calibrated threshold';
    else if (failure.category === 'identifier')
      hypothesis = 'identifier not detected, or not literally present in the expected chunk';
    else if (topDoc && expectedDocs.has(topDoc))
      hypothesis =
        'right document, wrong section: sibling sections share vocabulary and outrank the expected chunk';
    else if (failure.category === 'temporal')
      hypothesis = 'date question answered from another norm that cites similar dates';
    else
      hypothesis =
        'wrong document: another norm covers the same topic and wins on both BM25 and dense';
    explanations.push({
      questionId: failure.id,
      question: questionsById.get(failure.id) ?? failure.id,
      category: failure.category,
      expected: failure.expected,
      expectedSections: expectedChunks.map(
        (chunk) => `${chunk.documentSlug} › ${chunk.sectionPath}`,
      ),
      abstained: failure.abstained,
      top: chunks.map((chunk) => ({
        chunkId: chunk.id,
        sectionPath: chunk.sectionPath,
        documentSlug: chunk.documentSlug,
      })),
      hypothesis,
    });
  }
  return explanations;
};

const questionsById = new Map<string, string>();

export const generateReport = async (): Promise<string> => {
  const path = await latestResultsPath();
  const raw = await readFile(path, 'utf8');
  const results = JSON.parse(raw) as EvalResults;

  try {
    const goldenRaw = await readFile(join(process.cwd(), 'golden', 'questions.jsonl'), 'utf8');
    for (const line of goldenRaw.split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { id: string; question: string };
      questionsById.set(row.id, row.question);
    }
  } catch {
    // The report can still be produced without question text.
  }
  const failures = await explainFailures(results);
  const lines: string[] = [
    '# Evaluation report',
    '',
    `- Run: \`${results.runId}\` (${results.createdAt})`,
    `- Corpus: ${results.corpus.documents} documents, ${results.corpus.chunks} chunks`,
    `- Golden set: ${results.golden.total} questions (${Object.entries(results.golden.byCategory)
      .map(([category, count]) => `${count} ${category}`)
      .join(', ')})`,
    `- Retrieval metric: recall/MRR/nDCG at ${results.k}, binary relevance on expected_chunk_ids`,
    `- Confidence intervals: paired bootstrap, ${results.bootstrapSamples} resamples, 95%`,
    '',
    '## Headline',
    '',
    renderTable(results),
    '',
    '## By slice',
    '',
    renderSliceTable(results),
    '',
    '## Confidence intervals (overall)',
    '',
    '| config | recall@10 [95% CI] | MRR@10 [95% CI] | nDCG@10 [95% CI] |',
    '| --- | --- | --- | --- |',
  ];

  for (const name of CONFIG_NAMES) {
    const config = results.configs[name];
    if (config?.status !== 'ok') continue;
    const overall = config.metrics.overall;
    lines.push(
      `| ${name} | ${fmt(overall.recallAt10)} [${fmt(overall.recallCI.low)}, ${fmt(
        overall.recallCI.high,
      )}] | ${fmt(overall.mrrAt10)} [${fmt(overall.mrrCI.low)}, ${fmt(overall.mrrCI.high)}] | ${fmt(
        overall.ndcgAt10,
      )} [${fmt(overall.ndcgCI.low)}, ${fmt(overall.ndcgCI.high)}] |`,
    );
  }

  lines.push(
    '',
    '## Cost per 1,000 queries',
    '',
    '| config | $/1k | embedding $/query | rerank $/query | avg rerank input tokens | rerank fallbacks |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const name of CONFIG_NAMES) {
    const config = results.configs[name];
    if (config?.status !== 'ok') continue;
    const embeddingPerQuery = config.cost.embeddingUsd / Math.max(1, results.golden.total);
    const rerankPerQuery = config.cost.rerankUsd / Math.max(1, results.golden.total);
    lines.push(
      `| ${name} | $${fmt(config.cost.per1kQueriesUsd, 2)} | $${fmt(embeddingPerQuery, 5)} | $${fmt(rerankPerQuery, 5)} | ${Math.round(
        config.cost.avgRerankInputTokens,
      )} | ${config.cost.rerankFallbacks} |`,
    );
  }

  lines.push(
    '',
    '## Abstention',
    '',
    '| config | precision | recall | F1 | false abstention rate |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const name of CONFIG_NAMES) {
    const config = results.configs[name];
    if (config?.status !== 'ok') continue;
    lines.push(
      `| ${name} | ${fmt(config.abstention.precision)} | ${fmt(config.abstention.recall)} | ${fmt(
        config.abstention.f1,
      )} | ${fmt(config.abstention.falseAbstentionRate)} |`,
    );
  }

  if (results.routerAblation) {
    lines.push(
      '',
      '## Router ablation (identifier slice)',
      '',
      `- hybrid without exact lookup: recall@10 ${fmt(results.routerAblation.withoutRouter.recallAt10)}`,
      `- hybrid with exact lookup: recall@10 ${fmt(results.routerAblation.withRouter.recallAt10)}`,
    );
  }

  lines.push('', '## Failure gallery (10 queries still wrong on hybrid)', '');
  for (const failure of failures) {
    lines.push(
      `### ${failure.questionId} — ${failure.category}`,
      '',
      `**Question:** ${failure.question}`,
      '',
      `**Expected chunk ids:** ${failure.expected.join(', ')} (${failure.expectedSections.join('; ') || '—'})`,
      '',
      `**Retrieved top-3:** ${failure.top.map((item) => `${item.chunkId} (${item.documentSlug} › ${item.sectionPath})`).join('; ') || '—'}`,
      '',
      `**Hypothesis:** ${failure.hypothesis}`,
      '',
    );
  }

  const report = `${lines.join('\n')}\n`;
  await writeFile(join(process.cwd(), 'results', 'REPORT.md'), report, 'utf8');
  await updateReadme(results, path, failures);
  return report;
};

/** Replaces the content between `<!--NAME-->` and `<!--/NAME-->`. */
export const replaceSection = (text: string, name: string, body: string): string => {
  const open = `<!--${name}-->`;
  const close = `<!--/${name}-->`;
  const start = text.indexOf(open);
  if (start < 0) return text;
  const end = text.indexOf(close, start);
  const after = end < 0 ? text.slice(start + open.length) : text.slice(end + close.length);
  return `${text.slice(0, start)}${open}\n${body}\n${close}${after}`;
};

const escapeCell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');

const updateReadme = async (
  results: EvalResults,
  resultsPath: string,
  failures: FailureExplanation[],
): Promise<void> => {
  const readmePath = join(process.cwd(), 'README.md');
  let readme: string;
  try {
    readme = await readFile(readmePath, 'utf8');
  } catch {
    return;
  }
  const relative = `results/${basename(resultsPath)}`;
  const abstentionRows = CONFIG_NAMES.flatMap((name) => {
    const config = results.configs[name];
    if (config?.status !== 'ok') return [];
    return [
      `| ${name} | ${fmt(config.abstention.precision)} | ${fmt(config.abstention.recall)} | ${fmt(
        config.abstention.falseAbstentionRate,
      )} |`,
    ];
  });
  const skipped = CONFIG_NAMES.flatMap((name) => {
    const config = results.configs[name];
    return config?.status === 'skipped'
      ? [`\`${name}\` was skipped: ${config.reason ?? 'not configured'}.`]
      : [];
  });
  const table = [
    `Run \`${results.runId}\` · ${results.corpus.documents} documents · ${results.corpus.chunks} chunks · ${results.golden.total} questions · k=${results.k}. Raw data: [\`${relative}\`](${relative}). Produced by \`pnpm eval\`; this block is written by \`pnpm report\`.`,
    '',
    renderTable(results),
    '',
    ...(skipped.length > 0 ? [...skipped, ''] : []),
    '**By slice** (abstention columns apply to the unanswerable slice only)',
    '',
    renderSliceTable(results),
    '',
    '**Abstention** (unanswerable questions should return no chunks)',
    '',
    '| config | precision | recall | false abstention rate |',
    '| --- | --- | --- | --- |',
    ...abstentionRows,
  ];
  if (results.routerAblation) {
    const diff = results.routerAblation.recallDiffCI;
    table.push(
      '',
      `**Identifier router** (identifier slice, hybrid): recall@10 ${fmt(results.routerAblation.withoutRouter.recallAt10)} without exact lookup → ${fmt(results.routerAblation.withRouter.recallAt10)} with it${diff ? ` (paired difference ${fmt(diff.mean)}, 95% CI [${fmt(diff.low)}, ${fmt(diff.high)}])` : ''}.`,
    );
  }
  const gallery = [
    `From run \`${results.runId}\`, config \`hybrid\`. Expected vs retrieved sections are read from the database; the hypothesis column is a heuristic in [\`src/eval/report.ts\`](src/eval/report.ts), not a diagnosis.`,
    '',
    '| id | slice | question | expected section | hybrid top-1 | hypothesis |',
    '| --- | --- | --- | --- | --- | --- |',
    ...failures.map(
      (failure) =>
        `| ${failure.questionId} | ${failure.category} | ${escapeCell(failure.question)} | ${escapeCell(
          failure.expectedSections.join('; ') || '—',
        )} | ${failure.abstained ? '(abstained)' : escapeCell(failure.top[0] ? `${failure.top[0].documentSlug} › ${failure.top[0].sectionPath}` : '—')} | ${escapeCell(failure.hypothesis)} |`,
    ),
  ];
  readme = replaceSection(readme, 'RESULTS_TABLE', table.join('\n'));
  readme = replaceSection(readme, 'FAILURE_GALLERY', gallery.join('\n'));
  await writeFile(readmePath, readme, 'utf8');
};

export const setQuestionIndex = (questions: Array<{ id: string; question: string }>): void => {
  for (const question of questions) questionsById.set(question.id, question.question);
};
