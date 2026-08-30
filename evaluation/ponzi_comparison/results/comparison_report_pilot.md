# 파일럿 비교 평가 리포트 (30개 주소)

> 생성: 2026. 7. 24. 오후 9:57:46

## 데이터셋

- 파일럿 주소: 30개 (ponzi=20, normal=10)
- 소스 없음(정적 스킵): 0개
- 로그 없음(동적 스킵): 0개
- baseline 비교 가능: 30개

---

## 표 1. Ponzi 주소 잔고 진단

> isMajorDrain: 최종잔고 < 최고잔고 × 10% → BALANCE_DROP 룰 트리거 가능

| 주소 | peak(Ξ) | final(Ξ) | ratio | drain? | dynamic hint (triggered rules) |
|------|--------:|---------:|------:|:------:|-------------------------------|
| `0x582b2489710a4189ad558b6958641789587fcc27` | 0.5000 | 0.0005 | 0.1% | ✓ | rug_pull (BALANCE_DROP+FLOW_SPIKE+CONCENTRATION_DRAIN) |
| `0xeb4245c88c660ae4ee23c76954e5490ccd7bbd82` | 0.0166 | 0.0000 | 0.0% | ✓ | rug_pull (BALANCE_DROP+FLOW_SPIKE+CONCENTRATION_DRAIN) |
| `0xd92d62ce8504e5c61aa17d9a9b13c65dbd77c268` | 0.0510 | 0.0000 | 0.0% | ✓ | ponzi_scheme (BALANCE_DROP+FLOW_SPIKE+CONCENTRATION_DRAIN) |
| `0xc352add7ad8cac8baa839d8c88e7e9d7df9a219b` | 0.2892 | 0.2892 | 100.0% |   | unknown () |
| `0x3f4dd010fbbc9a9b6d95f1f53837d7e9f3befac8` | 0.1100 | 0.1100 | 100.0% |   | unknown () |
| `0xf9533353c20495527e0499ac71e1507b418b9314` | 17.9642 | 10.8901 | 60.6% |   | unknown () |
| `0xe8b55deaced913c5c6890331d2926ea0fcbe59ac` | 0.1000 | 0.1000 | 100.0% |   | unknown () |
| `0x879716da78a75a44bdfa8f038ce875f99586940a` | 56.2250 | 0.0000 | 0.0% | ✓ | rug_pull (BALANCE_DROP+FLOW_SPIKE+CONCENTRATION_DRAIN) |
| `0x6203188c0dd1a4607614dbc8af409e91ed46def0` | 0.2441 | 0.2441 | 100.0% |   | unknown () |
| `0x4e1833a4a67ed1c8cb0ffc541ab7291c02d2fd06` | 0.0300 | 0.0000 | 0.0% | ✓ | rug_pull (BALANCE_DROP+FLOW_SPIKE+CONCENTRATION_DRAIN) |
| `0xc27590378690620a44b1382e7cf31db5a1f9b99e` | 0.0109 | 0.0099 | 90.9% |   | unknown () |
| `0x80c1a36dcbdca742f59f09fda16c43e6ad877c2b` | 0.0020 | 0.0020 | 100.0% |   | unknown () |
| `0x53344c813fbc35890a7304187dc920358b5acf4a` | 0.1890 | 0.0930 | 49.2% |   | unknown (FLOW_SPIKE+CONCENTRATION_DRAIN) |
| `0xbef44157a4afbfcce76db29353b6c103a03ed803` | 0.0100 | 0.0000 | 0.0% | ✓ | rug_pull (BALANCE_DROP+FLOW_SPIKE+CONCENTRATION_DRAIN) |
| `0x2c8eab1b7c57a6f9f81f761b26b71f99b25ff59c` | 19.5122 | 12.4241 | 63.7% |   | unknown () |
| `0xbd1e1ea13de6f320e89f33a7076b29d1a00506d8` | 18.9046 | 12.3213 | 65.2% |   | unknown () |
| `0xfc4f1acaaed191715cd50b9bc5311f7ad076424e` | 20.2093 | 12.9458 | 64.1% |   | unknown () |
| `0x5d41106d9088f968f6fdc376bec83451420c356f` | 18.8582 | 11.5224 | 61.1% |   | unknown () |
| `0xec34d45fde0836d50ac8438f8442002b588435c0` | 19.5061 | 13.0852 | 67.1% |   | unknown () |
| `0x75f97d98eb49989f9af40c49a7a1eb32767214f5` | 19.3409 | 12.5827 | 65.1% |   | unknown () |

**isMajorDrain 충족: 6/20개 (로그 있는 ponzi 기준)**
**dynamic ponzi_scheme 탐지: 1/20개**

---

## 표 2. 시스템별 성능 비교

> 평가 기준: baseline과 공통 30개 주소

| 시스템                               | Precision | Recall  | F1-Score |   TP |   FP |   FN |   TN |
|--------------------------------------|----------:|--------:|---------:|-----:|-----:|-----:|-----:|
| Baseline (Random Forest)             |    79.17% |  95.00% |   86.36% |   19 |    5 |    1 |    5 |
| 정적 분석 (prevention_reasoner 재현)       |    50.00% |   5.00% |    9.09% |    1 |    1 |   19 |    9 |
| 동적 분석 (dynamic_analyzer)             |   100.00% |   5.00% |    9.52% |    1 |    0 |   19 |   10 |
| 온톨로지 파이프라인 (OR 결합)                   |    66.67% |  10.00% |   17.39% |    2 |    1 |   18 |    9 |

---

## 표 3. 판정 불일치 (Baseline ≠ Ontology) — 21건

| 주소 | 정답 | Baseline | Ontology | 변화 |
|------|:----:|:--------:|:--------:|:----:|
| `0x582b2489710a4189ad558b6958641789587fcc27` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0xeb4245c88c660ae4ee23c76954e5490ccd7bbd82` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0xc352add7ad8cac8baa839d8c88e7e9d7df9a219b` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0x3f4dd010fbbc9a9b6d95f1f53837d7e9f3befac8` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0xe8b55deaced913c5c6890331d2926ea0fcbe59ac` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0x6203188c0dd1a4607614dbc8af409e91ed46def0` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0x4e1833a4a67ed1c8cb0ffc541ab7291c02d2fd06` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0xc27590378690620a44b1382e7cf31db5a1f9b99e` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0x80c1a36dcbdca742f59f09fda16c43e6ad877c2b` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0x53344c813fbc35890a7304187dc920358b5acf4a` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0xbef44157a4afbfcce76db29353b6c103a03ed803` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0x2c8eab1b7c57a6f9f81f761b26b71f99b25ff59c` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0xbd1e1ea13de6f320e89f33a7076b29d1a00506d8` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0xfc4f1acaaed191715cd50b9bc5311f7ad076424e` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0x5d41106d9088f968f6fdc376bec83451420c356f` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0xec34d45fde0836d50ac8438f8442002b588435c0` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0x75f97d98eb49989f9af40c49a7a1eb32767214f5` | 1 | 1 | static=0/dyn=0→0 | TP→FN |
| `0x5019066b46ae4b8673085b609be366400f53871b` | 0 | 1 | static=0/dyn=0→0 | FP→TN |
| `0xbc9ccc8a46d424de38b2e4df5f4a5001321c5d4c` | 0 | 1 | static=0/dyn=0→0 | FP→TN |
| `0x16ff57d02d9b1442f87c4b69eab5779fc8a71516` | 0 | 1 | static=0/dyn=0→0 | FP→TN |
| `0x032747313c4e914b5fce356ab8dc4df551972dcd` | 0 | 1 | static=0/dyn=0→0 | FP→TN |

---

## 분석 노트

### isMajorDrain과 BALANCE_DROP
- `dynamic_analyzer.js`의 BALANCE_DROP 룰: 최종잔고 < 최고잔고 × 10% **AND** `owner_withdraw_all` 액션 존재.
- 블록 집계 → per-tx 변환 시, `isMajorDrain=true`인 마지막 출금 블록만 `owner_withdraw_all`로 변환.
- isMajorDrain을 충족하지 않으면 BALANCE_DROP이 트리거되지 않아 ponzi_scheme 경로로 분류 불가.

### 정적 분석
- `fraud_ontology.js`의 PonziScheme checklistItems detectPattern을 소스 코드에 regex 매칭.
- 소스 코드 없음(미검증 컨트랙트 등) → pred=0으로 처리.