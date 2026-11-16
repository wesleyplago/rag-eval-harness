import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../logger.js';
import { htmlToMarkdown } from './normalize.js';

export interface SourceMeta {
  slug: string;
  title: string;
  sourceUrl: string;
  retrievedAt: string;
  licenseNote: string;
  publishedAt?: string;
  dou?: string;
  assunto?: string;
  rawFormat?: 'html' | 'pdf';
}

export const LICENSE_NOTE =
  'Ato normativo oficial do Banco Central do Brasil. Texto de lei/regulamento não é objeto de proteção autoral (Lei 9.610/1998, art. 8º, IV).';

export const readSources = async (
  path = join(process.cwd(), 'data', 'sources.json'),
): Promise<SourceMeta[]> => {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as SourceMeta[];
};

/** Rebuilds data/corpus/*.md from the committed data/raw snapshots. */
export const normalizeCorpus = async (): Promise<
  Array<{ slug: string; tokensChars: string; tables: number; headings: number }>
> => {
  const rawDir = join(process.cwd(), 'data', 'raw');
  const corpusDir = join(process.cwd(), 'data', 'corpus');
  await mkdir(corpusDir, { recursive: true });
  const sources = await readSources();
  const report: Array<{ slug: string; tokensChars: string; tables: number; headings: number }> = [];

  for (const source of sources) {
    if (source.rawFormat === 'pdf') continue;
    const html = await readFile(join(rawDir, `${source.slug}.html`), 'utf8');
    const normalized = htmlToMarkdown(html, source.title);
    await writeFile(join(corpusDir, `${source.slug}.md`), normalized.markdown, 'utf8');
    report.push({
      slug: source.slug,
      tokensChars: `${normalized.markdown.length} chars`,
      tables: normalized.stats.tables,
      headings: normalized.stats.headings,
    });
    logger.info('normalized', {
      slug: source.slug,
      headings: normalized.stats.headings,
      tables: normalized.stats.tables,
      revokedBlocksRemoved: normalized.stats.removedRevokedBlocks,
    });
  }
  return report;
};

export const listCorpusFiles = async (): Promise<string[]> => {
  const corpusDir = join(process.cwd(), 'data', 'corpus');
  const files = await readdir(corpusDir);
  return files.filter((file) => file.endsWith('.md')).sort();
};
