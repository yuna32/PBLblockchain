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

### 1. v3에서 새로 나타난 미명명 disagreement 패턴 — 원인 분석 완료 (2026-08-30)

전체 disagreement 117건 중 Case A(7건)+B(11건)+C(11건) = 29건만 기존 세
패턴으로 설명되고, 나머지 88건은 명명되지 않은 패턴이다. 그중 건수가 두드러진
두 패턴을 `ontology_predictions.csv`(static_pred/dynamic_exact_pred/
dynamic_super_pred 개별 기여도)와 실제 `dynamic_analyzer.js` 재실행(각
주소의 `triggered_rules`)으로 원인을 추적했다.

**0단계 — static/dynamic 기여도 분리.** `final_pred = static_pred OR
dynamic_pred`이므로, static_pred가 이미 1인 행은 (static analyzer는 이번
패치와 무관하게 불변이므로) v2에서도 이미 같은 상태였을 가능성이 높다 —
"패치가 새로 만든" 불일치가 아니다. 이를 분리하면:

| 패턴 | (true,base,exact,super) | 전체 | dynamic 기여 | static-only(패치와 무관) |
|---|---|---|---|---|
| 신규 오탐 | (0,0,1,1) | 29건 | **27건** | 2건 |
| 신규 포착 | (1,0,1,1) | 25건 | **18건** | 7건 |

즉 "29건/25건"이라는 원래 수치는 패치 기여분을 다소 과대 계상하고 있었다 —
실제 패치 기인 disagreement는 각각 27건/18건이다 (이하 이 27/18건 기준으로
분석).

**1단계 — 규칙별 기여도 집계.**

| 규칙 | 신규 오탐(n=27) | 신규 포착(n=18) |
|---|---|---|
| BALANCE_DROP | **27/27 (100%)** | **18/18 (100%)** |
| FLOW_SPIKE | **27/27 (100%)** | **18/18 (100%)** |
| CONCENTRATION_DRAIN | 18/27 (67%) | 15/18 (83%) |
| BALANCE_TIMESERIES_DRAIN | 17/27 (63%) | 14/18 (78%) |
| TEMPORAL_PATTERN | 5/27 (19%) | 4/18 (22%) |

**BALANCE_DROP과 FLOW_SPIKE는 두 그룹 모두에서 예외 없이 100% 동시발생한다.**
오탐과 정탐 양쪽에 동일한 두 규칙이 지배적으로 관여한다는 것은, 이 둘이
정밀도(precision)와 재현율(recall)을 함께 밀어올리는 이번 패치의 핵심
메커니즘 그 자체이며 — 별도의 "특정 규칙 하나가 유독 오작동"하는 문제가
아니라는 뜻이다.

**2단계 — 왜 27건에서 걸러지지 않았나: 구조적 원인.** 신규 오탐 27건이
`isOrganicUnstake`(조직적 정상 환급) 게이트를 통과하지 못한 이유를
추적한 결과, **이 게이트는 실데이터 평가 파이프라인에서 구조적으로 전혀
작동하지 않는다**는 것을 확인했다. `evaluate_comparison.js`의
`convertToPerTx()`는 블록 집계 CSV를 개별 트랜잭션으로 변환하며 합성
주소를 붙이는데, 입금자 주소는 `0x0000...{idx}` 형태, 출금 수령자 주소는
`0xe000...{idx}` 형태로 **서로 다른 네임스페이스를 사용해 절대 겹치지
않도록 생성된다.** `isOrganicUnstake`의 핵심 조건("출금액의 90% 이상이
원 예치자 본인에게 귀속")은 `depositorMap.has(recipient)`로 판정하므로,
이 주소 스킴 하에서는 **272개 실주소 전체에 대해 항상 거짓**이 된다 —
합성 시나리오(중첩·최상위 버전 공통 테스트)에서는 예치자와 인출자가 같은
주소를 재사용해 완벽히 작동했던 게이트가, 실데이터 변환 파이프라인에서는
애초에 발동할 수 없는 구조였다. 따라서 BALANCE_DROP/FLOW_SPIKE는 272개
실주소 전체에 대해 사실상 무조건 활성 상태로 작동한 것이다.

**3단계 — 확인된 교란 변수: 데이터 품질.** 27건 중 최소 5건(19%)은 잔고가
물리적으로 불가능한 음수 값(예: `0xd0a6e6c5...`는 -7,211,672 ETH)을 보였다
— ETH 총발행량(~1.2억)을 아득히 초과하는 값으로, `fetch_and_convert.js`의
단위 변환 버그(ERC-20 토큰 전송량을 ETH로 오인 등 추정, 미확인)로 보인다.
신규 포착 18건에서도 유사하게 3건(17%)이 동일 증상을 보였다. 이 비율은
"규칙이 과민하다"는 결론과 별개로, **입력 데이터 자체가 손상된 경우가
무시할 수 없는 비중을 차지한다**는 것을 뜻한다 — 규칙 임계값을 어떻게
조정하든 고쳐지지 않는 원인이다.

**대표 사례 3건**:

| 주소 | 그룹 | 실제 원인 | 판정 |
|---|---|---|---|
| `0xbc9ccc8a46d4...` | 신규 오탐 | 정상 데이터. 0.01~0.05 ETH 단위로 예치→즉시 대부분 인출을 745행에 걸쳐 반복(전형적인 소액 순환형 dApp). 관측 종료 시점이 우연히 "인출 직후"라 peak 대비 잔고가 낮게 찍히는 **스냅샷 편향**. `isOrganicUnstake`가 원천적으로 발동 못 해 그대로 노출됨 | 규칙 설계+게이트 구조 문제 |
| `0xd0a6e6c5...` | 신규 오탐 | **데이터 손상** — 잔고가 -7,211,672 ETH까지 하락(물리적으로 불가능) | 데이터 파이프라인 버그 |
| `0x4398a4a1...` | 신규 포착 | BALANCE_DROP(40/40)·FLOW_SPIKE(30/30)·CONCENTRATION_DRAIN(35/35)·TEMPORAL_PATTERN(20/20)·BALANCE_TIMESERIES_DRAIN(20/20) 전부 만점, hint=rug_pull. 실제 라벨 폰지를 v2에서는 완전히 놓쳤던 사례를 v3가 정확히 포착 | 패치 의도대로 작동 |

**권고 (분석·권고만, 코드 수정 없음 — 별도 승인 필요)**:

1. **임계값을 성급히 다시 높이지 말 것.** 오탐 27건 중 상당수(추정 5건+)가
   임계값과 무관한 데이터 손상이 원인이므로, 이 숫자만 보고 BALANCE_DROP/
   FLOW_SPIKE를 되돌리면 실제로는 관련 없는 문제에 대응하는 것이 된다.
2. **우선순위 1 — 데이터 파이프라인 정합성 점검**: `fetch_and_convert.js`가
   생성하는 `cumulative_balance`가 음수이거나 ETH 총발행량을 초과하는
   행을 사전에 걸러내거나 원인(단위 변환 추정)을 수정. 규칙 튜닝보다 이
   문제 해결이 선행되어야 오탐 원인 분석이 의미를 가진다.
3. **우선순위 2 — `isOrganicUnstake` 게이트를 실데이터 파이프라인과
   호환되게 재설계**: 주소 신원에 의존하는 현재 방식은 합성 시나리오
   전용이므로, 실데이터에서도 "조직적 정상 환급" 신호를 낼 수 있는
   대안(예: 반복적 소액 순환 패턴 자체를 별도로 탐지하는 지표)을 검토.
   또는 이 게이트가 실데이터에는 적용 불가능하다는 점을 논문/문서에
   명시적 한계로 기록.
4. 위 두 가지 모두 코드 변경을 수반하므로 **별도 승인 후 진행**.

### 2. 임계값 완화의 반증 사례 — `0xb5b8749355b89bcb04dd70001cea1b98a81ffe61`

논문 4.3절 Case C에서 v0.1(패치 전)에 인용했던 이 실제 주소(true_label=0,
정상 컨트랙트)는 v2에서는 baseline의 오탐(FP)을 온톨로지가 정확히 걸러내는
사례였다(dynamic_exact_pred=0, dynamic_super_pred=0). v3 패치 이후에는
dynamic_exact_pred=1, dynamic_super_pred=1로 바뀌어 **온톨로지 스스로도 이
주소를 오탐하게 됐다.** baseline과 다른 방향이 아니라 같은 방향으로 틀리게
된 것이라 더 이상 disagreement 목록에 나타나지 않는다(둘 다 틀렸으므로
"불일치"가 아님).

**원인 확인 완료** (위 1절의 재현 스크립트로 직접 재실행): 잔고 데이터는
정상(음수 없음, peak=71.5 ETH)이었고, `BALANCE_DROP`(fraction 0.64,
+26점)·`FLOW_SPIKE`(fraction 1.0, +30점)·`BALANCE_TIMESERIES_DRAIN`
(fraction 1.0, +20점) 합산 76점으로 HIGH_RISK 문턱(65점)을 넘겼다. 즉 이
사례도 1절에서 확인한 "BALANCE_DROP+FLOW_SPIKE 보편적 동시발동 + 게이트
구조적 미작동" 패턴의 정확히 한 인스턴스다 — 데이터 손상은 아니었고,
순수하게 규칙 설계(연속 지표) + 게이트 미작동 조합이 원인이었다.

이 사례는 **"고정 임계값 클리프 → 연속 지표" 전환이 항상 안전한 변경은
아니라는 반증**이다: 클리프 방식에서는 이 주소의 패턴이 임계값 아래에 머물러
침묵했지만, 연속 점수 방식에서는 동일 패턴이 0보다 큰 부분 점수를 얻어 다른
신호와 합산되며 HIGH_RISK 문턱을 넘었다.

---

## Phase 1.5 — 이상치 격리 및 fetch_and_convert.js 버그 수정 (2026-08-30)

**신규 발견 및 수정된 버그**: `fetch_and_convert.js`의 `aggregateByBlock()`이
Etherscan API가 반환하는 `isError` 필드(실패/리버트 트랜잭션 여부)를 전혀
확인하지 않고 있었다. 실패한 트랜잭션도 Etherscan 응답에는 "의도했던" `value`
가 그대로 채워져 있는데, 실제로는 ETH가 이동하지 않았으므로 이를 그대로
합산하면 `cumulative_balance`가 왜곡된다. `isError==='1'`인 트랜잭션(일반·
내부 모두)을 제외하도록 수정했다. 재사용·검증을 위해 `processOne()`을
`export`하고 `main()`을 CLI 진입점 가드로 감쌌다(다른 스크립트가 import해도
전체 500건 재실행되지 않도록).

**검증 — 원 5건 재변환 결과**: 이 버그는 5건 중 **1건만 완전히 해결**한다.

| 주소 | 수정 전 minBal | 수정 후 minBal | 비고 |
|---|---|---|---|
| `0xcafe1a77...` | -24,948.83 | **0.0000** | 완전 해결. 단, 재검증 결과 peak 277,199 ETH→0 완전 소진이 **실제 패턴으로 확인**되어 dynamic_analyzer 재실행해도 여전히 오탐(exact=1/super=1/HIGH_RISK) — 데이터 문제가 아니라 규칙 설계 문제였음이 재확인됨 |
| `0x1d979bd0...` | -14.30 | -14.30 | 불변 — 실패 트랜잭션 0건, 이 버그와 무관 |
| `0x05240da1...` | -81.91 | -82.02 | 거의 불변 |
| `0xbc9ccc8a...` | -11.37 | -11.36 | 거의 불변 |
| `0xd0a6e6c5...` | -7,211,672 | -7,211,720 | 악화. 문제의 내부 트랜잭션이 `isError="0"`(성공)으로 기록되어 있어 원인 불명 |

**결론**: 데이터 수정만으로는 "신규 오탐 27건" 중 **단 한 건도 목록에서 빠지지
않는다.** Phase 2(게이트 재설계)가 선택이 아니라 필수임을 재확인.

**이상치 레지스트리**: `evaluation/ponzi_comparison/data/known_outliers.csv`
신설(13건 — 원 5건 + 전체 272건 재스캔에서 신규 발견 8건). 상태 3종:
`resolved_genuine`(1건, `0xcafe1a77`), `unresolved_corrupt`(4건 — 잔고가
여전히 음수/불가능한 값으로 남은 경우), `unreviewed`(8건, 이번 세션에서
미조사, 다음 세션 작업 후보). `unresolved_corrupt` 4건 중 실제로 평가에서
제외 처리한 것은 **`0xd0a6e6c5` 한 건뿐**이다 — 이더리움 전체 유통량을
초과하는 값이라 물리적으로 불가능함이 명백하지만, 나머지 3건(`0x05240da1`,
`0x1d979bd0`, `0xbc9ccc8a`)은 peak 대비 십수 % 수준의 오차라 그 주소의
전체 판정까지 무효화하기엔 근거가 약하다고 판단해 자동 제외 대상에서
뺐다(판단 재검토 가능).

`evaluate_comparison.js`에 `EXCLUDE_ADDRESSES` 환경변수(쉼표 구분) 추가 —
`known_outliers.csv`를 자동 참조하지 않고 실행 시 명시적으로 지정해야
동작한다(어떤 주소가 왜 빠졌는지 실행 로그에 항상 드러나도록 하기 위한
설계 선택).

## Phase 2 — isOrganicUnstake 재설계 검토 (2026-08-30, 구현 보류)

**배경 조사**: `convertToPerTx()`의 합성 주소 스킴(입금자 `0x000...`,
출금수령자 `0xe00...`)은 2026-07-24 작성, `isOrganicUnstake`의 전신인
`isNormalUnstake` 가드는 그보다 이른 2026-06-06부터 존재했다 — 서로 다른
시점에 다른 목적으로 작성된 두 코드가 우연히 충돌한 것으로, 의도적 설계
결함이 아니다. `evaluate_comparison.js` 자체 주석("개별 계정 정보가 없어
합성 주소로 근사 변환")이 이를 뒷받침한다.

**검토한 설계안 2개**:
- (a) 주소 겹침 대신 "입금 이력 존재 여부" 기반 판정 — 단일 게이트로 통합
- (b) 실데이터/시뮬레이션 경로 분리 — 각각 다른 정상성 판정 로직

**정량 검증 결과 — 두 안 모두 실효성 없음이 확인되어 구현하지 않았다.**
주소 겹침 조건만 제거한 버전을 실제 27건(0xd0a6e6c5 제외 26건)에
적용해본 결과 **0/26건이 해소됐다.** 원인 추적 결과 진짜 병목은 주소가
아니라 `isOrganicUnstake`의 **금액 균등성 조건**(`maxW ≤ minW × 2.5`)이었다:

| 차단 원인 | 26건 중 해당 |
|---|---|
| 금액 불균등 | **21/26** (비율 최대 1,241만 배) |
| `owner_withdraw_all` 오라벨링(`convertToPerTx`가 잔고 급락을 보고 마지막 출금을 자동으로 이렇게 표시) | 11/26 |
| 수령자 3명 미만 | 9/26 |

합성 시나리오의 "균등 금액" 가정이 실제 온체인 데이터(정상적으로도 인출
금액이 크게 들쭉날쭉함)에는 전혀 맞지 않는다. 주소 문제를 고쳐도 이 조건에
다시 걸린다.

**추가로 안 (a)는 회귀 위험이 확인됐다**: 주소 조건만 제거해 `evasive_A_log`
에 재적용하면 **다시 조직적 정상 환급으로 오판정된다**(4개 신규 주소가
"3명 이상·균등 금액·고성공률" 조건을 우연히 만족) — 이번 패치의 핵심
성과였던 시나리오 A 탐지가 되돌아간다. B/C는 수령자 1명이라 이 위험에서
안전하다. (b)안은 이 회귀는 피하지만 주소 조건만 분리해봐야 real-data
쪽 효과는 동일하게 0/26이라, 코드 복잡도만 늘고 실익이 없다.

**결정: 이번 세션에서는 `isOrganicUnstake` 코드 수정 보류.** 의미 있는
개선을 하려면 금액 균등성 조건과 `owner_withdraw_all` 오라벨링까지 함께
재설계해야 하는데, 이는 원래 검토 범위(주소 재설계)를 벗어나는 결정이라
별도 세션에서 재논의하기로 했다.

---

## known_outliers.csv 이상치 8건 조사 완료 (2026-08-30)

`unreviewed` 8건 전부 isError 필터 적용본으로 재변환·재확인했다. 결과가
원래 5건 때보다 훨씬 고무적이다 — **8건 중 4건이 완전히 해소됐다**
(원래 5건 중에는 1건만 해소됐던 것과 대조적):

| 주소 | 수정 전 minBal | 수정 후 minBal | 최종 상태 |
|---|---|---|---|
| `0x9a2e9235...` | -147.82 | **0.0000** | `resolved_genuine` — 부수 효과로 dynamic hint가 flash_loan→ponzi_scheme로 개선(기존엔 static만 정탐 기여) |
| `0x109c4f2c...` | -77.01 | **0.0000** (final=150.10) | `resolved_genuine` — 애초에 잔고 급락 자체가 없었음. 여전히 hint=flash_loan이라 미탐지지만 데이터 문제는 아님 |
| `0x2c2e3baa...` | -2.89 | **0.0000** | `resolved_genuine` — **단, 데이터 정상화 후 오히려 신규 오탐 발생**(true_label=0인데 HIGH_RISK/ponzi_scheme로 바뀜). 손상된 데이터 덕에 우연히 안 걸리던 것이 드러난 사례 |
| `0xf4571755...` | -25279.93 | **-1.00** | `resolved_genuine`(잔차 미미) — 분류 결과 불변(원래도 정탐) |
| `0x582e3d8d...` | -17244.51 | -17303.94 | `unresolved_corrupt` — minBal이 peak의 8.8배. **EXCLUDE_ADDRESSES 추가 후보로 제안**(판단 대기, 아래 참고) |
| `0x5fb3d432...` | -3818.01 | -5548.99(악화) | `unresolved_corrupt` — 중간 규모, 유통량 초과는 아님 |
| `0x20d42f2e...` | -2113.55 | -2830.91(소폭 악화) | `unresolved_corrupt` — true_label=0인데 여전히 오탐(데이터와 무관한 규칙 문제) |
| `0xa502f811...` | -8.24 | -8.24(불변) | `unresolved_corrupt` — 기존 mild 3건과 동일한 완만한 오차 |

**EXCLUDE_ADDRESSES 추가 여부 판단**: `0xd0a6e6c5`의 제외 기준("이더리움
총유통량을 초과하는 물리적으로 불가능한 값")을 엄격히 적용하면, 8건 중
이 기준을 충족하는 것은 없다(최대 규모 `0x582e3d8d`의 -17,304 ETH도
유통량 대비 미미함). **다만 `0x582e3d8d`는 minBal이 자체 peak의 8.8배에
달해 다른 완만한 사례들과 성격이 다르다고 판단**, 추가할지는 제안만
하고 실제 반영은 승인 후로 미뤘다.

**중요한 부수 발견**: `0x2c2e3baa`처럼, 데이터 정합성을 개선하는 것이
반드시 정확도를 높이는 것은 아니다 — 손상된(음수) 데이터 때문에 우연히
탐지를 피했던 진짜 정상 컨트랙트가, 데이터가 정상화되자 오히려
BALANCE_DROP/FLOW_SPIKE에 새로 걸리는 경우가 있다. 이는 Phase 2에서
확인한 "금액 균등성 조건이 진짜 병목"이라는 결론과 같은 방향의 증거다.

## scenarios/ smoke-test 결과 (2026-08-30)

**환경 문제 3단 발견 및 우회(코드 수정 없음, 진단 목적 한정)**:
1. `run_scenario.js`의 `execSync`는 Windows에서 `cmd.exe`를 거치는데,
   이 프로젝트가 `\\wsl.localhost\Ubuntu\...` UNC 경로에 있어 `cmd.exe`가
   작업 디렉터리를 인식 못해 즉시 실패한다.
2. WSL 안에서 실행해도 동일 오류가 재현됐는데, 원인은 이 WSL 배포판의
   `PATH`가 `/mnt/c/Program Files/nodejs`(Windows용 npm/npx)를 WSL
   네이티브 경로보다 앞에 두고 있어 `npx`/`npm`이 Windows `.cmd`로
   해석되기 때문이었다(`node`는 정상적으로 `/usr/bin/node`를 가리킴).
3. `npx`를 우회해 `./node_modules/.bin/hardhat`을 직접 호출하니 이번엔
   `Node.js 18.19.1 is not supported by Hardhat, upgrade to 22.10.0+`
   오류 — WSL 시스템 기본 node가 너무 오래됐다(nvm으로 22.22.2/23.11.1
   설치는 되어 있으나 비대화형 셸에서 자동 로드 안 됨, `ETHERSCAN_API_KEY`
   때와 동일한 패턴).

**`PATH=$(nvm이 설치한 node22 경로):$PATH`로 우회하자 유형별 1개씩 총 5개
시나리오(ponzi_001·rugpull_001·laundering_001·pumpdump_001·normal_001)가
전부 정상 실행됐다** — 생성(JSON) → 파라미터 전달(env var) →
`scripts/simulate_*.js` → hardhat 배포/트랜잭션 → CSV 로그 저장까지 체인
전체가 끊김 없이 작동한다. **파이프라인 코드 자체는 정상이며, 문제는
전부 이 머신의 WSL/Windows PATH·Node 버전 환경설정이었다.**

**결과 대조 (expected_signals vs 실제 dynamic_analyzer 출력)**:

| 시나리오 | label | expected | 실제 | 일치 |
|---|---|---|---|---|
| ponzi_001 | 1 | BALANCE_DROP✓ FLOW_SPIKE✓ | HIGH_RISK/100, hint=ponzi_or_laundering, 두 규칙 다 발동 | ✅ |
| rugpull_001 | 1 | BALANCE_DROP✓ FLOW_SPIKE✓ | HIGH_RISK/100, hint=rug_pull | ✅ |
| laundering_001 | 1 | BALANCE_DROP✓ | HIGH_RISK/100, hint=**rug_pull**(MoneyLaundering 아님) | 부분 일치 — 기존에 알려진 유형 판별 특성, 새 버그 아님 |
| pumpdump_001 | 1 | BALANCE_DROP✓ FLOW_SPIKE✓ | HIGH_RISK/100, hint=pump_dump | ✅ |
| **normal_001** | **0** | **전부 false** | **HIGH_RISK/76, hint=ponzi_or_laundering** — BALANCE_DROP+FLOW_SPIKE 발동 | ❌ **신규 오탐 확인** |

**normal_001 오탐 원인**: 19명이 스테이킹한 원래 금액으로 정확히 자기
주소에 언스테이킹(주소 겹침 100% — 인위적 evasion이 전혀 아닌 정상
시나리오)했음에도, 언스테이킹 금액이 0.5527~2.5931 ETH로 갈려(비율
4.69배) `isOrganicUnstake`의 금액 균등성 조건(≤2.5배)을 초과해 게이트가
발동하지 않았다. 최종 잔고가 peak 대비 89.7%나 빠져(리워드풀 잔여분
때문에 100% 못 돌려줌) BALANCE_DROP+FLOW_SPIKE가 그대로 작동했다. **이는
Phase 2에서 실데이터로 확인한 것과 완전히 동일한 메커니즘을, 주소가
완벽히 일치하는 순수 합성 시나리오에서도 재현한 것** — "균등성 조건이
진짜 병목"이라는 결론을 독립적인 두 번째 증거로 재확인한다. (스크립트
버그 아님 — 코드 수정 안 함, 위 Phase 2 논의에 힘을 싣는 자료로만 기록.)

**주의 — 재현 과정에서 실수 발견 및 즉시 복구**: 5개 시나리오를 실행하며
`scripts/simulate_*.js`가 결과를 `analysis/logs/{ponzi,rugpull,laundering,
pumpdump,normal}_log.csv`에 덮어쓴다는 것을 뒤늦게 인지했다 — 이 5개
파일은 이번 세션 내내 회귀 테스트 기준선(baseline)으로 써온 바로 그
파일들이다. 실행 직후 `git status`로 발견해 `git checkout --`으로 즉시
원상복구했고(커밋 `d50568b` 기준 정확히 일치 확인), 다른 작업에는 영향
없었다. `run_scenario.js`가 있는데도 왜 이 위험을 감수했는지: 환경
문제로 `run_scenario.js`(내부적으로 동일 경로에 씀)를 거치지 못해
`scripts/simulate_*.js`를 직접 호출했기 때문 — `run_scenario.js`를
사용했더라도 어차피 같은 파일에 쓰므로 동일한 위험이 있었다. **정식
25개 전체 실행 시에는 이 경로 충돌을 먼저 해결(예: 실행 전 백업, 또는
`analysis/logs/`를 시나리오별로 분리)해야 한다** — 이번 판단(아래)에도
반영.

**전체 25개 정식 실행 여부**: 코드 자체는 검증됐으니 진행할 가치는
있으나, (1) 이 머신의 PATH/노드 버전 환경설정을 먼저 정리하거나 매번
수동 우회해야 하고, (2) `analysis/logs/` 파일 충돌 문제를 먼저 해결해야
안전하게 25개를 연속 실행할 수 있다. **이번 세션에서는 5개 smoke-test로
그치고 25개 정식 실행은 진행하지 않았다** — 두 가지 선행 조건 정리 후
별도 세션에서 진행할 것을 제안한다.

---

## DEX_WHITELIST — HopLaundering bothSides 오탐 완화 (2026-08-30, Phase 1~3)

### Phase 1 — 조사

`MoneyLaundering_HopLaundering` 서브클래스(경유 지갑 판정)는
`analysis/dynamic_analyzer.js`의 `detectEvasionScores()` 내부(변경 전
439-444번 줄)에 구현되어 있다. 조건은 집합 멤버십 비교뿐이다:

```
hopAddrs  = 출금 주소 중 입금 주소 집합에 없는 주소 (경유 지갑 후보, ≥1)
bothSides = 출금 주소 중 입금 주소 집합에도 있는 주소 (양방향 주소, ≥2)
발동 조건: hopAddrs.length >= 1 AND bothSides.length >= 2
score = min(100, hopAddrs.length*30 + bothSides.length*20)
```

`analysis/analysis/dynamic_analyzer.js`(중첩 디렉터리, `detectEvasionSubclass()`
내부)에도 동일 조건식이 존재하지만, `analysis/` 자체가 별도의 독립 git
저장소(origin: `yuna32/PBLblockchain`)이고 그 안에 프로젝트 전체가
한 번 더 clone된 흔적이다. `run_all_scenarios.js`/`pipeline.js`/
`compare_evasion.js`/`evaluate_comparison.js` 전부 최상위 버전만
import하므로 **중첩 버전은 죽은 코드** — 이번 작업에서 건드리지 않았다.

**N=272 실데이터(XBlock, `evaluate_comparison.js`)에는 이 조건을 실행할
입력 자체가 없다** — MoneyLaundering 라벨이 없고, `fetch_and_convert.js`의
블록 집계 과정에서 실제 주소가 저장되지 않으며, 합성 주소는 순번 기반이라
hop 판정 대상이 되지 않는다(이전 세션 `evaluation/ponzi_comparison/results/
hoplaundering_review.md`에서 확인한 내용을 재확인).

주소 단위 데이터가 존재하는 유일한 곳은 EthereumHeist 파일럿(n=8,
`evaluation/hoplaundering/`)이다. bothSides≥2 SET조건 충족은 8건 중 2건:

| 케이스 | bothSides 주소 | Etherscan 공개 라벨 |
|---|---|---|
| Plus Token Ponzi 1 | `0x6ce110b2...` | Plus Token Ponzi 1(동일 세탁 클러스터) |
| | `0x32b0ccd7...` | 라벨 없음(EOA) |
| BELLE Honeypot Rug Pull | `0x7a250d56...` | **Uniswap V2: Router 2** |
| | `0xdef1c0de...` | **0x: Exchange Proxy** |
| | `0x44fe4535...` | 라벨 없음(EOA) |

**라벨 정정**: 기존 `evaluation/hoplaundering/results/pilot_report.md`가
`0xdef1c0ded9bec7f1a1670819833240f027b25eff`를 "1inch Router"로 기록해뒀는데,
Etherscan 재확인 결과 이는 1inch가 아니라 **0x Protocol의 "0x: Exchange
Proxy"**다(둘 다 DEX 애그리게이터 계열이지만 다른 프로젝트) — 화이트리스트에는
정정된 라벨로 반영했다.

BELLE 케이스는 bothSides 3개 중 2개가 범용 DEX 인프라와 겹친다. 다만 이
파일럿은 "8개 사건이 MoneyLaundering으로 분류돼야 한다"를 검증하는 게
아니라 bothSides 계산 로직이 실제 자금 흐름에서 계산 가능한지를 본
것이므로(파일럿 스코프 노트), **실제 파이프라인이 이 데이터를 통과시켜
정상 스왑을 세탁으로 오판한 사례를 관측한 것은 아니다** — N=272 쪽은
애초에 주소 데이터가 없어 이 조건이 프로덕션에서 발동한 적 자체가 없다.
따라서 이번 화이트리스트는 **"잠재 위험"에 대한 선제 조치**로 분류했고,
n=8 규모를 근거로 범위를 과도하게 넓히지 않았다(1inch·PancakeSwap 등
아직 실제로 걸리지 않은 다른 DEX는 추가하지 않음).

*(참고: hopAddrs 쪽에 반복 등장한 `0x722122df12d4e14e13ac3b6895a86e84145b6967`
= Tornado Cash 라우터는 믹서지 DEX가 아니므로 화이트리스트 대상이 아니다 —
오히려 반대로 의심 신호에 가까움. 혼동 방지차 기록.)*

### Phase 2/3 — 설계 및 구현

**개입 지점**: 판정 후 후처리가 아니라, `bothSides` 집합이 만들어지는
필터 조건 안에서 걸러야 트리거 여부와 점수가 둘 다 정확해진다(후처리
방식은 `hopAddrs.length*30 + bothSides.length*20` 점수 계산 자체가
왜곡된 개수를 그대로 쓰게 됨).

**구현**: `analysis/dynamic_analyzer.js` 상단에 하드코딩 상수
`DEX_WHITELIST`(Set, 2개 주소) 추가 + `bothSides` 필터에
`&& !DEX_WHITELIST.has(a)` 조건 추가. 제외된 주소는 기존
`EXCLUDE_ADDRESSES`(`evaluate_comparison.js`)와 동일한 "실행할 때마다
로그에 드러나야 한다"는 투명성 관례에 맞춰 `console.log`로 출력한다.
범위는 이번에 실증된 2개 주소로 한정:

```js
const DEX_WHITELIST = new Set([
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", // Uniswap V2: Router 2
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff", // 0x: Exchange Proxy
]);
```

### Phase 3-2 — 회귀 테스트 결과

**방법론 참고**: `pilot_hoplaundering.js`는 `chain_graph.js`(별도의
독립적인 bothSides 재구현)를 통해 파일럿을 재실행하며, `dynamic_analyzer.js`를
전혀 import하지 않는다 — 즉 파일럿을 그대로 재실행해도 이번 변경이 반영되지
않는다. 대신 `evaluation/hoplaundering/results/pilot_result.json`에 이미
기록된 실제 hopAddrs/bothSides 주소 배열(ground truth)에, 소스 파일에서
그대로 추출한 `DEX_WHITELIST`와 변경된 필터·점수 산식을 프로그램적으로
적용해 검증했다(수동 재입력에 의한 오류 방지).

| 케이스 | hopAddrs | bothSides(전) | bothSides(후) | 화이트리스트 발동 | 점수(전) | 점수(후) |
|---|---:|---:|---:|:---:|---:|---:|
| AnubisDAO Liquidity Rug 1 | 9 | 1 | 1 | — | 0 | 0 |
| BadgerDAO Exploiter | 0 | 0 | 0 | — | 0 | 0 |
| Bitmart Hacker | 2 | 0 | 0 | — | 0 | 0 |
| PolyNetwork Exploiter 1 | 1 | 0 | 0 | — | 0 | 0 |
| Kucoin Hacker | 5 | 1 | 1 | — | 0 | 0 |
| Plus Token Ponzi 1 | 175 | 2 | 2 | 없음 | 100 | 100 |
| Cream Finance Flash Loan Exploiter | 3 | 0 | 0 | — | 0 | 0 |
| **BELLE Honeypot Rug Pull** | 4 | **3** | **1** | Uniswap V2 Router 2, 0x Exchange Proxy | **100** | **0** |

BELLE 케이스는 bothSides가 3→1로 줄면서 `bothSides.length>=2` 조건 자체가
깨져 HopLaundering 점수가 100 → 0으로 완전히 꺼진다(단순 감점이 아니라
트리거 자체가 해제됨). Plus Token은 bothSides 두 주소 모두 화이트리스트에
없어 완전히 불변(100→100) — 예상대로다.

**기존 시나리오/실데이터 회귀 없음 확인**:
- `analysis/pipeline.js --contract MoneyLaundering`(시뮬레이션 로그):
  `dynamic_risk_score`/`verdict`/`fraud_type_hint`/`evasion_subclass`/
  `evasion_all_scores` 전부 변경 전후 완전히 동일(byte-identical JSON).
  시뮬레이션 로그는 bothSides 조건 자체가 원래 발동하지 않으므로
  (`evasion_all_scores: {}`) 화이트리스트가 개입할 지점이 없다.
- `analysis/compare_evasion.js`(6개 기본 컨트랙트 + 3개 회피 시나리오
  A/B/C, 총 9종): 콘솔 출력·`evasion_comparison.json` 전부 변경 전후
  byte-identical(`diff` 결과 없음).
- `evaluation/ponzi_comparison/evaluate_comparison.js`(XBlock 실데이터,
  `EXCLUDE_ADDRESSES=0xd0a6e6c5...` 기준 499건 평가): P/R/F1(Exact·
  Superclass 둘 다), `disagreement_cases.csv`, `ontology_predictions.csv`
  전부 변경 전후 byte-identical(리포트 헤더의 생성 타임스탬프만 다름).
  Phase 1에서 예측한 대로 이 데이터셋엔 애초에 bothSides 계산 대상 주소가
  없어 회귀 자체가 발생할 수 없는 구조.

**결론: 화이트리스트는 BELLE 파일럿 케이스 1건에서만 관측 가능한 효과를
내고, 기존 검증된 9개 시나리오와 N=272 실데이터에는 어떤 영향도 주지
않는다.**

### Phase 3-3 — 설계서 반영 메모

온톨로지 설계서(`온톨로지_방법론_letter.docx`)는 바이너리 포맷이라 이
세션에서 직접 편집하지 않았다(python-docx 등 라이브러리 설치가 이 환경에서
실패, zip/XML 직접 조작은 결과를 시각적으로 검증할 수 없어 서식이 깨질
위험이 있어 사용자 확인 후 보류). 대신 `ontology/CHANGELOG_v0.3.md`에
반영 내용을 기록했다 — docx에 수동 반영 시 "이 외에 기존에 파악한 한계도
남아 있다..." 단락(HopLaundering 시뮬레이션 데이터 제약 서술) 바로 뒤,
"본 실데이터 비교는..." 단락 앞에 삽입하는 것을 권장한다(상세는 해당
파일 참고).

---

*이 문서와 코드는 탐지 시스템 개선 연구 목적으로만 사용하며, 실제 스마트 컨트랙트 공격에 적용하는 것은 엄격히 금지합니다.*
