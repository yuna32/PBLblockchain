# archive/2026-10_nested-hardhat

2026-10-01 정리로 `analysis/` 아래에서 옮긴 중첩 hardhat 프로젝트(작업 흐름 ③의
시뮬레이션 부분). 컨트랙트와 시뮬레이션을 저장소 루트 hardhat 프로젝트 하나로
합치면서, 중복이거나 대체된 파일만 이곳에 보존한다.

- 이동 기준 커밋: `b36f455` (이동 전 마지막 변경은 모두 `1694a4c`, 2026-09-03)
- 복원: `git mv archive/2026-10_nested-hardhat/<경로> analysis/<경로>`
  (`analysis/artifacts/`, `analysis/cache/`는 복원 후 `hardhat compile`로 재생성)
- 비교 방법: "동일"은 CR 제거 후(`tr -d '\r'`) 비교한 결과다. 이 저장소는
  `core.autocrlf=true`라 작업트리의 줄바꿈이 파일마다 다르다.

## 왜 뺐나

- `analysis/contracts/`의 7개 중 Honeypot·PonziLabPatched는 루트 `contracts/`로
  옮겼고(`git mv`), 남은 5개는 루트 `contracts/`와 동일한 사본이다.
- 시뮬레이션 중 루트에 없던 `simulate_honeypot.js`, `simulate_evasion_patched.js`는
  루트 `scripts/`로 옮겼다(`git mv`). 루트 `package.json`의 `honeypot`, `evasion`
  script로 실행하며 출력은 `analysis/logs/`다. PonziLabPatched 로그 파일명은
  `analysis/pipeline.js`의 CONTRACT_MAP에 맞춰 `ponzipatched_log.csv`로 바꿨다.
  (2026-10-01 이후) `simulate_honeypot.js`는 `cb3b746`에서 메인 흐름 fixture
  `analysis/logs/honeypot_log.csv`(8열) 시나리오를 재현하도록 바꾸고 출력을
  `analysis/logs/honeypot_sim_log.csv`로 분리했다. 옮겨 오기 전 스크립트는 9열 시나리오
  (= `analysis/analysis/logs/honeypot_log.csv`)를 만들었다.
- 나머지 파일은 루트 hardhat 프로젝트에 같은 파일이 있거나, 루트 쪽이 상위 버전이다.

## 옮긴 파일

| 파일 | 무엇에 쓰였나 | 루트 대응 파일과 비교 |
|---|---|---|
| package.json | 중첩 hardhat 프로젝트 정의 (`honeypot`, `evasion` script 포함) | 루트 `package.json`의 부분집합. `honeypot`/`evasion` script는 루트로 옮겨 추가했다 |
| package-lock.json | 위 프로젝트의 lock 파일 | 루트 `package-lock.json`과 별개 |
| hardhat.config.js | 중첩 hardhat 설정 | 루트 `hardhat.config.js`와 **동일** |
| contracts/MoneyLaundering.sol, NormalStaking.sol, PonziLab.sol, PumpDump.sol, RugPull.sol | 중첩 시뮬레이션 대상 컨트랙트 | 루트 `contracts/`의 같은 이름 파일과 **동일** (git blob도 동일) |
| scripts/simulate_laundering.js, simulate_normal.js, simulate_ponzi.js, simulate_pumpdump.js, simulate_rugpull.js | 중첩 시뮬레이션 (출력 `analysis/analysis/logs/`) | 루트 `scripts/`의 같은 이름 파일과 **내용이 다름**: 루트 쪽은 `SCENARIO_*` 환경변수로 파라미터를 받는 상위 버전(`scenarios/run_scenario.js`가 사용) |
| scripts/test_hre.js, scripts/send-op-tx.ts | hardhat 템플릿·점검용 | 루트 `scripts/`와 **동일** |

## 삭제한 파일 (재생성 가능)

- `analysis/artifacts/`, `analysis/cache/`: 중첩 프로젝트의 컴파일 산출물 (`git rm -r`).

## 옮기지 않은 것

- `analysis/node_modules/`: git 추적 대상이 아니어서(`analysis/.gitignore`) 그대로 두었다.
  복원하지 않을 거라면 수동으로 지워도 된다.
- `analysis/analysis/`(③의 pipeline·reasoner·dashboard·logs·reports)는 그대로 있다.
  `evaluation/honeypot_comparison/*`가 중첩 `prevention_reasoner.js`를 import한다.
