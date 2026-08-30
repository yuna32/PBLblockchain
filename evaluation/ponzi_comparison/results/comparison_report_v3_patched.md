# 폰지 탐지 시스템 비교 평가 리포트

> 생성: 2026. 8. 30. PM 2:04:16

## 데이터셋 개요

- 전체 평가 주소: **500개**
- Ponzi (label=1): **200개**
- Normal (label=0): **300개**
- 소스 없음(정적 스킵): 0개
- 로그 없음(동적 스킵): 228개

---

## 표 1-A. Exact Match 평가

> 평가 기준: baseline_predictions.csv 공통 주소 **272개** (Ponzi=136, Normal=136). 소스/로그 없음 → negative(0) 처리.
> **exact_match는 정확한 유형 분류 성능**: dynamic_analyzer가 Ponzi Scheme(`ponzi_scheme` 또는 `ponzi_or_laundering`)으로 정확히 분류한 경우만 positive.

| 시스템                             | Precision | Recall  | F1-Score |   TP |   FP |   FN |   TN |
|------------------------------------|----------:|--------:|---------:|-----:|-----:|-----:|-----:|
| Baseline (Random Forest)           |    67.65% |  67.65% |   67.65% |   92 |   44 |   44 |   92 |
| 정적 분석 (prevention_reasoner 재현)     |    89.66% |  38.24% |   53.61% |   52 |    6 |   84 |  130 |
| 동적 분석 — exact match                |    60.31% |  58.09% |   59.18% |   79 |   52 |   57 |   84 |
| 온톨로지 (exact, Static OR Dynamic)    |    64.52% |  73.53% |   68.73% |  100 |   55 |   36 |   81 |

---

## 표 1-B. Superclass 평가

> 평가 기준: baseline_predictions.csv 공통 주소 **272개** (Ponzi=136, Normal=136). 소스/로그 없음 → negative(0) 처리.
> **superclass는 사기 여부 자체를 걸러내는 성능**: `ponzi_scheme`, `rug_pull`, `money_laundering`, `pump_and_dump` 중 하나라도 탐지되면 positive.

| 시스템                             | Precision | Recall  | F1-Score |   TP |   FP |   FN |   TN |
|------------------------------------|----------:|--------:|---------:|-----:|-----:|-----:|-----:|
| Baseline (Random Forest)           |    67.65% |  67.65% |   67.65% |   92 |   44 |   44 |   92 |
| 정적 분석 (prevention_reasoner 재현)     |    89.66% |  38.24% |   53.61% |   52 |    6 |   84 |  130 |
| 동적 분석 — superclass                 |    53.98% |  69.85% |   60.90% |   95 |   81 |   41 |   55 |
| 온톨로지 (super, Static OR Dynamic)    |    57.65% |  83.09% |   68.07% |  113 |   83 |   23 |   53 |

---

## 표 2. 판정 불일치 주소 (Baseline ≠ Ontology Exact) — 89건

> 상세: `./results/disagreement_cases.csv`

| 주소 | 정답 | Baseline | Ontology(exact) | 변화 |
|------|:----:|:--------:|:---------------:|:----:|
| `0xc352add7ad8cac8baa839d8c88e7e9d7df9a219b` | 1 | 1 | 0 | TP→FN |
| `0xe8b55deaced913c5c6890331d2926ea0fcbe59ac` | 1 | 1 | 0 | TP→FN |
| `0x879716da78a75a44bdfa8f038ce875f99586940a` | 1 | 1 | 0 | TP→FN |
| `0xe86c98c75450075d096580f843fcd67a858ffd5f` | 1 | 0 | 1 | FN→TP |
| `0x582e3d8dcd41f586fbcc6559f16476d20b2a3b95` | 1 | 0 | 1 | FN→TP |
| `0xf062783c821e2f5a1d3768a20d2c281d134e0c92` | 1 | 0 | 1 | FN→TP |
| `0xfc5de599c9fe4e5cf0744aef3139ae53aa30a566` | 1 | 0 | 1 | FN→TP |
| `0x2101ba900918345003585b0a17de91570609d706` | 1 | 0 | 1 | FN→TP |
| `0xc58492b3b14f658adff566c988029308505f81b5` | 1 | 1 | 0 | TP→FN |
| `0x5fb3d432bae33fcd418ede263d98d7440e7fa3ea` | 1 | 0 | 1 | FN→TP |
| `0x9a2e9235f7a7ac7b899e5f3208fbb13c6985171a` | 1 | 0 | 1 | FN→TP |
| `0x109c4f2ccc82c4d77bde15f306707320294aea3f` | 1 | 1 | 0 | TP→FN |
| `0x6adf9e666e3e85876b1ba25edb31799faad8417b` | 1 | 1 | 0 | TP→FN |
| `0xc99b3615724b7c4d3e4b348cfc8a25b9e2133828` | 1 | 1 | 0 | TP→FN |
| `0x245233bc8604d2097bfcbf3338959c46da04d9e0` | 1 | 1 | 0 | TP→FN |
| `0x99925cc9a57f5e473ff22314cfe0627a0bfcceb4` | 1 | 1 | 0 | TP→FN |
| `0xcd6608b1291d4307652592c29bff7d51f1ad83d7` | 1 | 0 | 1 | FN→TP |
| `0x7d3ae940eb73dc9131758ad2e326c7d863b0916a` | 1 | 0 | 1 | FN→TP |
| `0xfeeb8a968f0d7fd58e29fbfc525051f50ee2fedc` | 1 | 1 | 0 | TP→FN |
| `0x9758da9b4d001ed2d0df46d25069edf53750767a` | 1 | 1 | 0 | TP→FN |
| `0xa0f9fb2170dc2d181ef8aaf3571dc441813e0154` | 1 | 0 | 1 | FN→TP |
| `0x4398a4a10347d8f18029c07853a7a689eebbb925` | 1 | 0 | 1 | FN→TP |
| `0x7fcc7ed28c99f64f721be410ad816247925aade8` | 1 | 0 | 1 | FN→TP |
| `0xcaaca224e35d0a1fa3304a3c4ec8beb5f28a99aa` | 1 | 0 | 1 | FN→TP |
| `0xf70ce1be9685b0cfb531bc712d3faace858b5bfb` | 1 | 0 | 1 | FN→TP |
| `0xb5aff01f3e820735fac9abb594dc9993cb9e5bd2` | 1 | 1 | 0 | TP→FN |
| `0x43e49c79172a1be3ebb4240da727c0da0fa5d233` | 1 | 0 | 1 | FN→TP |
| `0x99d982e49bcb5465a6b4c1e0ec4341c912d9ba42` | 1 | 1 | 0 | TP→FN |
| `0xe861ad00aed0f04b41c675ec1c1493d2ebcbe776` | 1 | 1 | 0 | TP→FN |
| `0x55d035ba1f4ae932cf98125b93d830d9858cd39f` | 1 | 0 | 1 | FN→TP |
| `0x89c2352cb600df56fe4bfb5882caadef3e96213f` | 1 | 1 | 0 | TP→FN |
| `0xa259e6bcade86c770cb5214c789ee107662831a6` | 1 | 0 | 1 | FN→TP |
| `0x5a437d94843541d5cb83221a4a4b253de30b97b7` | 1 | 0 | 1 | FN→TP |
| `0x43bbc7fafb860d974037b8f7dd06b6f6fe799b3e` | 1 | 0 | 1 | FN→TP |
| `0xfd2487cc0e5dce97f08be1bc8ef1dce8d5988b4d` | 1 | 0 | 1 | FN→TP |
| `0xfe3672eff595cfd36ed05aaf4622d1aec3b5e852` | 1 | 0 | 1 | FN→TP |
| `0x19a6067538c90973ef5dc31ded5fa567f3d09059` | 1 | 0 | 1 | FN→TP |
| `0x24ec083b6a022099003e3d035fed48b9a58296e5` | 1 | 0 | 1 | FN→TP |
| `0x4865e85c72a27ca6c362da75ba6707c07464b953` | 1 | 1 | 0 | TP→FN |
| `0xf45717552f12ef7cb65e95476f217ea008167ae3` | 1 | 0 | 1 | FN→TP |
| `0x7d56485e026d5d3881f778e99969d2b1f90c50af` | 1 | 0 | 1 | FN→TP |
| `0xdcb13fa157eebf22ddc8c9aa1d6e394810de6fa3` | 1 | 1 | 0 | TP→FN |
| `0xbc9ccc8a46d424de38b2e4df5f4a5001321c5d4c` | 0 | 0 | 1 | TN→FP |
| `0x032747313c4e914b5fce356ab8dc4df551972dcd` | 0 | 1 | 0 | FP→TN |
| `0xc2d4290aa2dee92c6ad85ecd580d1216010e92d0` | 0 | 1 | 0 | FP→TN |
| `0x163733bcc28dbf26b41a8cfa83e369b5b3af741b` | 0 | 0 | 1 | TN→FP |
| `0xf0cfb6e33af9a0bbf70b37662c0f5b3c7483b16d` | 0 | 0 | 1 | TN→FP |
| `0x1d979bd0b663040f2fe8a9854a8569919ae153ac` | 0 | 0 | 1 | TN→FP |
| `0xf93599ba824af259d66742e563cb56310923fadd` | 0 | 1 | 0 | FP→TN |
| `0x59a048d31d72b98dfb10f91a8905aecda7639f13` | 0 | 0 | 1 | TN→FP |
| `0xd2c5c0d51c8d97d0deb0a5efa416de90600db62d` | 0 | 1 | 0 | FP→TN |
| `0xd70994d7020df8052a1124561ff548f3b88744d8` | 0 | 1 | 0 | FP→TN |
| `0x9ffe3a0864cce4995a6b385b99de3644cc8d2483` | 0 | 0 | 1 | TN→FP |
| `0xb6346b0cf3925b8758b5d98cd19703d2c5239e99` | 0 | 1 | 0 | FP→TN |
| `0x05240da139d30034eaae15737610bfbe68b97910` | 0 | 0 | 1 | TN→FP |
| `0x78c6b7f1f5259406be3bc73eca1eaa859471b9f3` | 0 | 0 | 1 | TN→FP |
| `0x3d3ed0a4f0af930955806b34367e7c64a0e1c84a` | 0 | 1 | 0 | FP→TN |
| `0x33a8ea1c8c6294c9f65f3dad7ca7f037bd09f951` | 0 | 1 | 0 | FP→TN |
| `0x8effd494eb698cc399af6231fccd39e08fd20b15` | 0 | 0 | 1 | TN→FP |
| `0xd87c91884f5796e7b0a7ee8cc5d40ad6c63f289d` | 0 | 0 | 1 | TN→FP |
| `0xd566fa4a696eac66f749f7fe999d6673fee2026c` | 0 | 0 | 1 | TN→FP |
| `0x02b97cca6d6a5227e464b2a60ee1a580ea4f7da9` | 0 | 1 | 0 | FP→TN |
| `0xc47f25a40e12f7f07fabcc996148d1e1326903d2` | 0 | 1 | 0 | FP→TN |
| `0xaf2b8e6114da000176c506f77b173251c16b511d` | 0 | 0 | 1 | TN→FP |
| `0x362bb67f7fdbdd0dbba4bce16da6a284cf484ed6` | 0 | 0 | 1 | TN→FP |
| `0x2ab9f67a27f606272189b307052694d3a2b158ba` | 0 | 0 | 1 | TN→FP |
| `0xd0a6e6c54dbc68db5db3a091b171a77407ff7ccf` | 0 | 0 | 1 | TN→FP |
| `0x91c94bee75786fbbfdcfefba1102b68f48a002f4` | 0 | 0 | 1 | TN→FP |
| `0x65391a542942510b10c1689d874b62620de28d3e` | 0 | 0 | 1 | TN→FP |
| `0xa2d4035389aae620e36bd828144b2015564c2702` | 0 | 0 | 1 | TN→FP |
| `0xb671c3883307cf05bb3dff77a9754e87b4347195` | 0 | 0 | 1 | TN→FP |
| `0x4e260e3ca268e40133c84b142de73108a7c1ec99` | 0 | 1 | 0 | FP→TN |
| `0xb10ba7b334d3bd1b2110ba00bca39696b6df406d` | 0 | 1 | 0 | FP→TN |
| `0xaf7aea249098f2c2f50cc11d4000ccf798194373` | 0 | 1 | 0 | FP→TN |
| `0xec94d178d97bac527fdcd4b3d4bf41b57d640c5b` | 0 | 0 | 1 | TN→FP |
| `0x7f37472ee88062acc82f14ccfe6e7bf5f469dd05` | 0 | 0 | 1 | TN→FP |
| `0x00a9f7d093c46d95f0318e4a6ffc6ed68f73044c` | 0 | 0 | 1 | TN→FP |
| `0xd3fa03c67cfba062325cb6f4f4b5c1e642f1cffe` | 0 | 0 | 1 | TN→FP |
| `0xcafe1a77e84698c83ca8931f54a755176ef75f2c` | 0 | 0 | 1 | TN→FP |
| `0xf93843fc86afcaa8479a13ad77fd6e6eec79a903` | 0 | 0 | 1 | TN→FP |
| `0x40f4991411ac5377675c421e87378e10470134a3` | 0 | 1 | 0 | FP→TN |
| `0x0f64db5a527850b8fc8025f9c49adb734fdf43ed` | 0 | 1 | 0 | FP→TN |
| `0xc9c7db3c7a2e3b8aca6e6f78180f7013575392a3` | 0 | 0 | 1 | TN→FP |
| `0xb95dd00b76c15b11ae82e875e9719029cd4d2110` | 0 | 0 | 1 | TN→FP |
| `0xe34f4bd4b05e0a40295daf48c2562c377338ea05` | 0 | 1 | 0 | FP→TN |
| `0x7b4700f2a2e0765aab00b082613b417cecd0f9f0` | 0 | 1 | 0 | FP→TN |
| `0xc1e4888069452687eaf2acc36f58b2a869412030` | 0 | 0 | 1 | TN→FP |
| `0xf2fd0c1eb5a2989e32ce929276463164410796b4` | 0 | 0 | 1 | TN→FP |
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