# ADR 0003 — Abstention thresholds are calibrated, not guessed

**Status:** accepted · **Date:** 2026-10-23

## Context

The four retrievers return scores on incomparable scales: `ts_rank_cd` for BM25,
cosine similarity for dense, RRF sums (~0.01–0.03) for hybrid, and rank-based
scores for the reranked list. A single global threshold would either abstain on
every hybrid query or never abstain on dense ones.

The product requirement is to return `no_answer` instead of random chunks when
the corpus does not contain the answer, and to measure whether abstention is
correct: precision (when it refuses, was refusal right?) and recall (of the
questions that should be refused, how many were?).

## Decision

- Each configuration has its own threshold, stored in `config/abstention.json`.
- Thresholds are produced by sweeping candidate cut-offs over the golden set and
  maximizing abstention recall subject to a **false-abstention rate ≤ 15%** on
  answerable questions. The script is `scripts/calibrate-abstain.ts`, and its
  output is committed so the eval is reproducible.
- The threshold applies to the top-1 score *after* retrieval; for
  `hybrid+rerank` it applies to the fused score, because the reranker's output is
  an ordering, not a calibrated probability.
- The eval reports precision, recall, F1 and the false-abstention rate. The
  calibration set is the golden set itself: this is mild overfitting and is
  called out in the README.

## Consequences

- `no_answer` is honest within the corpus, but the threshold is only as good as
  the 20 unanswerable questions.
- If a configuration's scores drift (new embedding model, different reranker),
  the threshold must be recalibrated; the eval will show the damage first as a
  drop in abstention recall.
