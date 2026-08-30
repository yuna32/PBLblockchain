# 폰지 탐지 시스템 비교 평가 리포트

> 생성: 2026. 7. 24. 오후 10:39:58

## 데이터셋 개요

- 전체 평가 주소: **500개**
- Ponzi (label=1): **200개**
- Normal (label=0): **300개**
- 소스 없음(정적 스킵): 0개
- 로그 없음(동적 스킵): 188개

---

## 표 1-A. Exact Match 평가

> **exact_match는 정확한 유형 분류 성능**: dynamic_analyzer가 Ponzi Scheme(`ponzi_scheme` 또는 `ponzi_or_laundering`)으로 정확히 분류한 경우만 positive.
> baseline_predictions.csv 공통 주소 기준. 소스/로그 없음 → negative(0) 처리.

| 시스템                             | Precision | Recall  | F1-Score |   TP |   FP |   FN |   TN |
|------------------------------------|----------:|--------:|---------:|-----:|-----:|-----:|-----:|
| Baseline (Random Forest)           |    66.67% |  64.47% |   65.55% |   98 |   49 |   54 |  111 |
| 정적 분석 (prevention_reasoner 재현)     |    89.83% |  34.87% |   50.24% |   53 |    6 |   99 |  154 |
| 동적 분석 — exact match                |    58.33% |  13.82% |   22.34% |   21 |   15 |  131 |  145 |
| 온톨로지 (exact, Static OR Dynamic)    |    77.53% |  45.39% |   57.26% |   69 |   20 |   83 |  140 |

---

## 표 1-B. Superclass 평가

> **superclass는 사기 여부 자체를 걸러내는 성능**: `ponzi_scheme`, `rug_pull`, `money_laundering`, `pump_and_dump` 중 하나라도 탐지되면 positive.
> baseline_predictions.csv 공통 주소 기준. 소스/로그 없음 → negative(0) 처리.

| 시스템                             | Precision | Recall  | F1-Score |   TP |   FP |   FN |   TN |
|------------------------------------|----------:|--------:|---------:|-----:|-----:|-----:|-----:|
| Baseline (Random Forest)           |    66.67% |  64.47% |   65.55% |   98 |   49 |   54 |  111 |
| 정적 분석 (prevention_reasoner 재현)     |    89.83% |  34.87% |   50.24% |   53 |    6 |   99 |  154 |
| 동적 분석 — superclass                 |    45.68% |  24.34% |   31.76% |   37 |   44 |  115 |  116 |
| 온톨로지 (super, Static OR Dynamic)    |    63.08% |  53.95% |   58.16% |   82 |   48 |   70 |  112 |

---

## 표 2. 판정 불일치 주소 (Baseline ≠ Ontology Exact) — 112건

> 상세: `./results/disagreement_cases.csv`

| 주소 | 정답 | Baseline | Ontology(exact) | 변화 |
|------|:----:|:--------:|:---------------:|:----:|
| `0xd92d62ce8504e5c61aa17d9a9b13c65dbd77c268` | 1 | 0 | 1 | FN→TP |
| `0xe8b55deaced913c5c6890331d2926ea0fcbe59ac` | 1 | 1 | 0 | TP→FN |
| `0x879716da78a75a44bdfa8f038ce875f99586940a` | 1 | 1 | 0 | TP→FN |
| `0xc27590378690620a44b1382e7cf31db5a1f9b99e` | 1 | 1 | 0 | TP→FN |
| `0x2c8eab1b7c57a6f9f81f761b26b71f99b25ff59c` | 1 | 1 | 0 | TP→FN |
| `0xbd1e1ea13de6f320e89f33a7076b29d1a00506d8` | 1 | 1 | 0 | TP→FN |
| `0xfc4f1acaaed191715cd50b9bc5311f7ad076424e` | 1 | 1 | 0 | TP→FN |
| `0x5d41106d9088f968f6fdc376bec83451420c356f` | 1 | 1 | 0 | TP→FN |
| `0xec34d45fde0836d50ac8438f8442002b588435c0` | 1 | 1 | 0 | TP→FN |
| `0x75f97d98eb49989f9af40c49a7a1eb32767214f5` | 1 | 1 | 0 | TP→FN |
| `0x21aec0a028d7adec228595b24439c7eb969edd5f` | 1 | 1 | 0 | TP→FN |
| `0x871ae94d2375f7a0d2fa584d0201c67ed2d35103` | 1 | 1 | 0 | TP→FN |
| `0xe86c98c75450075d096580f843fcd67a858ffd5f` | 1 | 0 | 1 | FN→TP |
| `0x582e3d8dcd41f586fbcc6559f16476d20b2a3b95` | 1 | 0 | 1 | FN→TP |
| `0x2e5e995bdaa495abaf2af499d682b0277d4dd66b` | 1 | 1 | 0 | TP→FN |
| `0x68bbb2461d7c4c30902621e5b6e6e3e45890c1ff` | 1 | 1 | 0 | TP→FN |
| `0x935b118412c93ee969051fd14ef96c70ecd7839d` | 1 | 1 | 0 | TP→FN |
| `0xe02d1cf96c2d6dc085f475ce61579c9538119b86` | 1 | 1 | 0 | TP→FN |
| `0x9bc42587af0fe34032d8068f51bd6bd7d7e4d718` | 1 | 1 | 0 | TP→FN |
| `0x7bbc3ad5c296ae6eb50228d2a6a37234d2db3ff1` | 1 | 1 | 0 | TP→FN |
| `0x2101ba900918345003585b0a17de91570609d706` | 1 | 0 | 1 | FN→TP |
| `0xb6951dba8d2aa5156440bcc4ba1af82f12c55159` | 1 | 1 | 0 | TP→FN |
| `0xd7cb65c907815d1852e246198aa7687e06d96e53` | 1 | 1 | 0 | TP→FN |
| `0x5fb3d432bae33fcd418ede263d98d7440e7fa3ea` | 1 | 0 | 1 | FN→TP |
| `0x9b26ba3a1d66cca67aa413da042a144a39c554b9` | 1 | 1 | 0 | TP→FN |
| `0x9a2e9235f7a7ac7b899e5f3208fbb13c6985171a` | 1 | 0 | 1 | FN→TP |
| `0x1ce7986760ade2bf0f322f5ef39ce0de3bd0c82b` | 1 | 1 | 0 | TP→FN |
| `0x109c4f2ccc82c4d77bde15f306707320294aea3f` | 1 | 1 | 0 | TP→FN |
| `0x4fb663c1616bfe80b5b6d5a214efa81d5a121801` | 1 | 1 | 0 | TP→FN |
| `0xda922e473796bc372d4a2cb95395ed17af8b309b` | 1 | 1 | 0 | TP→FN |
| `0x6adf9e666e3e85876b1ba25edb31799faad8417b` | 1 | 1 | 0 | TP→FN |
| `0x75aa81161e07483f6ca199fef46c13eb13d190be` | 1 | 1 | 0 | TP→FN |
| `0xc99b3615724b7c4d3e4b348cfc8a25b9e2133828` | 1 | 1 | 0 | TP→FN |
| `0x245233bc8604d2097bfcbf3338959c46da04d9e0` | 1 | 1 | 0 | TP→FN |
| `0x99925cc9a57f5e473ff22314cfe0627a0bfcceb4` | 1 | 1 | 0 | TP→FN |
| `0x7d3ae940eb73dc9131758ad2e326c7d863b0916a` | 1 | 0 | 1 | FN→TP |
| `0xf767fca8e65d03fe16d4e38810f5e5376c3372a8` | 1 | 0 | 1 | FN→TP |
| `0x51170b18bca7896b49c52dcc18e66e5c921e100f` | 1 | 1 | 0 | TP→FN |
| `0xcac337492149bdb66b088bf5914bedfbf78ccc18` | 1 | 1 | 0 | TP→FN |
| `0x3e84512f277a5081b9209831c51bce665035d9db` | 1 | 1 | 0 | TP→FN |
| `0xa0f9fb2170dc2d181ef8aaf3571dc441813e0154` | 1 | 0 | 1 | FN→TP |
| `0x78d4f849aab2b0a5a66f76b9b1ff47da5a9ae492` | 1 | 1 | 0 | TP→FN |
| `0xcaaca224e35d0a1fa3304a3c4ec8beb5f28a99aa` | 1 | 0 | 1 | FN→TP |
| `0xf70ce1be9685b0cfb531bc712d3faace858b5bfb` | 1 | 0 | 1 | FN→TP |
| `0xb5aff01f3e820735fac9abb594dc9993cb9e5bd2` | 1 | 1 | 0 | TP→FN |
| `0x99d982e49bcb5465a6b4c1e0ec4341c912d9ba42` | 1 | 1 | 0 | TP→FN |
| `0x258d778e4771893758dfd3e7dd1678229320eeb5` | 1 | 1 | 0 | TP→FN |
| `0x1368e088682b3ea455c4856297365542ca6828d8` | 1 | 1 | 0 | TP→FN |
| `0xe861ad00aed0f04b41c675ec1c1493d2ebcbe776` | 1 | 1 | 0 | TP→FN |
| `0x09515cb5e3acaef239ab83d78b2f3e3764fcab9b` | 1 | 1 | 0 | TP→FN |
| `0xb1d58bad78f33892719cdeba218f8641a71a3f05` | 1 | 1 | 0 | TP→FN |
| `0x37b53b46fa74ac3f9b4340dc5a39aabb0f2afa33` | 1 | 0 | 1 | FN→TP |
| `0x428da5ff72d8be0efaa85336b6c6a9fc9e0f73fe` | 1 | 0 | 1 | FN→TP |
| `0x89c2352cb600df56fe4bfb5882caadef3e96213f` | 1 | 1 | 0 | TP→FN |
| `0x16a4ff536001405f2b0d7ddafc79f6a10d024640` | 1 | 1 | 0 | TP→FN |
| `0xa259e6bcade86c770cb5214c789ee107662831a6` | 1 | 0 | 1 | FN→TP |
| `0xf7070fc72e2b92c6309785a39338d7c919a3cf4a` | 1 | 1 | 0 | TP→FN |
| `0x5a437d94843541d5cb83221a4a4b253de30b97b7` | 1 | 0 | 1 | FN→TP |
| `0x3325439082ff8ba7371dfdaa1af297bbfcac21b2` | 1 | 1 | 0 | TP→FN |
| `0x316201f586706aaa2795bc2a3f0bad2379c363e4` | 1 | 1 | 0 | TP→FN |
| `0xfd2487cc0e5dce97f08be1bc8ef1dce8d5988b4d` | 1 | 0 | 1 | FN→TP |
| `0x19a6067538c90973ef5dc31ded5fa567f3d09059` | 1 | 0 | 1 | FN→TP |
| `0x24ec083b6a022099003e3d035fed48b9a58296e5` | 1 | 0 | 1 | FN→TP |
| `0x4865e85c72a27ca6c362da75ba6707c07464b953` | 1 | 1 | 0 | TP→FN |
| `0xdcb13fa157eebf22ddc8c9aa1d6e394810de6fa3` | 1 | 1 | 0 | TP→FN |
| `0xb5b8749355b89bcb04dd70001cea1b98a81ffe61` | 0 | 1 | 0 | FP→TN |
| `0xbc9ccc8a46d424de38b2e4df5f4a5001321c5d4c` | 0 | 1 | 0 | FP→TN |
| `0xc2d4290aa2dee92c6ad85ecd580d1216010e92d0` | 0 | 1 | 0 | FP→TN |
| `0x163733bcc28dbf26b41a8cfa83e369b5b3af741b` | 0 | 1 | 0 | FP→TN |
| `0xf0cfb6e33af9a0bbf70b37662c0f5b3c7483b16d` | 0 | 0 | 1 | TN→FP |
| `0x59a048d31d72b98dfb10f91a8905aecda7639f13` | 0 | 1 | 0 | FP→TN |
| `0xd70994d7020df8052a1124561ff548f3b88744d8` | 0 | 1 | 0 | FP→TN |
| `0xc0506ceb264b057182a4c3ab8a0b910a545479f0` | 0 | 1 | 0 | FP→TN |
| `0x9ffe3a0864cce4995a6b385b99de3644cc8d2483` | 0 | 0 | 1 | TN→FP |
| `0xb6346b0cf3925b8758b5d98cd19703d2c5239e99` | 0 | 1 | 0 | FP→TN |
| `0x2c2e3baa2191cf325a28a01ff42340f2ae677572` | 0 | 1 | 0 | FP→TN |
| `0x2d68a9a9dd9fcffb070ea1d8218c67863bfc55ff` | 0 | 1 | 0 | FP→TN |
| `0x3d3ed0a4f0af930955806b34367e7c64a0e1c84a` | 0 | 1 | 0 | FP→TN |
| `0x33a8ea1c8c6294c9f65f3dad7ca7f037bd09f951` | 0 | 1 | 0 | FP→TN |
| `0xd566fa4a696eac66f749f7fe999d6673fee2026c` | 0 | 1 | 0 | FP→TN |
| `0x59de38752b22c13cb45da2105cd769e57ff615a8` | 0 | 1 | 0 | FP→TN |
| `0x02b97cca6d6a5227e464b2a60ee1a580ea4f7da9` | 0 | 1 | 0 | FP→TN |
| `0xc47f25a40e12f7f07fabcc996148d1e1326903d2` | 0 | 1 | 0 | FP→TN |
| `0xaf2b8e6114da000176c506f77b173251c16b511d` | 0 | 0 | 1 | TN→FP |
| `0xcd3e727275bc2f511822dc9a26bd7b0bbf161784` | 0 | 1 | 0 | FP→TN |
| `0x92a06f3ed11af181d832bb474d017906acb8c299` | 0 | 1 | 0 | FP→TN |
| `0x7171d368b76f5607ddd6233a00f5c2f5d82a95e4` | 0 | 0 | 1 | TN→FP |
| `0x04830e45762f09853b398d1d03003fda7c978597` | 0 | 1 | 0 | FP→TN |
| `0xd0a6e6c54dbc68db5db3a091b171a77407ff7ccf` | 0 | 0 | 1 | TN→FP |
| `0x91c94bee75786fbbfdcfefba1102b68f48a002f4` | 0 | 0 | 1 | TN→FP |
| `0xa3d4d7df3988d48c48728787cb5910a8a4cc4d26` | 0 | 1 | 0 | FP→TN |
| `0xdd5d965b26e1d11f7933797b465fa95c89c368f5` | 0 | 0 | 1 | TN→FP |
| `0x20d42f2e99a421147acf198d775395cac2e8b03d` | 0 | 1 | 0 | FP→TN |
| `0xa2d4035389aae620e36bd828144b2015564c2702` | 0 | 1 | 0 | FP→TN |
| `0x4e260e3ca268e40133c84b142de73108a7c1ec99` | 0 | 1 | 0 | FP→TN |
| `0xb10ba7b334d3bd1b2110ba00bca39696b6df406d` | 0 | 1 | 0 | FP→TN |
| `0x369587824c77812c8292029fc2860e56b586ced9` | 0 | 1 | 0 | FP→TN |
| `0xaf7aea249098f2c2f50cc11d4000ccf798194373` | 0 | 1 | 0 | FP→TN |
| `0xa9e2320d9e6c17eb45a921cb2698b42256f5e142` | 0 | 1 | 0 | FP→TN |
| `0xafabe4280633530a015150f6acf2993112db6817` | 0 | 1 | 0 | FP→TN |
| `0x3b6b74df081bc0e2c4776b3ceb3d4bc61c20ad32` | 0 | 1 | 0 | FP→TN |
| `0x8b9c35c79af5319c70dd9a3e3850f368822ed64e` | 0 | 1 | 0 | FP→TN |
| `0x7f37472ee88062acc82f14ccfe6e7bf5f469dd05` | 0 | 0 | 1 | TN→FP |
| `0xcabee6c73250495fc7da131ee93b819be294f6e0` | 0 | 1 | 0 | FP→TN |
| `0xf93843fc86afcaa8479a13ad77fd6e6eec79a903` | 0 | 1 | 0 | FP→TN |
| `0x0f64db5a527850b8fc8025f9c49adb734fdf43ed` | 0 | 1 | 0 | FP→TN |
| `0xa3ce9fa0f6b6649e40bc5146082661d5f0ed5d7a` | 0 | 1 | 0 | FP→TN |
| `0xb95dd00b76c15b11ae82e875e9719029cd4d2110` | 0 | 0 | 1 | TN→FP |
| `0xbbb88154f8fa94c3b5bc65088ac7db80a926e9b4` | 0 | 1 | 0 | FP→TN |
| `0xe34f4bd4b05e0a40295daf48c2562c377338ea05` | 0 | 1 | 0 | FP→TN |
| `0x7b4700f2a2e0765aab00b082613b417cecd0f9f0` | 0 | 1 | 0 | FP→TN |
| `0x18d70bd7bdfa7e424271fe25b527ee0250db5c90` | 0 | 1 | 0 | FP→TN |

---

## 분석 노트

### 정적 분석 (Static)
- `fraud_ontology.js`의 `preventionRules.PonziScheme.checklistItems` 패턴을 소스에 적용.
- `prevention_reasoner.js` 는 `PROJECT_ROOT/contracts/` 경로를 하드코딩하므로
  동일 로직을 직접 재구현. 사용한 패턴 규칙은 온톨로지와 동일함.
- 판정 기준: 사기 유형 중 **PonziScheme** 패턴 점수가 가장 높으면 positive.

### 동적 분석 (Dynamic)
- 블록 집계 CSV(total_in/total_out/cumulative_balance)를
  `dynamic_analyzer.js` 가 요구하는 per-transaction 포맷으로 변환 후 실행.
- 합성 주소 사용, 개별 계정 추적 불가 → 일부 규칙(CONCENTRATION_DRAIN, PROFIT_EXTRACTION) 정확도 제한.
- **Exact match**: `fraud_type_hint ∈ {ponzi_scheme, ponzi_or_laundering}` → positive.
- **Superclass**: `fraud_type_hint ∈ {ponzi_scheme, ponzi_or_laundering, rug_pull, money_laundering, pump_and_dump}` → positive.

### 최종 온톨로지 판정 (Final)
- **Union** 방식: 정적 OR 동적 중 하나라도 사기 판정하면 1.