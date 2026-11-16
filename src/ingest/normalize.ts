import { type CheerioAPI, load } from 'cheerio';

export interface NormalizedDocument {
  markdown: string;
  stats: {
    headings: number;
    tables: number;
    removedRevokedBlocks: number;
    paragraphs: number;
  };
}

const HEADING = /^(T[IÍ]TULO|CAP[IÍ]TULO|SE[CÇ][AÃ]O|SUBSE[CÇ][AÃ]O|ANEXO)\b/i;

const cleanInline = (value: string): string =>
  value
    .replace(/\u00a0/g, ' ')
    .replace(/(?:\u200b|\u200c|\u200d|\ufeff)/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

const paragraphText = ($: CheerioAPI, element: unknown): string => {
  const clone = $(element as never).clone();
  clone.find('br').replaceWith('\n');
  return cleanInline(clone.text());
};

const escapeCell = (value: string): string =>
  value.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();

const tableToMarkdown = ($: CheerioAPI, table: unknown): { markdown: string; rows: number } => {
  const rows: string[][] = [];
  $(table as never)
    .find('tr')
    .each((_i, tr) => {
      const cells: string[] = [];
      $(tr)
        .find('td,th')
        .each((_j, cell) => {
          const clone = $(cell).clone();
          clone.find('br').replaceWith(' ');
          cells.push(escapeCell(clone.text().replace(/\s+/g, ' ')));
        });
      if (cells.some((cell) => cell.length > 0)) rows.push(cells);
    });

  if (rows.length === 0) return { markdown: '', rows: 0 };
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => [
    ...row,
    ...Array.from({ length: width - row.length }, () => ''),
  ]);
  const header = padded[0] ?? [];
  const separator = Array.from({ length: width }, () => '---');
  const body = padded.slice(1);
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ];
  return { markdown: lines.join('\n'), rows: rows.length };
};

/**
 * Converts the Banco Central HTML export of a normative act into clean markdown.
 *
 * Two rules matter for retrieval:
 *  - text removed from the compiled norm (struck through, i.e. revoked) is dropped,
 *    so chunks describe the version in force, not a graveyard of old wording;
 *  - headings are rebuilt from the "CAPÍTULO I / DO ÂMBITO..." paragraphs, because
 *    the Word export has no semantic heading tags.
 */
export const htmlToMarkdown = (html: string, title: string): NormalizedDocument => {
  const $ = load(html);
  $('script,style,head,meta,link').remove();

  const removedRevokedBlocks = $('s').length + $('strike').length;
  $('s,strike').remove();

  const blocks: string[] = [];
  let headings = 0;
  let tables = 0;
  let paragraphs = 0;

  $('body')
    .find('p,h1,h2,h3,h4,h5,h6,table,ul,ol,pre')
    .each((_index, element) => {
      const tag = element.tagName.toLowerCase();
      if (tag !== 'table' && $(element).closest('table').length > 0) return;

      if (tag === 'table') {
        const table = tableToMarkdown($, element);
        if (table.markdown) {
          blocks.push(table.markdown);
          tables += 1;
        }
        return;
      }

      if (tag === 'ul' || tag === 'ol') {
        const items: string[] = [];
        $(element)
          .children('li')
          .each((_i, li) => {
            const text = paragraphText($, li);
            if (text) items.push(`- ${text}`);
          });
        if (items.length > 0) blocks.push(items.join('\n'));
        return;
      }

      const text = paragraphText($, element);
      if (!text) return;

      const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      const firstLine = lines[0] ?? '';
      if (lines.length > 0 && HEADING.test(firstLine)) {
        const headingLine = lines[0] as string;
        const subtitle = lines.slice(1).join(' — ');
        const level = /^SUBSE/i.test(headingLine)
          ? '####'
          : /^SE[CÇ][AÃ]O/i.test(headingLine)
            ? '###'
            : '##';
        blocks.push(`${level} ${headingLine}${subtitle ? ` — ${subtitle}` : ''}`);
        headings += 1;
        return;
      }

      blocks.push(lines.join('\n'));
      paragraphs += 1;
    });

  const markdown = [`# ${title}`, '', ...blocks.flatMap((block) => [block, ''])]
    .join('\n')
    .trimEnd();
  return {
    markdown: `${markdown}\n`,
    stats: { headings, tables, removedRevokedBlocks, paragraphs },
  };
};

/** Fixes the classic UTF-8-read-as-Latin-1 mojibake, when present. */
export const repairMojibake = (value: string): string => {
  if (!/[ÃÂ]/.test(value)) return value;
  try {
    const repaired = Buffer.from(value, 'latin1').toString('utf8');
    if (repaired.includes('\uFFFD')) return value;
    return repaired;
  } catch {
    return value;
  }
};
