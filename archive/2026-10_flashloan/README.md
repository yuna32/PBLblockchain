# archive/2026-10_flashloan

FlashLoanPattern 컨트랙트 묶음을 2026-10-07에 이 폴더로 옮겼다.

## 이동 사유

FlashLoanPattern은 시스템이 다루는 5개 사기 유형(PonziScheme, RugPull, MoneyLaundering,
PumpAndDump, HoneyPot) 밖의 실험용 컨트랙트다. 그래서 분석 대상에서 뺐다.
지운 것이 아니라 보존을 위해 옮긴 것이다.

## 이동한 파일과 원위치

| 이 폴더의 파일 | 원위치 |
|---|---|
| `FlashLoanPattern.sol` | `contracts/FlashLoanPattern.sol` |
| `FlashLoanPattern_report.json` | `analysis/reports/FlashLoanPattern_report.json` |
| `simulate_flashloan.js` | `scripts/simulate_flashloan.js` |

같은 작업에서 등록 4곳을 지웠다.

- `analysis/pipeline.js`의 `CONTRACT_MAP` 항목:
  `FlashLoanPattern:{ type: "flashloan",   csv: "flashloan_log.csv"    }`
- `package.json`의 `scripts` 항목:
  `"flashloan": "hardhat run scripts/simulate_flashloan.js",`
- `analysis/reports/index.js`와 `analysis/analysis/reports/index.js`의 `AVAILABLE_REPORTS`에서 `"FlashLoanPattern"`

## 남겨 둔 것: `analysis/logs/flashloan_log.csv` (동결 fixture)

- 이 로그는 `analysis/logs/`에 그대로 남겼다. 지금은 생성기가 저장소에 없으므로 내용을 바꾸지 않는 동결 fixture로 취급한다.
- 이 로그를 읽거나 근거로 삼는 곳:
  - `analysis/compare_evasion.js:31` (`{ name: "FlashLoan", csv: "flashloan_log.csv", ... }`)가 이 로그를 읽는다.
  - 그 산출물 `analysis/reports/evasion_comparison.json`에 FlashLoan 항목이 있다.
  - `EVASION_ANALYSIS.md:387-398`이 이 로그를 근거로 삼는다. 경계값 버그 `maxW(20) === minW(8) × 2.5` 발견과
    "MEDIUM_RISK/30→31 유지" 서술이 여기에 해당한다.

## 로그를 다시 만들려면

1. `FlashLoanPattern.sol`을 `contracts/`로, `simulate_flashloan.js`를 `scripts/`로 되돌린다.
2. `package.json`의 `scripts`에 원래 항목을 복원한다:
   `"flashloan": "hardhat run scripts/simulate_flashloan.js",`
3. 저장소 루트에서 `npx hardhat run scripts/simulate_flashloan.js`를 실행한다(`npm run flashloan`과 같다).
   - WSL에서는 `npm`이 Windows 쪽 실행 파일이라 신뢰할 수 없다. 그래서 위처럼 script 문자열을 직접 실행한다.
   - 출력은 `analysis/logs/flashloan_log.csv`이고, 기존 파일을 **덮어쓴다**(`simulate_flashloan.js:96,104`).
     동결 fixture가 바뀌므로 실행 전에 백업하고, 실행 후 `evasion_comparison.json`과 EVASION_ANALYSIS 수치를 다시 확인할 것.
4. 분석 대상으로 다시 넣으려면 위에서 지운 등록 4곳도 복원한다.
