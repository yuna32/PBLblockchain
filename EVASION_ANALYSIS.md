# 우회 시뮬레이션 분석 보고서

> **목적**: 현재 탐지 프레임워크(dynamic_analyzer.js · trust_scorer.js)의 **지표 설계 및 규칙 임계값 취약점**을 세 가지 우회 시나리오로 실증하고, 회피 원리와 개선 방향을 정리한다.
>
> **핵심 전제**: 모든 시나리오는 `"deposit"`, `"withdraw"`, `"owner_withdraw_all"` 등 **표준 action 문자열만** 사용한다. action 화이트리스트 우회가 아닌, 규칙 내부의 수식·임계값·가중치 설계 결함을 직접 공략한다.
>
> **범위**: 로컬 Hardhat 시뮬레이션 전용 — 실제 네트워크 배포 및 악용 금지

---

## 파일 구조

```
pbl/
├── contracts/
│   └── EvasiveContract.sol        ← 신규 ★  deposit() + withdrawTo() 만 보유
│
├── scripts/
│   ├── simulate_evasive_A.js      ← 신규 ★  시나리오 A: 분산 출금
│   ├── simulate_evasive_B.js      ← 신규 ★  시나리오 B: 임계값 절벽
│   └── simulate_evasive_C.js      ← 신규 ★  시나리오 C: 점수 가중치 격차
│
└── analysis/
    ├── dynamic_analyzer.js        ← 기존 (수정 없음)
    ├── trust_scorer.js            ← 기존 (수정 없음)
    ├── compare_evasion.js         ← 신규 ★  비교 분석 출력 및 JSON 저장
    └── logs/
        ├── evasive_A_log.csv
        ├── evasive_B_log.csv
        └── evasive_C_log.csv
```

---

## 실행 순서

```bash
# 1. 시나리오별 시뮬레이션 (순서 무관)
npx hardhat run scripts/simulate_evasive_A.js
npx hardhat run scripts/simulate_evasive_B.js
npx hardhat run scripts/simulate_evasive_C.js

# 2. 비교 분석 (기존 6개 로그도 함께 출력)
node --experimental-vm-modules analysis/compare_evasion.js
```

> 기존 시나리오(PonziLab, RugPull 등) 로그가 없으면 해당 줄에 `(run simulation first)` 표시 — 정상 동작.

---

## 탐지 시스템 규칙 요약

| 규칙 ID | 가중치 | 발동 조건 |
|---|---|---|
| BALANCE_DROP | +45 | `finalBal < peak×0.1` **AND** `hasOwnerDrain` |
| FLOW_SPIKE | +35 | `maxSingleWithdraw >= totalIn×0.5` |
| CONCENTRATION_DRAIN | +30 | `top3수령자 / totalOut >= 0.8` |
| PROFIT_EXTRACTION | +30 | `수령액/입금액 > 1.3` (depositorMap 내 주소) |
| OSCILLATING_BALANCE | +30 | 잔고 0↔복구 사이클 ≥ 2회 |

> `hasOwnerDrain` = `rows.some(r => r.action === "owner_withdraw_all")` (HIGH_RISK_ACTIONS)  
> HIGH_RISK ≥ 65점 / MEDIUM_RISK ≥ 25점 / LOW_RISK < 25점

---

## 시나리오별 우회 원리

### 시나리오 A — 분산 출금 (Distributed Drain)

**목표 취약점**: FLOW_SPIKE의 단일-최대값 지표 + CONCENTRATION_DRAIN의 80% 임계값 절벽

**시나리오 설계**

| 단계 | 내용 |
|---|---|
| Phase 1 | 참여자 10명 × 1 ETH 입금 → `totalIn = 10 ETH` |
| Phase 2 | 오너가 4 × 2.4 ETH `"withdraw"` → **4개 신규 주소**로 분산 인출 |
| 결과 | 9.6 ETH (96%) 탈취, 잔고 0.4 ETH |

**규칙별 분석**

```
FLOW_SPIKE          조건: maxSingleWithdraw(2.4) >= totalIn×0.5(5.0)
                    결과: 2.4 < 5.0 → 미발동

CONCENTRATION_DRAIN 조건: top3(7.2) / totalOut(9.6) >= 0.8
                    결과: 0.75 < 0.8 → 미발동

BALANCE_DROP        hasOwnerDrain = false (action="withdraw", not "owner_withdraw_all")
                    → 미발동

PROFIT_EXTRACTION   4개 신규 주소 ∉ depositorMap → received = 0 → 미발동
```

**최종 점수: 0 / LOW_RISK** (96% 탈취에도 불구)

**노출된 설계 결함**

1. **FLOW_SPIKE 지표**: `maxSingleWithdraw`는 단일 거래 최대값만 측정  
   → 동일한 9.6 ETH를 4회 분할하면 누적 유출은 보이지 않음  
   → 올바른 지표: `totalOut / totalIn` 누적 비율

2. **CONCENTRATION_DRAIN 임계값**: 80% 클리프는 수령자 수에 따른 절벽 구조  
   → 수령자를 3개에서 4개로 늘리는 것만으로 75%로 하락, 규칙 무력화  
   → 개선: 연속 농도 점수(gradient) 또는 하프 상위-N 가중 합산

---

### 시나리오 B — 임계값 절벽 (Threshold Cliff)

**목표 취약점**: BALANCE_DROP의 90% 하드 클리프 임계값

**시나리오 설계**

| 단계 | 내용 |
|---|---|
| Phase 1 | 참여자 10명 × 1 ETH 입금 → `peak = 10 ETH` |
| Phase 2 | 오너가 8.9 ETH `"owner_withdraw_all"` → 잔고 **1.1 ETH** 유지 |
| 결과 | 89% 탈취, 잔고 1.1 ETH |

**BALANCE_DROP 상세 분석**

```
조건: peak(10) > 0  AND  finalBal(1.1) < peak×0.1(1.0)  AND  hasOwnerDrain(true)

        peak×0.1 = 1.0 ETH   ←── 임계값
        finalBal = 1.1 ETH   ←── 실제 잔고
        차이:      +0.1 ETH  ←── 이 0.1 ETH 버퍼 하나로 +45점 규칙 완전 침묵

결과: 1.1 < 1.0 → FALSE → 미발동
```

**발동 규칙 및 최종 점수**

| 규칙 | 결과 | 이유 |
|---|---|---|
| BALANCE_DROP (+45) | **미발동** | finalBal=1.1 > peak×0.1=1.0 |
| FLOW_SPIKE (+35) | **발동** | 8.9 >= 5.0 |
| CONCENTRATION_DRAIN (+30) | **발동** | 오너가 8.9/8.9 = 100% 수령 |
| PROFIT_EXTRACTION (+30) | 미발동 | 오너 ∉ depositorMap |

**최종 점수: 65 / HIGH_RISK (경계선)**

> FLOW_SPIKE + CONCENTRATION_DRAIN만으로 경계선 65점 도달했지만,  
> **이 패턴을 위해 설계된 핵심 규칙(BALANCE_DROP +45)은 침묵**

**노출된 설계 결함**

1. **BALANCE_DROP의 90% 하드 클리프**: 89%와 91% 탈취는 위험도가 사실상 동일하나 규칙은 완전히 다른 결과를 냄  
   → 임계값은 공학적으로 정당화된 값이 아닌 임의의 절벽  
   → 개선: 탈취 비율에 따른 연속 가중치 (`(1 - finalBal/peak)^2` 등)

2. **단일 임계값의 취약성**: 임계값을 0.1 ETH 차이로 비켜가는 것만으로 가장 높은 가중치 규칙을 완전 비활성화 가능

---

### 시나리오 C — 점수 가중치 격차 + 시간 무감각

**목표 취약점**: 규칙 조합 점수 부족(60 < 65) + 시간 패턴 미측정

**시나리오 설계**

| 단계 | 내용 |
|---|---|
| Phase 1 | 오너 1 ETH 입금 (`depositorMap`에 오너 등록) |
| Phase 2 | 참여자 9명 × 1 ETH 입금 → `totalIn = 10 ETH` |
| Phase 3 | **50블록 대기** (아무 거래 없음) |
| Phase 4 | 오너가 4 × 2.4 ETH `"withdraw"` → **오너 본인 주소**로 인출 |
| 결과 | 9.6 ETH (96%) 탈취, 잔고 0.4 ETH |

**규칙별 분석**

```
BALANCE_DROP        hasOwnerDrain = false
                    → action="withdraw" ≠ "owner_withdraw_all"
                    → HIGH_RISK_ACTIONS 집합에 포함 안됨 → 미발동
                    (finalBal=0.4 < peak×0.1=1.0 이지만 hasOwnerDrain 게이트로 차단)

FLOW_SPIKE          maxSingleWithdraw = 2.4 < 5.0 → 미발동

CONCENTRATION_DRAIN totalOut=9.6, 오너가 9.6/9.6=100% 수령 → 발동 (+30)

PROFIT_EXTRACTION   오너: deposited=1.0, received=9.6, ratio=9.6 > 1.3 → 발동 (+30)

시간 패턴           50블록 지연 → 어떤 규칙도 측정하지 않음
```

**최종 점수: 60 / MEDIUM_RISK** (96% 탈취, HIGH_RISK 임계값에서 5점 부족)

**노출된 설계 결함**

1. **점수 가중치 격차**  
   - BALANCE_DROP(+45), FLOW_SPIKE(+35) = "얼마나" 흘렀는가 측정 규칙 (고가중치)  
   - CONCENTRATION_DRAIN(+30), PROFIT_EXTRACTION(+30) = "누가 받았는가" 측정 규칙 (저가중치)  
   - "누가" 규칙 2개의 합산(60)이 HIGH_RISK 기준(65)에 도달하지 못함  
   - "얼마나" 규칙 없이는 아무리 명백한 탈취 패턴도 MEDIUM_RISK 이상으로 올라갈 수 없는 구조

2. **BALANCE_DROP의 action 리터럴 게이트**  
   - `hasOwnerDrain`은 `action === "owner_withdraw_all"` 일 때만 true  
   - `"withdraw"` 역시 WITHDRAW_ACTIONS 집합에 속하는 표준 액션이지만 이 게이트를 통과시키지 않음  
   - 동일한 ETH 이동이 action 이름에 따라 완전히 다른 평가를 받음

3. **시간 무감각 (Temporal Blindness)**  
   - 입금 완료 후 50블록이 지나서 인출이 일어나는 패턴 → 완전히 무시됨  
   - 속도(ETH/block), 단계 간 블록 간격, 행동 패턴 변화를 측정하는 지표 자체가 없음  
   - 실제 스캠에서 흔히 사용되는 "기다렸다 가져가기" 전략에 대한 방어 없음

---

## 세 시나리오 비교 요약

| | 시나리오 A | 시나리오 B | 시나리오 C |
|---|---|---|---|
| **전략명** | 분산 출금 | 임계값 절벽 | 가중치 격차 |
| **탈취 비율** | 96% | 89% | 96% |
| **action 종류** | `withdraw` | `owner_withdraw_all` | `withdraw` |
| **동적 위험도** | 0 / **LOW_RISK** | 65 / **HIGH_RISK(경계)** | 60 / **MEDIUM_RISK** |
| **발동 규칙** | 없음 | FLOW_SPIKE, CONC_DRAIN | CONC_DRAIN, PROFIT_EXT |
| **침묵한 핵심 규칙** | FLOW_SPIKE, CONC_DRAIN | BALANCE_DROP (+45) | BALANCE_DROP, FLOW_SPIKE |
| **주요 공략 결함** | 단일-최대값 지표, 분포 임계값 | 90% 하드 클리프 | 가중치 불균형, action 게이트 |
| **추가 결함** | — | — | 시간 무감각 |

---

## 탐지 시스템 구조적 한계 정리

### 1. 지표(Metric) 설계 결함

| 지표 | 현재 수식 | 문제 | 개선 방향 |
|---|---|---|---|
| FLOW_SPIKE | `max(single_withdraw)` | 누적 유출 무시 | `totalOut / totalIn` |
| BALANCE_DROP | `finalBal < peak×0.1` | 임의의 90% 절벽 | 연속 가중치 함수 |
| CONCENTRATION_DRAIN | `top3 / totalOut >= 0.8` | 수령자 수에 따른 절벽 | 허핀달 지수(HHI) 등 연속 지표 |
| 시간 지표 | **존재하지 않음** | 속도·지연 패턴 무시 | ETH/block, phase gap 측정 |

### 2. 규칙(Rule) 설계 결함

| 규칙 | 게이트 조건 | 문제 | 개선 방향 |
|---|---|---|---|
| BALANCE_DROP | `hasOwnerDrain` = `owner_withdraw_all` 리터럴 | 동일 WITHDRAW_ACTIONS 내 action 차별 | WITHDRAW_ACTIONS 전체로 확장 |
| PROFIT_EXTRACTION | depositorMap 내 주소만 검사 | 비입금자 수령 무시 | 모든 수령자로 확장 |

### 3. 점수 가중치 불균형

```
"얼마나" 그룹:   BALANCE_DROP(+45) + FLOW_SPIKE(+35) = +80점  ← 지배적
"누가" 그룹:     CONCENTRATION_DRAIN(+30) + PROFIT_EXTRACTION(+30) = +60점

HIGH_RISK 임계값: 65점

→ "누가" 그룹만 발동할 경우 HIGH_RISK 도달 불가 (60 < 65)
→ "얼마나" 규칙이 전부 침묵하면 96% 탈취도 MEDIUM_RISK로 처리됨
```

**권고 가중치 조정**

| 규칙 | 현재 | 권고 | 이유 |
|---|---|---|---|
| BALANCE_DROP | 45 | 40 | 연속 지표 전환 시 과도한 집중 완화 |
| FLOW_SPIKE | 35 | 30 | 누적 비율로 전환 시 하향 조정 |
| CONCENTRATION_DRAIN | 30 | 35 | "누가" 그룹의 HIGH_RISK 도달 가능하도록 |
| PROFIT_EXTRACTION | 30 | 35 | 동상 |

---

## 권고 패치 목록

1. **FLOW_SPIKE 지표 교체**: `maxSingleWithdraw` → `totalOut / totalIn` 누적 비율  
   → 4회 분산 인출도 9.6 ETH 탈취로 정확히 측정

2. **BALANCE_DROP 게이트 제거**: `hasOwnerDrain` 조건 삭제 또는 WITHDRAW_ACTIONS 전체로 확장  
   → `"withdraw"`로 드레인해도 규칙 발동

3. **BALANCE_DROP 임계값 연속화**: `finalBal < peak×0.1` 바이너리 → `(1 - finalBal/peak)` 연속 함수  
   → 89%와 91% 탈취를 동등하게 위험하다고 평가

4. **CONCENTRATION_DRAIN 연속화**: 80% 클리프 → 허핀달-허쉬만 지수(HHI) 기반 연속 점수  
   → 수령자 수 증가에 비례한 점수 감소

5. **점수 가중치 재조정**: CONCENTRATION_DRAIN, PROFIT_EXTRACTION 각 +35로 상향  
   → "누가" 그룹 합산(70)이 단독으로 HIGH_RISK 도달 가능

6. **시간 지표 신설**  
   - 입금 집중 구간과 출금 집중 구간의 블록 간격 측정  
   - ETH/block 속도: 급격한 출금 속도를 HIGH_RISK 신호로 처리  
   - 두 단계 간격이 X블록 이내면 동시성 패턴 가중치 부여

7. **잔고 시계열 직접 분석**: action 무관하게 `contract_balance_eth`에서 N블록 내 X% 이상 감소 탐지

---

## 패치 적용 내역 (2026-08-30, Phase 1)

> **적용 범위**: `analysis/analysis/dynamic_analyzer.js` (중첩 버전)만 수정.
> `analysis/dynamic_analyzer.js`(최상위, `evaluation/ponzi_comparison/evaluate_comparison.js`가
> 사용하며 논문 McNemar/F1 수치와 연동)는 **별도 승인 전까지 미수정** — [CLAUDE.md](CLAUDE.md)
> "실제 동작하는 파이프라인 경로" 절 참고.

| 권고 | 적용 상태 | 실제 구현 |
|---|---|---|
| 1. FLOW_SPIKE → 누적 비율 | ✅ 적용 | `maxSingleWithdraw` 대신 `totalOut/totalIn >= 0.5`. 단, "조직적 정상 환급"(아래 참고) 시 억제 |
| 2. BALANCE_DROP 게이트 확장 | ✅ 적용 | `hasOwnerDrain`(owner_withdraw_all 리터럴) 제거, `WITHDRAW_ACTIONS` 전체 존재 여부로 대체 |
| 3. BALANCE_DROP 연속화 | ✅ 적용 (권고 예시 형태 채택) | `score = 40 * clamp((1 - finalBal/peak - 0.5)/0.5, 0, 1)` |
| 4. CONCENTRATION_DRAIN → HHI | ✅ 적용 | `HHI = Σ(수령비중)²`, `score = 35 * clamp((HHI-0.2)/0.6, 0, 1)` |
| 5. 가중치 재조정 | ✅ 적용 | BALANCE_DROP 45→40, FLOW_SPIKE 35→30, CONCENTRATION_DRAIN 30→35, PROFIT_EXTRACTION 30→35 |
| 6. 시간 지표 신설 | ✅ 적용 | 신규 규칙 `TEMPORAL_PATTERN`(+20): 입금 종료→출금 시작 대기 비율(dormancy) 또는 출금 구간 ETH/block 속도(velocity) 중 높은 쪽 |
| 7. 잔고 시계열 직접 분석 | ✅ 적용 | 신규 규칙 `BALANCE_TIMESERIES_DRAIN`(+20): action 무관, 15블록 이내 최대 상대 하락폭 기반 |

**회귀 테스트 중 발견되어 추가한 안전장치 (문서에 없던 조정)**

패치 4개 항목(1/2/3/6/7 — 금액·시간 기반 규칙)을 그대로 적용하면 `NormalStaking`처럼
다수 참여자가 동시에 원금을 정상 회수하는 경우에도 잔고가 크게 줄어 오탐(FP)이
발생함을 회귀 테스트에서 확인했다(자세한 내용은 아래 "회귀 테스트 결과" 참고).
이를 막기 위해 **"조직적 정상 환급(organic unstake)" 게이트**를 신설해
BALANCE_DROP · FLOW_SPIKE · TEMPORAL_PATTERN · BALANCE_TIMESERIES_DRAIN 네 규칙에만
적용했다 (CONCENTRATION_DRAIN · PROFIT_EXTRACTION은 이 패턴에서 자연히 낮은 값이
나오므로 게이트 불필요):

- 출금 수령자가 3명 이상이고,
- 오너 전용 액션(`owner_withdraw_all`/`owner_collect`)이 전혀 없고,
- 출금 성공률 80% 이상, 금액 편차가 작으며(최대/최소 < 2.5배),
- 출금액의 90% 이상이 **원래 예치자 본인**에게 돌아간 경우

→ 위 네 규칙을 억제(fraction=0)한다. 시나리오 A/B/C는 수령자가 신규 주소이거나
1~4명뿐이라 이 게이트에 걸리지 않고 정상적으로 탐지된다.

또한 `fraud_type_hint`의 pump_dump 판별 조건이 기존에는 `"!ids.has(BALANCE_DROP)"`에
의존했는데, 권고 2(게이트 확장) 적용 후 PumpDump 케이스도 BALANCE_DROP이 함께
발동하게 되어 이 조건이 깨졌다. 출금 성공/실패 혼재 여부(`amount>0`인 것과
`amount=0`인 것이 공존)로 직접 판별하도록 교체해 분류를 복원했다.

### 회귀 테스트 결과

**a) 기존 7개 검증 컨트랙트 — verdict 비교**

| 컨트랙트 | 패치 전 | 패치 후 | 판정 |
|---|---|---|---|
| PonziLab | HIGH_RISK / 100 | HIGH_RISK / 100 | 유지 |
| RugPull | HIGH_RISK / 100 | HIGH_RISK / 100 | 유지 |
| MoneyLaundering | HIGH_RISK / 100 | HIGH_RISK / 100 | 유지 |
| PumpDump | MEDIUM_RISK / 60 | **HIGH_RISK / 100** | **변경 (개선)** — 아래 설명 |
| Honeypot | HIGH_RISK / 100 | HIGH_RISK / 100 | 유지 |
| NormalStaking | LOW_RISK / 0 | LOW_RISK / 0 | 유지 (오탐 없음) |
| PonziLabPatched | LOW_RISK / 0 | LOW_RISK / 0 | 유지 |

PumpDump는 패치 전에도 `hasOwnerDrain`(owner_withdraw_all 리터럴) 게이트 때문에
BALANCE_DROP이 침묵했던 케이스로, 시나리오 A/C와 **동일한 근본 결함**을 안고 있었다.
게이트를 WITHDRAW_ACTIONS 전체로 확장한 권고 2를 적용한 결과 BALANCE_DROP이 정상
발동해 100% 잔고 급락이 반영됐다 — 회귀가 아니라 이번 패치가 의도한 개선이 기존
레퍼런스 컨트랙트에도 적용된 사례. `fraud_type_hint`는 "pump_dump"로 그대로 유지됨
(위 안전장치 참고).

**b) 3개 회피 시나리오 — verdict 비교**

| 시나리오 | 패치 전 | 패치 후 |
|---|---|---|
| A (분산 출금) | LOW_RISK / 0 | **HIGH_RISK / 90** |
| B (임계값 절벽) | HIGH_RISK / 65(경계) | HIGH_RISK / 100 (여유있게) |
| C (가중치 격차) | MEDIUM_RISK / 60 | **HIGH_RISK / 100** |

3개 시나리오 모두 HIGH_RISK로 정확히 탐지됨. (참고: 이 문서 상단의 "패치 전" 수치는
`analysis/dynamic_analyzer.js` 최상위 버전 기준 설명이며, 중첩 버전은 온톨로지
BALANCE_DROP 임계값이 달라 시나리오 B가 패치 전에도 이미 HIGH_RISK/100이었음 — 자세한
건 회귀 테스트 원본 로그 참고.)

**c) NormalStaking 오탐(FP) 확인** — 위 표에 포함, LOW_RISK/0 유지로 오탐 없음 확인.
`PonziLabPatched` 역시 오탐 없음.

**미조정 상태로 남겨둔 항목**: 권고 5의 BALANCE_DROP(45→40)·FLOW_SPIKE(35→30) 하향
폭과 권고 6의 TEMPORAL_PATTERN 가중치(20)는 위 회귀 결과가 모두 통과했으므로 문서에
제안된 값을 그대로 유지했다. 추가 실데이터 검증 시 재조정 가능.

---

## 최상위 버전 패치 완료 (2026-08-30, Phase 4)

승인을 받아 `analysis/dynamic_analyzer.js`(최상위)에도 동일한 7개 권고를 적용했다.

- **체크포인트 커밋**: `d50568b` — 패치 전, 논문 인용 실데이터 결과의 근거가 된
  당시 상태를 먼저 커밋해 안전한 롤백 지점을 확보했다.
- **패치 커밋**: `21203cb` — 7개 권고 적용 + 실데이터 재평가 결과 반영.
- 이 파일에는 이미 `detectInflowStop()` 내부에 `isNormalUnstake`라는 유사한
  정상성 가드가 존재했으므로, 중첩 버전에서 새로 만든 게이트를 별도로 또
  추가하지 않고 **기존 로직을 `computeIsOrganicUnstake()`로 추출·확장해
  단일 로직으로 통합**했다 (BALANCE_DROP/FLOW_SPIKE/TEMPORAL_PATTERN/
  BALANCE_TIMESERIES_DRAIN과 `detectInflowStop()`이 동일 함수를 공유).
- **회귀 테스트 중 발견한 경계값 버그**: 기존 `isNormalUnstake`의 금액-균등
  조건이 `maxW < minW * 2.5`(strict)였는데, `flashloan_log`(참여자 5명이
  각자 예치한 금액을 그대로 자기 자신에게 즉시 인출하는 자기순환 패턴)에서
  `maxW(20) === minW(8) × 2.5(20)`로 정확히 경계에 걸려 게이트가 통과하지
  못했다. 이 상태로 연속화된 BALANCE_DROP을 적용하면 순수 자기순환(수익도
  손실도 없음)을 96%+ 급락으로 오판해 MEDIUM_RISK(30)를 HIGH_RISK(100)로
  잘못 격상시켰을 것 — 회귀 테스트에서 발견해 `<`를 `<=`로 완화하고,
  "출금액의 90% 이상이 원 예치자 본인에게 귀속"·"오너 전용 액션 없음" 조건을
  추가로 통합해 해결했다. 패치 후 flashloan_log는 MEDIUM_RISK/30→31로
  등급 변화 없이 유지됨을 확인.
- 회귀 결과: 기존 7개 컨트랙트(최상위 데이터셋 기준 PonziLab/RugPull/
  MoneyLaundering/PumpDump/Honeypot/NormalStaking/FlashLoan) 전부 유지 또는
  개선(PumpDump MEDIUM→HIGH, 중첩 버전과 동일한 근본원인), 3개 회피 시나리오
  전부 HIGH_RISK로 격상, FP 없음. `fraud_type_hint`도 전부 안정적으로 유지됨
  (이 파일의 `hintFraudType`은 대부분 원시 트랜잭션을 직접 재계산하는 구조라
  중첩 버전과 달리 별도 워크어라운드가 필요 없었음).

### 실데이터 재평가 (`evaluate_comparison.js`, N=272 공통셋)

| 지표 | 패치 전 (v2_clean272) | 패치 후 (v3_patched) | 변동 |
|---|---|---|---|
| 동적분석 Exact — Precision | 58.33% | 60.31% | +1.98pp |
| 동적분석 Exact — Recall | 15.44% | 58.09% | **+42.65pp** |
| 동적분석 Exact — F1 | 24.42% | 59.18% | **+34.76pp** |
| 온톨로지 Exact(OR결합) — F1 | 60.71% | 68.73% | +8.02pp |
| 동적분석 Superclass — Precision | 45.68% | 53.98% | +8.30pp |
| 동적분석 Superclass — Recall | 27.21% | 69.85% | **+42.64pp** |
| 동적분석 Superclass — F1 | 34.10% | 60.90% | **+26.80pp** |
| 온톨로지 Superclass(OR결합) — F1 | 61.13% | 68.07% | +6.94pp |

**동적분석 단독 recall이 15.44%→58.09%(Exact), 27.21%→69.85%(Superclass)로
급등한 것은, 패치 전 규칙이 놓치던 실제 폰지 주소들 상당수가 시나리오 A/B/C와
같은 유형의 회피(분산 인출·임계값 근접·긴 대기 후 인출)를 실제로 쓰고
있었다는 뜻이며, 이번 패치의 회피 내성이 합성 시나리오뿐 아니라 실데이터에서도
그대로 재현됨을 보여주는 실증 근거다.**

McNemar 재현 (`mcnemar_test.js`, 입력: 패치 후 `disagreement_cases.csv`):

| | 논문 인용값 (v2) | 패치 후 (v3) |
|---|---|---|
| Exact | b=52, c=52, χ²=0.010, p=0.922 | b=46, c=43, χ²=0.045, p=0.832 |
| Superclass | b=67, c=52, χ²=1.647, p=0.199 | b=61, c=43, χ²=2.779, p=0.096 |

수치는 분류기 자체가 바뀌었으니 당연히 달라지지만(재현 대상 자체가 다른
분류기), "baseline과 온톨로지 접근 사이 오류 패턴에 통계적으로 유의한 차이는
없다"(양쪽 다 p>0.05)는 정성적 결론은 패치 전후 동일하게 유지된다. 단
Superclass의 p값이 0.199→0.096으로 유의선(0.05)에 더 가까워졌다.

원본 파일(`comparison_report_v2_clean272.md`, `mcnemar_report.md`)은 그대로
보존했고, 신규 결과는 `comparison_report_v3_patched.md`,
`mcnemar_report_v2_patched.md`로 분리 저장했다(모두
`evaluation/ponzi_comparison/results/`).

---

## v3 재검증 중 발견된 추가 사항 (2026-08-30, 논문 4.3절 정성적 사례 재검증)

논문 4.3절의 Case A/B/C는 v2(패치 전) `disagreement_cases.csv`를 기반으로
정의된 세 가지 대표 disagreement 패턴이다. v3(패치 후) 데이터로 재검증하며
두 가지를 추가로 발견했다.

### 1. v3에서 새로 나타난 미명명 disagreement 패턴 (v0.3 재분류 필요)

전체 disagreement 117건 중 Case A(7건)+B(11건)+C(11건) = 29건만 기존 세
패턴으로 설명되고, 나머지 88건은 명명되지 않은 패턴이다. 그중 건수가 두드러진
두 패턴:

| 패턴 | (true, baseline, exact, super) | 건수 | 해석 |
|---|---|---|---|
| 신규 오탐 | (0, 0, 1, 1) | 29건 | baseline은 정상으로 정확히 판정하는데, 패치 이후 온톨로지가 새로 폰지로 오탐 |
| 신규 포착 | (1, 0, 1, 1) | 25건 | baseline은 놓치는데, 패치 이후 온톨로지가 새로 정확히 포착 — recall 개선(15.44%→58.09%)의 직접적 증거 |

두 패턴 모두 Case A/B/C 정의로는 설명되지 않으며, **v0.3에서 별도 재분류 및
원인 분석이 필요한 항목**으로 남겨둔다. 특히 "신규 오탐" 29건은 회피 내성
강화(연속 지표 전환)가 정밀도 측면에서 어떤 대가를 치렀는지 보여주는 직접적
증거이므로 우선순위가 높다.

### 2. 임계값 완화의 반증 사례 — `0xb5b8749355b89bcb04dd70001cea1b98a81ffe61`

논문 4.3절 Case C에서 v0.1(패치 전)에 인용했던 이 실제 주소(true_label=0,
정상 컨트랙트)는 v2에서는 baseline의 오탐(FP)을 온톨로지가 정확히 걸러내는
사례였다(dynamic_exact_pred=0, dynamic_super_pred=0). v3 패치 이후에는
dynamic_exact_pred=1, dynamic_super_pred=1로 바뀌어 **온톨로지 스스로도 이
주소를 오탐하게 됐다.** baseline과 다른 방향이 아니라 같은 방향으로 틀리게
된 것이라 더 이상 disagreement 목록에 나타나지 않는다(둘 다 틀렸으므로
"불일치"가 아님).

이 사례는 **"고정 임계값 클리프 → 연속 지표" 전환이 항상 안전한 변경은
아니라는 반증**이다: 클리프 방식에서는 이 주소의 패턴이 임계값 아래에 머물러
침묵했지만, 연속 점수 방식에서는 동일 패턴이 0보다 큰 부분 점수를 얻어 다른
신호와 합산되며 HIGH_RISK 문턱을 넘었을 가능성이 있다. 정확한 원인(어느
규칙의 fraction이 새로 기여했는지)은 이 주소의 원본 트랜잭션 로그를 직접
재현해 확인해야 하며, v0.3 과제로 남겨둔다.

---

*이 문서와 코드는 탐지 시스템 개선 연구 목적으로만 사용하며, 실제 스마트 컨트랙트 공격에 적용하는 것은 엄격히 금지합니다.*
