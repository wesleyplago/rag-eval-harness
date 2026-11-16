# Corpus sources

Todos os documentos são atos normativos ou manuais oficiais do Banco Central do Brasil,
coletados em **2026-10-23** pela API pública de conteúdo do BCB
(`/api/conteudo/app/normativos/exibenormativo`) ou, no caso do manual, pelo PDF oficial.

**Direito de uso:** textos de leis, decretos e regulamentos não são objeto de proteção
autoral (Lei nº 9.610/1998, art. 8º, IV). Os arquivos são mantidos aqui como corpus de
avaliação, com URL canônica e data de coleta registradas abaixo.

## Documentos

| # | documento | URL canônica | publicado | coletado | chunks | tokens | tabelas |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Resolução BCB N° 1 (`pix-regulamento`) | https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20BCB&numero=1 | 2020-08-12 | 2026-10-23 | 101 | 76288 | 0 |
| 2 | Resolução Conjunta Nº 1 (`open-finance`) | https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20Conjunta&numero=1 | 2020-05-04 | 2026-10-23 | 20 | 13881 | 0 |
| 3 | Resolução BCB N° 443 (`boleto`) | https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20BCB&numero=443 | 2024-12-12 | 2026-10-23 | 14 | 8869 | 0 |
| 4 | Resolução BCB N° 150 (`arranjos-pagamento`) | https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20BCB&numero=150 | 2021-10-06 | 2026-10-23 | 53 | 37658 | 1 |
| 5 | Resolução BCB N° 32 (`open-finance-escopo`) | https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20BCB&numero=32 | 2020-10-29 | 2026-10-23 | 19 | 9342 | 0 |
| 6 | Resolução BCB N° 80 (`instituicoes-pagamento`) | https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20BCB&numero=80 | 2021-03-25 | 2026-10-23 | 14 | 6621 | 0 |
| 7 | Resolução BCB N° 522 (`arranjos-pagamento-522`) | https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20BCB&numero=522 | 2025-11-10 | 2026-10-23 | 21 | 18004 | 0 |
| 8 | Resolução BCB N° 142 (`fraudes-pagamentos`) | https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20BCB&numero=142 | 2021-09-23 | 2026-10-23 | 3 | 2263 | 0 |
| 9 | Circular N° 3.978 (`pld-ft`) | https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Circular&numero=3978 | 2020-01-23 | 2026-10-23 | 24 | 13631 | 0 |
| 10 | Manual de Padrões para Iniciação do Pix (v2.10.0) (`pix-manual`) | https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf | 2025-09-05 | 2026-10-23 | 117 | 69647 | 0 |
| | **total** | | | | **386** | **256204** | **1** |

## Normalização

- HTML do BCB → markdown por `src/ingest/normalize.ts`: headings reconstruídos a partir de
  `CAPÍTULO`/`Seção` (o export do Word não tem tags semânticas), tabelas convertidas para
  GFM, texto revogado (`<s>`) removido.
- O Manual de Iniciação do Pix é PDF; foi convertido por `scripts/pdf_to_markdown.py`
  (pypdf) e o markdown resultante é a fonte de verdade do ingest.
- Os `.md` estão commitados: rodar o projeto não depende de rede.

## Observações de cobertura

- O corpus contém exemplos literais de **CNPJ** (`00038166000105`, `12ABC34501DE35`) e
  **TXID** (`8b3da2f39a4140d1a91abd93113bd44`, `2353c790eefb11eaadc10242ac120002`) no
  manual do Pix.
- Não há exemplo literal de **linha digitável** nem de **nosso número** no material
  normativo coletado; o router cobre esses formatos por testes unitários, e a limitação
  está declarada no README.
