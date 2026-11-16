import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chunkMarkdown } from '../src/ingest/chunk.js';
import { countTokens } from '../src/ingest/tokens.js';

const dir = join(process.cwd(), 'data', 'corpus');
const files = (await readdir(dir)).filter((f) => f.endsWith('.md'));
let total = 0;
let totalTokens = 0;
for (const file of files.sort()) {
  const slug = file.replace(/\.md$/, '');
  const md = await readFile(join(dir, file), 'utf8');
  const chunks = chunkMarkdown(md, slug);
  const tokens = chunks.reduce((sum, c) => sum + c.tokens, 0);
  total += chunks.length;
  totalTokens += tokens;
  const tables = chunks.filter((c) => c.isTable).length;
  const small = chunks.filter((c) => c.tokens < 300).length;
  const avg = Math.round(chunks.reduce((s, c) => s + c.tokens, 0) / chunks.length);
  console.log(
    slug,
    'chunks',
    chunks.length,
    'avg',
    avg,
    'tables',
    tables,
    'under300',
    small,
    'tokens',
    countTokens(md),
  );
}
console.log('TOTAL chunks', total, 'chunkTokens', totalTokens);
