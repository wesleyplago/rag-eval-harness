import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from '../src/ingest/chunk.js';

const markdown = `# Documento de teste

## CAPÍTULO I — DISPOSIÇÕES GERAIS

Art. 1º Esta norma trata do funcionamento do arranjo de pagamentos.

Parágrafo único. Aplica-se a todas as instituições autorizadas.

## CAPÍTULO II — TARIFAS

Art. 2º As tarifas devem ser informadas de forma clara.

| Tipo | Valor |
| --- | --- |
| Pix | 0,00 |
| Boleto | 1,50 |

Art. 3º O prazo de contestação é de dez dias.
`;

describe('chunkMarkdown', () => {
  it('does not lose text and keeps every paragraph in some chunk', () => {
    const chunks = chunkMarkdown(markdown, 'doc-teste', { min: 10, max: 50 });
    const joined = chunks.map((chunk) => chunk.content).join('\n\n');
    expect(joined.length).toBeGreaterThanOrEqual(markdown.length);

    for (const paragraph of [
      'Esta norma trata do funcionamento do arranjo de pagamentos',
      'Aplica-se a todas as instituições autorizadas',
      'As tarifas devem ser informadas de forma clara',
      'O prazo de contestação é de dez dias',
    ]) {
      expect(joined).toContain(paragraph);
    }
  });

  it('emits tables as standalone chunks flagged is_table', () => {
    const chunks = chunkMarkdown(markdown, 'doc-teste', { min: 10, max: 50 });
    const tables = chunks.filter((chunk) => chunk.isTable);
    expect(tables).toHaveLength(1);
    expect(tables[0]?.content).toContain('| Pix | 0,00 |');
    expect(tables[0]?.sectionPath).toContain('CAPÍTULO II');
  });

  it('uses stable ids: same input, same ids', () => {
    const first = chunkMarkdown(markdown, 'doc-teste');
    const second = chunkMarkdown(markdown, 'doc-teste');
    expect(first.map((chunk) => chunk.id)).toEqual(second.map((chunk) => chunk.id));
  });
});
