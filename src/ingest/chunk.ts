import { createHash } from 'node:crypto';
import { countTokens } from './tokens.js';

export const CHUNK_MIN_TOKENS = 700;
export const CHUNK_MAX_TOKENS = 900;
export const CHUNK_OVERLAP_TOKENS = 150;

export interface Chunk {
  /** Stable across re-ingests: derived from document slug + index + content. */
  id: number;
  documentSlug: string;
  sectionPath: string;
  chunkIndex: number;
  content: string;
  isTable: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  tokens: number;
}

interface Block {
  kind: 'text' | 'table';
  text: string;
}

interface Unit {
  path: string[];
  blocks: Block[];
}

interface Heading {
  level: number;
  text: string;
}

const isTableLine = (line: string): boolean => line.trimStart().startsWith('|');

const parseBlocks = (markdown: string): Array<Block | Heading> => {
  const lines = markdown.split('\n');
  const out: Array<Block | Heading> = [];
  let buffer: string[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    const text = buffer.join('\n').trim();
    if (text) out.push({ kind: isTableLine(text) ? 'table' : 'text', text });
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = /^(#{2,4})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flush();
      out.push({
        level: (headingMatch[1] as string).length,
        text: (headingMatch[2] as string).trim(),
      });
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out;
};

const parseUnits = (markdown: string): { units: Unit[]; title: string } => {
  const blocks = parseBlocks(markdown);
  const titleMatch = /^#\s+(.*)$/m.exec(markdown);
  const title = titleMatch?.[1]?.trim() ?? 'Documento';
  const path: string[] = [];
  const units: Unit[] = [];
  let current: Unit = { path: ['Preâmbulo'], blocks: [] };

  for (const block of blocks) {
    if ('level' in block) {
      const level = block.level;
      path[level - 2] = block.text;
      path.length = level - 1;
      if (current.blocks.length > 0) units.push(current);
      current = { path: [...path].filter(Boolean), blocks: [] };
      continue;
    }
    current.blocks.push({ kind: block.kind, text: block.text });
  }
  if (current.blocks.length > 0) units.push(current);
  return { units, title };
};

const blockTokens = (block: Block): number => countTokens(block.text);

const joinBlocks = (blocks: Block[]): string => blocks.map((block) => block.text).join('\n\n');

const dateFrom = (text: string, marker: RegExp): string | null => {
  const match = marker.exec(text);
  if (!match) return null;
  const [, d, m, y] = match;
  if (!d || !m || !y) return null;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : iso;
};

const effectiveDates = (content: string): { from: string | null; to: string | null } => ({
  from: dateFrom(content, /a partir de\s+(\d{1,2})[/.](\d{1,2})[/.](\d{4})/i),
  to: dateFrom(content, /at[ée]\s+(\d{1,2})[/.](\d{1,2})[/.](\d{4})/i),
});

const chunkId = (slug: string, index: number, content: string): number => {
  const hash = createHash('sha256').update(`${slug}:${index}:${content}`).digest();
  // 31-bit positive integer, safe for Postgres integer and JSON.
  return hash.readUInt32BE(0) & 0x7fffffff;
};

/**
 * Section-aware chunker.
 *
 * A chunk never crosses a top-level division (CAPÍTULO/TÍTULO/ANEXO): merging
 * only happens between sibling sections of the same division. A single long
 * section is split at block boundaries with 150 tokens of overlap. Tables are
 * always emitted alone (is_table = true) and are never merged into prose.
 */
export const chunkMarkdown = (
  markdown: string,
  slug: string,
  options?: { min?: number; max?: number; overlap?: number },
): Chunk[] => {
  const min = options?.min ?? CHUNK_MIN_TOKENS;
  const max = options?.max ?? CHUNK_MAX_TOKENS;
  const overlap = options?.overlap ?? CHUNK_OVERLAP_TOKENS;
  const { units } = parseUnits(markdown);
  const chunks: Chunk[] = [];
  let index = 0;

  const emit = (path: string[], blocks: Block[], isTable: boolean): void => {
    const body = joinBlocks(blocks);
    const sectionPath = path.length > 0 ? path.join(' > ') : 'Documento';
    const content = `${sectionPath}\n\n${body}`.trim();
    const dates = effectiveDates(body);
    chunks.push({
      id: chunkId(slug, index, content),
      documentSlug: slug,
      sectionPath,
      chunkIndex: index,
      content,
      isTable,
      effectiveFrom: dates.from,
      effectiveTo: dates.to,
      tokens: countTokens(content),
    });
    index += 1;
  };

  let buffer: Block[] = [];
  let bufferPath: string[] = [];
  let bufferTokens = 0;
  let bufferDivision = '';

  const flush = (): void => {
    if (buffer.length === 0) return;
    emit(bufferPath, buffer, false);
    buffer = [];
    bufferTokens = 0;
  };

  const divisionOf = (path: string[]): string => path[0] ?? '';

  const addTextBlock = (block: Block, path: string[]): void => {
    const tokens = blockTokens(block);
    const division = divisionOf(path);

    if (buffer.length > 0 && division !== bufferDivision) flush();

    if (buffer.length > 0 && bufferTokens + tokens > max) {
      flush();
    }

    if (buffer.length === 0) {
      bufferPath = path;
      bufferDivision = division;
    }

    // A single oversized block is split by sentences so no chunk exceeds max.
    if (tokens > max) {
      const sentences = block.text.split(/(?<=[.;:!?])\s+/);
      let piece = '';
      for (const sentence of sentences) {
        const candidate = piece ? `${piece} ${sentence}` : sentence;
        if (countTokens(candidate) > max && piece) {
          buffer.push({ kind: 'text', text: piece });
          bufferTokens += countTokens(piece);
          flush();
          piece = sentence;
        } else {
          piece = candidate;
        }
      }
      if (piece) {
        buffer.push({ kind: 'text', text: piece });
        bufferTokens += countTokens(piece);
      }
    } else {
      buffer.push(block);
      bufferTokens += tokens;
    }

    if (bufferTokens >= min) flush();
  };

  for (const unit of units) {
    for (const block of unit.blocks) {
      if (block.kind === 'table') {
        flush();
        emit(unit.path, [block], true);
        continue;
      }
      addTextBlock(block, unit.path);
    }
  }
  flush();

  // Overlap: prepend the tail of the previous chunk to each chunk that continues
  // the same division and was produced by a size split. Kept simple and explicit.
  if (overlap > 0) {
    for (let i = 1; i < chunks.length; i += 1) {
      const previous = chunks[i - 1];
      const current = chunks[i];
      if (!previous || !current || previous.isTable || current.isTable) continue;
      if (previous.sectionPath.split(' > ')[0] !== current.sectionPath.split(' > ')[0]) continue;
      if (current.tokens >= max) continue;
      const previousBody = previous.content.slice(previous.sectionPath.length).trim();
      const sentences = previousBody.split(/(?<=[.;:!?])\s+/);
      const tail: string[] = [];
      let tailTokens = 0;
      for (let s = sentences.length - 1; s >= 0; s -= 1) {
        const sentence = sentences[s];
        if (!sentence) continue;
        const tokens = countTokens(sentence);
        if (tailTokens + tokens > overlap) break;
        tail.unshift(sentence);
        tailTokens += tokens;
      }
      if (tail.length > 0 && tailTokens <= overlap) {
        current.content = `${current.sectionPath}\n\n${tail.join(' ')}\n\n${current.content
          .slice(current.sectionPath.length)
          .trim()}`;
        current.tokens = countTokens(current.content);
        current.id = chunkId(slug, current.chunkIndex, current.content);
      }
    }
  }

  return chunks;
};
