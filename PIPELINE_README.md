# 파이프라인 사용 가이드

블록체인 사기 탐지 파이프라인은 **정적 분석 → 동적 분석 → 신뢰 점수 계산**을 단일 명령으로 실행하고, 결과를 JSON 보고서와 대시보드 HTML로 저장합니다.

---

## 실행 환경

> **모든 명령어는 WSL (Ubuntu) 터미널에서 실행해야 합니다.**

이 프로젝트는 Node.js가 WSL 내부에 설치되어 있고, 스마트 컨트랙트 시뮬레이션(Hardhat)도 WSL에서만 동작합니다. PowerShell이나 Windows 명령 프롬프트(CMD)에서 `npm run` 명령을 실행하면 Windows 경로(`C:\Windows\...`)를 참조하여 오류가 발생합니다.

### 올바른 실행 방법

```bash
# WSL 터미널 (Ubuntu) 을 열고 프로젝트 디렉터리로 이동
cd /home/kamatte/pbl

# 이후 모든 npm 명령 실행
npm run analyze -- --contract PonziLab
```

### 잘못된 실행 방법 (오류 발생)

```powershell
# ❌ PowerShell 또는 CMD에서 실행 — 경로 오류로 실패
npm run analyze -- --contract PonziLab
```

### WSL 터미널 여는 방법

- Windows 검색에서 **"Ubuntu"** 또는 **"WSL"** 검색 후 실행
- VS Code에서 터미널 드롭다운 → **Ubuntu (WSL)** 선택
- Windows Terminal에서 새 탭 → Ubuntu 선택

---

## 사전 준비

WSL 터미널을 열고 아래 순서대로 실행합니다.

```bash
cd /home/kamatte/pbl

# 1. 의존성 설치 (최초 1회)
npm install

# 2. 컨트랙트 컴파일 (최초 1회, 컨트랙트 수정 시 재실행)
npm run compile

# 3. 시뮬레이션 실행 — 동적 분석에 필요한 CSV 로그 생성
#    분석하려는 컨트랙트에 해당하는 명령만 실행해도 됩니다
npm run ponzi        # → analysis/logs/ponzi_log.csv
npm run normal       # → analysis/logs/normal_log.csv
npm run rugpull      # → analysis/logs/rugpull_log.csv
npm run laundering   # → analysis/logs/laundering_log.csv
npm run pumpdump     # → analysis/logs/pumpdump_log.csv
npm run flashloan    # → analysis/logs/flashloan_log.csv
```

> 시뮬레이션 없이 파이프라인을 실행하면 Step 2·3이 "CSV 없음" 경고를 출력하고, 정적 분석 결과만 반영된 보고서를 생성합니다.

---

## 파이프라인 실행

```bash
npm run analyze -- --contract <컨트랙트 이름>
```

### 지원 컨트랙트 이름

| 컨트랙트         | 사기 유형     | 필요한 시뮬레이션     |
|-----------------|-------------|-------------------|
| PonziLab        | 폰지 사기    | `npm run ponzi`   |
| NormalStaking   | 정상 스테이킹 | `npm run normal`  |
| RugPull         | 러그풀       | `npm run rugpull` |
| MoneyLaundering | 자금세탁     | `npm run laundering` |
| PumpDump        | 펌프앤덤프   | `npm run pumpdump` |
| FlashLoanPattern| 플래시론     | `npm run flashloan` |

### 실행 예시 (WSL 터미널)

```bash
# 폰지 사기 분석
npm run ponzi
npm run analyze -- --contract PonziLab

# 정상 계약과 비교
npm run normal
npm run analyze -- --contract NormalStaking

# 러그풀 분석
npm run rugpull
npm run analyze -- --contract RugPull
```

---

## 대시보드 연동

파이프라인은 **단일 대시보드(`analysis/dashboard.html`)** 하나만 사용합니다. 컨트랙트별 HTML 사본을 생성하지 않습니다.

### 생성되는 파일

```
analysis/reports/
├── index.js                ← 보고서 목록 (대시보드가 드롭다운에 표시)
├── PonziLab_report.json    ← 상세 JSON 보고서
├── NormalStaking_report.json
└── *.json                  ← analyze 실행마다 누적 추가
```

`index.js`는 파이프라인이 자동으로 갱신합니다. 수동으로 편집하지 않아도 됩니다.

### 대시보드 여는 방법 — 로컬 HTTP 서버 필수

> **`file://`로 직접 열면 `fetch()`가 차단됩니다.**
> 브라우저의 CORS 보안 정책으로 인해 `file://` 프로토콜에서는 같은 디렉터리의 JSON을 `fetch`할 수 없습니다.
> 반드시 로컬 HTTP 서버를 통해 접근해야 합니다.

```bash
# WSL 터미널에서 실행 (analysis 폴더를 루트로 서빙)
cd ~/pbl
python3 -m http.server 8080 --directory analysis
```

그런 다음 브라우저에서 접근합니다.

```
http://localhost:8080/dashboard.html
```

> 서버는 백그라운드로 계속 실행합니다. 분석 명령을 실행한 뒤 브라우저에서 보고서를 선택하면 즉시 확인할 수 있습니다. 서버를 종료하려면 `Ctrl+C`를 누릅니다.

### 대시보드에서 보고서 선택하는 방법

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⬇ 보고서  [PonziLab ▾]  [불러오기]  ✓ PonziLab 로드 완료            │
│           ─────────────────────────────────────────────────────────  │
│  D HIGH   정적: 100  동적: 100  신뢰: 76  │ 요약 / 권고 메시지       │
└──────────────────────────────────────────────────────────────────────┘
```

1. 드롭다운에서 분석할 컨트랙트 선택
2. **불러오기** 버튼 클릭 → JSON을 fetch하여 배너에 표시
3. 사기 유형 탭(폰지 사기, 러그풀 등)이 해당 컨트랙트에 맞게 자동 전환

보고서 배너가 표시하는 항목:
- **등급 배지** (A–F): 정적·동적·신뢰 점수를 가중 합산한 종합 판정
- **3개 점수 카드**: 각 단계의 점수 (빨간=위험, 초록=안전)
- **요약 문구**: 한국어로 된 지갑 분석 요약 및 탐지 결과
- **권고 메시지**: 등급에 따른 행동 지침

보고서가 없거나 드롭다운이 비어 있으면, 대시보드는 내장 샘플 데이터로 정상 동작합니다.

### 전체 연동 흐름

```
[WSL 터미널 A]                        [WSL 터미널 B]
─────────────────────────────         ──────────────────────────────────
npm run ponzi                         python3 -m http.server 8080 \
npm run analyze -- \                       --directory ~/pbl/analysis
  --contract PonziLab
    ↓
  reports/PonziLab_report.json    ─→  http://localhost:8080/dashboard.html
  reports/index.js (목록 갱신)          드롭다운: [PonziLab ▾]
                                        불러오기 클릭 → 배너 표시
```

---

## 파이프라인 동작 원리

### 전체 흐름

```
contracts/PonziLab.sol          → [정적 분석]  규칙 기반 소스 스캔
analysis/logs/ponzi_log.csv     → [동적 분석]  트랜잭션 패턴 탐지
analysis/logs/ponzi_log.csv     → [신뢰 점수]  지갑별 행동 채점
                                        ↓
                              종합 등급 산출 (A–F)
                                        ↓
          analysis/reports/PonziLab_report.json      저장
          analysis/reports/index.js                  목록 갱신
                                        ↓
          http://localhost:8080/dashboard.html 에서 보고서 선택
```

### Step 1 — 정적 분석 (`static_analyzer.js`)

Solidity 소스 코드를 정규식으로 스캔하여 코드 자체에 위험 패턴이 있는지 확인합니다. 시뮬레이션 없이도 즉시 실행됩니다.

| 규칙 ID                   | 가중치 | 탐지 조건                                      |
|--------------------------|--------|----------------------------------------------|
| UNCONSTRAINED_OWNER_DRAIN | +50   | `onlyOwner` 전액 인출 함수 (`withdrawAll`, `rugPullAll`) |
| PYRAMID_STRUCTURE         | +40   | `rewardRate` 변수 존재 + `rewardPool` 없음      |
| INSIDER_PRIVILEGE         | +35   | `isInsider`, `addInsider`, `insiderWithdraw`   |
| RAPID_EXIT_MECHANISM      | +30   | 파라미터 없는 `withdrawAll()` 함수             |
| REWARD_PROMISE            | +15   | `rewardRate`, `annualRate`, `interestRate` 변수 |

점수 합산 후 100점 상한 적용.
- **HIGH_RISK**: 45점 이상
- **MEDIUM_RISK**: 25–44점
- **LOW_RISK**: 24점 이하

### Step 2 — 동적 분석 (`dynamic_analyzer.js`)

시뮬레이션이 생성한 CSV 트랜잭션 로그를 파싱하여 실제 자금 흐름의 이상 신호를 탐지합니다.

| 규칙 ID             | 가중치 | 탐지 조건                                        |
|---------------------|--------|------------------------------------------------|
| BALANCE_DROP        | +45   | `owner_withdraw_all` 액션 후 잔고 90%+ 급락       |
| FLOW_SPIKE          | +35   | 단일 출금 ≥ 총 입금의 50%                         |
| CONCENTRATION_DRAIN | +30   | 상위 3개 수령 지갑이 총 출금의 80% 이상 차지       |
| PROFIT_EXTRACTION   | +30   | 입금 대비 130% 이상 수령한 지갑 1개 이상 존재      |
| OSCILLATING_BALANCE | +30   | 잔고가 0에서 복구되고 다시 0으로 떨어지는 사이클 2회+ |

점수 합산 후 100점 상한 적용.
- **HIGH_RISK**: 65점 이상
- **MEDIUM_RISK**: 25–64점
- **LOW_RISK**: 24점 이하

### Step 3 — 신뢰 점수 (`trust_scorer.js`)

CSV에 등장하는 모든 지갑(컨트랙트 주소 제외)의 행동을 5가지 지표로 개별 채점하고 평균을 냅니다.

| 지표              | 가중치 | 채점 기준                                     |
|------------------|--------|---------------------------------------------|
| BLACKLIST        | 30%   | `owner_withdraw_all` 수령 지갑이면 0점, 아니면 100점 |
| FUND_FLOW        | 25%   | 수령액/입금액 비율 — 1.0 이하: 100점, 1.5 초과: 0점 |
| SCAM_HISTORY     | 15%   | 수익률 130% 초과이거나 드레이너이면 0점             |
| ACTIVITY_DURATION| 15%   | 활동한 블록 범위 (블록 수 × 5, 최대 100점)          |
| TX_DIVERSITY     | 15%   | 보유한 액션 타입 종류 수 (2종 이상이면 100점)        |

지갑 점수 평균 = `overall_trust_score` (0–100, 높을수록 신뢰)
- **SAFE**: 70점 이상
- **CAUTION**: 40–69점
- **DANGER**: 39점 이하

### 종합 등급 산출

3단계 결과를 아래 공식으로 합산합니다.

```
combined_risk = 정적 위험도 × 0.30
              + 동적 위험도 × 0.40
              + (100 − 신뢰 점수) × 0.30
```

동적 분석에 가중치를 가장 높게(40%) 부여한 이유: 코드 패턴보다 **실제 자금 흐름**이 사기 여부를 더 명확히 드러내기 때문입니다.

| 등급 | combined_risk | 의미          | 권고                          |
|------|--------------|--------------|-------------------------------|
| A    | 0–19         | 정상         | 참여 고려 가능                  |
| B    | 20–39        | 낮은 위험도   | 소액 테스트 후 참여 권장          |
| C    | 40–59        | 중간 위험도   | 추가 조사 필요                  |
| D    | 60–79        | 높은 위험도   | 참여 자제                       |
| F    | 80–100       | 극도로 위험   | 절대 참여 금지                  |

### 각 컨트랙트 예상 분석 결과

| 컨트랙트         | 정적  | 동적  | 신뢰 | 예상 등급 |
|-----------------|-------|-------|------|---------|
| PonziLab        | 100   | 100   | 중간  | D / F   |
| NormalStaking   | 15    | 0     | 높음  | A       |
| RugPull         | 50    | 100   | 낮음  | D / F   |
| MoneyLaundering | 50    | 100   | 낮음  | D / F   |
| PumpDump        | 35    | 60    | 중간  | C / D   |
| FlashLoanPattern| 30    | 30    | 높음  | B / C   |

> 실제 점수는 시뮬레이션 결과(CSV 데이터)에 따라 달라질 수 있습니다.

---

## 향후 확장 방향

이 파이프라인은 교육용 프로토타입입니다. 실제 블록체인 분석 도구로 확장하려면 아래를 고려할 수 있습니다.

| 항목              | 현재 구현                 | 확장 방향                              |
|-----------------|-------------------------|--------------------------------------|
| 정적 분석 입력    | 로컬 `.sol` 파일          | 컨트랙트 주소 → Etherscan API 소스 조회  |
| 동적 분석 입력    | Hardhat 시뮬레이션 CSV    | 실제 온체인 트랜잭션 (ethers.js 조회)    |
| 사기 탐지 방식    | 규칙 기반                 | 머신러닝 분류기 (LightGBM, GNN 등)      |
| 대시보드 업데이트 | 파일 재생성               | WebSocket 실시간 스트리밍               |
| 지갑 신뢰 데이터  | 단일 시뮬레이션 내 행동     | 크로스 컨트랙트 이력 집계               |

---

## 파일 구조

```
pbl/
├── contracts/
│   ├── PonziLab.sol          ← 정적 분석 입력
│   ├── NormalStaking.sol
│   ├── RugPull.sol
│   ├── MoneyLaundering.sol
│   ├── PumpDump.sol
│   └── FlashLoanPattern.sol
├── scripts/
│   ├── simulate_ponzi.js     ← 동적 분석 입력(CSV) 생성
│   └── simulate_*.js
├── analysis/
│   ├── static_analyzer.js    ← Step 1: 소스 코드 규칙 탐지
│   ├── dynamic_analyzer.js   ← Step 2: CSV 이상 신호 탐지
│   ├── trust_scorer.js       ← Step 3: 지갑 신뢰 점수 채점
│   ├── pipeline.js           ← 오케스트레이터 (CLI 진입점)
│   ├── dashboard.html        ← 원본 대시보드 (배너 비활성)
│   ├── logs/                 ← 시뮬레이션 CSV 로그
│   │   ├── ponzi_log.csv
│   │   └── *.csv
│   ├── reports/              ← 파이프라인 출력 (자동 생성)
│   │   ├── PonziLab_report.json
│   │   └── PonziLab_dashboard.html
│   └── PIPELINE_README.md    ← 이 파일
└── package.json
```
