# PBL 프로젝트 메모

## 실제 동작하는 파이프라인 경로

프로젝트에 `analysis/*.js`(최상위)와 `analysis/analysis/*.js`(중첩) 두 개의 파이프라인
사본이 공존한다. **둘 다 실행은 된다** — Phase 1 초기 조사에서 "최상위는 import가 깨져
있다"고 판단했던 것은 **오류였다** (아래 정정 참고). 실제 차이는 import가 아니라
데이터셋 범위다.

- **`analysis/analysis/`(중첩) — 설계서 v0.1 기준 최신/전체 데이터셋.**
  자체 `fraud_ontology.js`를 보유하고, `contracts/`·`reports/`에 PonziLab, RugPull,
  MoneyLaundering, PumpDump, Honeypot, NormalStaking, PonziLabPatched **7개**가 모두
  일치한다(설계서 7-1절 표와 정확히 매칭). **온톨로지 지식(`fraud_ontology.js`)을
  고치는 작업은 반드시 이 경로 기준으로 할 것.**
- **`analysis/*.js`(최상위) — 더 오래된 5개 컨트랙트 스냅샷.**
  `prevention_reasoner.js`의 `import { FraudOntology } from "./analysis/fraud_ontology.js"`는
  상대경로 계산상 정확히 `analysis/analysis/fraud_ontology.js`(중첩)를 가리켜서 **정상
  import된다.** 다만 컨트랙트 소스는 `PROJECT_ROOT/contracts/`(= pbl 최상위 `contracts/`)
  에서 읽는데, 이 폴더에는 Honeypot·PonziLabPatched가 아예 없고 RugPull/MoneyLaundering/
  PumpDump.sol 내용도 `analysis/contracts/`의 것과 **다르다**(구버전으로 추정, `diff`로
  확인됨). 즉 "깨진" 게 아니라 "구버전 5개 컨트랙트만 커버하는 별도 스냅샷"이다.
  `analysis/dynamic_analyzer.js`(최상위)는 `fraud_ontology.js`에 의존하지 않는
  자기완결형 축약 버전이며, `evaluation/ponzi_comparison/evaluate_comparison.js`가
  바로 이 최상위 버전을 사용한다(중첩 버전이 아님 — import 경로 `'../../analysis/dynamic_analyzer.js'`
  참고). 이 사실을 모르고 동적 분석 임계값을 중첩 `dynamic_analyzer.js`에서만 고치면
  `evaluate_comparison.js` 결과에는 반영되지 않으니 주의.
- 결론: **온톨로지 지식/공리(`fraud_ontology.js`, `prevention_reasoner.js`) 수정은
  `analysis/analysis/` 기준**, 단 `evaluation/ponzi_comparison/`의 실데이터 비교실험은
  최상위 `analysis/dynamic_analyzer.js`를 쓰고 있다는 점을 함께 인지할 것.
  **(2026-08-30 갱신)** 회피 시뮬레이션 패치(권고 7개)는 양쪽 `dynamic_analyzer.js`
  모두에 반영 완료됐으나, **두 파일을 하나로 합치는 구조적 정리 작업 자체는 여전히
  미착수 상태**다 — 코드가 물리적으로 두 벌 존재하는 한, 이 파일을 고칠 때마다
  매번 양쪽 다 확인/반영해야 하는 부담은 그대로 남아 있다. 자세한 내용은 아래
  "회피 시뮬레이션 패치" 절 참고.

## 설계서(온톨로지_설계서_v0.1.docx) 관련 이슈

- **4-3절 표기 오류**: "WithdrawBlock → implies → WithdrawAttemptFail"은 오기재다.
  - 설계서 3-1절(클래스 계층)과 4-1절(Domain/Range 표) 기준으로 보면 원인/결과가
    반대로 적혀 있고, 애초에 "WithdrawBlock" 클래스 자체가 구현체(fraud.owl,
    fraud_ontology.js) 어디에도 존재하지 않는다. 존재하는 것은 `ZeroWithdrawBlock`
    (AnomalySignal)뿐이다.
  - 올바른 방향은 **`WithdrawAttemptFail(BehaviorPattern) → implies →
    ZeroWithdrawBlock(AnomalySignal)`** 이며, Phase 1 작업에서 이미 이 방향으로
    정정하여 구현했다 (`ontology/build_ontology.py`, `ontology/add_swrl_rules.py`,
    `analysis/analysis/fraud_ontology.js` 참고).
  - **설계서 v0.2 작성 시 4-3절 표를 이 정정 내용으로 수정해야 한다.**

## 통계 검정 (McNemar)

- 논문("온톨로지_방법론_letter.docx" 4.2절)에 인용된 McNemar 검정 수치(Exact:
  b=52,c=52,χ²=0.010,p=0.922 / Superclass: b=67,c=52,χ²=1.647,p=0.199)는 원래
  저장소에 계산 스크립트가 없어 출처가 불명확했으나, **재현에 성공했다.**
- **McNemar 계산 스크립트: `evaluation/ponzi_comparison/mcnemar_test.js`**
  (입력: `results/disagreement_cases.csv`, 출력: `results/mcnemar_report.md`).
  연속성 보정 적용 공식 χ² = (\|b-c\|-1)²/(b+c), df=1 로 논문 수치가 정확히 재현됨을
  확인했다. b/c는 "판정이 갈리는 행에서 true_label과 일치하는 쪽을 승자로 카운트"
  방식으로 정의한다.

## 외부 데이터 소스 (EthereumHeist)

- HopLaundering 실데이터 검증(Phase 3 후속)을 위해 `github.com/lindan113/EthereumHeist`
  에서 3개 CSV를 받아 **`data/raw/ethereumheist/`**(신규 폴더, 원본 파이프라인
  데이터와 분리)에 저장했다.
  - `Heist label-etherscan.csv` (117개 주소) — 탈취/러그풀 사건의 **공격자 지갑 주소**에
    사건명을 붙인 라벨. 온톨로지의 `MoneyLaundering`(다수 입금자→단일 주소 스마트컨트랙트
    패턴) 라벨이 **아니라**, "장물이 이 주소에서부터 어디로 흘러갔는지" 추적할 시작점
    주소 목록이다.
  - `HeistEvent_Info - filtered.csv` (33건) — 사건별 메타데이터(연도/유형/피해액/수법).
    Case Name으로 위 라벨 파일과 느슨하게 연결된다.
  - `Service_Provider_Map.csv` (41건) — 거래소 등 알려진 서비스 제공자 **이름/카테고리/
    웹사이트만** 있고 **주소가 없다** (Step 3-2에서 확인 — 최초 판단과 달리 주소 대조에
    직접 쓸 수 없음). 최종 목적지가 알려진 서비스인지 자동 판별하려면 별도의
    주소→서비스 매핑 데이터가 필요하다(이번 범위에서는 확보 안 함).
  - README의 Dropbox 링크(`dropbox.com/sh/edel1qeuvy6d2o2/...`)는 HTTP 접근은 되지만
    JS 렌더링 SPA라 자동 다운로드 불가 — GitHub의 3개 CSV만으로 진행.

## HopLaundering 실데이터 검증 — 선행조건 3가지 해소 완료

Phase 3에서 확인된 3가지 구조적 부재(라벨셋 없음/주소 데이터 소실/체인 그래프
로직 미구현)를 모두 해소했다. `evaluation/hoplaundering/` 신규 폴더:

- `fetch_and_convert_v2.js` — 원본 `evaluation/ponzi_comparison/fetch_and_convert.js`의
  `aggregateByBlock()`이 주소를 버리는 문제를 고친 버전. `deposit_addresses`/
  `withdrawal_addresses` 열 + 시계열 정렬된 `{address}_edges.csv`(tx hash 포함) 생성.
  `--smoketest`로 API 키 없이 오프라인 검증 가능. CLI 직접 실행시에만 `main()` 구동(다른
  스크립트가 `processOne()`을 import해도 부수효과 없음).
- `chain_graph.js` — 입금→경유→인출을 집합 멤버십(기존 dynamic_analyzer.js와 동일 조건:
  hopAddrs≥1, bothSides≥2)뿐 아니라 **시계열 순서**(받은 블록 이후에 실제로 내보냈는지,
  `passThroughConfirmed`)까지 확인하는 재귀 체인 추적기. depth 제한 + 방문 집합으로
  사이클 방지. API 호출 없음(로컬 edges.csv만 읽음).
- `pilot_hoplaundering.js` — EthereumHeist 시드 8개로 실제 파일럿 실행, 결과:
  `results/pilot_report.md` 참고. **핵심 발견**: 집합 조건(SET조건) 충족은 2/8이지만
  시계열 pass-through 확인은 6/8 — 기존 임계값이 과소 탐지 경향이 있을 수 있음.
  또한 **Tornado Cash 라우터가 여러 사건에 등장했는데 그 지점에서 추적이 끊김** —
  믹서는 입출금 연결고리를 의도적으로 끊으므로 주소 그래프 기반 접근(chain_graph.js
  및 기존 dynamic_analyzer.js 둘 다)의 근본적 한계로 확인됨. 설계서 8-1절에 추가할
  가치가 있는 발견.

**Etherscan API 키**: `~/.bashrc`의 `ETHERSCAN_API_KEY`가 예전엔 무효한 값이었다
(v2 엔드포인트에서 "Invalid API Key" 확인). 2026-08-09 사용자가 새 키를 제공해 갱신
완료, 정상 작동 확인함. `.bashrc`는 `case $- in *i*) ;; *) return;; esac` 가드가 있어서
`bash -lc`(비대화형)로는 안 읽힌다 — 이 환경변수를 스크립트에서 쓰려면 `bash -ic`
(대화형)로 실행하거나 값을 직접 export 해야 한다.

## 회피 시뮬레이션 패치 (2026-08-30 — 양쪽 dynamic_analyzer.js 모두 완료)

`EVASION_ANALYSIS.md`의 권고 패치 7개를 **중첩 버전과 최상위 버전 모두에** 적용
완료. 자세한 표/수치는 EVASION_ANALYSIS.md "패치 적용 내역" 및 "최상위 버전 패치
완료" 절 참고. 요약:

- **중첩 버전** (`analysis/analysis/dynamic_analyzer.js`): Phase 1에서 적용.
  BALANCE_DROP/FLOW_SPIKE/CONCENTRATION_DRAIN 연속 점수화, 가중치 재조정,
  신규 규칙 TEMPORAL_PATTERN·BALANCE_TIMESERIES_DRAIN 추가. 부작용 방지를 위해
  "조직적 정상 환급(organic unstake)" 게이트를 새로 만들어 적용(이 파일에는
  기존에 유사한 가드가 없었음).
- **최상위 버전** (`analysis/dynamic_analyzer.js`): Phase 4에서 적용. 동일한
  7개 권고를 얹되, 이 파일에 이미 있던 `detectInflowStop()`의 `isNormalUnstake`
  가드를 `computeIsOrganicUnstake()`로 추출·확장해 재사용(신규 게이트를 또
  만들지 않음). 회귀 테스트 중 `flashloan_log`(자기순환 패턴)에서 기존 가드의
  경계값 버그(`maxW < minW*2.5` strict 비교)를 발견해 `<=`로 수정.
  `hintFraudType`/`detectEvasionSubclass`/`reasoning_steps` 등 이 파일 고유
  로직은 그대로 유지.
- **체크포인트 커밋 `d50568b`** (패치 전 상태 보존) → **패치 커밋 `21203cb`**
  (최상위 패치 + 실데이터 재평가).
- **실데이터 재평가** (`evaluate_comparison.js`, N=272): 동적분석 Exact F1
  24.42%→59.18%, Superclass F1 34.10%→60.90%, 온톨로지(OR결합) Exact F1
  60.71%→68.73%, Superclass F1 61.13%→68.07% — 전부 개선, 회귀 없음. McNemar
  수치는 분류기가 바뀌었으니 당연히 달라졌지만(Exact p=0.922→0.832, Superclass
  p=0.199→0.096) "baseline과 온톨로지 간 오류 패턴 유의차 없음"이라는 정성적
  결론은 유지. 신규 결과는 `evaluation/ponzi_comparison/results/
  comparison_report_v3_patched.md`, `mcnemar_report_v2_patched.md`에 저장,
  원본(`comparison_report_v2_clean272.md`, `mcnemar_report.md`)은 보존.
- **앞으로 이 파일 관련 작업 시 주의**: 두 `dynamic_analyzer.js`는 여전히 물리적으로
  분리된 별도 파일이다 (위 "실제 동작하는 파이프라인 경로" 절 참고). 규칙/임계값을
  다시 고칠 일이 생기면 **반드시 양쪽 다 확인**하고, 최상위를 고치면
  `evaluate_comparison.js`/`mcnemar_test.js`도 함께 재실행해 논문 수치 변동을
  재확인할 것.

## v3 논문 4.3절 재검증 + 미명명 disagreement 원인 분석 (2026-08-30)

- **4.3절 Case A/B/C 재검증**: v2(패치 전) 대비 A는 변동 없음(7건),
  B는 36건→11건(recall 개선으로 25건 해소, 두 인용 주소는 유지),
  C는 27건→11건 + 인용 주소가 목록에서 소멸(패치가 그 주소를 새로
  오탐하게 만들어 baseline과 같은 방향으로 틀리게 됨 — 아래 원인 분석
  참고). docx(`온톨로지_방법론_letter.docx`) 4.3절에 전부 반영, 커밋
  `20a3d5c`.
- **미명명 disagreement 패턴(신규 오탐 29건/신규 포착 25건) 원인 분석
  완료**: static/dynamic 기여도를 분리하면 실제 패치 기인분은 각각
  27건/18건(나머지는 static analyzer發 기존 불일치, 패치와 무관). 두
  그룹 모두 **BALANCE_DROP+FLOW_SPIKE가 100% 동시발생** — 별도 규칙
  하나의 오작동이 아니라 이번 패치의 핵심 메커니즘 자체가 정밀도/재현율을
  동시에 밀어올리는 것. 구조적 원인: `evaluate_comparison.js`의
  `convertToPerTx()`가 입금자(`0x000...`)/출금 수령자(`0xe00...`) 주소를
  겹치지 않는 별도 네임스페이스로 합성하기 때문에, 주소 신원에 의존하는
  `isOrganicUnstake` 게이트가 **실데이터 272건 전체에서 구조적으로
  한 번도 발동하지 못한다.** 추가로 27건 중 5건(19%)은 잔고가 음수로
  수억 ETH까지 내려가는 등 데이터 자체가 손상된 사례(추정: `fetch_and_
  convert.js`의 단위 변환 버그) — 임계값 튜닝으로는 고쳐지지 않는 별도
  문제. 상세 표·대표 사례·권고는 `EVASION_ANALYSIS.md` "v3 재검증 중
  발견된 추가 사항 → 1. v3에서 새로 나타난 미명명 disagreement 패턴"
  참고. **코드 수정은 하지 않았음 — 데이터 파이프라인 정합성 점검과
  `isOrganicUnstake` 실데이터 호환 재설계 둘 다 별도 승인 필요.**

## Phase 1.5/2 — 이상치 격리 + isOrganicUnstake 재설계 검토 (2026-08-30)

위 disagreement 원인 분석의 후속 작업. 상세는 `EVASION_ANALYSIS.md`의
"Phase 1.5" / "Phase 2" 절 참고. 요약:

- **`fetch_and_convert.js` 버그 수정**: `aggregateByBlock()`이 Etherscan의
  `isError`(실패 트랜잭션 여부)를 확인하지 않아 리버트된 트랜잭션까지
  잔고에 합산되던 버그를 고쳤다. `processOne()`을 export하고 `main()`을
  CLI 가드로 감싸 재사용 가능하게 함. **효과는 제한적**: 이상 5건 중
  1건(`0xcafe1a77`)만 완전히 해결됐고, 나머지 4건은 원인이 다른 것으로
  확인됨(추정: selfdestruct 등 Etherscan API가 포착 못하는 자금 이동
  경로 — 코드로 고칠 수 없음). 심지어 해결된 1건도 재검증 결과 진짜로
  peak→0 완전 소진이었음이 드러나 여전히 오탐으로 분류된다 — **데이터
  수정만으로는 신규 오탐 27건 중 0건도 해소되지 않음.**
- **이상치 레지스트리 신설**: `evaluation/ponzi_comparison/data/
  known_outliers.csv`(13건: resolved_genuine 1, unresolved_corrupt 4,
  unreviewed 8). `unreviewed` 8건은 **다음 세션 작업 후보**로 명시적으로
  남겨둔 상태 — 이번 세션에서 재조사하지 않았다.
- **`EXCLUDE_ADDRESSES` 환경변수 추가** (`evaluate_comparison.js`) —
  물리적으로 불가능한 값(이더리움 전체 유통량 초과 등)을 가진 주소를
  평가에서 제외하기 위함. `known_outliers.csv`를 자동 참조하지 않고
  명시적 지정만 지원(실행할 때마다 뭐가 왜 빠졌는지 드러나도록). 현재는
  `unresolved_corrupt` 4건 중 `0xd0a6e6c5` 한 건만 실제로 제외 대상으로
  씀 — 나머지 3건은 오차가 작아(peak 대비 십수%) 판정 전체를 무효화할
  근거가 약하다고 판단.
- **`isOrganicUnstake` 재설계는 검토만 하고 구현하지 않았다.** 주소
  네임스페이스 문제만 고치는 두 설계안(주소 대신 입금이력 기반 판정 /
  실데이터·시뮬레이션 경로 분리)을 실제 26건(27건 중 `0xd0a6e6c5` 제외)
  에 시뮬레이션한 결과 **0/26건 해소** — 진짜 병목은 주소가 아니라
  "금액 균등성" 조건(`maxW ≤ minW×2.5`, 21/26건이 여기 걸림, 실제
  데이터는 정상적으로도 인출액이 크게 들쭉날쭉하기 때문)과
  `convertToPerTx`가 잔고 급락을 보고 마지막 출금을 자동으로
  `owner_withdraw_all`로 잘못 라벨링하는 문제(11/26건)였다. 게다가 주소
  조건만 제거하는 안은 `evasive_A_log`를 다시 조직적 정상 환급으로
  오판정시키는 **회귀까지 확인됨**(4개 신규 주소가 우연히 균등 금액·
  고성공률 조건을 만족). 사용자가 이 결과를 보고 **구현 보류를
  결정** — 의미 있는 해결은 원래 검토 범위(주소)를 넘어 균등성 조건과
  오라벨링까지 재설계해야 하므로, 별도 세션에서 재논의하기로 함.
- **(2026-08-30 후속) `known_outliers.csv`의 `unreviewed` 8건 전부 조사
  완료.** isError 필터 적용 후 8건 중 4건 완전 해소(원 5건 때 1/5였던
  것보다 훨씬 나음), 나머지 4건은 여전히 `unresolved_corrupt`(유통량
  초과 수준은 아님 — `0xd0a6e6c5`와 달리 EXCLUDE_ADDRESSES 자동 추가
  대상 아님, 다만 `0x582e3d8d`는 peak의 8.8배라 추가 후보로 제안·승인
  대기). 상세는 `EVASION_ANALYSIS.md` "known_outliers.csv 이상치 8건
  조사 완료" 절 참고. `known_outliers.csv`에 더 이상 `unreviewed` 항목
  없음.

## scenarios/ 폴더 상태 점검 (2026-08-30)

`scenarios/generate_scenarios.js`(+ `param_ranges.js`)로 유형당 5개씩
총 25개 파라미터 시나리오(`scenarios/generated/*.json`)가 생성되어
있었으나, 이게 실행 파이프라인과 연결되어 있는지 불확실하다는 문제
제기가 있어 추적했다.

- **결론: 파이프라인은 코드 레벨에서 완전히 연결되어 있다.**
  `run_scenario.js`가 `generated/{id}.json`의 params를 `SCENARIO_*`
  환경변수로 변환해 해당 `scripts/simulate_*.js`를 hardhat으로 실행하고,
  `scripts/simulate_ponzi.js` 등에서 실제로 이 환경변수들을
  (`process.env.SCENARIO_PARTICIPANTS` 등) 읽어 쓰는 것을 코드로 확인했다.
  `run_all_scenarios.js`는 25개 전부를 순회 실행한 뒤 각 결과 CSV를
  `analysis/static_analyzer.js`/`dynamic_analyzer.js`/`trust_scorer.js`/
  `prevention_reasoner.js`(전부 최상위 `analysis/`, 4개 파일 모두 실존
  확인)에 태워 등급까지 산출하도록 짜여 있다 — "생성만 하고 그 다음이
  없는" 미완성 상태가 아니다.
- **그러나 단 한 번도 실행된 적이 없다.** `scenarios/logs/` 디렉터리
  자체가 존재하지 않는다(출력 0건). git 이력도 없다(전체가 미커밋).
  파일 mtime은 전부 2026-06-05 21:30~21:54 사이 — 같은 세션에서
  집중적으로 작성된 뒤 실행 없이 방치된 것으로 보인다.
- **문서상 근거**: `온톨로지_설계서_v0.1.docx`(Downloads에만 있고 이
  저장소에는 없어 8-1절 원문을 직접 확인하지 못함)의 "시뮬레이션 데이터
  편향" 해소용이라는 추정은 코드 자체(유형별 파라미터를 `min~max` 범위
  내에서 무작위 샘플링)로 뒷받침되지만, 명시적 문서 인용은 찾지
  못했다 — 설계서를 이 저장소로 옮겨주시면 재확인 가능.
  **(2026-08-30 갱신)** 이후 세션에서 설계서 원본을 저장소 루트에
  확보했다(`온톨로지_설계서_v0.1.docx`, 아래 "설계서 저장소 반영" 절
  참고). 8-1절 한계 표를 직접 확인한 결과 "시뮬레이션 데이터 편향"이
  첫 항목으로 정확히 등재되어 있어, 위 추정이 옳았음이 확인됐다.
- **시점 관계**: 이 파이프라인은 2026-06-05에 작성됐고, 그 다음날
  (06-06) `dynamic_analyzer.js`의 대규모 개선이, 약 7주 후(07-24)부터
  XBlock 실데이터(N=272) 비교실험이 시작됐다. 즉 **실데이터 검증이라는
  더 강력한 대안이 이미 확보된 이후에는 이 파이프라인이 쓰이지 않은
  것**으로 보인다.
- **판단: (a)와 (b)의 중간 — 조건부 (a) 권고.** 실데이터(N=272)의
  대체재로서는 이미 필요성이 낮다(그쪽이 외적 타당도가 훨씬 높음).
  다만 이 파이프라인의 본래 강점은 실데이터로는 할 수 없는 것 —
  **파라미터를 통제한 민감도 분석**(예: "reward_rate가 얼마일 때
  BALANCE_DROP이 침묵하는가")이다. 이는 오늘 진행한 "미명명
  disagreement 원인 분석"과 정확히 같은 종류의 질문이라, 향후 v3 규칙의
  경계 조건을 체계적으로 스트레스테스트하는 용도로 재활용할 가치가 있다.
  단, 한 번도 실행되지 않은 코드이므로 먼저 **smoke test 1회 실행**으로
  실제 동작을 확인하는 것이 선행되어야 한다. (b)처럼 삭제/archive하기엔
  코드가 이미 완성돼 있어 아깝고, (c)처럼 판단을 미루기엔 이미 충분한
  근거를 확보했다고 판단해 (a)로 보고한다.

### smoke-test 실행 결과 (2026-08-30) — 코드는 정상, 환경설정이 문제였음

유형별 1개씩 5개(ponzi/rugpull/laundering/pumpdump/normal_001) 실행 완료.
**생성→파라미터 전달→시뮬레이션→로그→분석 체인 전체가 정상 작동한다.**
막혔던 건 전부 이 머신의 환경설정: (1) 프로젝트가 UNC 경로에 있어
`run_scenario.js`의 `execSync`가 거치는 `cmd.exe`가 작업 디렉터리를 못
잡음, (2) WSL의 `PATH`가 Windows용 `npx`/`npm`을 앞에 둬서 같은 문제가
WSL 안에서도 재현됨, (3) WSL 시스템 node가 v18(Hardhat은 22.10+ 요구) —
nvm에 22.22.2 있지만 비대화형 셸엔 자동 로드 안 됨(`ETHERSCAN_API_KEY`와
동일 패턴). PATH에 nvm node22 경로를 앞세우고 `npx` 대신
`./node_modules/.bin/hardhat`을 직접 호출하는 것으로 전부 우회됨(코드는
안 고침). 25개 전체 정식 실행 전 이 환경설정을 먼저 정리하거나 매번
수동 우회해야 함 — 상세 및 **다음 결정사항(전체 25개 실행 여부는 이번엔
보류)**은 `EVASION_ANALYSIS.md`의 "scenarios/ smoke-test 결과" 절 참고.

**중요한 신규 발견**: normal_001(정상 스테이킹, label=0)이 dynamic_analyzer
재실행에서 **HIGH_RISK/76으로 오탐**됐다 — 19명이 자기 주소로 정확히
언스테이킹했는데도(주소 겹침 100%) 금액이 0.55~2.59 ETH로 갈려(4.69배)
`isOrganicUnstake`의 균등성 조건(≤2.5배)을 못 넘어 게이트가 뚫렸다. 이는
바로 위 "Phase 1.5/2" 절에서 실데이터로 확인한 것과 **완전히 동일한
메커니즘을 순수 합성 시나리오(주소 문제 전혀 없음)에서도 재현**한
것으로, "진짜 병목은 주소가 아니라 균등성 조건"이라는 결론에 대한
독립적인 두 번째 증거다.

**작업 중 사고 및 즉시 복구**: 5개 실행 중 `scripts/simulate_*.js`가
`analysis/logs/{ponzi,rugpull,laundering,pumpdump,normal}_log.csv`에
덮어쓴다는 걸 뒤늦게 인지 — 이 5개는 이번 세션 내내 회귀 테스트
기준선으로 써온 파일들이다. 실행 직후 발견해 `git checkout --`으로
커밋 `d50568b` 기준과 정확히 일치하도록 즉시 복구했다. **앞으로 이
scenarios 파이프라인을 다시 돌릴 때는 먼저 `analysis/logs/`를 백업하거나
시나리오별 출력 경로로 분리할 것.**

## DEX_WHITELIST — HopLaundering bothSides 오탐 완화 (2026-08-30)

`MoneyLaundering_HopLaundering` 서브클래스(경유 지갑 판정, `analysis/
dynamic_analyzer.js` 변경 전 439-444번 줄)는 순수 집합 멤버십
비교(`hopAddrs>=1 AND bothSides>=2`)만 한다는 걸 재확인했다. 죽은
코드로 이미 확인된 `analysis/analysis/dynamic_analyzer.js`(중첩,
별도 git 저장소) 쪽 동일 로직은 건드리지 않았다.

- **조사**: EthereumHeist 파일럿(n=8, `evaluation/hoplaundering/`)에서
  SET조건 충족 2건 중 BELLE Honeypot Rug Pull 케이스의 bothSides
  3개 중 2개가 Uniswap V2: Router 2 / 0x: Exchange Proxy로 확인됐다
  (기존 파일럿 리포트의 "1inch Router" 표기는 오류 — Etherscan
  재확인 결과 0x Protocol이 맞음, 정정함). N=272 XBlock 실데이터에는
  주소 단위 데이터 자체가 없어 이 조건이 발동한 적이 없다 — 이번
  발견은 실증된 오탐이 아니라 메커니즘 차원의 잠재 위험으로 기록.
- **구현**: `analysis/dynamic_analyzer.js` 상단에 하드코딩 `DEX_WHITELIST`
  (2개 주소)를 추가하고 bothSides 필터에서 제외, 제외 시 `console.log`로
  노출(기존 `EXCLUDE_ADDRESSES` 투명성 관례와 통일). 범위는 이번에
  실증된 2개 주소로 한정 — n=8 규모를 근거로 과확장하지 않음.
- **회귀 확인**: BELLE 케이스 HopLaundering 점수 100→0(bothSides
  3→1로 트리거 조건 자체가 깨짐), Plus Token Ponzi 1은 100→100 불변.
  기존 6개 컨트랙트+3개 회피 시나리오(`compare_evasion.js`)와 N=272
  실데이터(`evaluate_comparison.js`, EXCLUDE_ADDRESSES 기존 설정 유지)는
  변경 전후 출력이 byte-identical — 회귀 없음.
- **문서**: 온톨로지 설계서(`온톨로지_방법론_letter.docx`)는 바이너리라
  이 세션에서 직접 편집하지 않고 `ontology/CHANGELOG_v0.3.md`에 별도
  기록(수동 반영 위치 명시). 상세는 `EVASION_ANALYSIS.md`의
  "DEX_WHITELIST — HopLaundering bothSides 오탐 완화" 절 참고.

## 대시보드 조사 + Panel 5 "탐지 근거" 구현 (2026-08-30)

- **정본 파일**: `analysis/dashboard.html`이 유일한 정본. `analysis/
  analysis/dashboard.html`(별도 중첩 git 저장소, 죽은 코드)은 함수
  인벤토리가 완전히 동일한 방치된 복제본일 뿐 — 두 파일 다 git
  이력이 초기 업로드 커밋(`fc9aa60`) 하나뿐, 이후 수정 없음.
- **mock vs 실데이터 경계**: L0/Panel 1~4/renderL1() 초기 렌더링은
  전부 하드코딩 `RAW_DATA`(주석: "Sample Data")를 클라이언트 JS로
  재계산한 것. 실 파이프라인 데이터는 `loadReport()` 함수 하나(주석
  "PIPELINE REPORT LOADER")만 사용하며, L1의 Trust Score 일부 필드와
  pipe-strip만 덮어썼음 — `prevention.ontology_reasoning_chain`은
  전혀 미연결이었음(이번에 Panel 5로 연결).
- **`checklist` vs `ontology_reasoning_chain` 구분**: `prevention_reasoner.js`는
  평문 서사 로그(`ontology_reasoning_chain`, 문자열 배열)와는 별도로
  구조화된 `checklist` 배열(`id/label/detected/riskWeight/evidence/
  consequence/fix`)을 반환한다 — 조건 충족/미충족 UI에는 checklist가
  원본 소스로 더 적합.
- **`trust_scorer.js`의 "블랙리스트 연관도"/"스캠 연루 이력" 축은
  실제 외부 평판 데이터가 아님**: 둘 다 `isDrainer`/`profitRatio`라는
  같은 온체인 신호에서 파생된 값이며, 진짜 블랙리스트 DB 조회는 코드
  어디에도 없다(`s_blacklist = isDrainer?0:100`, `s_scam =
  (profitRatio>1.3||isDrainer)?0:100`). 이번엔 로직은 안 건드리고
  Trust Vector 카드에 캡션만 추가했다 — 축 자체의 재설계는 Panel
  1~4 mock→실데이터 전환 때 함께 판단하기로 함.
- **"8-1절/8-2절" 인용 불일치**: 사용자가 인용한 절 번호가 저장소의
  두 docx(`온톨로지_방법론_letter.docx`와 그 백업)에 존재하지 않음 —
  둘 다 1~6절 구조뿐(회피 공리는 3.4절, UI 미연결 서술은 5절). 이전
  세션이 이미 기록해둔 "8-1절 원문은 Downloads의 `온톨로지_설계서_
  v0.1.docx`에만 있고 이 저장소엔 없음"과 일치 — 저장소 밖 문서를
  가리키는 것으로 보임.
  **(2026-08-30 갱신)** "저장소 밖 문서"였던 `온톨로지_설계서_v0.1.docx`
  를 이후 세션에서 저장소 루트에 확보했다(letter.docx와는 별개 파일,
  9절 구조: 1 개요/2 설계원칙/3 클래스계층/4 관계/5 공리/6 비정상판단
  시나리오/7 검증결과/8-1·8-2 한계및향후계획/9 버전이력). 사용자가
  인용해온 "8-1절/8-2절"은 정확한 인용이었음이 확인됐다 — 불일치는
  letter.docx(6절 구조)와 설계서(9절 구조)가 서로 다른 두 문서였기
  때문이었다. 상세는 "설계서 저장소 반영" 절 참고.
- **Panel 5 구현**: 상세는 `ontology/CHANGELOG_v0.3.md`의 "대시보드
  Panel 5 '탐지 근거'" 절 참고. 요약: 기존 `openPanel`/`renderPanel`/
  `P_TITLES` 패턴을 그대로 확장(신규 아키텍처 없음), prevention/dynamic
  2탭 구조, `analysis/reports/*.json` 5개가 evasion 필드 없는 구버전
  스냅샷이라 재실행으로 갱신함. 헤드리스 Edge(CDP)로 실제 렌더링
  검증 — Playwright 등 설치가 안 돼 있어 `msedge.exe
  --remote-debugging-port` + Node 내장 WebSocket으로 임시 드라이버를
  짜서 사용했다(재사용 가능한 스크립트는 리포지토리에 남기지 않음).

## 설계서(온톨로지_설계서_v0.1.docx) 저장소 반영 (2026-08-30)

이전 세션들이 "저장소 밖 문서"로 반복 기록해온 `온톨로지_설계서_v0.1.docx`
원본을 사용자가 이번 세션에 제공해 저장소 루트에 확보했다(letter.docx와
동일한 위치, 파일명은 그대로 유지해 구분).

- **구조 확인**: 9절 — 1(문서 개요, 1-1~1-3) / 2(설계 원칙, 2-1 목적
  관점 3가지·2-2 JS/OWL 레이어 분리) / 3(클래스 계층, 3-1~3-3) /
  4(관계 정의, 4-1~4-3) / 5(공리, 5-1~5-5) / 6(비정상 판단 시나리오
  도출) / 7(검증 결과) / 8(한계 및 향후 계획, 8-1 현재 구현 한계·8-2
  버전별 향후 계획) / 9(버전 이력). 이전 세션들이 인용해온 "8-1절/
  8-2절", "5-3절 대응 탐지 표" 등은 **전부 이 문서를 정확히 가리키고
  있었음**이 확인됐다 — letter.docx(6절 구조, 별개 문서)와 혼용되어
  "저장소 docx와 불일치"로 잘못 기록됐던 것.
- **2-1절 "목적 관점 3가지" 표 원문** — 예방(Prevention)/완화
  (Mitigation)/대응(Response) 3행 구조:
  - 예방: "컨트랙트 자체가 문제" → "사기 패턴을 지식으로 저장 →
    추론으로 배포 전 분류"
  - 완화: "실행되더라도 피해 최소화" → "탐지 근거를 사용자에게
    시각화 → 사전 경고"
  - **대응: "사후 어떻게 대처할지" → "새로운 패턴 발견 시 온톨로지에
    추가 → 다음 탐지에 활용"**
- **8-2절 버전별 계획 원문**: v0.1(현재, 파이프라인 구축) / v0.2(실데이터
  검증 + 관계추론 강화, triggers/implies 반영·FullEvasion 재검토) /
  **v0.3(UI 연결 + 대응 레이어 추가 — "reasoning_chain 대시보드 시각화,
  response_reasoner.js 구현, 피드백 루프 구축")**. `ontology/
  CHANGELOG_v0.3.md`가 letter.docx 5절 인용만으로 재구성해뒀던 v0.3
  로드맵 내용과 정확히 일치함을 원문으로 재확인.
- **hoplaundering_review.md·fullevasion_check.js의 "5-3절/8-1절" 인용은
  검증 결과 정확했다** — 수정하지 않음(아래 참고).

## response_reasoner.js 범위 정의 조사 (Phase 1, 2026-08-30)

설계서 v0.3 로드맵 항목인 `response_reasoner.js`(사후 대응 추론기, 위
"설계서 저장소 반영" 절의 2-1절/8-2절 인용 참고)의 구현 범위를 정하기
위한 선행 조사. 코드/설계는 진행하지 않고 조사 + 범위 제안까지만 수행.

- **사람이 수작업으로 해온 "발견→대응" 사례 3건 정리**: (1) 미명명
  disagreement 패턴 분석(`EVASION_ANALYSIS.md`의 "v3에서 새로 나타난
  미명명 disagreement 패턴" 절, 신규 오탐 27건/신규 포착 18건 원인을
  `dynamic_analyzer.js` 개별 재실행으로 추적 → 권고만 작성, 코드 미반영),
  (2) `hoplaundering_review.md`(설계서 5-3절 "대응 탐지" 항목의 구현
  여부 조사 → 선행조건 부재 확인, 문서 반영 권고만), (3) 이번 세션의
  DEX_WHITELIST(발견은 자동화 어려웠지만 검증·회귀테스트는 스크립트로
  가능했던 사례). 세 사례 모두 "①수집→②원인특정→③패턴추출→④수정안
  제시→⑤사람승인→⑥반영→⑦회귀테스트"의 반복 절차를 보였고, **④→⑤ 사이
  승인 없이 반영된 사례는 하나도 없었다.**
- **결론 — 완전 자동화(온톨로지 파일 자동 수정) 배제 원칙 채택 권고**:
  `response_reasoner.js`는 "패턴 감지 + 수정안 제안"까지만 하고, 실제
  온톨로지/코드/문서 반영은 항상 별도 승인을 거치도록 설계할 것을 제안.
  기존 워크플로우를 그대로 코드화하는 것에 가까움.
- **MVP 후보**: (A, 우선순위 높음) `evaluate_comparison.js` 재실행 시
  `disagreement_cases.csv`를 직전 실행분과 비교해 신규 오탐/신규 포착을
  규칙별(`triggered_rules`)로 자동 집계하는 요약기 — 사례 (1)에서 사람이
  수작업으로 한 절차와 가장 직접적으로 대응되고, 기존 csv에는 규칙 단위
  귀속 정보가 없어 이 부분만 신규 구현 필요. (B) `known_outliers.csv`
  스타일 이상치 트리아지 초안 자동화 — 범위가 좁아 2순위.
  Phase 2(설계)는 다음 세션으로 이월.

## 네트워크 시각화 Phase 1 — v2_clean272 참조 금지 (2026-09-09)

`evaluation/network_viz/`(온톨로지 네트워크 그래프 시각화, Fig.3 스타일)
Phase 1 데이터 준비 중 발견.

- **`evaluation/ponzi_comparison/results/ontology_predictions.csv` 및
  `comparison_report_v2_clean272.md`는 `dynamic_analyzer.js`의 회피 내성
  패치(연속 점수화, "권고 1-7" — 위 "회피 시뮬레이션 패치" 절 참고) 이전
  스냅샷이며, 현재 코드 상태와 불일치한다.** 직접 재확인: `reasoning_raw.json`
  생성 시 현재 `dynamic_analyzer.js`/`fraud_ontology.js`를 그대로 재실행해
  N=272 전체의 final_exact_pred/final_super_pred를 다시 계산한 결과
  (정확 155건/상위 196건)가 v2_clean272의 수치(정확 88건/상위 129건)와
  전혀 다르고, **`comparison_report_v3_patched.md`(정확 155건→Precision
  64.52%/Recall 73.53%/F1 68.73%, 상위 196건→57.65%/83.09%/68.07%)와
  정확히 일치했다.**
- **역산 검증 완료**: `온톨로지_방법론_letter.docx`(zipfile로 word/document.xml
  직접 추출, docx 뷰어 없이 텍스트 확인)의 "표 1. XBlock 실데이터(N=272)
  비교 검증 결과"에 실린 온톨로지(정적 OR 동적) 수치가 Exact
  64.52%/73.53%/68.73%, Superclass 57.65%/83.09%/68.07%로
  v3_patched와 **완전히 일치**한다. 즉 논문에 실제로 인용된 것은
  v3_patched이며, v2_clean272는 이미 폐기된 중간 산출물이다.
- **앞으로 이 데이터셋(N=272 XBlock 폰지 비교) 언급 시 반드시
  `comparison_report_v3_patched.md` 또는 재실행 결과(`evaluation/
  network_viz/reasoning_raw.json`) 기준으로 작업할 것 — `ontology_predictions.csv`와
  `comparison_report_v2_clean272.md`는 참조 금지.**

## Known issues

- **NormalStaking 오탐성 예측 신호**: `analysis/analysis/prevention_reasoner.js`의
  triggers/implies 예측 로직에서 NormalStaking 컨트랙트에 대해
  `ParticipantMidExit → FlowSpike` 예측 신호가 발동한다(정상적인 unstake 동작이
  ParticipantMidExit 프록시 패턴과 겹치기 때문). 이 예측 신호는 `hasSignal`이 아닌
  `triggers`/`implies` 엣지로만 연결되어 있어 실제 분류 결과(정상 판정)에는 영향을
  주지 않는다. 다만 향후 대시보드 시각화(Phase 5, UI 연결) 시 이 예측 신호가
  사용자에게 오탐처럼 보이지 않도록 표시 방식에 주의가 필요하다.

## OWL/SWRL 4개 파일 직접 검증 결과 (2026-09-11)

`ontology/fraud.owl`, `fraud_with_instances.owl`, `fraud_with_rules.owl`,
`fraud_reasoned.owl` 네 파일과 `온톨로지_설계서_v0.2.docx`,
`온톨로지_방법론_letter.docx`를 직접 열어(docx는 zipfile로 word/document.xml
추출) 대조 검증했다. 아래는 중요도 순 정리이며, 제기됐던 초기 초안 중 일부
수치(인스턴스 개수)는 실제 파일과 달라 본 절에서 바로잡았다.

### 1. [최우선] triggers/implies: OWL 규칙은 "선행 신호 필요", JS 레이어는 "순수 예측" — 서로 다른 두 구현이 "1:1 대응"이라 주석에 잘못 기재됨

- `fraud_with_rules.owl`의 인과관계 SWRL 규칙 5개(파일 내 1~5번째 `<swrl:Imp>`,
  예: `Trig_SingleLargeOutflow`)는 body에 `hasPattern(c,p)∧SingleLargeOutflow(p)`
  뿐 아니라 `hasSignal(c,s)∧MaxTxAlert(s)`처럼 **결과 신호가 이미 인스턴스로
  존재할 것**을 요구한다. 즉 이미 공존하는 두 사실에 인과관계 라벨만 얹는
  방식이며, 온톨로지_방법론_letter.docx 3.2절의 "추론기가 행동 패턴만
  관측해도 파생될 이상 신호를 예측할 수 있는 구조를 v0.2에서 반영할
  계획"이라는 서술과는 형식적으로 다르다.
- 그런데 **`fraud_reasoned.owl`에는 이 OWL 규칙만으로는 나올 수 없는
  개체가 실제로 존재한다**: `sig_predicted_maxtxalert_rugpull`,
  `sig_predicted_maxtxalert_laundering`, `sig_predicted_flowspike_pumpdump`,
  `sig_predicted_flowspike_normal` (라인 574-588). `MaxTxAlert` 타입 개체는
  `fraud_with_instances.owl`/`fraud_with_rules.owl` 어디에도 사전 인스턴스가
  **단 하나도 없고**, `contract_normal`은 애초에 `hasSignal` 자체가 하나도
  없는데도(`hasPattern`만 5개) `pat_midexit_normal`에 `triggers →
  sig_predicted_flowspike_normal`이 붙어 있다. 표준 SWRL/DL 추론기는 head에서
  새 개체를 생성할 수 없으므로, 이 4개 개체는 `fraud_with_rules.owl`의
  규칙을 실제로 실행해서 나온 결과일 수 없다 — 즉 `fraud_reasoned.owl`을
  "Pellet/HermiT 추론기 실행 결과"(설계서 1-2절, 7-3절)라고 부르는 것 자체가
  이 4개 개체에 한해서는 사실과 다르다.
- 진짜 출처는 JS 레이어다: `analysis/analysis/prevention_reasoner.js:58-63`
  주석에 "OWL 레이어의 triggers/implies SWRL 규칙과 1:1 대응"이라고
  적혀 있지만, 바로 아래 `predictCausalSignals()` 함수(64행~)는 소스코드에서
  BehaviorPattern의 정적 프록시(정규식)만 매치되면 **대응 AnomalySignal이
  실제로 관측됐는지와 무관하게** 예측을 발동시킨다 — 이게 바로 letter
  3.2절이 묘사한 동작이다. 요컨대 letter 3.2절의 "예측" 서술은 JS 레이어
  기준으로는 맞고, OWL/SWRL 레이어 기준으로는 틀리다. 두 레이어가 같은
  기능을 다르게 구현해놓고 "1:1 대응"이라 주석 처리한 것 자체가 문서화
  오류이며, `fraud_reasoned.owl`의 predicted 개체 4종은 이 JS 결과를 OWL로
  내보내면서 섞여 들어간 것으로 보인다(내보내기 스크립트 자체는 미확인).
- **영향**: (a) letter 3.2절은 "수정 필요"가 아니라 "어느 레이어 기준인지
  명시 필요"로 재분류해야 함. (b) 설계서 1-2절/7-3절의 "fraud_reasoned.owl =
  Pellet/HermiT 실행 결과" 서술은 최소 4개 개체에 대해 부정확 — 순수 SWRL
  산출물과 JS 예측 산출물이 한 파일에 섞여 있음을 명기할 필요. (c) 위 "Known
  issues"의 NormalStaking 오탐 신호 항목도 JS 레이어뿐 아니라 OWL
  파일(`fraud_reasoned.owl`)에도 동일하게 새어 들어가 있다는 뜻이므로 범위를
  넓혀 인지할 것.
확인 완료, 추가 조치는 팀 논의 후 결정

### 2. [운영] OWL 관련 파일 4개 분리 + 인스턴스 개수 정정

- 실제 구조: `fraud.owl`(스키마만, `<owl:NamedIndividual>` 0개·`<swrl:Imp>`
  0개) / `fraud_with_instances.owl`(스키마+인스턴스 **41개**, 규칙 0개) /
  `fraud_with_rules.owl`(스키마+인스턴스 41개+규칙 **13개**) /
  `fraud_reasoned.owl`(전체+추론후 인스턴스 **45개**+규칙 13개). 개수는
  `grep -c "<owl:NamedIndividual"` / `<swrl:Imp>` 직접 카운트로 확인했다
  (초기 보고됐던 "82개/90개"는 실제 파일과 불일치 — 41/45가 맞는 수치다).
  `fraud_reasoned.owl`의 +4개는 위 1번 항목의 predicted 신호 개체들이다.
- 설계서_v0.2.docx 1-2절 표는 OWL 관련 항목으로 "표준 OWL 파일=fraud.owl
  (W3C OWL 표준 포맷, 학술 근거 레이어)"와 "SWRL 추론 결과=fraud_reasoned.owl
  (Pellet/HermiT 추론기 실행 결과)" 2개 행만 두고 있고, `fraud_with_instances.owl`·
  `fraud_with_rules.owl`은 표에 아예 등장하지 않는다 — 정확히는 "규칙 정의"라는
  표현이 쓰인 건 아니고 fraud.owl의 역할 설명이 스키마/인스턴스/규칙 구성을
  구분하지 않고 뭉뚱그려져 있는 것이다. SWRL 규칙 자체를 찾으려면
  `fraud_with_rules.owl` 또는 `fraud_reasoned.owl`을 봐야 한다.
확인 완료, 추가 조치는 팀 논의 후 결정

### 3. [설계서 보완] 5-5절 SWRL 규칙 표는 5개, 실제 분류 규칙은 8개(총 13개 중 인과관계 5개 제외)

- 설계서 5-6절(인과관계 5개: Trig_OwnerWithdrawAll/Trig_SingleLargeOutflow/
  Trig_ParticipantMidExit/Imp_InsiderBulkDeposit/Imp_WithdrawAttemptFail)은
  `fraud_with_rules.owl`의 첫 5개 `<swrl:Imp>`와 정확히 일치한다.
- 그러나 나머지 8개 분류 규칙 중 5-5절 표에 실린 것은 Rule_RugPull,
  Rule_PonziScheme, Rule_MoneyLaundering, Rule_HoneyPot, Rule_RugPull_SlowDrain
  5개뿐이다. 표에서 누락된 3개:
  - `FraudContract(c)∧hasPattern(c,p1)∧InsiderExitSuccess(p1)∧hasPattern(c,p2)∧
    WithdrawAttemptFail(p2) → PumpAndDump(c)` — PumpAndDump 기본분류 규칙.
    다만 이 조건 자체는 7-3절 표("contract_pumpdump: ... InsiderExitSuccess +
    WithdrawAttemptFail (2-iter 승격)")에 비형식적으로는 언급돼 있다.
  - `PumpAndDump(c)∧hasPattern(c,p1)∧InsiderExitSuccess(p1)∧hasPattern(c,p2)∧
    DistributedInflow(p2) → PumpDump_MaxTxEvasion(c)` — 5-5절 각주("※
    PumpDump_MaxTxEvasion은 Iteration 2에서 승격됨")로만 존재를 암시할 뿐
    실제 body는 어디에도 기재돼 있지 않다.
  - `PonziScheme(c)∧hasPattern(c,p)∧ParticipantMidExit(p)∧hasSignal(c,s)∧
    InflowStop(s) → PonziScheme_MaxTxEvasion(c)` — 설계서 어디에도 전혀
    언급이 없다.
확인 완료, 추가 조치는 팀 논의 후 결정

### 4. [설계서 정정] 5-5절 규칙 3건의 body 조건이 실제 SWRL과 다름

- **Rule_RugPull**: 문서 = `hasSignal(BalanceDrop)∧hasPattern(OwnerWithdrawAll)∧
  hasSignal(MaxTxAlert)`. 실제(`fraud_with_rules.owl` 12번째 `<swrl:Imp>`) =
  `hasSignal(BalanceDrop)∧hasPattern(OwnerWithdrawAll)∧hasPattern(SingleLargeOutflow)`
  — 세 번째 조건이 `hasSignal(MaxTxAlert)`가 아니라 `hasPattern(SingleLargeOutflow)`.
- **Rule_PonziScheme**: 문서 = `hasSignal(BalanceDrop)∧hasSignal(FlowSpike)∧
  hasPattern(ParticipantMidExit)`. 실제(13번째 `<swrl:Imp>`) =
  `hasSignal(BalanceDrop)∧hasPattern(OwnerWithdrawAll)∧hasPattern(ParticipantMidExit)`
  — 두 번째 조건이 `hasSignal(FlowSpike)`가 아니라 `hasPattern(OwnerWithdrawAll)`.
- **Rule_MoneyLaundering**: 문서 = 2조건(`hasPattern(DistributedInflow)∧
  hasPattern(SingleLargeOutflow)`). 실제(11번째 `<swrl:Imp>`) = 3조건
  (`hasPattern(DistributedInflow)∧hasPattern(CollectorIsDepositor)∧
  hasPattern(SingleLargeOutflow)`) — `CollectorIsDepositor` 조건이 문서에서
  누락됨.
- **Rule_HoneyPot**·**Rule_RugPull_SlowDrain**은 문서와 실제 body가 정확히
  일치함을 확인했다(불일치 없음).
확인 완료, 추가 조치는 팀 논의 후 결정

### 5. [경미] 3-1절 클래스 계층 트리에서 회피 서브클래스 3개 누락

- 설계서_v0.2.docx 3-1절 트리 그림에는 `PumpDump_BalanceDropEvasion`,
  `MoneyLaundering_BalanceDropEvasion`, `MoneyLaundering_MaxTxEvasion`이
  빠져 있다(PumpAndDump 아래 3개만, MoneyLaundering 아래 2개만 표시).
  같은 문서 3-3절 본문("공통 3종 — PonziScheme/RugPull/MoneyLaundering/PumpDump
  전체 적용")과 `fraud.owl` 실제 클래스 정의(해당 3개 클래스 모두 존재,
  `#PumpDump_BalanceDropEvasion` 등)에는 이 3개가 정상적으로 포함돼 있어,
  트리 그림만 축약되어 그려진 것으로 보인다.
확인 완료, 추가 조치는 팀 논의 후 결정

## GTN2vec 데이터셋 조사 — MoneyLaundering 실데이터 검증 1단계 (2026-09-14)

`evaluation/laundering_comparison/data/GTN2vec` 조사 완료. 결론: **부분호환**
(사실상 규칙11은 불호환)으로 보류, 변환/평가 파이프라인은 아직 작성하지 않음.

- git 최신 커밋엔 코드(`GTN2vec.py`, `GTN2vec_walk.py`)와 라벨(`mllabel.txt`)만
  있고 실제 그래프 데이터는 없었다 — 과거 커밋(`6367045`)에서 삭제된
  `dataset.rar`를 `git show`로 복구해서 확인함(RAR5 포맷, WSL에 없던 `unrar`을
  받아서 해제).
- 노드 = 익명화된 정수ID(hex 주소 매핑 없음), 엣지 = (발신, 수신, gas가격,
  timestamp)만 존재 — **금액(value) 컬럼이 논문에서 의도적으로 제외됨**
  ("gas price가 거래금액보다 자금세탁 구분에 유효하다"는 저자 판단, 원 논문
  "Graph Embedding-Based Money Laundering Detection for Ethereum", *Electronics*
  2023, 12, 3180 확인).
- 라벨(815/815)은 일반 자금세탁이 아니라 **2019 업비트 해킹 단일 사건 태그**
  (Etherscan "Upbit Hack" 태그) — 위 "외부 데이터 소스 (EthereumHeist)"
  섹션과 동일한 "단일사건 라벨 스코프" 문제가 재발. 자금세탁 실데이터 전반의
  구조적 한계일 가능성으로 기록해 둔다.
- `fraud_with_rules.owl` 규칙11(`DistributedInflow ∧ CollectorIsDepositor ∧
  SingleLargeOutflow`) 중 `DistributedInflow`(5개 이상 고유 입금주소)만
  위상정보로 계산 가능, 나머지 2개는 "최대 인출" 판정에 금액이 필요해 계산
  불가 → AND 규칙 전체를 이 데이터로 평가할 수 없다.
- 미해결 항목(우선순위 낮음, 필요시 재확인): 노드 수 6% 불일치(실측 48,237 vs
  논문 45,585), 논문 서술("2-order")과 실제 파일명(`1ordertrans_*`) 불일치.
- **향후 자금세탁류 데이터셋 검토 시 먼저 체크**: (1) 라벨이 단일 사건의
  파생물인지, (2) 거래 금액 컬럼이 실제로 존재하는지 — 이 두 가지를 먼저
  확인하면 이번처럼 깊이 파고든 뒤에야 막히는 상황을 방지할 수 있다.
확인 완료, 추가 조치는 팀 논의 후 결정

## CRPWarner RugPull 데이터셋 조사 결과 (2026-09-14)

`evaluation/rugpull_comparison/data/CRPWarner` 조사 완료. 결론: **불호환**
(GTN2vec보다 근본적, 변환으로 해결 불가).

- CRPWarner는 러그풀 탐지 도구가 아니라 정적 바이트코드 분석(Mint/Leak/
  Limit 함수 존재 여부)이 실제 산출물. 우리 공리(`singleLargeOutflow ∧
  ownerWithdrawAll ∧ NOT participantMidExit`)는 관측된 트랜잭션 행위라
  분석 축 자체가 다름 — 방법론 불일치.
- `rugpullevents.xlsx`(103건, 독립 사건 — 라벨 스코프 문제는 없음)는
  컨트랙트 주소 자체가 없어 즉시 사용 불가. `Loss(kUSD)`도 사건 전체
  추정 피해액이지 개별 트랜잭션 출금액이 아니다.
- 배포자 EOA 주소, 잔고 시계열, 개별 출금 트랜잭션 모두 저장소에
  원천 부재 — 확보하려면 Etherscan 등에서 완전히 새로 수집해야 한다.
- 백업 후보 `Ethereum-BSC-token-dataset`(USENIX Sec'23)도 확인함 —
  토큰 생성 메타데이터뿐이고 러그풀 판정 라벨 자체가 없어 CRPWarner
  보다도 우리 목적에서 더 멀다.
- **실데이터 확장 시도 누적 패턴**: PumpAndDump(단위불일치)/
  MoneyLaundering(라벨스코프+필드부재)/RugPull(방법론불일치) 전부 다른
  이유로 불호환. 성공은 Ponzi(XBlock) 하나뿐. 향후 데이터셋 검토 시
  "우리 온톨로지가 요구하는 원시 트랜잭션+금액+행위라벨" 조건을 가장
  먼저 확인할 것.
확인 완료, 추가 조치는 팀 논의 후 결정

## HoneyPot SelectiveTrap 오분류 버그 수정 (2026-09)

SelectiveTrap(오너만 인출 성공, 나머지 전원 실패)이 `dynamic_analyzer.js`의
동적 우선순위 체인에서 PumpAndDump로 오분류되던 버그를 재현·수정. 데이터
속성 추가(1~2단계) → 재현 확인 → 조건 교체(3단계) 순으로 진행.

- **파일 위치 착오 주의**: `analysis/analysis/fraud_ontology.js`는 클래스/공리/
  체크리스트를 담은 **선언적 데이터 객체**일 뿐 분기 로직(if/else)이 없다
  (grep으로 `Priority`/`allWithdrawalsBlocked`/`insiderExit` 전무 확인). 실제
  동적 로그 분류 우선순위 체인은 `analysis/dynamic_analyzer.js`의
  `hintFraudType()`에 있다. `evaluation/ponzi_comparison/evaluate_comparison.js`·
  `evaluation/network_viz/extract_reasoning.mjs`가 두 파일을 `import('../../analysis/
  dynamic_analyzer.js')`와 `import('../../analysis/analysis/fraud_ontology.js')`로
  **별도 모듈로 병행 import**하는 것으로 역할 분리를 재확인함(전자=동적 분류,
  후자=`prevention_reasoner.js`용 정적 소스 예방 체크리스트). 앞으로 "5-1절/5-2절
  분류 우선순위" 관련 작업은 `dynamic_analyzer.js`를 볼 것.
- **데이터 속성 3종 추가** (`hintFraudType()` 내부, 기존 `insiderExitDetected`
  계산 직후): `withdrawSuccessRate`(성공 출금/전체 출금 시도),
  `nonPrivilegedSuccessRate`(오너 주소 제외 성공률 — 오너는 시뮬레이션 스크립트의
  `ownerClient` 고정 주소 `0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266`로 식별,
  1안), `balanceAtFailure`(기존 `someWithdrawalsFail` 필터, 즉 `amount_eth===0`인
  withdraw 행의 `contract_balance_eth` **최댓값** — 평균이 아니라 최댓값을 쓴
  이유는 오너 드레인 전/후로 실패 시점이 섞이면 평균이 희석되기 때문). 세 값
  모두 `reasoning_steps`와 `analyzeDynamic()` 최상위 반환 필드
  (`withdraw_success_rate`/`non_privileged_success_rate`/`balance_at_failure_eth`)에
  노출.
- **Priority 2(HoneyPot) 조건 교체** (추가가 아니라 대체): 기존
  `allWithdrawalsBlocked ∧ inflowContinues` → `nonPrivilegedSuccessRate ≤ 0.05 ∧
  balanceAtFailure > 0 ∧ inflowContinues`. 기존 "전원 실패" 케이스도
  `nonPrivilegedSuccessRate=0`으로 자동 포함됨을 `honeypot_log.csv` 회귀로 확인.
  스펙에 없던 방어로 `nonPrivilegedWithdrawals.length > 0` 가드를 추가함(비-오너
  시도가 0건일 때 0/0→0으로 계산돼 증거 없이 honeypot 오분류되는 것 방지).
- **Priority 3(PumpAndDump) 조건에 `balanceAtFailure ≤ ε` 추가** — 이번 버그
  수정 자체엔 불필요(Priority 2에서 이미 가로챔)하지만 PumpDump="잔고 0 소진" vs
  Honeypot="잔고 잔존" 대칭을 데이터 정의에도 명시. **ε는 미확정**: `NON_
  PRIVILEGED_SUCCESS_EPSILON=0.05`, `PUMPDUMP_BALANCE_AT_FAILURE_EPSILON=0`
  둘 다 코드에 TODO 주석과 함께 상수로 분리해둠 — 임의로 확정하지 않음, 실데이터
  회귀분석 필요.
- **HoneyPot 2단계 서브클래스 추론 추가**: `withdrawSuccessRate=0` →
  `HoneyPot_UniversalTrap`, `withdrawSuccessRate>0 ∧ nonPrivilegedSuccessRate≤ε` →
  `HoneyPot_SelectiveTrap`. `honeypot_subclass` 필드로 노출(해당 없으면 `null`).
- **`insiderExitDetected`는 미수정**: 오너가 입금 이력 없이 인출하면
  구조적으로 거의 항상 true가 되는 조건이지만(SelectiveTrap류 전반의 일반적
  특성), Priority 2가 Priority 3보다 먼저 실행되는 기존 순서가 이미 올바르므로
  재배치도 불필요했음 — 조건 내용 교체만으로 충분함을 확인.
- **회귀 테스트**: git HEAD(이번 작업 전 커밋 `fa83059`) 버전과 현재 버전을
  동일 CSV 8종(7-1/7-2절은 같은 CSV를 공유하므로 중복 제거) + OWL 인스턴스
  6종(`ontology/owl_results.json`)에 대해 직접 실행 비교. **PumpDump 포함 기존
  7개 결과 전부 불변**, 신규 `analysis/logs/honeypot_selective_log.csv`만
  `pump_and_dump`(버그 재현) → `honeypot`/`HoneyPot_SelectiveTrap`(수정 확인)로
  의도대로 변경됨. OWL 6종은 미수정이라 당연히 불변.
- **OWL 레이어도 동반 수정 완료** (2026-09, 후속 작업) — `fraud.owl`~
  `owl_results.json` 5개 파일 전부 JS와 함께 갱신됨. 4단계 파이프라인
  (`build_ontology.py` → `load_instances.py` → `add_swrl_rules.py` →
  `export_results.py`) 순서대로 재실행해 산출물을 생성 — `fraud_with_rules.owl`
  만 수동 XML 편집하지 않음, 이 프로젝트는 스크립트가 산출물(.owl)을 매번
  새로 생성하는 구조임을 재확인.
  - `Rule_PumpAndDump`(파일 내 9번째 `<swrl:Imp>`) body에
    `balanceAtFailure=0.0`(엄격한 0 비교, ε 미확정 TODO 주석 포함) 조건 추가.
  - `Rule_HoneyPot_SelectiveTrap` 신규 규칙 추가(`withdrawSuccessRate>0 ∧
    nonPrivilegedSuccessRate≤0.05`), 기존 `Rule_HoneyPot`은 불변 — 규칙9
    조건 추가만으로 두 레이어 간 층간 충돌이 해소되는 구조임을 확인함(재배치
    불필요, JS 쪽 수정 때와 동일한 결론).
  - **검증**: JS·OWL 두 레이어가 `balanceAtFailure` 등 3개 값을 "같은 CSV
    원본에서 각자 재계산"하는 방식으로 교차검산하도록 구현 — 기존 6개
    인스턴스 전부 소수점까지 일치, 신규 `contract_honeypot_selective`
    인스턴스에서 양쪽 다 SelectiveTrap 판정이 일치함을 확인.
  - `run_reasoner.py`는 `add_swrl_rules.py`와 별개로 존재하는 낡은 8규칙짜리
    중복 스크립트이며 `export_results.py`가 실제로 읽는 대상이 아님 — 이번
    작업 범위 밖, 기존부터 있던 불일치로 남겨둠(필요 시 별도 정리 대상).
  - SWRL 빌트인(`equal`/`greaterThan`/`lessThanOrEqual`) 수치비교 규칙은
    이번이 이 프로젝트 최초 사례다 — 기존 13개 규칙은 전부 클래스 멤버십
    규칙이었음. Java 미가용 환경이라 실제 추론은 Python forward-chaining
    폴백이 수행하므로 `data_eq`/`data_gt`/`data_le` 분기를 그 폴백 로직에도
    별도로 동기화해야 했음 — **향후 수치비교 규칙을 추가할 때마다 이 폴백
    로직도 함께 갱신해야 함을 기억할 것** (SWRL XML만 고치고 폴백을 빠뜨리면
    선언은 있는데 실제로는 적용 안 되는 상태가 됨).
확인 완료, 추가 조치는 팀 논의 후 결정

## HoneyPot 코드축 서브클래스 추가 — Torres et al. 2019 HoneyBadger 상위 2기법 (2026-09-19)

위 SelectiveTrap(행동 기반, `hasPattern`/`hasSignal`)과 독립된 별도 축 — 컨트랙트
소스코드 자체에 내장된 함정 기법 분류. 신뢰도 점수가 아닌 순수 boolean 판정.

- **채택 기법 2종**: HiddenStateUpdate(해시/시크릿 비교 가드 변수의 write 지점
  ≥2), StrawManContract(msg.sender 송금 후 생성자 주입 컨트랙트 변수에 대한
  고수준 외부호출, 또는 owner 전용 세터로 변경 가능한 주소로의 인접
  delegatecall). Torres et al. 원논문 8기법 중 빈도 상위 2종(실측 382/690·
  101/690건, 합산 커버리지 약 70%)만 채택 — 나머지 6종은 미구현.
- **0단계 조사에서 확인된 선행 오류 정정**: (1) JS 레이어 클래스명은
  `HoneyPot`이 아니라 `HoneypotTrap`(OWL은 `HoneyPot` — 3개 레이어 표기 혼재는
  기존 상태, 이번에 통일 시도 안 함). (2) "지난 세션에 설계 완료"라던
  `hasCodePattern`/`HoneypotCodePattern`은 실제 파일 어디에도 없었음 — 이번에
  처음부터 신규 설계. (3) `prevention_reasoner.js`에는 "기본 유형 확정 후
  2단계 서브클래스" 패턴 자체가 없었음(그 패턴은 `dynamic_analyzer.js`의
  `detectEvasionSubclass()`에만 존재, CSV 로그·신뢰도 점수 기반이라 구조가
  다름) — 복제 아닌 신규 구현.
- **구현**: `fraud_ontology.js`에 `HoneypotTrap.codePatternSubclasses` 신설(boolean
  전용, 기존 `evasionSubclasses`와 스키마 다름). `prevention_reasoner.js`에
  `detectHiddenStateUpdate`/`detectStrawManContract` 함수 추가(순수 정규식+줄
  인덱스, AST 미사용 — 기존 파일 철학 유지), `fraudType==="HoneypotTrap"`일
  때만 2차 분류로 실행, 신규 필드 `honeypot_code_pattern_subclasses`로 노출.
  OWL: `build_ontology.py`에 `HoneyPot_HiddenStateUpdate`/
  `HoneyPot_StrawManContract`/`HoneypotCodePattern`(+ 하위
  `HiddenStateUpdatePattern`/`StrawManContractPattern`)/`hasCodePattern` 추가.
  `load_instances.py`는 CSV가 아니라 `analysis/contracts/Honeypot.sol` 원본을
  직접 읽어 JS와 동일 로직을 Python으로 독립 재구현(교차검산, SelectiveTrap
  때의 `balanceAtFailure` 설계 원칙과 동일). `add_swrl_rules.py`에
  `Rule_HoneyPot_HiddenStateUpdate`/`Rule_HoneyPot_StrawManContract` 및 Python
  forward-chaining 폴백용 `codepattern` check_type 신규 추가.
- **회귀 테스트**: 7개 시뮬레이션 컨트랙트(Honeypot/MoneyLaundering/
  NormalStaking/PonziLab/PonziLabPatched/PumpDump/RugPull) 전부 기존
  risk_score/risk_level/checklist/fraud_type_suspected byte-identical(신규
  필드 추가와 Honeypot의 신규 reasoning_chain 2줄만 diff — 순수 부가 추론
  확인). OWL 파이프라인 4단계 전체 재실행 결과 기존 7개 인스턴스 분류·
  triggers/implies 예측 전부 불변, 신규 규칙 둘 다 발동 안 함(Honeypot.sol은
  두 기법 모두 True Negative).
- **N=272 XBlock 드리프트 조사 (중요, 오판정 정정)**: 커밋 전 최종 확인 과정에서
  `evaluate_comparison.js` 재실행 시 3개 주소(`0x582e3d8d`/`0x9a2e9235`/
  `0x2c2e3baa`)의 예측이 `comparison_report_v3_patched.md` 스냅샷과 달라지는
  것을 발견했다. **최초 가설("이번 세션의 미커밋 `dynamic_analyzer.js` 변경분이
  원인")은 `git stash`로 그 파일만 HEAD로 되돌려 재실행해도 동일한 드리프트가
  그대로 재현되어 틀렸음이 확인됨.** 진짜 원인: 세 주소 전부
  `evaluation/ponzi_comparison/data/known_outliers.csv`에 이미 기록된 항목이며
  (`0x582e3d8d`=unresolved_corrupt, `0x9a2e9235`/`0x2c2e3baa`=resolved_genuine),
  해당 CSV와 `data/logs/*.csv`는 `comparison_report_v3_patched.md`가 생성된
  시점 **이후**의 별도 세션(커밋 `3386f41` "Phase 1.5 이상치 격리", `8e30d32`
  "unreviewed 이상치 8건 조사 완료" — 둘 다 이미 커밋되어 있고 이번 세션과
  무관)에서 `fetch_and_convert.js`의 isError 필터 수정으로 갱신된 것이다. 즉
  `comparison_report_v3_patched.md`가 그 수정 이후 재생성되지 않은 **오래된
  스냅샷**이라 드리프트가 나는 것이며, 이번 SelectiveTrap 세션·HoneyBadger
  코드축 세션 둘 다와 무관하다. 두 세션의 실제 영향은 각각 독립적으로
  `git stash` 대조로 재확인해 완전 불변임을 확인했다(SelectiveTrap: 이 절;
  HoneyBadger 코드축: 아래 항목). **`comparison_report_v3_patched.md` 재생성
  여부는 별도 승인 필요 — 이번 세션에서는 스냅샷을 건드리지 않았다.**
- **HoneyBadger 실데이터 검증** (`evaluation/honeypot_comparison/`,
  `christoftorres/HoneyBadger` 클론): `evaluate_honeybadger.js`로 실제
  `datasets/source_code/{hidden_state_update(164)/straw_man_contract(34)}` +
  `results/evaluation/*.csv` 정답 라벨 대조. 첫 실행에서 두 탐지기 모두
  매치율 100%가 나와 의심했고, 원인은 테스트 하네스가 `{matched,evidence}`
  객체를 boolean으로 오판정한 버그였음(프로덕션 코드 `runPrevention()`은
  처음부터 `.matched`로 정상 접근 — 버그는 평가 스크립트에만 있었음).
  버그 수정 후 `cross_validate.js`로 다른 6개 기법 폴더(총 278개 파일)를
  음성 대조군 삼아 재검증 — 두 탐지기 모두 자기 범주 밖에서는 0% 오탐.
  자기 범주 내에서는 HSU 63/164(38.4%), SMC 초기 0/34 — SMC 0%의 원인을
  추적해 (a) 실데이터 34건 전부 `constructor` 키워드가 없는 구버전(^0.4.18)
  Solidity라 생성자 주입 추출이 전무했던 점, (b) 3/34만 `onlyOwner` 모디파이어를
  쓰고 나머지는 인라인 `require(msg.sender==owner)` 가드를 쓰는 점, (c)
  delegatecall 변종이 생성자 주입 유무에 종속되어 있던 제어흐름 버그를 각각
  수정 → SMC 13/34(38.2%)로 개선. 두 항목 모두 **정밀도 100%(TP/(TP+FP)),
  FP=0** — 원논문 수치(HSU 81.7%, SMC 88.2%)보다 오히려 높은 정밀도이나
  재현율은 38%대로 원논문(둘 다 자체 탐지기 관점 100%에 가까움)보다 크게
  낮음. **정밀-저재현 성향**: boolean 정규식/줄 기반 탐지기가 "canonical"
  형태는 정확히 잡지만 복잡한 변형(예: 송금 대상이 `msg.sender`가 아닌
  호출자 지정 파라미터인 경우)은 놓친다 — 이런 경우까지 잡으려면 과제 명세의
  axiom 문구("msg.sender에게 송금")를 벗어나야 해서 이번 세션에서는 확장하지
  않음(향후 재검토 후보로 기록). 상세 수치는
  `evaluation/honeypot_comparison/results/honeybadger_precision_report.json`.
- **부산물**: `evaluation/honeypot_comparison/data/rcamino`에 이미
  `rcamino/honeypot-detection`(별개 논문 저장소)이 클론돼 있었고 그 안의
  `honeybadger_labels/`에도 HoneyBadger 원 논문의 동일 평가 CSV 8종 사본이
  있음을 발견 — 이번 검증에는 공식 저장소(`data/HoneyBadger/`)를 새로 클론해
  사용, rcamino 쪽은 소스코드가 없어(라벨만 존재) 이번 목적엔 미사용.
  `data/HoneyBadger`·`data/rcamino`는 다른 `evaluation/*_comparison/data/`
  하위 3rd-party 클론(CRPWarner, GTN2vec)과 동일하게 이번 커밋에서 제외 —
  기존 관례(대용량 외부 데이터는 추적 안 함)를 따름.
확인 완료, 추가 조치는 팀 논의 후 결정

## CLAUDE.md 정정 — N=272 드리프트 원인 재정정 (2026-09)

이전 기록("SelectiveTrap 미커밋분이 N=272 드리프트 원인")은 틀렸음.
git stash 재대조 결과 HEAD 상태에서도 동일 드리프트(주소 3개:
0x582e3d8d/0x9a2e9235/0x2c2e3baa) 재현됨 — 이번 세션 커밋 2건과 무관.

진짜 원인: comparison_report_v3_patched.md가 isError 필터 수정
커밋(3386f41, 8e30d32) 이후 재생성되지 않은 낡은 스냅샷. 그 시점 이후
known_outliers.csv/logs/*.csv는 갱신됐으나 리포트만 안 따라감.

**영향 범위 미확인 — 중요**: v3_patched는 letter v0.2 표1 및 8-1절
한계 수치의 근거 파일이었음("v2_clean272는 참조금지, v3_patched만
신뢰"로 이전에 못박음). isError 필터 수정이 판정 결과에 실질 영향을
줬다면 letter 표1 수치 자체가 최신이 아닐 가능성 있음 — 재생성 후
letter 수치와 대조 필요.

v3_patched 재생성은 이번 세션에서 미실행(승인 대기). 다음 세션 우선
처리 항목.

확인 완료, 추가 조치는 팀 논의 후 결정
