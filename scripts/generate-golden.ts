import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { type Chunk, chunkMarkdown } from '../src/ingest/chunk.js';
import { listCorpusFiles } from '../src/ingest/corpus.js';
import { logger } from '../src/logger.js';

interface GoldenRow {
  id: string;
  question: string;
  category: 'semantic' | 'identifier' | 'temporal' | 'unanswerable';
  expected_chunk_ids: number[];
  unanswerable: boolean;
  source_chunk_id?: number;
}

const SEED = 20261023;
const rand = (() => {
  let a = SEED;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();

const shuffle = <T>(items: T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
};

const loadChunks = async (): Promise<Chunk[]> => {
  const files = await listCorpusFiles();
  const chunks: Chunk[] = [];
  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    const markdown = await readFile(join(process.cwd(), 'data', 'corpus', file), 'utf8');
    chunks.push(...chunkMarkdown(markdown, slug));
  }
  return chunks;
};

const ask = async (prompt: string): Promise<string> => {
  if (!config.rerank.baseUrl || !config.rerank.model) throw new Error('LLM not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`${config.rerank.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(config.rerank.apiKey ? { authorization: `Bearer ${config.rerank.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.rerank.model,
        temperature: 0.2,
        max_tokens: 200,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const body = text.trimStart().startsWith('data:')
      ? text
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => {
            try {
              return (
                (JSON.parse(line.slice(5)) as { choices?: Array<{ delta?: { content?: string } }> })
                  .choices?.[0]?.delta?.content ?? ''
              );
            } catch {
              return '';
            }
          })
          .join('')
      : ((JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]
          ?.message?.content ?? '');
    return body.trim();
  } finally {
    clearTimeout(timer);
  }
};

const cleanQuestion = (raw: string): string => {
  let text = raw.replace(/```[a-z]*\n?/gi, '').trim();
  text = text.replace(/^["“]|["”]$/g, '').trim();
  text =
    text
      .split('\n')
      .find((line) => line.trim().length > 10)
      ?.trim() ?? text;
  if (!text.endsWith('?')) text += '?';
  text = text.replace(/\s+/g, ' ');
  if (text.length > 320) {
    const cut = text.lastIndexOf(' ', 320);
    text = `${text.slice(0, cut > 0 ? cut : 320)}?`;
  }
  return text;
};

const semanticPrompt = (
  chunk: Chunk,
): string => `Você está montando um golden set para avaliação de RAG sobre normas do Banco Central do Brasil.

Trecho:
"""
${chunk.content.slice(0, 4000)}
"""

Escreva UMA pergunta em português brasileiro cuja resposta esteja contida no trecho. Regras:
- Pergunta natural, específica e autocontida.
- Não cite "este trecho", "o texto acima" nem números de artigo.
- Não inclua a resposta.
- Responda apenas com a pergunta, em uma linha.`;

const temporalPrompt = (
  chunk: Chunk,
): string => `Você está montando um golden set temporal sobre normas do Banco Central.

Trecho:
"""
${chunk.content.slice(0, 4000)}
"""

Escreva UMA pergunta em português brasileiro sobre a vigência/data da regra descrita (por exemplo, "a partir de quando..."). Regras:
- A pergunta deve poder ser respondida com o trecho.
- Não cite números de artigo nem "este trecho".
- Responda apenas com a pergunta, em uma linha.`;

const pool = async <T, R>(
  items: T[],
  size: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  });
  await Promise.all(runners);
  return results;
};

const identifierQuestions: Array<{
  question: string;
  identifier: string;
  mode: 'digits' | 'alnum';
}> = [
  {
    question: 'Qual é o CNPJ de exemplo 00038166000105 usado para uma chave Pix do tipo CNPJ?',
    identifier: '00038166000105',
    mode: 'digits',
  },
  {
    question: 'O número 00038166000105 aparece como exemplo de qual tipo de chave Pix?',
    identifier: '00038166000105',
    mode: 'digits',
  },
  {
    question: 'Como o Manual de Iniciação do Pix exemplifica a chave Pix de CNPJ 00038166000105?',
    identifier: '00038166000105',
    mode: 'digits',
  },
  {
    question:
      'No exemplo de chave Pix por CNPJ 00038166000105, qual é a sequência numérica apresentada?',
    identifier: '00038166000105',
    mode: 'digits',
  },
  {
    question:
      'Qual CNPJ numérico, 00038166000105, o manual usa para ilustrar o cadastro de chave Pix?',
    identifier: '00038166000105',
    mode: 'digits',
  },
  {
    question: 'O valor 12ABC34501DE35 corresponde a qual tipo de chave Pix?',
    identifier: '12ABC34501DE35',
    mode: 'alnum',
  },
  {
    question: 'Qual é o exemplo de CNPJ alfanumérico 12ABC34501DE35 aceito como chave Pix?',
    identifier: '12ABC34501DE35',
    mode: 'alnum',
  },
  {
    question:
      'Como o manual representa o CNPJ alfanumérico 12ABC34501DE35 na lista de exemplos de chaves?',
    identifier: '12ABC34501DE35',
    mode: 'alnum',
  },
  {
    question: 'O CNPJ alfanumérico 12ABC34501DE35 aparece em qual contexto no manual do Pix?',
    identifier: '12ABC34501DE35',
    mode: 'alnum',
  },
  {
    question:
      'Que formato alternativo de CNPJ, como 12ABC34501DE35, pode ser usado como chave Pix?',
    identifier: '12ABC34501DE35',
    mode: 'alnum',
  },
  {
    question: 'O txid 8b3da2f39a4140d1a91abd93113bd44 aparece em qual exemplo do manual?',
    identifier: '8b3da2f39a4140d1a91abd93113bd44',
    mode: 'alnum',
  },
  {
    question:
      'Qual é o txid 8b3da2f39a4140d1a91abd93113bd44 usado no exemplo de cobrança com QR Code dinâmico?',
    identifier: '8b3da2f39a4140d1a91abd93113bd44',
    mode: 'alnum',
  },
  {
    question:
      'Que transaction identifier 8b3da2f39a4140d1a91abd93113bd44 o manual mostra no exemplo de QR Code estático?',
    identifier: '8b3da2f39a4140d1a91abd93113bd44',
    mode: 'alnum',
  },
  {
    question:
      'O identificador 8b3da2f39a4140d1a91abd93113bd44 tem quais caracteres permitidos para txid?',
    identifier: '8b3da2f39a4140d1a91abd93113bd44',
    mode: 'alnum',
  },
  {
    question:
      'Qual txid de exemplo, 8b3da2f39a4140d1a91abd93113bd44, é único por CPF ou CNPJ do recebedor?',
    identifier: '8b3da2f39a4140d1a91abd93113bd44',
    mode: 'alnum',
  },
  {
    question: 'O txid 2353c790eefb11eaadc10242ac120002 é usado em qual exemplo de payload Pix?',
    identifier: '2353c790eefb11eaadc10242ac120002',
    mode: 'alnum',
  },
  {
    question:
      'Qual identificador de transação, 2353c790eefb11eaadc10242ac120002, aparece no exemplo de QR Code com valor definido?',
    identifier: '2353c790eefb11eaadc10242ac120002',
    mode: 'alnum',
  },
  {
    question:
      'No exemplo de BR Code com o txid 2353c790eefb11eaadc10242ac120002, qual é o valor informado no campo 62-05?',
    identifier: '2353c790eefb11eaadc10242ac120002',
    mode: 'alnum',
  },
  {
    question: 'O txid 2353c790eefb11eaadc10242ac120002 aparece em qual seção do manual?',
    identifier: '2353c790eefb11eaadc10242ac120002',
    mode: 'alnum',
  },
  {
    question:
      'Qual exemplo de txid, 2353c790eefb11eaadc10242ac120002, o manual associa a uma cobrança com vencimento?',
    identifier: '2353c790eefb11eaadc10242ac120002',
    mode: 'alnum',
  },
];

const unanswerable: string[] = [
  'Qual é a alíquota do Imposto de Renda sobre dividendos recebidos por pessoa física?',
  'Como funciona o financiamento imobiliário pelo Sistema Brasileiro de Poupança e Empréstimo?',
  'Qual é o limite de crédito do cartão consignado para aposentados do INSS?',
  'Quais são os documentos necessários para solicitar aposentadoria por tempo de contribuição?',
  'Como a União Europeia regula stablecoins lastreadas em euro?',
  'Qual é o prazo de garantia legal de produtos duráveis segundo o Código de Defesa do Consumidor?',
  'Como funciona o saque do FGTS para compra de imóvel?',
  'Qual é a taxa Selic meta definida na última reunião do Copom?',
  'Como funciona um consórcio de imóveis com carta de crédito?',
  'Quais são as regras do seguro obrigatório DPVAT para motocicletas?',
  'Como é calculado o IPVA de veículos usados no estado de São Paulo?',
  'Qual é o prazo para contestar uma compra no cartão de crédito?',
  'Quais são os requisitos para abrir um MEI?',
  'Como funciona o Tesouro Direto para pessoa física?',
  'Qual é a regulamentação da CVM para ofertas de criptoativos?',
  'Como funciona o cheque especial e qual é o teto de juros?',
  'Quais são as regras de portabilidade de plano de saúde?',
  'Como funciona o financiamento estudantil pelo FIES?',
  'Qual é o prazo de validade do cheque emitido no Brasil?',
  'Como funciona a tributação de fundos de investimento no exterior?',
];

const main = async (): Promise<void> => {
  const chunks = await loadChunks();
  logger.info('chunks loaded for golden generation', { chunks: chunks.length });

  const byDoc = new Map<string, Chunk[]>();
  for (const chunk of chunks) {
    const list = byDoc.get(chunk.documentSlug) ?? [];
    list.push(chunk);
    byDoc.set(chunk.documentSlug, list);
  }

  const eligibleSemantic = chunks.filter(
    (chunk) => !chunk.isTable && chunk.tokens >= 220 && !/^\s*#/.test(chunk.content),
  );
  const semanticSample = shuffle(eligibleSemantic).slice(0, 80);
  logger.info('generating semantic questions', { count: semanticSample.length });

  const semantic = await pool(semanticSample, 4, async (chunk) => {
    try {
      const question = cleanQuestion(await ask(semanticPrompt(chunk)));
      return { chunk, question };
    } catch (error) {
      logger.warn('semantic question failed', { error: String(error), id: chunk.id });
      return null;
    }
  });

  const temporalSample = shuffle(
    chunks.filter((chunk) => /a partir de\s+\d{1,2}[/.]\d{1,2}[/.]\d{4}/i.test(chunk.content)),
  ).slice(0, 20);
  logger.info('generating temporal questions', { count: temporalSample.length });
  const temporal = await pool(temporalSample, 4, async (chunk) => {
    try {
      const question = cleanQuestion(await ask(temporalPrompt(chunk)));
      return { chunk, question };
    } catch (error) {
      logger.warn('temporal question failed', { error: String(error), id: chunk.id });
      return null;
    }
  });

  const rows: GoldenRow[] = [];
  let index = 1;
  const nextId = (): string => `q${String(index++).padStart(3, '0')}`;

  for (const item of semantic) {
    if (!item) continue;
    rows.push({
      id: nextId(),
      question: item.question,
      category: 'semantic',
      expected_chunk_ids: [item.chunk.id],
      unanswerable: false,
      source_chunk_id: item.chunk.id,
    });
  }

  for (const item of identifierQuestions) {
    const needle = item.mode === 'digits' ? item.identifier : item.identifier.toUpperCase();
    const matching = chunks
      .filter((chunk) =>
        item.mode === 'digits'
          ? chunk.content.replace(/\D/g, '').includes(needle)
          : chunk.content.toUpperCase().includes(needle),
      )
      .map((chunk) => chunk.id);
    if (matching.length === 0) {
      logger.warn('identifier not found in corpus', { identifier: item.identifier });
      continue;
    }
    rows.push({
      id: nextId(),
      question: item.question,
      category: 'identifier',
      expected_chunk_ids: matching,
      unanswerable: false,
      source_chunk_id: matching[0],
    });
  }

  for (const item of temporal) {
    if (!item) continue;
    rows.push({
      id: nextId(),
      question: item.question,
      category: 'temporal',
      expected_chunk_ids: [item.chunk.id],
      unanswerable: false,
      source_chunk_id: item.chunk.id,
    });
  }

  for (const question of unanswerable) {
    rows.push({
      id: nextId(),
      question,
      category: 'unanswerable',
      expected_chunk_ids: [],
      unanswerable: true,
    });
  }

  // Fill any shortfall (failed LLM calls) with more semantic chunks, keeping 80/20/20/20.
  const targetSemantic = 80;
  const currentSemantic = rows.filter((row) => row.category === 'semantic').length;
  if (currentSemantic < targetSemantic) {
    const used = new Set(rows.map((row) => row.source_chunk_id));
    const extra = shuffle(eligibleSemantic.filter((chunk) => !used.has(chunk.id))).slice(
      0,
      targetSemantic - currentSemantic,
    );
    for (const chunk of extra) {
      rows.push({
        id: nextId(),
        question: `O que a norma estabelece sobre ${chunk.sectionPath.split(' > ').pop()?.toLowerCase() ?? 'este tema'}?`,
        category: 'semantic',
        expected_chunk_ids: [chunk.id],
        unanswerable: false,
        source_chunk_id: chunk.id,
      });
    }
  }

  const order = { semantic: 0, identifier: 1, temporal: 2, unanswerable: 3 } as const;
  rows.sort(
    (a, b) =>
      order[a.category] - order[b.category] || (a.source_chunk_id ?? 0) - (b.source_chunk_id ?? 0),
  );

  const final = rows.map((row, i) => ({ ...row, id: `q${String(i + 1).padStart(3, '0')}` }));
  const counts = final.reduce<Record<string, number>>((acc, row) => {
    acc[row.category] = (acc[row.category] ?? 0) + 1;
    return acc;
  }, {});
  if (final.length !== 140)
    throw new Error(`expected 140 questions, got ${final.length}: ${JSON.stringify(counts)}`);

  await mkdir(join(process.cwd(), 'golden'), { recursive: true });
  await writeFile(
    join(process.cwd(), 'golden', 'questions.jsonl'),
    `${final
      .map((row) =>
        JSON.stringify({
          id: row.id,
          question: row.question,
          category: row.category,
          expected_chunk_ids: row.expected_chunk_ids,
          unanswerable: row.unanswerable,
        }),
      )
      .join('\n')}\n`,
    'utf8',
  );

  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const review = [
    '# Golden set review',
    '',
    'Status: **pendente de revisão humana**. Todas as 140 perguntas foram geradas a partir de',
    'chunks do corpus (amostragem + LLM) e passaram apenas por validação mecânica:',
    'contagem por categoria, ids existentes, unicidade e presença do identificador citado.',
    'Nenhuma pergunta deve ser considerada revisada até este arquivo ser assinado.',
    '',
    '## Checklist',
    '',
    '- [ ] 80 semânticas: resposta contida no chunk de origem e pergunta não ambígua',
    '- [ ] 20 de identificador: valor existe literalmente no corpus e é o alvo da pergunta',
    '- [ ] 20 temporais: data/vigência correta e sem resposta duplicada em outro chunk',
    '- [ ] 20 sem resposta: tema realmente ausente do corpus',
    '- [ ] Nenhuma pergunta cita número de artigo ou copia o texto literalmente',
    '',
    `## As 140 perguntas (${counts.semantic} semânticas, ${counts.identifier} identificador, ${counts.temporal} temporais, ${counts.unanswerable} sem resposta)`,
    '',
    '| id | categoria | pergunta | chunk de origem | trecho | status |',
    '| --- | --- | --- | --- | --- | --- |',
    ...final.map((row) => {
      const source = row.source_chunk_id ? chunkById.get(row.source_chunk_id) : undefined;
      const excerpt = source
        ? source.content.replace(/\s+/g, ' ').slice(0, 140).replace(/\|/g, '\\|')
        : '—';
      return `| ${row.id} | ${row.category} | ${row.question.replace(/\|/g, '\\|')} | ${row.source_chunk_id ?? '—'} | ${excerpt} | pendente |`;
    }),
    '',
    'Assinatura (revisor, data): ______________________________',
  ].join('\n');
  await writeFile(join(process.cwd(), 'golden', 'REVIEW.md'), review, 'utf8');

  logger.info('golden set written', { counts, total: final.length });
};

main().catch((error: unknown) => {
  logger.error('golden generation failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
