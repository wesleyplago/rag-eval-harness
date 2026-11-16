# Abstention calibration

Thresholds chosen by sweeping cut-offs over the 140 golden questions, maximizing
recall on unanswerable questions subject to a false-abstention rate <= 15% on
answerable ones. Produced by `scripts/calibrate-scores.ts`.

| config | threshold | precision | recall | F1 | false abstention |
| --- | --- | --- | --- | --- | --- |
| bm25 | 2.0000 | 0.514 | 0.900 | 0.655 | 0.142 |
| dense | 0.5360 | 0.826 | 0.950 | 0.884 | 0.033 |
| hybrid | 0.0311 | 0.452 | 0.700 | 0.549 | 0.142 |
