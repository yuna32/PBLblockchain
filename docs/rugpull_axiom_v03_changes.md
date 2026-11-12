# 러그풀 교차공리 반영 — 설계서 v0.3 변경점

> 설계서(`온톨로지_설계서_v0.2.docx`)는 직접 고치지 않았다. 이 문서는 v0.3에 반영할 변경점을 모은 것이다.
> 브랜치 `feat/rugpull-axiom`, 반영 전 온톨로지 상태는 태그 `ontology-v0.2-final`(main `ead3d65`).
> 명세: 팀 "러그풀 교차공리 간소화안"(2026-10-11). 팀 코드를 가져오지 않고 명세를 기준으로 우리 코드에 직접 구현했다.

## 1. 요약

- 원칙: **원금을 넘는 돈을 한쪽이 몰아 가져가면 러그풀, 여러 참여자가 나눠 가지면 폰지.**
- 구조: 적용 범위(전제) → 기본 공리(러그풀의 본질) → 교차 공리(다른 유형과의 구분).
- 판정식: `RugPull ← Contract ∧ HasFlow ∧ ¬T ∧ NetDrain ∧ ¬SharedProfit`
- 검증 범위: **시뮬레이션에서만 확인했다.** N=272에는 지갑별 장부가 없어 적용하지 못했고, 팀 실데이터 25건은
  저장소에 없어 재현하지 못했다. 이 변경으로 실데이터 성능(F1 등)이 나아졌다고 말할 근거는 없다.

## 2. 정의 (설계서 러그풀 절 교체)

지갑 a마다 `deposited(a)`(컨트랙트에 낸 돈)와 `received(a)`(컨트랙트에서 받은 돈), 그리고 `peak`(컨트랙트 잔고의 최댓값).

| 단계 | 술어 | 정의 |
|---|---|---|
| 적용 범위 | Contract | 입금 받은 주소가 컨트랙트 (개인 지갑이면 범위 밖, `eoa`) |
| 적용 범위 | HasFlow | 입금과 성공 출금(금액 > 0)이 각각 1건 이상 (없으면 `no_flow`) |
| 적용 범위 | ¬T | 반복 중계 아님. T = 성공 출금 5건 이상이고 그 과반이 직전 입금과 같은 금액(차이 ≤ 1e-9 ETH) (`pass_through`) |
| 적용 범위 | (구현 추가) 지갑별 장부 | 주소별 거래 기록일 것. 블록 집계 자료는 `no_wallet_ledger` |
| 기본 공리 | NetDrain | `Σ_a max(0, received(a) − deposited(a)) ≥ 0.7 × peak` |
| 교차 공리 | ¬SharedProfit | `|{a : deposited(a) > 0 ∧ received(a) ≥ 1.05 × deposited(a)}| < 2` |

- 적용 범위 밖은 "정상"이 아니라 **"이 장부로는 판단할 수 없음"**이다. 판정 체인에서는 러그풀 단계만 건너뛰고 다른 유형은 계속 본다.
  전역 판정불가 verdict는 두지 않았다(폰지·펌프앤덤프까지 맞추는 2단계-B에서 따로 정한다).
- 이전 T의 조건(일치율 80%, ±2%, 수령처 2곳 이하)은 버렸다.
- 이름에 Owner를 쓰지 않는다. 배포자 주소를 확인하지 않고, 라우터·수수료 지갑도 유출에 포함되기 때문이다.
- 판정 순서는 그대로다: (플래시론) → 펌프앤덤프 → 자금세탁 → **러그풀** → 폰지 → 출금 차단 경고 → 정상.

### 이전 정의 (v0.2)

- JS: `singleLargeOutflow(최대 단일 출금 ≥ 최고 잔고의 70%) ∧ ownerWithdrawAll(최대 출금 수령자가 입금자 아님) ∧ ¬participantMidExit`
- OWL `Rule_RugPull`: `BalanceDrop ∧ OwnerWithdrawAll ∧ SingleLargeOutflow` (SWRL에 부정이 없어 ¬MidExit이 빠져 JS와 달랐다)
- v0.2 정의는 블록 집계 장부(N=272)의 판정 체인에서만 계속 쓴다(4절).

## 3. 기준값과 근거 (시뮬레이션 기준)

| 기준 | 값 | 근거 |
|---|---|---|
| NetDrain | 0.7 | 시뮬레이션에서 70~85% 사이로 바꿔도 판정 불변. 90%로 올리면 evasive_B(89%)·evasive_C(86%)가 러그풀에서 빠진다 |
| 수익 기준 | 1.05 | 100% 초과~110%에서 판정 불변. 정확히 100% 환불은 수익이 아니다. 130%로 올리면 폰지 fixture(수익률 110%)의 수익자가 0명이 되어 러그풀로 바뀐다 |
| 수익자 수 | 2 | 정의상 최소("여럿") |
| T | 출금 5건·과반 | 명세값. 시뮬레이션에서 걸리는 것은 플래시론 로그(5/5)뿐이고, 이 로그는 판정 순서상 플래시론 분기가 먼저다 |

- 기준값은 `analysis/dynamic_analyzer.js`의 `RUGPULL_AXIOM` 한 곳에서만 정한다. OWL 생성 스크립트(`ontology/rugpull_axiom.py`),
  `fraud_ontology.js`, 시연용 `demo/lib`, 대시보드(리포트의 `rugpull_axiom.thresholds`)가 모두 이 값을 따른다.
- 경계 비교는 wei 정수(JS BigInt, Python Decimal)로 한다. 폰지 fixture의 NetDrain이 정확히 70.0%여서
  부동소수점이면 경계에서 뒤집힐 수 있다. 정확히 70%·105%와 그 직전·직후 값을 단위 테스트로 고정했다.

## 4. 데이터 입력별 적용

| 입력 | 지갑별 장부 | 러그풀 축 |
|---|---|---|
| 시뮬레이션 로그 (8열, 9열 중첩 포함) | 있음 (입금 `from`, 출금 `to`) | 적용. Contract는 가정(hardhat 배포 컨트랙트) |
| N=272 XBlock | **없음** (블록 단위 `total_in/total_out`. 평가 스크립트가 합성 주소로 펼침) | `no_wallet_ledger`. 판정 체인은 v0.2 술어 유지 |

N=272에 새 공리를 그대로 적용하면(계산만 해 본 결과) 폰지 112건이 러그풀로 바뀌어 exact F1이 0.590에서 0.064로 떨어진다.
합성 주소의 출금 수령자는 입금한 적이 없어 SharedProfit이 늘 0이 되기 때문이다. 공리가 틀렸다는 뜻이 아니라,
이 자료로는 판단할 수 없다는 뜻이다. 그래서 `analyzeDynamic(csv, { ledger: "aggregated" })`를 두었다.

## 5. OWL (설계서 OWL·SWRL 절)

- 데이터 속성 4개 추가 (`ontology/build_ontology.py`): `netDrainRatio`(float), `profitSharerCount`(int),
  `passThrough`(bool), `hasFlow`(bool). 값은 `ontology/load_instances.py`가 CSV에서 다시 계산한다(JS 값 복사 아님).
- 새 `Rule_RugPull` (SWRL은 부정이 없어 수치·불리언으로):
  ```
  FraudContract(?c), hasFlow(?c, true), passThrough(?c, false),
  netDrainRatio(?c, ?r), greaterThanOrEqual(?r, 0.7),
  profitSharerCount(?c, ?n), lessThan(?n, 2) -> RugPull(?c)
  ```
- 재생성 결과(Python 전방 추론): 이전과 달라진 추론은 **자금세탁 인스턴스가 RugPull로도 추론되는 것 하나**다.
  변경 전 스크립트로 다시 만들면 커밋된 OWL 5개 파일이 byte 단위로 같게 재현됨을 먼저 확인했다.

## 6. 결과 JSON (`report.dynamic.rugpull_axiom`)

```js
{
  version: 1,
  thresholds: { netDrain, profitRatio, profitSharers, passThroughMinWithdrawals, passThroughMatchShare },
  scope: { isContract, isContractSource: "assumed" | "input", ledger: "per_wallet" | "aggregated",
           hasFlow, passThrough, passThroughDetail: { withdrawals, matched }, inScope,
           reason: null | "eoa" | "no_flow" | "pass_through" | "no_wallet_ledger" },
  netDrain:     { value, netOutflowEth, peakBalanceEth, threshold, met },
  sharedProfit: { count, threshold, met, wallets: [address] },
  wallets: [{ address, deposited, received, netGain, drainContributor, profitSharer }],
  verdict
}
```

판단 과정(`reasoning_steps`)에는 `rugpullScope`·`netDrain`·`sharedProfit` 3줄을 더한다(집계 장부에서는 더하지 않는다).

## 7. 검증 결과 (시뮬레이션)

| 입력 | 이전 판정 | 새 판정 | NetDrain | 수익자 |
|---|---|---|---|---|
| 시나리오 normal | normal_staking | 같음 | 3.0% | 0 |
| 시나리오 ponzi | ponzi_scheme | 같음 | 70.0% | 3 |
| 시나리오 rugpull | rug_pull | 같음 | 100% | 0 |
| 시나리오 laundering | money_laundering | 같음 (러그풀 조건도 맞지만 판정 순서상 자금세탁) | 94.4% | 1 |
| 시나리오 pumpdump | pump_and_dump | 같음 | 38.5% | 3 |
| evasive_A | ponzi_scheme | **rug_pull** (RugPull_MaxTxEvasion) | 96% | 0 |
| evasive_B | rug_pull | 같음 | 89% | 0 |
| evasive_C (운영자 1 입금 → 9.6 인출) | ponzi_scheme | **rug_pull** (RugPull_MaxTxEvasion) | 86% | 1 |

- 그 밖의 시뮬레이션 로그(허니팟 3종, 패치 폰지, 플래시론, 중첩 9열 로그)는 판정이 같다.
- N=272 생성 4파일(`ontology_predictions.csv`, `disagreement_cases.csv`, `comparison_report.md`, `mcnemar_report.md`)은
  회귀 기준선과 byte 단위로 같다. prevention(메인·중첩 8×2), response_reasoner 스모크, 발동 규칙도 그대로다.
- `analysis/reports/evasion_comparison.json`은 EvasiveA·EvasiveC의 `fraud_type_hint`만 바뀌었다.

## 8. 알려진 한계

- 러그풀과 자금세탁은 장부상 같은 모양일 수 있어 판정 순서(자금세탁 우선)로 가른다. OWL에는 순서가 없어 둘 다 추론된다.
- 운영자가 지갑을 둘 이상 쓰면 SharedProfit이 성립해 러그풀이 아니게 된다(폰지 쪽으로 간다).
- LP pair를 보지 않으므로 토큰형 러그풀은 보이지 않는다.
- 배포자를 조회하지 않으므로 자금세탁과 위장 운영자를 구분하지 못한다.
- EOA 여부는 파이프라인에서 확인하지 않는다(`isContract`는 가정값, 호출자가 알면 넘긴다).
- 정상 스테이킹 시뮬레이션의 참여자 수익률은 104.0~104.9%로 수익 기준 105% 바로 아래다.

## 9. 대시보드

- 판정 조건: 러그풀 카드를 3단(① 판단할 수 있는 거래 기록인가 ② 원금을 넘는 돈이 빠져나갔나 ③ 한쪽이 몰아 가져갔나)으로,
  "러그풀과 폰지가 갈리는 지점" 카드 추가.
- 거래 분석: "지갑별 낸 돈과 받은 돈"(원천 `rugpull_axiom.wallets`). 원금보다 더 받은 지갑 강조, 수익자 표시.
- 적용 범위 밖은 회색 중립 톤의 "이 장부로는 판단할 수 없음"과 사유(개인 지갑 / 흐름 없음 / 반복 중계 / 지갑별 기록 없음).
- 온톨로지 그래프: RugPull ← HasFlow·NotPassThrough·NetDrain·NotSharedProfit ← 데이터 속성 4개.
- 화면 숫자와 기준값은 모두 결과 JSON에서 만든다.

## 10. 후속 정리 후보 (이번 범위 밖, 손대지 않음)

- `flash_loan` 분기: 컨트랙트·시뮬은 `archive/2026-10_flashloan/`로 옮겼지만 판정 1순위 분기와 `OSCILLATING_BALANCE` 규칙은 남아 있다.
- 커밋된 `analysis/reports/`·`analysis/analysis/reports/`의 컨트랙트 리포트 14개는 이번 변경 전부터 현재 코드보다 낡았다
  (변경 전 코드로 다시 만들어도 prevention 추론 체인 등이 다름). 다시 만들지 결정 필요.
- `ontology/run_reasoner.py`는 `add_swrl_rules.py`의 규칙 사본인데 이미 어긋나 있다(PumpAndDump 규칙에 balanceAtFailure 조건 없음, 인스턴스 목록에 honeypot_selective 없음). 이번에는 Rule_RugPull만 맞췄다.
- CLAUDE.md의 HSU/SMC 서술(`fraudType==="HoneypotTrap"`일 때만 실행)은 허니팟 유형 삭제 전 내용이다.
- `evaluation/ponzi_comparison/results/`의 커밋된 4파일은 2026-09 isError 데이터 수정 전 스냅샷이라 지금 실행 결과와
  주소 3개(0x582e3d8d, 0x9a2e9235, 0x2c2e3baa)가 다르다(이번 변경과 무관, 논문 수치 확인 필요 건으로 이미 기록됨).
- 2단계-B(폰지·펌프앤덤프의 "1명이라도" → SharedProfit, 4유형 공통 적용 범위): 시작하지 않음. N=272 영향 계산 후 결정.
