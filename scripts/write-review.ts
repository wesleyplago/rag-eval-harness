import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Chunk, chunkMarkdown } from '../src/ingest/chunk.js';
import { listCorpusFiles } from '../src/ingest/corpus.js';

interface Row {
  id: string;
  question: string;
  category: string;
  expected_chunk_ids: number[];
  unanswerable: boolean;
}

const chunks: Chunk[] = [];
for (const file of await listCorpusFiles()) {
  const slug = file.replace(/\.md$/, '');
  const markdown = await readFile(join(process.cwd(), 'data', 'corpus', file), 'utf8');
  chunks.push(...chunkMarkdown(markdown, slug));
}
const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
const rows = (await readFile(join(process.cwd(), 'golden', 'questions.jsonl'), 'utf8'))
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Row);

const counts = rows.reduce<Record<string, number>>((acc, row) => {
  acc[row.category] = (acc[row.category] ?? 0) + 1;
  return acc;
}, {});

const review = [
  '# Golden set review',
  '',
  'Status: **pendente de revisão humana**. As 140 perguntas foram geradas a partir de chunks',
  'do corpus (amostragem determinística + LLM) e passaram por validação mecânica: contagem por',
  'categoria, ids existentes, unicidade e presença literal do identificador. Nenhuma pergunta',
  'deve ser considerada revisada até a assinatura no fim deste arquivo.',
  '',
  '## Checklist',
  '',
  '- [ ] 80 semânticas: resposta contida no chunk de origem, pergunta não ambígua',
  '- [ ] 20 de identificador: valor existe literalmente no corpus e é o alvo da pergunta',
  '- [ ] 20 temporais: data/vigência correta, sem resposta concorrente em outro chunk',
  '- [ ] 20 sem resposta: tema realmente ausente do corpus',
  '- [ ] Nenhuma pergunta copia o texto literalmente ou cita número de artigo',
  '',
  `## As 140 perguntas (${counts.semantic ?? 0} semânticas, ${counts.identifier ?? 0} identificador, ${counts.temporal ?? 0} temporais, ${counts.unanswerable ?? 0} sem resposta)`,
  '',
  '| id | categoria | pergunta | chunk de origem | trecho | status |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows.map((row) => {
    const source = row.expected_chunk_ids[0] ? byId.get(row.expected_chunk_ids[0]) : undefined;
    const excerpt = source
      ? source.content.replace(/\s+/g, ' ').slice(0, 140).replace(/\|/g, '\\|')
      : '—';
    return `| ${row.id} | ${row.category} | ${row.question.replace(/\|/g, '\\|')} | ${row.expected_chunk_ids.join(', ') || '—'} | ${excerpt} | pendente |`;
  }),
  '',
  'Assinatura (revisor, data): ______________________________',
  '',
].join('\n');

await writeFile(join(process.cwd(), 'golden', 'REVIEW.md'), review, 'utf8');
console.log('review written', counts);
