import { describe, expect, it } from 'vitest';
import { replaceSection } from '../src/eval/report.js';

describe('replaceSection', () => {
  it('fills an open marker and is idempotent on re-run', () => {
    const first = replaceSection('# T\n\n<!--X-->\n\n## Next', 'X', 'one');
    expect(first).toBe('# T\n\n<!--X-->\none\n<!--/X-->\n\n## Next');
    expect(replaceSection(first, 'X', 'two')).toBe('# T\n\n<!--X-->\ntwo\n<!--/X-->\n\n## Next');
  });

  it('leaves text without the marker untouched', () => {
    expect(replaceSection('no markers', 'X', 'body')).toBe('no markers');
  });
});
