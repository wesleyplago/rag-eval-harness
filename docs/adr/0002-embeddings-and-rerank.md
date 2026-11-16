# ADR 0002 — Local embeddings, listwise LLM rerank with hard fallback

**Status:** accepted · **Date:** 2026-10-23

## Context

The main table needs four configurations: BM25, dense, hybrid and hybrid+rerank.
Dense and rerank need providers. This environment had no paid API key. The
alternatives were: skip half the table, or make the provider pluggable and run
the best available option.

Two facts constrained the choice:

- OpenRouter free models were rate-limited upstream (HTTP 429 on the first call)
  and the account has zero credits; a 140-question eval would not finish.
- A local LLM small enough to run on a 16 GB laptop is too weak to rerank 50
  Portuguese legal chunks reliably; a 3B model would make the rerank result a
  measurement of the model, not of reranking.

## Decision

**Embeddings:** `Xenova/bge-m3` (1024 dimensions, int8 ONNX) running locally with
`@huggingface/transformers`. It is multilingual, handles Portuguese well, is
deterministic, costs $0 per query, and keeps the repo runnable offline after the
one-time model download (~570 MB, cached in `.cache/transformers`).

**Rerank:** an OpenAI-compatible chat endpoint configured by
`RERANK_BASE_URL` / `RERANK_MODEL` / `RERANK_API_KEY`. In this environment it is
served by a local 9router instance backed by Kiro (`kr/claude-haiku-4.5`). The
code does not know about Kiro: it speaks the OpenAI chat-completions protocol, so
any compatible provider works.

Design rules:

- send the top 50 fused candidates, each capped at 3,000 characters, and ask for
  a JSON object `{"ids": [...]}` ordered by relevance;
- validate the response with Zod; discard ids that were not offered, deduplicate,
  and fill missing slots from the fused order;
- timeout (`RERANK_TIMEOUT_MS`), HTTP error, invalid JSON or an empty ranking all
  fall back to the fused order — a failed rerank must never break an eval run;
- count prompt/completion tokens from the provider response for the `$/1k`
  column, priced at the model's list price (Anthropic Haiku 4.5: $1/$5 per MTok).
  The actual marginal cost here is $0 because the model is reached through a
  subscription; the report says so instead of hiding it.

When no rerank endpoint is configured, `hybrid+rerank` is reported as
`skipped — TODO, not measured`, never with a fabricated number.

## Consequences

- Dense retrieval quality is bounded by bge-m3; it is not the strongest embedding
  model available, and that is visible in the numbers.
- The rerank quality is bounded by Haiku and by the 3,000-character cap. The cap
  is documented because a chunk's tail may be cut.
- The eval is reproducible offline except for the rerank calls, which require the
  configured endpoint.
