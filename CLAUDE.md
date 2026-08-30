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
- **Panel 5 구현**: 상세는 `ontology/CHANGELOG_v0.3.md`의 "대시보드
  Panel 5 '탐지 근거'" 절 참고. 요약: 기존 `openPanel`/`renderPanel`/
  `P_TITLES` 패턴을 그대로 확장(신규 아키텍처 없음), prevention/dynamic
  2탭 구조, `analysis/reports/*.json` 5개가 evasion 필드 없는 구버전
  스냅샷이라 재실행으로 갱신함. 헤드리스 Edge(CDP)로 실제 렌더링
  검증 — Playwright 등 설치가 안 돼 있어 `msedge.exe
  --remote-debugging-port` + Node 내장 WebSocket으로 임시 드라이버를
  짜서 사용했다(재사용 가능한 스크립트는 리포지토리에 남기지 않음).

## Known issues

- **NormalStaking 오탐성 예측 신호**: `analysis/analysis/prevention_reasoner.js`의
  triggers/implies 예측 로직에서 NormalStaking 컨트랙트에 대해
  `ParticipantMidExit → FlowSpike` 예측 신호가 발동한다(정상적인 unstake 동작이
  ParticipantMidExit 프록시 패턴과 겹치기 때문). 이 예측 신호는 `hasSignal`이 아닌
  `triggers`/`implies` 엣지로만 연결되어 있어 실제 분류 결과(정상 판정)에는 영향을
  주지 않는다. 다만 향후 대시보드 시각화(Phase 5, UI 연결) 시 이 예측 신호가
  사용자에게 오탐처럼 보이지 않도록 표시 방식에 주의가 필요하다.
