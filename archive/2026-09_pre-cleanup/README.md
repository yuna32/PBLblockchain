# archive/2026-09_pre-cleanup

2026-09-28 저장소 정리(B안 1)로 저장소 루트에서 옮긴 초기 파이프라인 사본.
이동 시점에 어떤 npm script·import·문서 경로도 이 파일들을 참조하지 않았으며
(참조는 이 폴더 안의 파일끼리뿐), `pipeline.js`·`compare_evasion.js`는 이동 전부터
실행 불가 상태였다(아래 참고).

- 이동 기준 커밋: `8f7a5bb` (로컬 태그 `pre-cleanup-20260928`)
- 복원: `git mv archive/2026-09_pre-cleanup/<경로> <경로>`
  또는 `git checkout pre-cleanup-20260928 -- <경로>`
- 비교 방법: "현행과 동일"은 `analysis/` 아래 같은 이름 파일과 **CR 제거 후**
  (`tr -d '\r'`) 비교한 결과다. 이 저장소는 `.git/config`에 `core.autocrlf=true`가
  설정되어 있어 작업트리의 줄바꿈이 파일마다 다르므로 CR 차이는 무시한다.
- 마지막 변경: 파일별 `git log -1 -- <이동 전 경로>` 값.

## 코드·대시보드

| 파일 | 무엇에 쓰였나 | 현행 대응 파일과 비교 | 마지막 변경 |
|---|---|---|---|
| dynamic_analyzer.js | 초기(5월) 동적 분석기. 회피 패치·DEX_WHITELIST·SelectiveTrap 이전 버전(193줄) | `analysis/dynamic_analyzer.js`(764줄)와 **내용이 다름** | 5740a4e 2026-05-22 |
| pipeline.js | 초기 오케스트레이터(정적·동적·신뢰 3단계, prevention 단계 없음) | `analysis/pipeline.js`(`npm run analyze`)와 **내용이 다름**. 이동 전부터 실행 불가 — `PROJECT_ROOT = path.resolve(__dirname, "..")`가 저장소 상위 디렉터리를 가리킴 | 5740a4e 2026-05-22 |
| dashboard.html | Panel 5("탐지 근거") 추가 이전 대시보드. 같은 폴더의 `reports/`를 fetch | `analysis/dashboard.html`(GUIDE.md가 안내하는 정본)과 **내용이 다름** | 5740a4e 2026-05-22 |
| compare_evasion.js | 회피 시나리오 A/B/C 비교 스크립트 | `analysis/compare_evasion.js`와 **동일한 사본**. 이 위치에서는 pipeline.js와 같은 PROJECT_ROOT 문제로 실행 불가 | 5740a4e 2026-05-22 |
| static_analyzer.js | pipeline.js 1단계(소스 규칙 탐지) | `analysis/static_analyzer.js`와 **동일한 사본** | 5740a4e 2026-05-22 |
| trust_scorer.js | pipeline.js 3단계(지갑 신뢰 점수) | `analysis/trust_scorer.js`와 **동일한 사본** | 5740a4e 2026-05-22 |
| visualize.py | 같은 폴더 `logs/`의 CSV를 읽는 시각화 스크립트 | `analysis/visualize.py`와 **동일한 사본** | 5740a4e 2026-05-22 |

## logs/ (시뮬레이션 로그·그림, 17개)

현행 시뮬레이션(`scripts/simulate_*.js`)은 `analysis/logs/`에 기록한다.
아래 17개는 모두 `analysis/logs/`의 같은 이름 파일과 동일하다(CSV는 CR 제거 후, PNG는 바이트 비교).

| 파일 | 현행 대응 | 마지막 변경 |
|---|---|---|
| logs/comparison_all.png | 동일 | 5740a4e 2026-05-22 |
| logs/evasive_A_log.csv | 동일 | 5740a4e 2026-05-22 |
| logs/evasive_B_log.csv | 동일 | 5740a4e 2026-05-22 |
| logs/evasive_C_log.csv | 동일 | 5740a4e 2026-05-22 |
| logs/flashloan_analysis.png | 동일 | 5740a4e 2026-05-22 |
| logs/flashloan_log.csv | 동일 | 5740a4e 2026-05-22 |
| logs/laundering_analysis.png | 동일 | 5740a4e 2026-05-22 |
| logs/laundering_log.csv | 동일 | 5740a4e 2026-05-22 |
| logs/normal_analysis.png | 동일 | 5740a4e 2026-05-22 |
| logs/normal_log.csv | 동일 | 5740a4e 2026-05-22 |
| logs/pattern_comparison.png | 동일 | 5740a4e 2026-05-22 |
| logs/ponzi_analysis.png | 동일 | 5740a4e 2026-05-22 |
| logs/ponzi_log.csv | 동일 | 5740a4e 2026-05-22 |
| logs/pumpdump_analysis.png | 동일 | 5740a4e 2026-05-22 |
| logs/pumpdump_log.csv | 동일 | 5740a4e 2026-05-22 |
| logs/rugpull_analysis.png | 동일 | 5740a4e 2026-05-22 |
| logs/rugpull_log.csv | 동일 | 5740a4e 2026-05-22 |

## reports/ (초기 파이프라인 출력, 8개)

현행 파이프라인은 `analysis/reports/`에 기록한다. 아래 8개는 모두 `analysis/reports/`의
같은 이름 파일과 **내용이 다른** 구버전 산출물이다(prevention·evasion 필드 없음 등).

| 파일 | 현행 대응 | 마지막 변경 |
|---|---|---|
| reports/FlashLoanPattern_report.json | 다름 | 5740a4e 2026-05-22 |
| reports/MoneyLaundering_report.json | 다름 | 5740a4e 2026-05-22 |
| reports/NormalStaking_report.json | 다름 | 5740a4e 2026-05-22 |
| reports/PonziLab_report.json | 다름 | 5740a4e 2026-05-22 |
| reports/PumpDump_report.json | 다름 | 5740a4e 2026-05-22 |
| reports/RugPull_report.json | 다름 | 5740a4e 2026-05-22 |
| reports/evasion_comparison.json | 다름 | 5740a4e 2026-05-22 |
| reports/index.js | 다름 | 5740a4e 2026-05-22 |

## 이번 정리에서 제외한 것

- `analysis/analysis/*`와 `analysis/{package.json, scripts/, contracts/, hardhat.config.js}`:
  `analysis/` 디렉터리에서 실행하는 `npm run analyze`의 진입점(`analysis/analysis/pipeline.js`)과
  중첩 hardhat 시뮬레이션 출력 경로이므로 보류. 별도 결정 필요.
- `analysis/prevention_reasoner.js`(205줄 구본): `analysis/pipeline.js:7`,
  `scenarios/run_all_scenarios.js:51`이 사용 중이므로 유지.
