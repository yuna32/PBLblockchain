# MoneyLaundering_HopLaundering 실데이터 재검증 (Phase 3)

> 조사만 수행, 코드 구현 없음. `analysis/*`, `evaluate_comparison.js` 등 원본 파이프라인
> 파일은 전혀 수정하지 않았다.

## 1. 경로 확인 — 어느 dynamic_analyzer.js 기준인지

HopLaundering 조건은 **두 버전 모두에 구현되어 있다** (Phase 2에서 확인한 최상위/중첩
이원화가 여기서도 그대로 이어짐):

- **`analysis/dynamic_analyzer.js`(최상위, `evaluate_comparison.js`가 실제 참조하는 버전)**
  — `detectEvasionScores()` 내부 `scores.HopLaundering` (L302-338). `baseFraudType ===
  "MoneyLaundering"`일 때만 평가되며, 0~100 점수로 산출되어 다른 회피 점수들과 함께
  `candidates` 배열에 들어간다.
- `analysis/analysis/dynamic_analyzer.js`(중첩) — `detectEvasionSubclass()` 내부
  (L153-163), `"MoneyLaundering_HopLaundering"` 문자열 서브클래스를 반환하는 형태.

두 버전의 판정 조건식 자체는 동일하다:
```
hopAddrs  = withdrawAddrs 중 depositAddrs 집합에 없는 주소 (경유 지갑)
bothSides = withdrawAddrs 중 depositAddrs 집합에도 있는 주소 (양방향 주소)
발동 조건: hopAddrs.length >= 1 AND bothSides.length >= 2
```
Phase 2 결론대로 `evaluate_comparison.js`는 최상위 버전을 쓰므로, 실데이터 검증도
**최상위 버전 기준**으로 진행했다. (다만 아래에서 보듯 어느 버전이든 결론은 동일 —
데이터 자체가 없다.)

## 2. XBlock 실데이터 가용성 확인 → **데이터 부재로 보류**

세 가지를 확인했고 전부 없다는 것을 확인했다.

1. **MoneyLaundering 라벨/유사 판정 부재**: `evaluation/ponzi_comparison/data/Ponzi_label.csv`
   헤더는 `Contract,Ponzi` — Ponzi(1)/Normal(0) 이진 라벨뿐이다. `labeled_addresses.csv`도
   동일(label ∈ {0,1}). MoneyLaundering을 가리키는 라벨이나 유사 판정 컬럼이
   `evaluation/` 어디에도 없다. `evaluation/` 최상위에는 `ponzi_comparison/` 폴더
   하나뿐이라, 별도의 자금세탁 전용 데이터셋도 존재하지 않는다.
2. **주소 단위(경유 지갑 분석용) 데이터가 저장 단계에서 소실됨**: `fetch_and_convert.js`가
   Etherscan에서 `txlist`/`txlistinternal`로 **실제 `from`/`to` 주소가 포함된 트랜잭션을
   가져오기는 한다** (`aggregateByBlock()` 함수, L177-236). 하지만 이 함수는 주소를
   블록 단위로 집계하면서 **개별 주소 문자열 자체는 버리고 `unique_participants`
   누적 카운트 하나만 남긴다** (`cumSet.size`만 CSV에 기록, 실제 주소는 저장 안 됨).
   그 결과 `data/logs/*.csv`의 컬럼은 `block,total_in,total_out,net_flow,
   cumulative_balance,unique_participants,max_single_tx` 뿐이며 **주소 컬럼이 아예 없다.**
   원본 `normalTxs`/`internalTxs` 배열도 디스크에 저장되지 않아 재구성 불가능하다
   (재수집하려면 Etherscan API를 다시 호출해야 함 — 이번 범위 밖).
3. **`evaluate_comparison.js`의 합성 주소는 hop 분석에 쓸 수 없음**: 이 스크립트의
   `convertToPerTx()`는 block-aggregated 데이터를 per-tx 포맷으로 근사 변환하며
   입금 주소를 `0x0...0{depIdx}` 같은 **순번 기반 합성 식별자**로 만든다
   (L131-175). 이는 실제 지갑 재사용 패턴이 아니라 변환 로직이 만들어낸 인공물이라,
   여기에 hop 판정을 걸어도 "회피 서브클래스 발동 여부"가 아니라 "합성 ID 생성
   규칙의 산물"을 측정하는 셈이 된다. 억지로 이 데이터에 HopLaundering을 적용하지
   않았다.

**결론: 위 3가지 모두 부재 → 데이터 부재로 보류.** 억지로 프록시 데이터를 만들거나
구현을 진행하지 않았다.

## 3. 입금→경유→인출 체인 그래프 분석 로직 — 미구현 확인

두 `dynamic_analyzer.js` 버전 모두 **집합(Set) 기반 멤버십 비교**(`hopAddrs`,
`bothSides`)만 수행한다. "입금 A → 경유 B → 인출 C"처럼 **자금 흐름 순서를 그래프로
추적하는 로직은 어느 버전에도 없다** — 단순히 "출금 주소가 입금 주소 집합에
있는지 없는지"만 판별할 뿐, 실제 자금이 몇 단계를 거쳤는지·어떤 순서로 이동했는지는
추적하지 않는다. 이는 설계서 5-3절 표(대응 탐지: "입금→경유→인출 주소 체인 그래프
분석")가 **설계는 됐지만 구현되지 않은 상태**임을 확인한 것이다.

이번 범위에서는 새로 구현하지 않았다 — **필요 작업(범위 밖)**으로만 기록한다.

## 4. 설계서 8-1절 한계 서술 갱신 필요 여부

**갱신 불필요 — 오히려 그대로 유지, 근거만 강화됨.** 8-1절의 "수신자 주소가 첫
입금자 주소와 동일 설정으로 HopLaundering 탐지 불가"는 **시뮬레이션 로그의
설계 제약**을 지적한 문장인데, 이번 조사로 실데이터 쪽은 애초에 **더 근본적인
제약**(주소 자체가 저장되지 않음, 라벨도 없음)이 있음이 드러났다. 즉:

- 시뮬레이션 데이터: 조건 계산은 가능하지만 테스트 케이스 설계가 편향돼 있어 탐지가 안 됨.
- 실데이터(현재 확보분): 조건 계산에 필요한 입력 자체가 없어서 아예 시도할 수 없음.

두 문제는 층위가 다르므로, 8-1절 문장은 그대로 두되 v0.2 후속 계획에 "HopLaundering
실데이터 검증을 위해서는 (1) MoneyLaundering 라벨셋 확보, (2) 주소 단위 데이터를
보존하도록 `fetch_and_convert.js`의 집계 로직 개선, (3) 체인 그래프 분석 로직 신규
구현이 모두 선행되어야 한다"는 3가지 필요조건을 명시적으로 추가하는 것을 권장한다
(이번 범위에서는 문서 반영까지만 권고, 실제 설계서 수정은 하지 않음).
