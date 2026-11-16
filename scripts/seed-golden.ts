import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { closeDb, db } from '../src/db/client.js';

const Row = z.object({
  id: z.string(),
  question: z.string(),
  category: z.enum(['semantic', 'identifier', 'temporal', 'unanswerable']),
  expected_chunk_ids: z.array(z.number().int()),
  unanswerable: z.boolean(),
});
const rows = (await readFile(join(process.cwd(), 'golden', 'questions.jsonl'), 'utf8'))
  .split('\n')
  .filter(Boolean)
  .map((line) => Row.parse(JSON.parse(line)));
await db()('golden_questions').delete();
await db()('golden_questions').insert(rows);
console.log('seeded', rows.length, 'golden questions');
await closeDb();
