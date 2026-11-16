import { config } from '../src/config.js';
import { closeDb } from '../src/db/client.js';
import { HybridRetriever } from '../src/retrieval/hybrid.js';
import { RerankRetriever } from '../src/retrieval/rerank.js';

const { baseUrl, model } = config.rerank;
if (!baseUrl || !model) throw new Error('RERANK_BASE_URL and RERANK_MODEL must be set');
const hybrid = new HybridRetriever('local:bge-m3');
const reranker = new RerankRetriever(hybrid, {
  baseUrl,
  apiKey: config.rerank.apiKey,
  model,
  timeoutMs: config.rerank.timeoutMs,
  candidates: config.rerank.candidates,
});
for (const query of [
  'Como funciona o bloqueio cautelar no Pix?',
  'Qual é o exemplo de CNPJ 00038166000105 usado como chave Pix?',
]) {
  const started = performance.now();
  const results = await reranker.retrieve(query, 10);
  console.log('\n', query, Math.round(performance.now() - started), 'ms');
  console.log(results.map((r) => r.chunkId).join(','));
  console.log(reranker.stats());
}
await closeDb();
