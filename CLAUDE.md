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

## Known issues

- **NormalStaking 오탐성 예측 신호**: `analysis/analysis/prevention_reasoner.js`의
  triggers/implies 예측 로직에서 NormalStaking 컨트랙트에 대해
  `ParticipantMidExit → FlowSpike` 예측 신호가 발동한다(정상적인 unstake 동작이
  ParticipantMidExit 프록시 패턴과 겹치기 때문). 이 예측 신호는 `hasSignal`이 아닌
  `triggers`/`implies` 엣지로만 연결되어 있어 실제 분류 결과(정상 판정)에는 영향을
  주지 않는다. 다만 향후 대시보드 시각화(Phase 5, UI 연결) 시 이 예측 신호가
  사용자에게 오탐처럼 보이지 않도록 표시 방식에 주의가 필요하다.
