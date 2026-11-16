# Evaluation report

- Run: `2026-10-23T20-31-37-711Z` (2026-10-23T20:37:16.626Z)
- Corpus: 10 documents, 386 chunks
- Golden set: 140 questions (80 semantic, 20 identifier, 20 temporal, 20 unanswerable)
- Retrieval metric: recall/MRR/nDCG at 10, binary relevance on expected_chunk_ids
- Confidence intervals: paired bootstrap, 1000 resamples, 95%

## Headline

| config | recall@10 | MRR@10 | nDCG@10 | $/1k | p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- |
| bm25 | 0.427 | 0.234 | 0.279 | $0.00 | 3 ms | 5 ms |
| dense | 0.820 | 0.606 | 0.654 | $0.00 | 28 ms | 38 ms |
| hybrid | 0.767 | 0.566 | 0.615 | $0.00 | 32 ms | 55 ms |
| hybrid+rerank | 0.608 | 0.486 | 0.516 | $51.11 | 2170 ms | 3366 ms |

## By slice

| slice | config | recall@10 | MRR@10 | nDCG@10 | abstention precision | abstention recall |
| --- | --- | --- | --- | --- | --- | --- |
| semantic | bm25 | 0.512 | 0.275 | 0.332 | n/a | n/a |
| semantic | dense | 0.887 | 0.711 | 0.755 | n/a | n/a |
| semantic | hybrid | 0.738 | 0.493 | 0.552 | n/a | n/a |
| semantic | hybrid+rerank | 0.637 | 0.461 | 0.504 | n/a | n/a |
| identifier | bm25 | 0.062 | 0.025 | 0.025 | n/a | n/a |
| identifier | dense | 0.470 | 0.170 | 0.215 | n/a | n/a |
| identifier | hybrid | 0.850 | 0.785 | 0.801 | n/a | n/a |
| identifier | hybrid+rerank | 0.600 | 0.600 | 0.600 | n/a | n/a |
| temporal | bm25 | 0.450 | 0.283 | 0.323 | n/a | n/a |
| temporal | dense | 0.900 | 0.621 | 0.688 | n/a | n/a |
| temporal | hybrid | 0.800 | 0.642 | 0.681 | n/a | n/a |
| temporal | hybrid+rerank | 0.500 | 0.475 | 0.482 | n/a | n/a |
| unanswerable | bm25 | 0.000 | 0.000 | 0.000 | 0.514 | 0.900 |
| unanswerable | dense | 0.000 | 0.000 | 0.000 | 0.826 | 0.950 |
| unanswerable | hybrid | 0.000 | 0.000 | 0.000 | 0.452 | 0.700 |
| unanswerable | hybrid+rerank | 0.000 | 0.000 | 0.000 | 0.259 | 0.700 |

## Confidence intervals (overall)

| config | recall@10 [95% CI] | MRR@10 [95% CI] | nDCG@10 [95% CI] |
| --- | --- | --- | --- |
| bm25 | 0.427 [0.335, 0.518] | 0.234 [0.174, 0.299] | 0.279 [0.212, 0.345] |
| dense | 0.820 [0.749, 0.883] | 0.606 [0.534, 0.676] | 0.654 [0.584, 0.718] |
| hybrid | 0.767 [0.683, 0.842] | 0.566 [0.487, 0.644] | 0.615 [0.538, 0.688] |
| hybrid+rerank | 0.608 [0.517, 0.692] | 0.486 [0.400, 0.568] | 0.516 [0.428, 0.596] |

## Cost per 1,000 queries

| config | $/1k | embedding $/query | rerank $/query | avg rerank input tokens | rerank fallbacks |
| --- | --- | --- | --- | --- | --- |
| bm25 | $0.00 | $0.00000 | $0.00000 | 0 | 0 |
| dense | $0.00 | $0.00000 | $0.00000 | 0 | 0 |
| hybrid | $0.00 | $0.00000 | $0.00000 | 0 | 0 |
| hybrid+rerank | $51.11 | $0.00000 | $0.05111 | 51047 | 93 |

## Abstention

| config | precision | recall | F1 | false abstention rate |
| --- | --- | --- | --- | --- |
| bm25 | 0.514 | 0.900 | 0.655 | 0.142 |
| dense | 0.826 | 0.950 | 0.884 | 0.033 |
| hybrid | 0.452 | 0.700 | 0.549 | 0.142 |
| hybrid+rerank | 0.259 | 0.700 | 0.378 | 0.333 |

## Router ablation (identifier slice)

- hybrid without exact lookup: recall@10 0.236
- hybrid with exact lookup: recall@10 0.850

## Failure gallery (10 queries still wrong on hybrid)

### q007 — semantic

**Question:** Quais são as comunicações que o instituidor de um arranjo de pagamento deve fazer ao Banco Central do Brasil e aos participantes em caso de ocorrência de eventos críticos?

**Expected chunk ids:** 321425308

**Retrieved top-3:** —

**Hypothesis:** o sistema abstém: score do topo abaixo do limiar calibrado

### q008 — semantic

**Question:** Qual é a diferença entre PSP Pagador e PSP Recebedor no contexto do Pix?

**Expected chunk ids:** 332588723

**Retrieved top-3:** —

**Hypothesis:** o sistema abstém: score do topo abaixo do limiar calibrado

### q011 — semantic

**Question:** Quais são os critérios mínimos que os participantes devem adotar para avaliar suspeita de fraude em transações Pix?

**Expected chunk ids:** 456840834

**Retrieved top-3:** 598708002 (pix-regulamento › CAPÍTULO XIII — DO DICT > Seção III — Das funcionalidades); 60526530 (pix-regulamento › CAPÍTULO XIII — DO DICT > Seção III — Das funcionalidades > Subseção IX — Da notificação de infração); 1512774325 (pix-regulamento › CAPÍTULO XIII — DO DICT > Seção III — Das funcionalidades > Subseção IV — Da portabilidade das chaves Pix)

**Hypothesis:** chunks vizinhos da mesma seção competem e empurram o chunk correto para fora do top-10

### q014 — semantic

**Question:** Quais são as modalidades de arranjos de pagamento que o Pix abrange, considerando sua classificação quanto ao propósito, relacionamento dos usuários e abrangência territorial?

**Expected chunk ids:** 523447225

**Retrieved top-3:** —

**Hypothesis:** o sistema abstém: score do topo abaixo do limiar calibrado

### q017 — semantic

**Question:** Quais são as condições que instituições de pagamento não autorizadas pelo Banco Central devem cumprir para participar do Pix?

**Expected chunk ids:** 616468885

**Retrieved top-3:** —

**Hypothesis:** o sistema abstém: score do topo abaixo do limiar calibrado

### q018 — semantic

**Question:** Quais são as atividades para as quais o instituidor de um arranjo de pagamento deve designar diretores responsáveis?

**Expected chunk ids:** 622071760

**Retrieved top-3:** 2050038634 (arranjos-pagamento-522 › Preâmbulo); 724598071 (arranjos-pagamento › CAPÍTULO II — DAS DEFINIÇÕES); 1961677802 (arranjos-pagamento-522 › Preâmbulo)

**Hypothesis:** chunks vizinhos da mesma seção competem e empurram o chunk correto para fora do top-10

### q024 — semantic

**Question:** Quais são os possíveis valores que o campo de status da recorrência pode assumir quando o status da mensagem é 'true'?

**Expected chunk ids:** 731405503

**Retrieved top-3:** —

**Hypothesis:** o sistema abstém: score do topo abaixo do limiar calibrado

### q028 — semantic

**Question:** Qual é o prazo máximo para iniciar uma devolução de Pix contado da data da transação original?

**Expected chunk ids:** 846327789

**Retrieved top-3:** —

**Hypothesis:** o sistema abstém: score do topo abaixo do limiar calibrado

### q031 — semantic

**Question:** Quais são os dois procedimentos diferentes previstos para resolução de conflitos originários de transações iniciadas por serviço de iniciação de pagamento?

**Expected chunk ids:** 893621497

**Retrieved top-3:** —

**Hypothesis:** o sistema abstém: score do topo abaixo do limiar calibrado

### q034 — semantic

**Question:** Quais são as exceções previstas para instituições de pagamento que não precisam se submeter aos parâmetros desta Resolução?

**Expected chunk ids:** 973089848

**Retrieved top-3:** —

**Hypothesis:** o sistema abstém: score do topo abaixo do limiar calibrado

