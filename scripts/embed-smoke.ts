import { embedTexts } from '../src/ingest/embed.js';

const started = Date.now();
const vectors = await embedTexts([
  'O Pix permite transferências instantâneas.',
  'O boleto é um instrumento de pagamento.',
]);
console.log('vectors', vectors.length, 'dim', vectors[0]?.length, 'ms', Date.now() - started);
console.log(
  'cosine',
  vectors[0] && vectors[1]
    ? vectors[0].reduce((s, v, i) => s + v * (vectors[1]?.[i] ?? 0), 0)
    : null,
);
