# 블록체인 사기 탐지 Framework — 실습 가이드

> 이 가이드는 스마트 컨트랙트 배포 → 시뮬레이션 실행 → 시각화 순서로 전체 실습 과정을 안내합니다.

---

## 📁 프로젝트 구조

```
pbl/
├── contracts/
│   ├── PonziLab.sol          ← 폰지 사기 (기존)
│   ├── NormalStaking.sol     ← 정상 스테이킹 (기존)
│   ├── RugPull.sol           ← 러그풀 (신규)
│   ├── MoneyLaundering.sol   ← 자금세탁 (신규)
│   ├── PumpDump.sol          ← 펌프앤덤프 (신규)
│   └── FlashLoanPattern.sol  ← 플래시론 패턴 (신규)
│
├── scripts/
│   ├── simulate_ponzi.js     ← 폰지 시뮬레이션 (기존)
│   ├── simulate_normal.js    ← 정상 시뮬레이션 (기존)
│   ├── simulate_rugpull.js   ← 러그풀 시뮬레이션 (신규)
│   ├── simulate_laundering.js← 자금세탁 시뮬레이션 (신규)
│   ├── simulate_pumpdump.js  ← 펌프앤덤프 시뮬레이션 (신규)
│   └── simulate_flashloan.js ← 플래시론 시뮬레이션 (신규)
│
├── analysis/
│   ├── logs/                 ← 시뮬레이션 결과 CSV 저장 위치
│   │   ├── ponzi_log.csv
│   │   ├── normal_log.csv
│   │   ├── rugpull_log.csv       ← 시뮬레이션 실행 후 생성
│   │   ├── laundering_log.csv    ← 시뮬레이션 실행 후 생성
│   │   ├── pumpdump_log.csv      ← 시뮬레이션 실행 후 생성
│   │   └── flashloan_log.csv     ← 시뮬레이션 실행 후 생성
│   ├── dashboard.html        ← 대시보드 (브라우저에서 바로 열기)
│   └── visualize.py          ← Python 시각화 스크립트
│
├── hardhat.config.js
├── package.json
└── GUIDE.md                  ← 이 파일
```

---

## ⚙️ 환경 준비 (최초 1회)

WSL Ubuntu 터미널에서 프로젝트 디렉토리로 이동합니다.

```bash
cd ~/pbl
```

의존성 설치 (이미 되어 있으면 건너뜀):

```bash
npm install
```

Python 의존성 (시각화 사용 시):

```bash
pip install pandas matplotlib numpy
# 한글 폰트 설치 (Ubuntu)
sudo apt install fonts-nanum -y
fc-cache -fv
```

---

## 🚀 STEP 1 — 스마트 컨트랙트 컴파일

6개 컨트랙트를 한 번에 컴파일합니다.

```bash
npx hardhat compile
```

컴파일 성공 시 아래와 같은 메시지가 출력됩니다:

```
Compiled 6 Solidity files successfully
```

> **오류 발생 시**: `artifacts/` 폴더를 삭제 후 재시도
> ```bash
> rm -rf artifacts cache
> npx hardhat compile
> ```

---

## 🎬 STEP 2 — 시뮬레이션 실행

각 시뮬레이션은 Hardhat의 로컬 인메모리 네트워크에서 실행됩니다.  
실행 순서는 상관없으며, 각 실행 후 `analysis/logs/` 에 CSV가 저장됩니다.

### 기존 시뮬레이션 (이미 CSV 존재 시 건너뜀)

```bash
npx hardhat run scripts/simulate_ponzi.js
npx hardhat run scripts/simulate_normal.js
```

### 신규 시뮬레이션 4종 (순서대로 실행)

```bash
# 1. 러그풀 — 잔고 점진 축적 후 오너 전액 단번 인출
npx hardhat run scripts/simulate_rugpull.js

# 2. 자금세탁 — 19명 소액 분산 입금 → 단일 지갑 집계 인출
npx hardhat run scripts/simulate_laundering.js

# 3. 펌프앤덤프 — 내부자 pump → 후발자 유입 → 내부자 dump → 후발자 손실
npx hardhat run scripts/simulate_pumpdump.js

# 4. 플래시론 패턴 — 대량 입금 후 즉시 전액 인출 반복
npx hardhat run scripts/simulate_flashloan.js
```

### 시뮬레이션 출력 확인

각 시뮬레이션이 완료되면 아래처럼 출력됩니다 (예: 러그풀):

```
=== 러그풀 시뮬레이션 시작 ===

RugPull 배포 완료: 0xe7f1...

── Phase 1: 10명 입금 (잔고 점진 축적) ──
  [Block 4] 입금 1.0 ETH | 잔고: 1.0 ETH
  [Block 7] 입금 1.2 ETH | 잔고: 2.2 ETH
  ...
  [Block 31] 입금 2.8 ETH | 잔고: 19.0 ETH

── Phase 2: 오너 전액 단번 인출 (러그풀 트리거) ──
  [Block 35] OWNER 전액 인출 19.0 ETH | 잔고: 0 ETH

✅ 로그 저장 완료: analysis/logs/rugpull_log.csv
   총 11개 트랜잭션 기록
```

---

## 📊 STEP 3 — 대시보드 열기

대시보드는 서버 없이 브라우저에서 바로 실행됩니다.

```bash
# WSL에서 Windows 브라우저로 파일 열기
explorer.exe "$(wslpath -w ~/pbl/analysis/dashboard.html)"
```

또는 Windows 파일 탐색기에서 `\\wsl.localhost\Ubuntu\home\kamatte\pbl\analysis\dashboard.html` 을 더블클릭합니다.

### 대시보드 사용법

| 패널 | 설명 | 인터랙션 |
|------|------|---------|
| **① 자금 흐름 네트워크** | 지갑-컨트랙트 간 자금 이동 그래프 | 노드 드래그, 줌, 클릭 시 ② 업데이트 |
| **② 지갑 신뢰 벡터** | 선택 지갑의 5차원 레이더 차트 | 상단 지갑 태그 클릭 또는 ①에서 노드 클릭 |
| **③ 시계열 대시보드** | 6개 지표 미니 차트 + 블록 리플레이 | 슬라이더로 과거 블록 탐색, 미래 예측선 확인 |
| **④ 이상 신호 탐지기** | 3가지 규칙 기반 배지 | 자동 업데이트 (빨간색 = 이상 감지) |

**상단 버튼**으로 6가지 사기 유형을 전환합니다:
- `폰지 사기` / `정상 스테이킹` / `러그풀` / `자금세탁` / `펌프앤덤프` / `플래시론`

### 이상 신호 배지 해석

| 배지 | 조건 | 의미 |
|------|------|------|
| **BALANCE DROP** | 잔고가 1블록 내 80% 이상 급락 | 러그풀, 펌프앤덤프, 폰지의 핵심 신호 |
| **FLOW SPIKE** | `net_flow < -(이전잔고 × 0.5)` | 대규모 자금 유출 발생 |
| **MAX TX ALERT** | 최대 단일 TX ≈ 컨트랙트 잔고 | 전액 인출 트리거 |

---

## 📈 STEP 4 — Python 시각화 (PNG 저장)

```bash
cd ~/pbl
python3 analysis/visualize.py
```

생성되는 PNG 파일:

| 파일명 | 내용 |
|--------|------|
| `pattern_comparison.png` | 폰지 vs 정상 2x2 비교 (기존 유지) |
| `comparison_all.png` | 전체 6유형 시계열 비교 |
| `ponzi_analysis.png` | 폰지 사기 개별 분석 |
| `normal_analysis.png` | 정상 스테이킹 개별 분석 |
| `rugpull_analysis.png` | 러그풀 개별 분석 |
| `laundering_analysis.png` | 자금세탁 개별 분석 |
| `pumpdump_analysis.png` | 펌프앤덤프 개별 분석 |
| `flashloan_analysis.png` | 플래시론 패턴 개별 분석 |

> **주의**: 시뮬레이션이 실행되지 않은 CSV는 자동으로 건너뜁니다.  
> 존재하는 CSV만 로드하여 그래프를 생성합니다.

---

## 🔬 각 사기 유형 이해

### 1. 폰지 사기 (PonziLab)
- **패턴**: 신규 참여자의 입금 → 기존 참여자 수익 지급 → 지속 불가 → 관리자 러그풀
- **탐지 지표**: 잔고 점진 증가 → 수직 급락, 마지막 블록 max_single_tx = 전체 잔고
- **핵심 함수**: `participate()` (입금) / `withdraw()` (출금) / `ownerWithdrawAll()` (러그풀)

### 2. 러그풀 (RugPull)
- **패턴**: 오너가 **중간 인출 없이** 잔고를 최대치까지 축적 후 **단 1회** 전액 인출
- **탐지 지표**: 역-V자 누적 잔고 곡선, 피크에서 BALANCE DROP 신호 동시 발화
- **핵심 함수**: `deposit()` / `rugPullAll()`

### 3. 자금세탁 (MoneyLaundering)
- **패턴**: 다수 지갑이 소액 분산 입금 (레이어링) → 단일 수취인에게 집계 인출 (통합)
- **탐지 지표**: unique_participants 급증 후 max_single_tx 단발 폭발
- **핵심 함수**: `deposit()` / `withdrawAll(recipient)`

### 4. 펌프앤덤프 (PumpDump)
- **패턴**: 내부자 3명이 대량 입금(pump) → 후발자 5명 유입 → 내부자가 입금액 이상 인출(dump) → 후발자 0 ETH 손실
- **탐지 지표**: net_flow 급격한 진동, 후발자 출금 블록에서 amount_eth = 0
- **핵심 함수**: `addInsider()` / `deposit()` / `insiderWithdraw()` / `withdraw()`

### 5. 플래시론 패턴 (FlashLoanPattern)
- **패턴**: 대량 입금 후 즉시 전액 인출을 여러 블록에서 반복, 잔고가 절대 누적되지 않음
- **탐지 지표**: max_single_tx == total_in 관계가 매 라운드 성립, cumulative_balance 0 수렴
- **핵심 함수**: `deposit()` / `withdrawAll()`

---

## 🛠 트러블슈팅

### Q: `npx hardhat compile` 에서 에러 발생
```bash
# artifacts 삭제 후 재컴파일
rm -rf artifacts cache
npx hardhat compile
```

### Q: 시뮬레이션에서 `Cannot find module` 에러
```bash
# Hardhat v3 + ESM 환경 확인
cat package.json | grep '"type"'   # "module" 이어야 함
node --version                      # v20 이상 권장
```

### Q: Python에서 `ModuleNotFoundError`
```bash
pip install pandas matplotlib numpy
```

### Q: 한글 폰트가 깨져서 □로 출력됨
```bash
# NanumGothic 폰트 설치
sudo apt install fonts-nanum -y
fc-cache -fv
# 이후 matplotlib 캐시 삭제
rm -rf ~/.cache/matplotlib
```

### Q: 대시보드가 빈 화면으로 열림
- 브라우저에서 직접 파일을 열면 일부 브라우저가 로컬 스크립트를 차단할 수 있습니다.
- **Chrome**: 주소창에 `chrome://flags/#allow-insecure-localhost` 확인 또는 아래 로컬 서버 사용
- **로컬 서버 방법** (Python 3):
  ```bash
  cd ~/pbl/analysis
  python3 -m http.server 8080
  # 브라우저에서 http://localhost:8080/dashboard.html 접속
  ```

### Q: 펌프앤덤프에서 후발자가 손실을 입지 않음
시뮬레이션 수치 조정이 필요합니다. `simulate_pumpdump.js`에서 다음을 확인:
- 내부자 입금: 4.0 ETH × 3 = 12 ETH
- 후발자 입금: 1.5 ETH × 5 = 7.5 ETH
- 내부자 인출: 6.5 ETH × 3 = 19.5 ETH (전체 잔고 소진)

---

## 📚 학습 포인트 체크리스트

### 스마트 컨트랙트 레이어
- [ ] 각 컨트랙트의 `owner` 권한 설계 차이 이해
- [ ] `require` 조건과 취약점의 관계 파악
- [ ] `call{value}` 패턴의 재진입 공격 가능성 검토

### 시뮬레이션 레이어
- [ ] Hardhat `testClient.mine()` 의 블록 제어 방식 이해
- [ ] viem의 `parseEther` / `formatEther` 사용법 숙지
- [ ] 시뮬레이션 로그 구조 (6개 컬럼) 파악

### 분석 레이어
- [ ] 6가지 핵심 메트릭 계산 방법 이해
  - total_in, total_out, net_flow, cumulative_balance, unique_participants, max_single_tx
- [ ] 3가지 이상 탐지 규칙의 수학적 조건 이해
- [ ] 지갑 신뢰 벡터의 5개 차원 의미 파악

### 발표/토론 준비
- [ ] 각 사기 유형의 사회적 피해와 실제 사례 조사
- [ ] 규칙 기반 탐지의 한계와 머신러닝 접근법 비교
- [ ] DeFi 프로토콜에서의 실제 방어 메커니즘 조사

---

## 🔄 전체 실습 흐름 요약

```
[터미널]                          [브라우저]
npx hardhat compile
  ↓
npx hardhat run scripts/simulate_rugpull.js    → analysis/logs/rugpull_log.csv
npx hardhat run scripts/simulate_laundering.js → analysis/logs/laundering_log.csv
npx hardhat run scripts/simulate_pumpdump.js   → analysis/logs/pumpdump_log.csv
npx hardhat run scripts/simulate_flashloan.js  → analysis/logs/flashloan_log.csv
  ↓                                                       ↓
python3 analysis/visualize.py              analysis/dashboard.html 열기
  ↓                                                       ↓
analysis/logs/*.png 생성              6가지 유형 전환, 슬라이더 탐색,
                                      이상 신호 배지 확인
```

---

*교육 목적 전용 — 실제 블록체인 배포 및 악용 금지*
