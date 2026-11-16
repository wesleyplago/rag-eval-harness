import { normalizeCorpus } from '../src/ingest/corpus.js';

const report = await normalizeCorpus();
console.log(JSON.stringify(report, null, 2));
