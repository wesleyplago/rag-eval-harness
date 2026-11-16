# Evaluation report

- Run: `2026-11-16T18-42-33-124Z` (2026-11-16T18:42:49.047Z)
- Corpus: 10 documents, 386 chunks
- Golden set: 140 questions (80 semantic, 20 identifier, 20 temporal, 20 unanswerable)
- Retrieval metric: recall/MRR/nDCG at 10, binary relevance on expected_chunk_ids
- Confidence intervals: paired bootstrap, 1000 resamples, 95%

## Headline

| config | recall@10 | MRR@10 | nDCG@10 | $/1k | p50 | p95 |
| --- | --- | --- | --- | --- | --- | --- |
| bm25 | 0.427 | 0.234 | 0.279 | $0.00 | 4 ms | 6 ms |
| dense | 0.820 | 0.606 | 0.654 | $0.00 | 29 ms | 56 ms |
| hybrid | 0.792 | 0.602 | 0.648 | $0.00 | 31 ms | 79 ms |
| hybrid+rerank | skipped | skipped | skipped | skipped | skipped | skipped |

## By slice

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

## Confidence intervals (overall)

| config | recall@10 [95% CI] | MRR@10 [95% CI] | nDCG@10 [95% CI] |
| --- | --- | --- | --- |
| bm25 | 0.427 [0.335, 0.518] | 0.234 [0.174, 0.299] | 0.279 [0.212, 0.345] |
| dense | 0.820 [0.749, 0.883] | 0.606 [0.534, 0.676] | 0.654 [0.584, 0.718] |
| hybrid | 0.792 [0.717, 0.858] | 0.602 [0.523, 0.677] | 0.648 [0.575, 0.719] |

## Cost per 1,000 queries

| config | $/1k | embedding $/query | rerank $/query | avg rerank input tokens | rerank fallbacks |
| --- | --- | --- | --- | --- | --- |
| bm25 | $0.00 | $0.00000 | $0.00000 | 0 | 0 |
| dense | $0.00 | $0.00000 | $0.00000 | 0 | 0 |
| hybrid | $0.00 | $0.00000 | $0.00000 | 0 | 0 |

## Abstention

| config | precision | recall | F1 | false abstention rate |
| --- | --- | --- | --- | --- |
| bm25 | 0.514 | 0.900 | 0.655 | 0.142 |
| dense | 0.826 | 0.950 | 0.884 | 0.033 |
| hybrid | 0.452 | 0.700 | 0.549 | 0.142 |

## Router ablation (identifier slice)

- hybrid without exact lookup: recall@10 0.236
- hybrid with exact lookup: recall@10 1.000

## Failure gallery (10 queries still wrong on hybrid)

### q011 — semantic

**Question:** Quais são os critérios mínimos que os participantes devem adotar para avaliar suspeita de fraude em transações Pix?

**Expected chunk ids:** 456840834 (pix-regulamento › CAPÍTULO X — DA AUTORIZAÇÃO PARA INICIAÇÃO E DA REJEIÇÃO DE TRANSAÇÕES)

**Retrieved top-3:** 598708002 (pix-regulamento › CAPÍTULO XIII — DO DICT > Seção III — Das funcionalidades); 60526530 (pix-regulamento › CAPÍTULO XIII — DO DICT > Seção III — Das funcionalidades > Subseção IX — Da notificação de infração); 1512774325 (pix-regulamento › CAPÍTULO XIII — DO DICT > Seção III — Das funcionalidades > Subseção IV — Da portabilidade das chaves Pix)

**Hypothesis:** right document, wrong section: sibling sections share vocabulary and outrank the expected chunk

### q018 — semantic

**Question:** Quais são as atividades para as quais o instituidor de um arranjo de pagamento deve designar diretores responsáveis?

**Expected chunk ids:** 622071760 (arranjos-pagamento › CAPÍTULO IV — DOS ARRANJOS DE PAGAMENTO > Seção III — Da Autorização para a Instituição de Arranjos de Pagamento)

**Retrieved top-3:** 2050038634 (arranjos-pagamento-522 › Preâmbulo); 724598071 (arranjos-pagamento › CAPÍTULO II — DAS DEFINIÇÕES); 1961677802 (arranjos-pagamento-522 › Preâmbulo)

**Hypothesis:** wrong document: another norm covers the same topic and wins on both BM25 and dense

### q039 — semantic

**Question:** Quais são as três categorias de valores que podem ser cobrados dos participantes de um arranjo de pagamento, e como elas se diferenciam?

**Expected chunk ids:** 1142210967 (arranjos-pagamento-522 › Preâmbulo)

**Retrieved top-3:** 2028611514 (arranjos-pagamento › CAPÍTULO IV — DOS ARRANJOS DE PAGAMENTO > Seção I — Das Modalidades); 1323354255 (arranjos-pagamento › CAPÍTULO IV — DOS ARRANJOS DE PAGAMENTO > Seção III — Da Autorização para a Instituição de Arranjos de Pagamento); 724598071 (arranjos-pagamento › CAPÍTULO II — DAS DEFINIÇÕES)

**Hypothesis:** wrong document: another norm covers the same topic and wins on both BM25 and dense

### q066 — semantic

**Question:** Quais são os requisitos que uma instituição financeira deve cumprir para que sua política seja considerada válida perante o Banco Central?

**Expected chunk ids:** 1794280036 (pld-ft › CAPÍTULO II)

**Retrieved top-3:** 94516529 (pix-regulamento › CAPÍTULO VII — DA PARTICIPAÇÃO > Seção II — Dos requisitos e dos procedimentos para a participação no Pix); 1447443350 (arranjos-pagamento-522 › Preâmbulo); 1749362878 (open-finance-escopo › CAPÍTULO VI — DA PARTICIPAÇÃO NO OPEN — FINANCE > Seção I — Do Registro das Instituições — Participantes)

**Hypothesis:** wrong document: another norm covers the same topic and wins on both BM25 and dense

### q077 — semantic

**Question:** Quais são os campos de uma recorrência Pix que o usuário recebedor pode alterar após ela ter sido confirmada pelo usuário pagador?

**Expected chunk ids:** 2113923838 (pix-manual › ANEXO IV – Pix Automático > 3.3. Estados da CobR > 3.3.5. Agendamento rejeitado pelo PSP Pagador)

**Retrieved top-3:** 1265504923 (pix-manual › 6. Casos de Uso > 6.4. Pix Automático); 1979495217 (pix-manual › 5. Funcionalidades da API Pix); 262386968 (pix-manual › 6. Casos de Uso > 6.4. Pix Automático)

**Hypothesis:** right document, wrong section: sibling sections share vocabulary and outrank the expected chunk

### q080 — semantic

**Question:** Quais foram as datas em que o DICT entrou em funcionamento e em quais modalidades operacionais?

**Expected chunk ids:** 2131499371 (pix-regulamento › Preâmbulo)

**Retrieved top-3:** 1727426619 (pix-regulamento › CAPÍTULO XIII — DO DICT > Seção II — Do acesso); 874903904 (pix-regulamento › CAPÍTULO XIII — DO DICT); 552507461 (pix-regulamento › CAPÍTULO XIII — DO DICT > Seção III — Das funcionalidades > Subseção XII — Da recuperação de valores)

**Hypothesis:** right document, wrong section: sibling sections share vocabulary and outrank the expected chunk

### q111 — temporal

**Question:** A partir de quando os participantes do Pix passaram a não poder estabelecer limites para o número de transações que poderiam ser enviadas ou recebidas pelos usuários finais?

**Expected chunk ids:** 893498252 (pix-regulamento › CAPÍTULO X — DA AUTORIZAÇÃO PARA INICIAÇÃO E DA REJEIÇÃO DE TRANSAÇÕES)

**Retrieved top-3:** 1148756691 (pix-regulamento › CAPÍTULO V — DA INICIAÇÃO DE UM PIX > Seção I — Disposições gerais); 87998317 (pix-regulamento › CAPÍTULO XV — DA COBRANÇA DE TARIFAS AOS USUÁRIOS FINAIS); 180782179 (pix-regulamento › CAPÍTULO X — DA AUTORIZAÇÃO PARA INICIAÇÃO E DA REJEIÇÃO DE TRANSAÇÕES)

**Hypothesis:** right document, wrong section: sibling sections share vocabulary and outrank the expected chunk

### q118 — temporal

**Question:** A partir de quando o Mecanismo Especial de Devolução para o Pix passou a incluir casos de autorização indevida de transações do Pix Automático?

**Expected chunk ids:** 1844161234 (pix-regulamento › CAPÍTULO XI — DA DEVOLUÇÃO DE TRANSAÇÕES > Seção I)

**Retrieved top-3:** 57683669 (pix-regulamento › CAPÍTULO XI — DA DEVOLUÇÃO DE TRANSAÇÕES > Seção II — Do Mecanismo Especial de Devolução); 262386968 (pix-manual › 6. Casos de Uso > 6.4. Pix Automático); 846327789 (pix-regulamento › CAPÍTULO XI — DA DEVOLUÇÃO DE TRANSAÇÕES > Seção I)

**Hypothesis:** right document, wrong section: sibling sections share vocabulary and outrank the expected chunk

### q007 — semantic

**Question:** Quais são as comunicações que o instituidor de um arranjo de pagamento deve fazer ao Banco Central do Brasil e aos participantes em caso de ocorrência de eventos críticos?

**Expected chunk ids:** 321425308 (arranjos-pagamento › CAPÍTULO VI — DO GERENCIAMENTO DE RISCOS > Seção I — Da estrutura de gerenciamento — contínuo e integrado de riscos dos arranjos de pagamento)

**Retrieved top-3:** —

**Hypothesis:** abstained: top fused score below the calibrated threshold

### q008 — semantic

**Question:** Qual é a diferença entre PSP Pagador e PSP Recebedor no contexto do Pix?

**Expected chunk ids:** 332588723 (pix-manual › 4. Conceitos gerais)

**Retrieved top-3:** —

**Hypothesis:** abstained: top fused score below the calibrated threshold

