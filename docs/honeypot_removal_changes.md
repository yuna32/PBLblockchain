# 허니팟 사기 유형 삭제 — 설계서 반영용 변경 요약

- 대상 문서: `온톨로지_설계서_v0.2.docx` (이 문서는 수정하지 않았다. 아래 절을 이 요약에 따라 고치면 된다)
- 작업일: 2026-10-14
- 근거: 외부 피드백 "허니팟은 사기 유형이 아니라 사전 단계의 기만 장치"
- 원칙: HoneyPot을 분류 대상에서 뺀다. 다만 출금이 막힌 컨트랙트를 Normal로 오판하지 않도록,
  사기 조건이 모두 불일치인데 출금 차단 신호(ZeroWithdrawBlock)가 있으면 **"유형 미확정 + 출금 차단 경고"**
  (`unclassified_warning`)로 처리한다.
- Honeypot.sol, `analysis/logs/honeypot_log.csv`, OWL 인스턴스 `contract_honeypot`은 삭제하지 않고
  "경고 출력 확인용 음성 대조 케이스"로 유지한다.

## 구현 쪽 요약 (설계서 서술의 근거)

| 레이어 | 변경 |
|---|---|
| JS 지식 (`analysis/analysis/fraud_ontology.js`) | `fraudTypes`·`preventionRules`에서 HoneypotTrap 삭제. `withdrawBlockWarning`(체크리스트 2개·riskLevels·코드 패턴 HSU/SMC를 값 변경 없이 이동), `classificationChain`, `classes.NormalContract` 정의 추가 |
| 동적 분류 (`analysis/dynamic_analyzer.js`) | honeypot 분기 삭제, 우선순위 재정렬, ZeroWithdrawBlock 경고 경로 추가 (`fraud_type_hint: "unclassified_warning"`) |
| 예방 (`prevention_reasoner.js` 2벌) | 출금 차단 체크리스트 점수가 유형 점수와 최고점 경쟁에 참여. 모든 유형 점수보다 높을 때만 `fraud_type_suspected: null` + `classification: "unclassified_warning"`. 코드 패턴(HSU/SMC)은 유형과 무관하게 항상 검사 (`code_pattern_warnings`) |
| OWL (`ontology/*.py` → `.owl` 4개 재생성) | 클래스 FundFreezeFraud·HoneyPot·HoneyPot 서브클래스 3종·InflowContinues 삭제, SWRL 규칙 Rule_HoneyPot과 HoneyPot 서브클래스 규칙 3개 삭제 |

---

## 3-1. 전체 클래스 계층 구조

**현재**: `FraudContract` 아래에 `FundFreezeFraud (자금동결형) └── HoneyPot`이 있고,
`BehaviorPattern` 아래에 `InflowContinues`가 있다.

**변경**
- `└── FundFreezeFraud (자금동결형)` / `└── HoneyPot` 두 줄을 삭제한다. `FundMovementFraud`는 그대로 둔다.
  `FundMovementFraud` 앞의 `├──`는 `└──`로 바꾼다.
- `BehaviorPattern` 목록에서 `└── InflowContinues`를 삭제한다. 앞 줄의 `├── InsiderExitSuccess ├── WithdrawAttemptFail`
  행을 마지막 행으로 정리한다.
- 주석 추가: "AnomalySignal의 ZeroWithdrawBlock(구 WithdrawBlock)은 사기 유형이 아닌 **출금 차단 경고 신호**다.
  사기 유형 조건이 모두 불일치일 때 Normal 대신 '유형 미확정 + 출금 차단 경고'를 낸다(5-1절)."
- "(v0.1 대비 구조 변경 없음)" 문구는 "(허니팟 유형 삭제 — 9절 참고)"로 바꾼다.

## 3-2. 클래스 정의표

**변경**
- `FundFreezeFraud` 행, `HoneyPot` 행을 삭제한다.
- `NormalContract` 정의를 다음으로 바꾼다:
  > 어떤 사기 유형에도 해당하지 않고 출금 차단 신호(ZeroWithdrawBlock)도 없는 컨트랙트. 미판정이 아닌 명시적 정상 표현.
- (선택) 표 아래 주석: "출금 차단 신호만 있고 사기 유형 조건이 맞지 않는 컨트랙트는 어떤 클래스에도 속하지 않는다
  (유형 미확정). OWL 인스턴스는 inferred_types가 비고, JS 레이어는 `unclassified_warning`을 출력한다."

## 5-1. 유형 분류 공리 — 우선순위 체인

**현재**: 1 HoneyPot → 2 PumpAndDump → 3 MoneyLaundering → 4 RugPull → 5 PonziScheme → 6 Normal.

**변경 후 표** (구현: `analysis/dynamic_analyzer.js` `hintFraudType()`)

| 우선순위 | 분류 결과 | 필수 조건 | 핵심 구분자 |
|---|---|---|---|
| 1 | PumpAndDump | someWithdrawalsSucceed AND someWithdrawalsFail AND insiderExitDetected AND balanceAtFailure ≤ ε(현재 0) | 내부자만 출금 성공, 실패 시점 잔고 0 |
| 2 | MoneyLaundering | singleLargeOutflow AND distributedInflow (≥5) AND NOT ownerWithdrawAll | 다수 입금자 + 단일 비-오너 인출 |
| 3 | RugPull | singleLargeOutflow AND ownerWithdrawAll AND NOT participantMidExit | 오너 단발 전액 인출 |
| 4 | PonziScheme | balanceDrop AND flowSpike AND participantMidExit | 중간 참여자 출금 존재 |
| 5 | 유형 미확정 + 출금 차단 경고 (`unclassified_warning`) | 1~4 불일치 AND ZeroWithdrawBlock | 사기 유형 아님, 경고만 출력 |
| 6 | Normal | 1~4 불일치 AND NOT ZeroWithdrawBlock (+ stake/unstake 패턴) | 어떤 사기 조건도, 출금 차단 신호도 없음 |

- ZeroWithdrawBlock(메인 분석기 정의): 비오너 출금 시도 > 0 AND 비오너 출금 성공률 ≤ 5% AND 실패 시점 잔고(balanceAtFailure) > 0.
  기존 HoneyPot 조건에서 inflowContinues만 뺀 것으로, 오너만 인출하는 선택적 차단도 포함한다.
  경고는 dynamic_risk_score에 더하지 않는다.
- 주석: "구현에는 4개 사기 유형 밖의 실험용 분기 flash_loan(OSCILLATING_BALANCE)이 1번보다 앞에 있다(기존과 동일)."
  — 설계서 표에 넣을지는 팀 판단. 넣으면 7단계, 빼면 6단계다.
- "(v0.2에서 구조 변경 없음, 7-4절 회귀 테스트로 불변 확인)" 문구는 "허니팟 삭제로 1단계 제거, 나머지 유형의 판정 결과는 회귀 검증으로 불변 확인"으로 바꾼다.

## 5-2. 교차 유형 구분 공리

**변경**: 허니팟 행만 삭제한다.

| 삭제 행 |
|---|
| `WithdrawAttemptFail` / `InsiderExitSuccess = false (전원 실패)` / `HoneyPot` |

- 참고(조사 결과): 이 행과 기존 체인 1번은 "펌프앤덤프가 아니다"를 가르는 유일한 장치가 아니었다.
  PumpAndDump 조건의 `balanceAtFailure ≤ ε`가 출금 차단 로그(실패 시점 잔고 8~9 ETH)를 이미 배제한다.
  허니팟 분기를 끈 사본에서 두 허니팟 로그 모두 PumpAndDump로 가지 않음을 확인했다.

## 5-5. SWRL 규칙 (OWL 레이어)

**변경**
- `Rule_HoneyPot` 행(조건 `hasPattern(InflowContinues), hasPattern(WithdrawAttemptFail)`)을 삭제한다.
- 설계서 표에는 없었지만 구현에 있던 HoneyPot 하위 규칙 3개도 삭제됐다:
  `Rule_HoneyPot_SelectiveTrap`, `Rule_HoneyPot_HiddenStateUpdate`, `Rule_HoneyPot_StrawManContract`
  (모두 body가 `HoneyPot(?c)`라 HoneyPot 삭제 후 발동할 수 없다).
- 현재 구현 규칙 수: **분류 7개 + 인과관계 5개 = 12개** (삭제 전 11 + 5 = 16개).
  분류 7개: Rule_PonziScheme, Rule_RugPull, Rule_MoneyLaundering, Rule_PumpAndDump,
  Rule_RugPull_SlowDrain, Rule_PonziScheme_MaxTxEvasion, Rule_PumpDump_MaxTxEvasion.
- 문단의 "5개 SWRL 분류 규칙" 표현은 실제 구현(7개)과 이미 맞지 않는다. 표에 Rule_PumpAndDump,
  Rule_PonziScheme_MaxTxEvasion, Rule_PumpDump_MaxTxEvasion이 빠져 있고 Rule_RugPull 등의 body도 구현과 다르다.
  이번 작업 범위 밖이므로 정정 여부는 팀 판단.
- 함께 고칠 후보(요청 목록 밖): 4-3절·5-6절의 "기존 hasSignal 기반 8개 분류 규칙" → "7개".

## 6. 비정상 판단 시나리오 — 시나리오 4

**현재**: 출금 성공률 부분 저하 / WithdrawAttemptFail 일부, InsiderExitSuccess = false, LatecomersExitFail = true /
"허니팟과 펌프앤덤프 중간 변종" / 성공/실패 비율 시계열 추적

**변경 제안**
- 의심 유형: "**출금 차단 경고(유형 미확정)와 펌프앤덤프의 중간 변종**"
- 대응 방향: "성공/실패 비율 시계열 추적. 실패 시점 잔고(balanceAtFailure)가 0이면 펌프앤덤프 쪽,
  잔고가 남은 채 비오너 출금 성공률 ≤ 5%이면 출금 차단 경고"

## 7-1. 예방 레이어 검증 (prevention_reasoner.js)

| 컨트랙트 | 변경 |
|---|---|
| Honeypot | 점수 3점, 등급 HIGH, 감지 1/2, 등급 캡 B→C, 최종 C — **수치는 동일**. 의심 유형만 HoneypotTrap → **유형 미확정(`unclassified_warning`), 출금 차단 경고**로 바뀐다 |
| 나머지 6개 | 변경 없음 (의심 유형·점수·등급·감지 항목 동일) |

- 주석 추가: "출금 차단 체크리스트(HIDDEN_WITHDRAW_BLOCK, NO_PUBLIC_WITHDRAW_ACTIVATE)는 유형과 무관한 경고 항목이다.
  점수가 모든 사기 유형 점수보다 높을 때만 유형 미확정 경로로 가고, 동점이면 사기 유형이 우선한다.
  Honeypot.sol은 경고 3점 > PonziScheme 2점이라 유형 미확정이다(단순 삭제했다면 PonziScheme 의심으로 오분류됐을 것)."
- 코드 패턴(HiddenStateUpdate/StrawManContract)은 유형과 무관하게 7개 모두 검사하며 현재 모두 미검출이다.

## 7-2. 회피탐지 공리 검증 (dynamic_analyzer.js)

| 로그 | 변경 |
|---|---|
| honeypot_log | 기본 유형(신) `honeypot ✅` → **`unclassified_warning` (유형 미확정, 출금 차단 경고) ✅**. 회피 서브클래스 — (skip), 신뢰도 0, InflowStop false (0.17) 유지 |
| 나머지 5개 | 변경 없음 |

- (선택) 행 추가: `honeypot_selective_log` (오너만 인출 성공) → `unclassified_warning`.
- 주석: "중첩 흐름(③)의 9열 fixture `analysis/analysis/logs/honeypot_log.csv`(owner_collect로 10 ETH 전액 회수)는
  중첩 분석기에서 사기 조건(BalanceDrop+FlowSpike, 사용자 출금 없음)이 맞아 `rug_pull`로 판정된다.
  출금 차단 경고보다 사기 유형이 우선한다는 원칙에 따른 결과다."

## 7-3. OWL/SWRL 추론 검증

| 인스턴스 | 변경 |
|---|---|
| contract_honeypot | inferred_types `HoneyPot` → **`[]` (없음)**. 주요 근거: "WithdrawAttemptFail 패턴과 ZeroWithdrawBlock 신호는 남아 있으나 이를 사기 유형으로 분류하는 규칙이 없음(출금 차단 경고 음성 대조), finalBalance=8.0" |
| 나머지 5개 | inferred_types 변경 없음 |

- (선택) 행 추가: `contract_honeypot_selective` — inferred_types `HoneyPot, HoneyPot_SelectiveTrap` → `[]`.
- 참고: InflowContinues 클래스 삭제로 `contract_normal`의 patterns에서 `pat_inflowcont_normal`도 빠졌다(inferred_types `[]`는 동일).
- 재추론 시 Pellet/HermiT는 Java가 없어 실행되지 않았고, 기존과 같은 Python forward-chaining 대체 추론기를 썼다.
  fixpoint 2회, 인과 엣지 관측 연결 6건·예측 생성 6건(기존과 동일).

## 8-2. 버전별 향후 계획

**변경**: v0.3 행의 "HoneyPot 8개 서브클래스 세분화(Torres et al. 2019 기반)"를
"**코드 패턴 경고 확장(Torres et al. 2019 HoneyBadger 기법, 사기 유형과 무관한 출금 차단 경고 축)**"으로 바꾼다.
현재 구현된 HiddenStateUpdate·StrawManContract 2종은 유형 연결을 끊고 `code_pattern_warnings`로 유지한다.

## 9. 버전 이력

**행 추가 제안**

| 버전 | 일자 | 변경 내용 |
|---|---|---|
| (다음 버전) | 2026.10 | 외부 피드백에 따라 HoneyPot을 사기 유형에서 삭제(FundFreezeFraud·InflowContinues 동반 삭제, SWRL 분류 규칙 11→7). 출금 차단은 ZeroWithdrawBlock 경고 신호로 유지하고, 사기 조건 불일치 시 "유형 미확정 + 출금 차단 경고"로 처리. NormalContract 정의에 "출금 차단 신호 없음" 추가. 3-1, 3-2, 5-1, 5-2, 5-5, 6, 7-1~7-3, 8-2절 갱신 |

---

## 경고 병기(b안)

### 변경 이유

위 1차 변경에서는 사기 조건이 하나라도 맞으면 유형이 확정되고, 출금 차단 경고(`unclassified_warning`)는
사기 조건이 모두 불일치일 때만 나왔다. 그래서 중첩 흐름(③)의 9열 fixture
`analysis/analysis/logs/honeypot_log.csv`(입금 10 → `withdraw_attempt` 5건 전원 실패 → `owner_collect` 10 ETH)가
`rug_pull`로 확정되면서, 출금 시도가 전원 실패했다는 정보가 판정 출력에서 사라졌다.
b안은 **경고를 분류 결과와 독립된 플래그로 항상 병기**한다. 분류 결과(유형·점수·등급·classification 값)는 바뀌지 않는다.

### 구현

| 위치 | 추가 필드 | 경고 조건 (기존 정의 그대로) |
|---|---|---|
| `analysis/dynamic_analyzer.js` (메인) | `withdraw_block_warning: { detected, reason }` — 항상 존재 | ZeroWithdrawBlock: 비오너 출금 시도 > 0 ∧ 비오너 출금 성공률 ≤ 5% ∧ 실패 시점 잔고 > 0. 분류 체인 밖에서 항상 계산. 유형 확정 + 경고면 reasoning_steps에 "유형은 {type}으로 확정, 별도로 출금 차단 경고 병기" 줄 추가 |
| `analysis/analysis/dynamic_analyzer.js` (중첩) | 같은 필드 — 항상 존재 | ZERO_WITHDRAW_PATTERN 규칙 발동(`withdraw_attempt` 존재 ∧ 금액 > 0 사용자 출금 없음). reasoning_steps가 없는 분석기라 "유형 확정 + 경고 병기" 문구는 `reason`에 담는다 |
| `prevention_reasoner.js` (메인·중첩) | `withdraw_block_warning: { detected, matched_items }` — 모든 반환 경로에 존재 | 출금 차단 체크리스트(HIDDEN_WITHDRAW_BLOCK, NO_PUBLIC_WITHDRAW_ACTIVATE) 중 하나라도 검출. 유형 판정(경고 점수가 유형 점수와 최고점 경쟁)은 그대로 |

- 두 동적 분석기의 경고 조건은 정의가 다르다. ③ 로그는 메인 정의로는 성립하지 않는다(`withdraw_attempt`가
  메인 `WITHDRAW_ACTIONS`에 없어 비오너 출금 0건). ③ 흐름은 중첩 분석기만 쓰므로 각 분석기의 기존 정의를 유지했다.

### 설계서에서 고칠 곳

- **5-1절**: 우선순위 5행 "유형 미확정 + 출금 차단 경고"와 6행 Normal의 "AND NOT ZeroWithdrawBlock"은 그대로 두고,
  표 아래에 다음을 추가한다.
  > 출금 차단 경고(ZeroWithdrawBlock)는 유형과 무관하게 병기한다. 사기 유형이 확정돼도 경고 조건이 성립하면
  > `withdraw_block_warning.detected = true`를 함께 출력한다. 경고가 분류 결과(classification)를 바꾸는 것은
  > 사기 조건이 모두 불일치일 때(Normal 대신 유형 미확정)뿐이다.
  (1차 요약의 "사기 조건이 모두 불일치일 때만 경고" 서술을 이 문장으로 대체)
- **6절 시나리오 4**: 대응 방향 끝에 "유형이 펌프앤덤프 등으로 확정돼도 비오너 출금 전원 실패면 출금 차단 경고 병기"를 덧붙인다.
- **7-2절** 기대 결과(경고 열 추가 제안):

  | 로그 | 기본 유형 | 출금 차단 경고 |
  |---|---|---|
  | honeypot_log (메인 8열) | unclassified_warning | detected (비오너 5건 성공률 0%, 실패 시점 잔고 8 ETH) |
  | honeypot_selective_log | unclassified_warning | detected (실패 시점 잔고 9 ETH) |
  | 중첩 ③ honeypot_log (9열) | rug_pull | detected (ZERO_WITHDRAW_PATTERN, 유형 확정 + 경고 병기) |
  | ponzi / rugpull / laundering / pumpdump / normal | 변경 없음 | 미검출 |

- **7-3절**: OWL 레이어는 이번 변경 대상이 아니다. contract_honeypot의 inferred_types는 `[]` 그대로이고,
  출금 차단 정보는 기존처럼 `hasSignal(ZeroWithdrawBlock)` 신호와 `WithdrawAttemptFail → implies → ZeroWithdrawBlock`
  인과 엣지로 남는다는 문장을 기대 결과에 덧붙인다. 7-1절(예방 레이어)을 함께 고친다면 Honeypot 행에
  "출금 차단 경고 detected (HIDDEN_WITHDRAW_BLOCK)", 나머지 6개는 미검출로 적는다.
