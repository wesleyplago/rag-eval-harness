import { readFile } from 'node:fs/promises';
import { load } from 'cheerio';

for (const slug of ['open-finance-escopo', 'instituicoes-pagamento']) {
  const html = await readFile(`data/raw/${slug}.html`, 'utf8');
  const $ = load(html);
  console.log(slug, 'html', html.length, 'bodyText', $('body').text().length);
  const tags: Record<string, number> = {};
  $('body')
    .find('*')
    .each((_, el) => {
      const t = el.tagName;
      tags[t] = (tags[t] || 0) + 1;
    });
  console.log(tags);
  console.log('first 400:', $('body').text().slice(0, 400).replace(/\s+/g, ' '));
}
