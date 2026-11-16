import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chunkMarkdown } from '../src/ingest/chunk.js';
import { readSources } from '../src/ingest/corpus.js';

const sources = await readSources();
const rows: Array<{
  slug: string;
  title: string;
  url: string;
  published: string;
  retrieved: string;
  license: string;
  chunks: number;
  tokens: number;
  tables: number;
}> = [];

for (const source of sources) {
  const markdown = await readFile(
    join(process.cwd(), 'data', 'corpus', `${source.slug}.md`),
    'utf8',
  );
  const chunks = chunkMarkdown(markdown, source.slug);
  rows.push({
    slug: source.slug,
    title: source.title,
    url: source.sourceUrl,
    published: source.publishedAt?.slice(0, 10) ?? '—',
    retrieved: source.retrievedAt,
    license: source.licenseNote,
    chunks: chunks.length,
    tokens: chunks.reduce((sum, chunk) => sum + chunk.tokens, 0),
    tables: chunks.filter((chunk) => chunk.isTable).length,
  });
}

const totalChunks = rows.reduce((sum, row) => sum + row.chunks, 0);
const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0);

const lines = [
  '# Corpus sources',
  '',
  'Todos os documentos são atos normativos ou manuais oficiais do Banco Central do Brasil,',
  'coletados em **2026-10-23** pela API pública de conteúdo do BCB',
  '(`/api/conteudo/app/normativos/exibenormativo`) ou, no caso do manual, pelo PDF oficial.',
  '',
  '**Direito de uso:** textos de leis, decretos e regulamentos não são objeto de proteção',
  'autoral (Lei nº 9.610/1998, art. 8º, IV). Os arquivos são mantidos aqui como corpus de',
  'avaliação, com URL canônica e data de coleta registradas abaixo.',
  '',
  '## Documentos',
  '',
  '| # | documento | URL canônica | publicado | coletado | chunks | tokens | tabelas |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map(
    (row, index) =>
      `| ${index + 1} | ${row.title} (\`${row.slug}\`) | ${row.url} | ${row.published} | ${row.retrieved} | ${row.chunks} | ${row.tokens} | ${row.tables} |`,
  ),
  `| | **total** | | | | **${totalChunks}** | **${totalTokens}** | **${rows.reduce((sum, row) => sum + row.tables, 0)}** |`,
  '',
  '## Normalização',
  '',
  '- HTML do BCB → markdown por `src/ingest/normalize.ts`: headings reconstruídos a partir de',
  '  `CAPÍTULO`/`Seção` (o export do Word não tem tags semânticas), tabelas convertidas para',
  '  GFM, texto revogado (`<s>`) removido.',
  '- O Manual de Iniciação do Pix é PDF; foi convertido por `scripts/pdf_to_markdown.py`',
  '  (pypdf) e o markdown resultante é a fonte de verdade do ingest.',
  '- Os `.md` estão commitados: rodar o projeto não depende de rede.',
  '',
  '## Observações de cobertura',
  '',
  '- O corpus contém exemplos literais de **CNPJ** (`00038166000105`, `12ABC34501DE35`) e',
  '  **TXID** (`8b3da2f39a4140d1a91abd93113bd44`, `2353c790eefb11eaadc10242ac120002`) no',
  '  manual do Pix.',
  '- Não há exemplo literal de **linha digitável** nem de **nosso número** no material',
  '  normativo coletado; o router cobre esses formatos por testes unitários, e a limitação',
  '  está declarada no README.',
  '',
];

await writeFile(join(process.cwd(), 'data', 'corpus', 'SOURCES.md'), lines.join('\n'), 'utf8');
console.log(`SOURCES.md written: ${totalChunks} chunks, ${totalTokens} tokens`);
