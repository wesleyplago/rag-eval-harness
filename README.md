# rag-eval-harness

Retrieval over Brazilian payment regulation, measured: **how much does retrieval
improve going from plain BM25 to hybrid with rerank, and at what cost in money and
latency?** Answered with a 140-question golden set, recall@10 / MRR@10 / nDCG@10,
bootstrap confidence intervals, dollars per 1,000 queries and p50/p95 — including
the results that are bad, and the one that is not measured yet (rerank).

[![CI](https://github.com/wesleyplago/rag-eval-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/wesleyplago/rag-eval-harness/actions/workflows/ci.yml)
[![Retrieval eval](https://github.com/wesleyplago/rag-eval-harness/actions/workflows/eval.yml/badge.svg)](https://github.com/wesleyplago/rag-eval-harness/actions/workflows/eval.yml)

## Results

<!--RESULTS_TABLE-->
Run `2026-11-16T18-42-33-124Z` · 10 documents · 386 chunks · 140 questions · k=10. Raw data: [`results/results-2026-11-16T18-42-33-124Z.json`](results/results-2026-11-16T18-42-33-124Z.json). Produced by `pnpm eval`; this block is written by `pnpm report`.

| config | recall@10 | MRR@10 | nDCG@10 | $/1k | p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- |
| bm25 | 0.427 | 0.234 | 0.279 | $0.00 | 4 ms | 6 ms |
| dense | 0.820 | 0.606 | 0.654 | $0.00 | 29 ms | 56 ms |
| hybrid | 0.792 | 0.602 | 0.648 | $0.00 | 31 ms | 79 ms |
| hybrid+rerank | skipped | skipped | skipped | skipped | skipped | skipped |

`hybrid+rerank` was skipped: rerank endpoint rejected a probe request (HTTP 400).

**By slice** (abstention columns apply to the unanswerable slice only)

| slice | config | recall@10 | MRR@10 | nDCG@10 | abstention precision | abstention recall |
| --- | --- | --- | --- | --- | --- | --- |
| semantic | bm25 | 0.512 | 0.275 | 0.332 | n/a | n/a |
| semantic | dense | 0.887 | 0.711 | 0.755 | n/a | n/a |
| semantic | hybrid | 0.738 | 0.493 | 0.552 | n/a | n/a |
| identifier | bm25 | 0.062 | 0.025 | 0.025 | n/a | n/a |
| identifier | dense | 0.470 | 0.170 | 0.215 | n/a | n/a |
| identifier | hybrid | 1.000 | 1.000 | 1.000 | n/a | n/a |
| temporal | bm25 | 0.450 | 0.283 | 0.323 | n/a | n/a |
| temporal | dense | 0.900 | 0.621 | 0.688 | n/a | n/a |
| temporal | hybrid | 0.800 | 0.642 | 0.681 | n/a | n/a |
| unanswerable | bm25 | n/a | n/a | n/a | 0.514 | 0.900 |
| unanswerable | dense | n/a | n/a | n/a | 0.826 | 0.950 |
| unanswerable | hybrid | n/a | n/a | n/a | 0.452 | 0.700 |

**Abstention** (unanswerable questions should return no chunks)

| config | precision | recall | false abstention rate |
| --- | --- | --- | --- |
| bm25 | 0.514 | 0.900 | 0.142 |
| dense | 0.826 | 0.950 | 0.033 |
| hybrid | 0.452 | 0.700 | 0.142 |

**Identifier router** (identifier slice, hybrid): recall@10 0.236 without exact lookup → 1.000 with it (paired difference 0.764, 95% CI [0.583, 0.920]).
<!--/RESULTS_TABLE-->

**Reading it** (numbers from the block above and
[`results/REPORT.md`](results/REPORT.md), which has the 95% CIs):

- **BM25 → dense is the big step:** recall@10 0.427 → 0.820 on the 120 answerable
  questions, with non-overlapping CIs ([0.335, 0.518] vs [0.749, 0.883]).
- **Hybrid (RRF) does not beat dense here.** Overall recall@10 is 0.792 vs 0.820
  (CIs overlap), and on the semantic slice fusion costs about 15 points
  (0.887 → 0.738): BM25 is weak on this corpus and RRF gives its ranks equal weight.
- **Hybrid wins only on identifiers, and that is the router, not the fusion:**
  identifier recall@10 0.236 without exact lookup → 1.000 with it. Read the 1.000
  with care: identifier questions were generated so that the identifier appears
  literally in the expected chunk, so this slice measures whether the router
  fires, not retrieval in general. Before alphanumeric CNPJs were routed it was
  0.850 ([`results/results-2026-11-16T12-38-28-447Z.json`](results/results-2026-11-16T12-38-28-447Z.json)).
- **Rerank is not measured.** The rerank endpoint was unavailable for this run, so
  the eval skipped it instead of reporting fallback numbers. An earlier run
  ([`results/results-2026-10-23T20-31-37-711Z.json`](results/results-2026-10-23T20-31-37-711Z.json))
  has a rerank row, but it is **not valid**: 93 of 140 calls fell back, and an
  abstention bug (fixed in `fix(rerank): keep fused score distribution…`) cost it
  19 hits. Re-running needs only `RERANK_*` in `.env` and `pnpm eval`.
- **Cost is $0 for every measured config** because embeddings run locally; CPU
  time is not priced. Latency is p50 ~30 ms for dense and hybrid on a laptop CPU.
- **Abstention:** dense separates unanswerable questions best (precision 0.826,
  recall 0.950, 3.3% false abstentions). Thresholds were calibrated on this same
  set, so these numbers are optimistic.

## How the numbers were produced

- **Corpus:** nine public normative acts and one technical manual from the Banco
  Central do Brasil (Pix, Open Finance, boleto, payment arrangements, payment
  institutions, fraud/AML). 386 chunks after section-aware chunking; sources,
  URLs, collection date and licensing are in
  [`data/corpus/SOURCES.md`](data/corpus/SOURCES.md). The corpus is committed, so
  ingesting does not need the network.
- **Golden set:** 140 questions — 80 semantic, 20 identifier, 20 temporal, 20
  unanswerable — in [`golden/questions.jsonl`](golden/questions.jsonl). Questions
  were generated by sampling chunks and prompting an LLM, then **validated
  mechanically** (category counts, expected ids exist, identifier is literal in
  the corpus, no duplicates). They have **not** been reviewed by a human yet. Human review is tracked in
  [`golden/REVIEW.md`](golden/REVIEW.md) and is **pending**; the README does not
  claim manual review until that file is signed.
- **Metrics:** recall@10, MRR@10 and nDCG@10 with binary relevance against
  `expected_chunk_ids`, implemented in [`src/eval/metrics.ts`](src/eval/metrics.ts).
  The overall row averages the 120 answerable questions; unanswerable questions
  are scored only by abstention. When a configuration abstains, its retrieved list
  is treated as empty.
- **Confidence intervals:** paired bootstrap over questions, 1,000 resamples,
  95% percentile interval, per slice and overall
  ([`src/eval/metrics.ts`](src/eval/metrics.ts)).
- **Cost:** `$/1k = (embedding cost + rerank cost per query) × 1000`, using the
  price table in [`src/eval/pricing.ts`](src/eval/pricing.ts) with source URLs.
  Embeddings run locally with bge-m3, so their API cost is $0. Rerank, when it
  runs, is priced from the provider's reported token usage at Anthropic's Haiku 4.5
  list price ($1/$5 per MTok).
- **Abstention:** per-config thresholds calibrated by sweeping cut-offs on the
  golden set (false-abstention ≤ 15%), stored in
  [`config/abstention.json`](config/abstention.json). See
  [`config/ABSTENTION.md`](config/ABSTENTION.md) and
  [`docs/adr/0003-abstention.md`](docs/adr/0003-abstention.md).

- **Chunking ablation:** `pnpm eval --ablation` (3 sizes × 2 overlaps, BM25);
  result and reading in [`docs/adr/0001-chunking.md`](docs/adr/0001-chunking.md#ablation-result).
  Larger chunks gain ~4–6 recall points, within noise; the larger overlap never helps.

The raw run is [`results/`](results/) (`results-<timestamp>.json`), the rendered
report is [`results/REPORT.md`](results/REPORT.md), and every table in this
README is reproducible with `pnpm eval && pnpm report`.

### Why the corpora and golden set are small

140 questions over 386 chunks is enough to see a 5-point recall difference with a
paired bootstrap, not enough to resolve 1-point differences. The confidence
intervals are printed for exactly this reason: read them before believing a
ranking. This is an engineering eval, not a benchmark.

## Architecture

```text
Banco Central content API ──► data/raw/*.html (snapshots)
                                   │
                          normalize.ts (headings, tables, drop revoked <s>)
                                   ▼
                          data/corpus/*.md (committed)
                                   │
                          chunk.ts (section-aware, 900 max, 150 overlap)
                                   ▼
                     chunks ──► bge-m3 (1024-dim, local, int8)
                                   │
                            Postgres 16 + pgvector
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
        BM25 (tsvector)      dense (HNSW)      RRF k=60 fusion
              └────────────────────┼────────────────────┘
                                   ▼
                     identifier router (exact lookup first)
                                   ▼
                 LLM listwise rerank (top-50 → 10, Zod validated)
                                   ▼
                     eval runner ──► results/*.json ──► REPORT.md
                                   │
                            Hono /search + /health
```

- Chunking decision: [`docs/adr/0001-chunking.md`](docs/adr/0001-chunking.md)
- Embeddings and rerank: [`docs/adr/0002-embeddings-and-rerank.md`](docs/adr/0002-embeddings-and-rerank.md)
- Abstention: [`docs/adr/0003-abstention.md`](docs/adr/0003-abstention.md)
- Identifier router: [`docs/adr/0004-identifier-router.md`](docs/adr/0004-identifier-router.md)

## Quickstart

```bash
git clone https://github.com/wesleyplago/rag-eval-harness.git && cd rag-eval-harness
cp .env.example .env && docker compose up -d
pnpm install && pnpm ingest
pnpm eval
```

`docker compose up -d` starts Postgres 16 + pgvector on `localhost:5433` and the
API on `localhost:3000` (set `API_PORT` if 3000 is taken).
`pnpm ingest` runs migrations, chunks and embeds the committed corpus, and seeds
the golden questions. The first ingest downloads the ~570 MB bge-m3 model into
`.cache/transformers`; later runs are offline.

```bash
pnpm report   # results/REPORT.md from the latest run
pnpm serve    # GET /health, POST /search on :3000
pnpm eval --ablation   # 3 chunk sizes × 2 overlaps, BM25-only
```

Search:

```bash
curl -s localhost:3000/search -H 'content-type: application/json' \
  -d '{"query":"Como funciona o bloqueio cautelar no Pix?","k":5}' | jq
```

On the published data this example **abstains** (`"abstained": true`, top fused
score 0.0302 vs the calibrated hybrid threshold 0.0311 in
[`config/abstention.json`](config/abstention.json)): one of the 14% false
abstentions in the abstention table, left as is rather than hand-tuned away.

**macOS note:** `onnxruntime-node` ships an ad-hoc-signed native binary that some
hardened Node builds refuse to load. Symptom: `ERR_DLOPEN_FAILED ... different
Team IDs`. Fix (already applied in this workspace):

```bash
codesign --force --sign - node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/*.node
codesign --force --sign - node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/*.dylib
```

Then use a Node build with `com.apple.security.cs.disable-library-validation`
(the nvm and Homebrew builds have it).

## Failure gallery

Ten queries that are still wrong on `hybrid` (rerank was not measured). Extracted
from the latest run by [`src/eval/report.ts`](src/eval/report.ts); the full list
with retrieved chunk ids is in [`results/REPORT.md`](results/REPORT.md).

<!--FAILURE_GALLERY-->
From run `2026-11-16T18-42-33-124Z`, config `hybrid`. Expected vs retrieved sections are read from the database; the hypothesis column is a heuristic in [`src/eval/report.ts`](src/eval/report.ts), not a diagnosis.

| id | slice | question | expected section | hybrid top-1 | hypothesis |
| --- | --- | --- | --- | --- | --- |
| q011 | semantic | Quais são os critérios mínimos que os participantes devem adotar para avaliar suspeita de fraude em transações Pix? | pix-regulamento › CAPÍTULO X — DA AUTORIZAÇÃO PARA INICIAÇÃO E DA REJEIÇÃO DE TRANSAÇÕES | pix-regulamento › CAPÍTULO XIII — DO DICT > Seção III — Das funcionalidades | right document, wrong section: sibling sections share vocabulary and outrank the expected chunk |
| q018 | semantic | Quais são as atividades para as quais o instituidor de um arranjo de pagamento deve designar diretores responsáveis? | arranjos-pagamento › CAPÍTULO IV — DOS ARRANJOS DE PAGAMENTO > Seção III — Da Autorização para a Instituição de Arranjos de Pagamento | arranjos-pagamento-522 › Preâmbulo | wrong document: another norm covers the same topic and wins on both BM25 and dense |
| q039 | semantic | Quais são as três categorias de valores que podem ser cobrados dos participantes de um arranjo de pagamento, e como elas se diferenciam? | arranjos-pagamento-522 › Preâmbulo | arranjos-pagamento › CAPÍTULO IV — DOS ARRANJOS DE PAGAMENTO > Seção I — Das Modalidades | wrong document: another norm covers the same topic and wins on both BM25 and dense |
| q066 | semantic | Quais são os requisitos que uma instituição financeira deve cumprir para que sua política seja considerada válida perante o Banco Central? | pld-ft › CAPÍTULO II | pix-regulamento › CAPÍTULO VII — DA PARTICIPAÇÃO > Seção II — Dos requisitos e dos procedimentos para a participação no Pix | wrong document: another norm covers the same topic and wins on both BM25 and dense |
| q077 | semantic | Quais são os campos de uma recorrência Pix que o usuário recebedor pode alterar após ela ter sido confirmada pelo usuário pagador? | pix-manual › ANEXO IV – Pix Automático > 3.3. Estados da CobR > 3.3.5. Agendamento rejeitado pelo PSP Pagador | pix-manual › 6. Casos de Uso > 6.4. Pix Automático | right document, wrong section: sibling sections share vocabulary and outrank the expected chunk |
| q080 | semantic | Quais foram as datas em que o DICT entrou em funcionamento e em quais modalidades operacionais? | pix-regulamento › Preâmbulo | pix-regulamento › CAPÍTULO XIII — DO DICT > Seção II — Do acesso | right document, wrong section: sibling sections share vocabulary and outrank the expected chunk |
| q111 | temporal | A partir de quando os participantes do Pix passaram a não poder estabelecer limites para o número de transações que poderiam ser enviadas ou recebidas pelos usuários finais? | pix-regulamento › CAPÍTULO X — DA AUTORIZAÇÃO PARA INICIAÇÃO E DA REJEIÇÃO DE TRANSAÇÕES | pix-regulamento › CAPÍTULO V — DA INICIAÇÃO DE UM PIX > Seção I — Disposições gerais | right document, wrong section: sibling sections share vocabulary and outrank the expected chunk |
| q118 | temporal | A partir de quando o Mecanismo Especial de Devolução para o Pix passou a incluir casos de autorização indevida de transações do Pix Automático? | pix-regulamento › CAPÍTULO XI — DA DEVOLUÇÃO DE TRANSAÇÕES > Seção I | pix-regulamento › CAPÍTULO XI — DA DEVOLUÇÃO DE TRANSAÇÕES > Seção II — Do Mecanismo Especial de Devolução | right document, wrong section: sibling sections share vocabulary and outrank the expected chunk |
| q007 | semantic | Quais são as comunicações que o instituidor de um arranjo de pagamento deve fazer ao Banco Central do Brasil e aos participantes em caso de ocorrência de eventos críticos? | arranjos-pagamento › CAPÍTULO VI — DO GERENCIAMENTO DE RISCOS > Seção I — Da estrutura de gerenciamento — contínuo e integrado de riscos dos arranjos de pagamento | (abstained) | abstained: top fused score below the calibrated threshold |
| q008 | semantic | Qual é a diferença entre PSP Pagador e PSP Recebedor no contexto do Pix? | pix-manual › 4. Conceitos gerais | (abstained) | abstained: top fused score below the calibrated threshold |
<!--/FAILURE_GALLERY-->

What the gallery shows, checked by reading the chunks:

- **Fixed since the previous run: alphanumeric CNPJ.** q091/q092/q094 cite
  `12ABC34501DE35`; the router only knew the 14-digit numeric form, so they went to
  fusion and missed. [`src/retrieval/router.ts`](src/retrieval/router.ts) now
  detects the alphanumeric form (IN RFB 2.229/2024) with check-digit validation,
  and all three hit. No failure left in the gallery is an identifier question.
- **Two norms on the same topic compete.** Resolutions BCB 150 and BCB 522 both
  cover payment arrangements (q018, q039); each question retrieves the other one.
- **Sibling sections of one long act** (q011, q077, q080, q111, q118): the right document,
  a different chapter with the same vocabulary.
- **Some questions are underspecified.** q066 ("a política" of "uma instituição
  financeira") could be answered by several norms; this is a golden-set problem
  that human review should catch.

## What I'd do differently

- **Annotate the golden set before writing the harness.** Generating 140 questions
  with an LLM and reviewing them later is backwards: annotation is the expensive
  part, and questions written from a chunk inherit the chunk's blind spots.
- **Snapshot the norm over time instead of only the current consolidated text.**
  The temporal slice asks "when did this rule start?", not "what did the rule say
  in March 2024?". Answering the latter requires storing versions and filtering by
  `effective_from`; the schema has the columns, the corpus does not have the
  versions.
- **Use an embedding API with a stronger multilingual model** and compare it with
  bge-m3. Dense already beats BM25 here; the interesting question is how much of
  that is the model versus the corpus being easy for embeddings.
- **Measure answer quality, not only retrieval.** A retrieved chunk is necessary,
  not sufficient. Faithfulness/generation is deliberately out of scope, but a
  reader should not confuse this table with end-to-end RAG quality.
- **Route the identifier formats that exist now, not the ones I remembered.** The
  alphanumeric CNPJ was in the corpus and the first router missed it (fixed after
  the failure gallery exposed it); identifier patterns should be inventoried from
  the corpus, not written from memory.
- **Make rerank runs reproducible without a third-party gateway.** The first rerank
  run went through a local gateway that later stopped working; the measured row was
  lost with it. A pinned API with recorded responses would keep it re-runnable.
- **Split the reranker from the retriever earlier.** Once rerank is in, every
  failure has three possible causes; the current failure gallery guesses, it does
  not instrument each stage.

## Limitations

- **Not production software.** No auth, multi-tenancy, rate limiting, document
  ingestion of user files, or deployment story.
- **Retrieval-only eval.** No generation, no answer correctness, no citation
  faithfulness.
- **Small, Portuguese-only corpus.** 10 documents / 386 chunks; results do not
  transfer to other domains or languages.
- **Does not answer the rerank half of the question yet.** `hybrid+rerank` is
  skipped in the published run; the cost and latency of rerank are not measured.
- **Golden set pending human review**, and 80 of 140 questions are LLM-generated
  from chunks (see [`golden/REVIEW.md`](golden/REVIEW.md)).
- **Threshold calibration uses the eval set**, so the abstention numbers are
  mildly optimistic.
- **Cost is a list-price estimate.** Embeddings are local ($0 API, compute not
  priced).
- **No linha digitável example in the corpus.** The router's linha digitável and
  nosso número paths are covered by unit tests, not by the identifier slice.
- **Temporal questions are date questions**, not version-filtered retrieval: the
  schema has `effective_from`/`effective_to`, but the eval does not filter by an
  as-of date.

## Stack and decisions

- **TypeScript-first by choice.** The API, ingestion and eval share one strict
  type system (Zod at every boundary, no loose `any`). Python would be faster for
  the ML parts, but it would split the runtime and hide the seams; this repo is
  about showing the seams.
- **Postgres 16 + pgvector for everything.** BM25 lives in `tsvector`, dense in
  HNSW, chunks and eval runs in the same database. One store, one backup, one
  transaction boundary; no Elasticsearch/OpenSearch sidecar.
- **Knex with raw SQL where it matters.** Migrations and simple queries use the
  query builder; BM25, vector search and exact identifier lookup are raw SQL so
  the planner behaviour is explicit.
- **Hono + Zod** for the minimal API. Two endpoints, strict body validation, no
  framework ceremony.
- **No agent framework.** The four retrievers and the reranker are implemented by
  hand; the point is the decisions, not the abstraction.
- **Vitest** for unit tests, GitHub Actions for CI, Docker Compose for the local
  stack.

## License

MIT. The corpus is composed of public normative acts from the Banco Central do
Brasil; licensing notes per document are in
[`data/corpus/SOURCES.md`](data/corpus/SOURCES.md).
