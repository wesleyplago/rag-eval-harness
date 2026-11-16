# ADR 0001 — Chunking by section, not by fixed size

**Status:** accepted · **Date:** 2026-10-23

## Context

The corpus is Brazilian payment regulation: normative acts with a strong hierarchy
(`TÍTULO` → `CAPÍTULO` → `Seção` → `Art.` → `§`). Answers to questions like "what
does the rule say about the cautionary block?" live inside an article, and the
article is only meaningful together with its section heading. Retrieval quality
depends on returning that whole unit, not an arbitrary window that starts in the
middle of a paragraph.

The question this repository must answer — BM25 vs hybrid with rerank — is only
comparable if chunking is held constant and defensible. If chunk boundaries are
arbitrary, differences between retrievers get confounded with where the boundary
happened to fall.

## Decision

1. **One chunk per section, split only when the section exceeds the budget.**
   The hierarchy is rebuilt from the HTML (the Word exports used by the Banco
   Central have no semantic heading tags, only paragraphs that start with
   `CAPÍTULO`/`Seção`). A chunk never crosses a top-level division
   (`TÍTULO`/`CAPÍTULO`/`ANEXO`).
2. **Budget: 900 tokens maximum, 700 minimum when the section allows it, with
   150 tokens of overlap when a long section is split.** Splitting happens at
   paragraph/article boundaries, never mid-sentence, except for a single
   oversized paragraph (then at sentence boundaries).
3. **Tables are standalone chunks** and carry `is_table = true`. They are never
   merged with prose: a table row answered by a nearby paragraph is a different
   retrieval unit, and mixing them hides failures.
4. **Revoked text is removed.** The compiled BCB page marks revoked wording with
   `<s>` (951 blocks in the PIX regulation alone). Indexing it would make the
   corpus describe rules that are no longer in force.
5. **Chunk ids are a 31-bit hash of `(document, chunk_index, content)`**, so
   golden questions survive a re-ingest and a CI run that ingests a subset.
6. **Token counts use `gpt-tokenizer` (cl100k_base) as a proxy** for the XLM-R
   tokenizer used by bge-m3. A ~10% delta does not move a 700–900 token budget
   across the relevant boundary.

### Rejected alternative: fixed-size chunks

The obvious alternative is a sliding window of 512 or 1024 tokens with 10–20%
overlap. It is simpler and makes every chunk the same length, which is convenient
for batching.

It was rejected because:

- It cuts articles in half. A question about the *caput* of an article may retrieve
  the paragraph with the exception, not the rule.
- It produces chunks without a stable section path, so the LLM reranker cannot be
  told where a chunk came from, and failures cannot be explained by section.
- It multiplies near-duplicate chunks (overlap), which inflates recall@10 without
  making the system more useful.
- On this corpus it would also mix text from different `CAPÍTULOS` in one chunk,
  which is semantically wrong for a normative act.

## How the decision is measured

`pnpm eval --ablation` runs **3 sizes × 2 overlaps** (700/850/1000 tokens ×
120/180 overlap) and reports `recall@10`, `MRR@10` and `nDCG@10` on the same 140
golden questions.

Two caveats, stated up front:

- The ablation uses **BM25 only**. Re-embedding six variants would multiply eval
  cost and time by six; the chunking question is about boundaries, and BM25 is
  sensitive to them. Dense retrieval is measured on the chosen configuration in
  the main eval.
- Relevance for a variant is mapped from the original expected chunk by Jaccard
  similarity (≥ 0.3) between token sets. This is an approximation, and the
  `coverage` column reports how many questions could be mapped.

Results live in `results/ablation-<timestamp>.json`; the executed run is copied
into the README.

## Consequences

- Chunks average ~600–750 tokens, with some small ones at section ends (a section
  that ends below 700 tokens is not padded with the next section).
- The corpus produces ~380 chunks from ~1.5 MB of source text, enough for
  retrieval to be non-trivial but small enough to inspect by hand.
- The section path is stored and also prefixed to the chunk content, so the
  reranker and the failure gallery can point at the exact division.
