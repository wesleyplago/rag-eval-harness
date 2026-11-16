import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { IngestError } from '../errors.js';
import { logger } from '../logger.js';

export interface CorpusSource {
  slug: string;
  title: string;
  /** Canonical human-facing URL, recorded in data/corpus/SOURCES.md. */
  canonicalUrl: string;
  kind: 'bcb-normativo';
  normativo: { tipo: string; numero: string };
}

export const SOURCES: CorpusSource[] = [
  {
    slug: 'pix-regulamento',
    title: 'Resolução BCB nº 1/2020 — Regulamento do Pix',
    canonicalUrl:
      'https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20BCB&numero=1',
    kind: 'bcb-normativo',
    normativo: { tipo: 'Resolução BCB', numero: '1' },
  },
  {
    slug: 'open-finance',
    title: 'Resolução Conjunta BCB/CMN nº 1/2020 — Open Finance',
    canonicalUrl:
      'https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20Conjunta&numero=1',
    kind: 'bcb-normativo',
    normativo: { tipo: 'Resolução Conjunta', numero: '1' },
  },
  {
    slug: 'boleto',
    title: 'Resolução BCB nº 443/2024 — Arranjo de pagamento do boleto',
    canonicalUrl:
      'https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20BCB&numero=443',
    kind: 'bcb-normativo',
    normativo: { tipo: 'Resolução BCB', numero: '443' },
  },
  {
    slug: 'arranjos-pagamento',
    title: 'Resolução BCB nº 150/2021 — Arranjos de pagamento',
    canonicalUrl:
      'https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20BCB&numero=150',
    kind: 'bcb-normativo',
    normativo: { tipo: 'Resolução BCB', numero: '150' },
  },
];

interface BcbEnvelope {
  conteudo?: Array<Record<string, unknown>>;
}

const fetchJson = async (url: string, timeoutMs = 30_000): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'rag-eval-harness/0.1 (corpus refresh)',
      },
    });
    if (!response.ok) throw new IngestError(`HTTP ${response.status} fetching ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const API = 'https://www.bcb.gov.br/api/conteudo/app/normativos/exibenormativo';

const fetchOne = async (source: CorpusSource): Promise<Record<string, unknown>> => {
  const url = `${API}?p1=${encodeURIComponent(source.normativo.tipo)}&p2=${encodeURIComponent(
    source.normativo.numero,
  )}`;
  const payload = (await fetchJson(url)) as BcbEnvelope;
  const content = payload.conteudo?.[0];
  if (!content || typeof content.Texto !== 'string' || content.Texto.length === 0) {
    throw new IngestError(`No text returned for ${source.slug}`);
  }
  return content;
};

/**
 * Refreshes data/raw from the Banco Central content API.
 * Not required to run the project: the normalized markdown is committed.
 */
export const fetchRawCorpus = async (
  rawDir = join(process.cwd(), 'data', 'raw'),
): Promise<void> => {
  await mkdir(rawDir, { recursive: true });
  const meta: Array<Record<string, unknown>> = [];

  for (const source of SOURCES) {
    logger.info('fetching corpus source', { slug: source.slug });
    const content = await fetchOne(source);
    const html = content.Texto as string;
    await mkdir(dirname(join(rawDir, source.slug)), { recursive: true });
    await writeFile(join(rawDir, `${source.slug}.html`), html, 'utf8');
    const entry = {
      slug: source.slug,
      canonicalUrl: source.canonicalUrl,
      titulo: content.Titulo,
      tipo: content.Tipo,
      numero: content.Numero,
      dou: content.DOU,
      assunto: content.Assunto,
      retrievedAt: new Date().toISOString(),
      bytes: Buffer.byteLength(html, 'utf8'),
    };
    meta.push(entry);
    logger.info('corpus source saved', { slug: source.slug, bytes: entry.bytes });
  }

  await writeFile(join(rawDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
};
