# ADR 0004 — Exact lookup before ANN for identifiers

**Status:** accepted · **Date:** 2026-10-23

## Context

Queries that contain a TXID, a linha digitável, a CNPJ or a nosso número ask
about one specific record. Approximate nearest neighbours are the wrong tool:
the embedding of a 32-character identifier carries almost no semantics, and the
one chunk that contains that literal value can easily fall outside the top 50.

## Decision

`detectIdentifier(query)` runs before retrieval and recognises:

| kind | pattern |
| --- | --- |
| linha digitável | 47 or 48 digits, with or without separators |
| CNPJ | masked `00.000.000/0000-00` or 14 bare digits |
| TXID | 26–35 alphanumerics containing at least one letter and one digit |
| nosso número | explicitly labelled (`nosso número: ...`), 9–14 digits |

When an identifier is present, hybrid retrieval performs an exact/lexical lookup
(digits-only or uppercased content, sequential scan over the small corpus) and
only fills the remaining slots with the RRF-fused semantic results. If the exact
lookup finds nothing, it falls back to pure fusion — the identifier may simply
not be in the corpus.

The router is part of the `hybrid` and `hybrid+rerank` configurations. To make
its effect measurable, the eval also runs a `hybrid-no-router` variant on the
identifier slice and reports the paired bootstrap difference.

## Consequences

- The identifier slice shows whether exact lookup helps; if the gain is zero,
  the README says so.
- A false positive (e.g., an ordinary 14-digit number) degrades to the fusion
  fallback, so it is safe.
- The corpus currently contains TXID and CNPJ examples (PIX manual) but no
  linha digitável example; the router's linha digitável path is covered by unit
  tests, not by the golden set. This is stated in the README.
