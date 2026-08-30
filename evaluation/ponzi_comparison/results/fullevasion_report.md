# FullEvasion 실데이터 재검토 (Phase 2)

> 생성: 2026. 8. 9. 오후 9:37:03

## 데이터셋

- 평가 대상: evaluate_comparison.js 와 동일한 공통 주소 **N=272개**
  (labeled_addresses.csv ∩ baseline_predictions.csv 주소)
- 로그 존재: 272개
- withdrawal 이벤트 존재(회피 공리 계산 가능): **228개** (Ponzi=126, Normal=102)

## 표 1. 회피 서브클래스 개별 발동 비율

> 기준: withdrawal 이벤트가 1건 이상 있는 228개 주소

| 조건 | 발동 건수 | 비율 | Ponzi(label=1) | Normal(label=0) |
|------|----------:|-----:|----------------:|-----------------:|
| BalanceDropEvasion (max_ratio < 0.80) | 78 | 34.21% | 45 | 33 |
| MaxTxEvasion (count≥3 AND max_ratio < 0.90) | 71 | 31.14% | 42 | 29 |
| SlowDrain (span_ratio > 0.30) | 132 | 57.89% | 82 | 50 |

## 표 2. FullEvasion (3조건 동시 AND) 발동 카운트

| 구분 | 건수 |
|------|-----:|
| 전체 | 44 |
| Ponzi(label=1) | 26 |
| Normal(label=0) | 18 |

### FullEvasion 발동 주소 상세

| 주소 | label | withdrawal_count | max_single_ratio | span_ratio |
|------|:-----:|------------------:|------------------:|------------:|
| `0xc352add7ad8cac8baa839d8c88e7e9d7df9a219b` | 1 | 133 | 0.089 | 1.000 |
| `0xe8b55deaced913c5c6890331d2926ea0fcbe59ac` | 1 | 24 | 0.320 | 1.000 |
| `0xc27590378690620a44b1382e7cf31db5a1f9b99e` | 1 | 3 | 0.091 | 1.000 |
| `0xed59cf07c469f071fa1eb268f3b62d744ae572c0` | 1 | 15 | 0.743 | 0.998 |
| `0x934e65cead3c1c2824ed75d54768d53fa44e4e17` | 1 | 3 | 0.153 | 1.000 |
| `0xe648ae88a6d9b3373e115e3414be91b7cf12de4c` | 1 | 282 | 0.612 | 1.000 |
| `0x1fe7a92013b295ff98da0954b7a08e603754a1bf` | 1 | 40 | 0.391 | 0.990 |
| `0x9b26ba3a1d66cca67aa413da042a144a39c554b9` | 1 | 17 | 0.765 | 0.474 |
| `0x1ce7986760ade2bf0f322f5ef39ce0de3bd0c82b` | 1 | 27 | 0.535 | 1.000 |
| `0xa9fa83d31ff1cfd14b7f9d17f02e48dcfd9cb0cb` | 1 | 16 | 0.736 | 1.000 |
| `0x75aa81161e07483f6ca199fef46c13eb13d190be` | 1 | 58 | 0.535 | 1.000 |
| `0x723dff0e27cc38b80556f5e05dfdbdcb721654d7` | 1 | 57 | 0.085 | 1.000 |
| `0xcd6608b1291d4307652592c29bff7d51f1ad83d7` | 1 | 22 | 0.296 | 0.776 |
| `0xfeeb8a968f0d7fd58e29fbfc525051f50ee2fedc` | 1 | 3 | 0.250 | 0.893 |
| `0xf767fca8e65d03fe16d4e38810f5e5376c3372a8` | 1 | 16 | 0.255 | 1.000 |
| `0x294308484f47ff5a833a284ac6949eb02728fbe4` | 1 | 69 | 0.755 | 1.000 |
| `0x9758da9b4d001ed2d0df46d25069edf53750767a` | 1 | 104 | 0.333 | 1.000 |
| `0xcac337492149bdb66b088bf5914bedfbf78ccc18` | 1 | 30 | 0.743 | 1.000 |
| `0xba6284ca128d72b25f1353fadd06aa145d9095af` | 1 | 176 | 0.470 | 1.000 |
| `0xcff9cb72d19c10df754ae7be6d280e379cdb2354` | 1 | 23 | 0.697 | 1.000 |
| `0xfd2487cc0e5dce97f08be1bc8ef1dce8d5988b4d` | 1 | 164 | 0.506 | 1.000 |
| `0xbb9854bfd082c48b4d426ac6a2a152b01326f46f` | 1 | 5 | 0.750 | 1.000 |
| `0xa502f8112b2491718855f01a01a60462cc97a0d5` | 1 | 19 | 0.593 | 1.000 |
| `0xe82719202e5965cf5d9b6673b7503a3b92de20be` | 1 | 67 | 0.586 | 1.000 |
| `0xdc84953d7c6448e498eb3c33ab0f815da5d13999` | 1 | 17 | 0.627 | 1.000 |
| `0xdcb13fa157eebf22ddc8c9aa1d6e394810de6fa3` | 1 | 118 | 0.112 | 1.000 |
| `0x1d979bd0b663040f2fe8a9854a8569919ae153ac` | 0 | 992 | 0.209 | 0.993 |
| `0xc0506ceb264b057182a4c3ab8a0b910a545479f0` | 0 | 48 | 0.142 | 1.000 |
| `0x2dbe0f03f1dddbdbc87557e86df3878ae25af855` | 0 | 456 | 0.514 | 1.000 |
| `0xb6346b0cf3925b8758b5d98cd19703d2c5239e99` | 0 | 4 | 0.779 | 0.402 |
| `0x05240da139d30034eaae15737610bfbe68b97910` | 0 | 329 | 0.313 | 1.000 |
| `0x8effd494eb698cc399af6231fccd39e08fd20b15` | 0 | 854 | 0.541 | 1.000 |
| `0x02b97cca6d6a5227e464b2a60ee1a580ea4f7da9` | 0 | 16 | 0.355 | 1.000 |
| `0xcd3e727275bc2f511822dc9a26bd7b0bbf161784` | 0 | 57 | 0.349 | 1.000 |
| `0x2ab9f67a27f606272189b307052694d3a2b158ba` | 0 | 910 | 0.208 | 1.000 |
| `0xa3d4d7df3988d48c48728787cb5910a8a4cc4d26` | 0 | 32 | 0.290 | 1.000 |
| `0x20d42f2e99a421147acf198d775395cac2e8b03d` | 0 | 41 | 0.192 | 0.996 |
| `0xa2d4035389aae620e36bd828144b2015564c2702` | 0 | 21 | 0.301 | 1.000 |
| `0xece701c76bd00d1c3f96410a0c69ea8dfcf5f34e` | 0 | 694 | 0.008 | 0.994 |
| `0xcafe1a77e84698c83ca8931f54a755176ef75f2c` | 0 | 131 | 0.144 | 1.000 |
| `0xa3ce9fa0f6b6649e40bc5146082661d5f0ed5d7a` | 0 | 22 | 0.490 | 1.000 |
| `0xb95dd00b76c15b11ae82e875e9719029cd4d2110` | 0 | 711 | 0.010 | 0.950 |
| `0x7b4700f2a2e0765aab00b082613b417cecd0f9f0` | 0 | 39 | 0.259 | 1.000 |
| `0x76e580f75bf01bffbf4f44167d5822346de4f176` | 0 | 3 | 0.615 | 0.951 |

## 결론

TP > 0 (44건). 설계서 5-3절에서 "시뮬레이션 발생 확률 극히 낮음"으로 제외했던 가정과 달리, 실데이터에서는 FullEvasion 패턴이 관측된다. 다만 이는 block-aggregated 로그를 per-tx로 근사 변환한 데이터 기반이라 개별 트랜잭션 단위 오차가 있을 수 있음에 유의. 아래 "근거 데이터"를 토대로 FullEvasion 공리 신규 추가 여부를 판단할 수 있다 (이번 범위는 데이터 검증까지이며 구현은 하지 않음).

## 기존 N=272 비교실험 영향 확인

- `evaluate_comparison.js` 의 `dynamicPredict()`는 `analyzeDynamic()` 결과에서 `fraud_type_hint`/`verdict` 필드만 사용하며 `evasion_subclass` 필드는 전혀 참조하지 않는다 (코드 확인, evaluate_comparison.js:186-213). 따라서 회피 서브클래스 공리 발동 여부는 Exact/Superclass Precision·Recall·F1에 구조적으로 영향을 줄 수 없다.
- `evaluate_comparison.js`를 재실행해 `results/comparison_report_v2_clean272.md`와 대조한 결과, 생성 시각을 제외한 모든 지표(Precision/Recall/F1/TP/FP/FN/TN, 판정 불일치 목록)가 완전히 동일함을 실측으로 확인했다 (Phase 1의 triggers/implies 변경 포함, 지금까지의 변경이 이 실험에 영향을 준 적 없음).
- 저장소 내 McNemar 검정 구현은 현재 존재하지 않는다(`evaluate_comparison.js`, `baseline_classifier.js`, `pilot_diagnose.js` 검색 결과 매치 없음) — 따라서 "McNemar 수치에 영향 없음"은 해당 사항 없음으로 보고한다.
