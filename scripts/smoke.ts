import { closeDb } from '../src/db/client.js';
import { Bm25Retriever } from '../src/retrieval/bm25.js';
import { DenseRetriever } from '../src/retrieval/dense.js';
import { HybridRetriever } from '../src/retrieval/hybrid.js';
import { config } from '../src/config.js';

const queries = process.argv.slice(2);
const list = queries.length > 0 ? queries : [
  'Como funciona o bloqueio cautelar no Pix?',
  'Qual é o exemplo de CNPJ 00038166000105 usado como chave Pix?',
  'Quando o txid 8b3da2f39a4140d1a91abd93113bd44 aparece no manual?',
];
const retrievers = [new Bm25Retriever(), new DenseRetriever('local:bge-m3'), new HybridRetriever('local:bge-m3')];
for (const query of list) {
  console.log('\n==', query);
  for (const retriever of retrievers) {
    const started = performance.now();
    const results = await retriever.retrieve(query, 5);
    console.log(retriever.name, Math.round(performance.now() - started), 'ms', results.map((r) => `${r.chunkId}:${r.score.toFixed(3)}`).join(' '));
  }
}
await closeDb();
