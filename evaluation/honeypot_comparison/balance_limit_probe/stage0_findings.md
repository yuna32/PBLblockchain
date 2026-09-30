# balanceAtFailure 한계 조사 — 0단계 결과 (조사 중단)

조사일: 2026-09-24
확인 커밋: `8f7a5bb52a8e107df49076ab4a4d39585c3c8621` (2026-09-21 22:18:43 +0900, HEAD)
작업 디렉토리 상태: untracked/deleted 항목 2건 있으나 모두 `온톨로지_설계서_v0_2.docx:Zone.Identifier`(Windows 다운로드 메타파일) 관련, 이번 조사와 무관.

## 결론 먼저

**0단계에서 중단.** 지시문이 전제하는 "HoneyBadger 주소 기반 허니팟 실데이터 로그"
(트랜잭션 단위, N=244+39, UniversalTrap 67 / SelectiveTrap 39, 재현율 43.4%)가
`pbl` 저장소 어디에도 존재하지 않는다. 이 수치들을 만들었다는 스크립트나 출력
파일을 찾지 못했다 — grep/find로 다음을 확인:

- `UniversalTrap`, `SelectiveTrap`, `nonPrivilegedSuccessRate`, `balanceAtFailure`
  전부 `analysis/dynamic_analyzer.js`와 `CLAUDE.md` 서술에서만 발견됨. 이 값들을
  집계한 리포트/JSON 파일은 저장소 전체에 없음.
- `244`, `43.4`, "재현율" 텍스트를 포함한 파일 전수 확인 — 일치하는 건 전부
  무관한 우연 매치(`EVASION_ANALYSIS.md`의 `-17244.51` 등 Ponzi 쪽 잔차값,
  `evaluate_honeybadger.js` 산출물의 `43.3%`/`47.0%`는 **코드축**(정적 .sol
  소스, HiddenStateUpdate/StrawManContract 정밀도 평가)이지 트랜잭션 로그 기반
  동적 분석이 아님).
- git log(`--all --grep`, `--oneline | grep -i honeypot`)에도 해당 수치를 만든
  커밋 없음.
- `/home/kamatte` 전체(저장소 밖 포함)에서도 `UniversalTrap` 등으로 재검색했으나
  `pbl` 밖에는 아무것도 없음.

## 0-1, 0-2단계: 실제로 존재하는 HoneyPot 관련 데이터 3종류

1. **`evaluation/honeypot_comparison/data/HoneyBadger/datasets/honeypots/*.sol`**
   (31개 파일, `.sol`/`.bin`만) — christoftorres/HoneyBadger 원 저장소의 정적
   소스코드 샘플. 트랜잭션 로그, 잔고, 블록 정보 전혀 없음.
2. **`evaluation/honeypot_comparison/data/HoneyBadger/results/evaluation/*.csv`**,
   **`data/rcamino/honeybadger_labels/*.csv`**, **`data/rcamino/paper_new_honeypots.csv`**
   — 전부 `(address, technique/label)` 형태의 **라벨 목록**일 뿐, 트랜잭션도
   블록 집계도 아님. `evaluate_honeybadger.js`/`cross_validate.js`가 쓰는 것도
   이 라벨 CSV + 정적 `.sol` 소스뿐(23-39행, 42-43행 확인) — `balanceAtFailure`나
   `nonPrivilegedSuccessRate`는 이 파이프라인에 아예 등장하지 않음.
3. **`analysis/logs/honeypot_log.csv`(14행), `honeypot_selective_log.csv`(12행)**
   — 트랜잭션 단위 스키마(`block,timestamp,from,to,action,amount_eth,
   contract_balance_eth,participant_count`)는 맞지만, **실데이터가 아니라
   `analysis/scripts/simulate_honeypot.js`가 로컬 Hardhat 테스트넷에서 만든
   합성 시뮬레이션**이다. 등장하는 주소(`0xf39fd6e5...`, `0x70997970...`,
   `0x3c44cddd...` 등)는 전부 Hardhat 기본 니모닉의 표준 테스트 계정이고,
   컨트랙트도 로그당 1개씩(총 2개)뿐이다. "244개 허니팟" 규모의 데이터가 될 수
   없다.

즉 이 저장소에는 **HoneyBadger 주소를 기준으로 실제 이더리움 온체인 트랜잭션을
수집한 로그가 없다.** `fetch_and_convert_v2.js`(`evaluation/hoplaundering/`)는
존재하지만 HopLaundering용이며 honeypot 데이터를 만든 적이 없다(스크립트 내
honeypot 언급 0건, grep 확인).

## 판정

**조사 성립 불가 (가설 확인/기각 이전 단계).** balanceAtFailure 조건 때문에
실제 허니팟이 오분류되는지 실증적으로 검증하려면 주소별 실제 트랜잭션 시계열이
필요한데, 그런 데이터셋이 이 저장소에 없다. 지시문이 언급한 "244/39,
67/39, 43.4%" 수치의 출처를 찾지 못했으므로, 그 수치가 어느 세션/문서에서
나온 것인지 재확인이 먼저 필요하다(다른 저장소, 별도 노트, 또는 착오 가능성
모두 열어둠).

## 참고: 코드 정의만 우선 확인 (실데이터 불필요, 비용 낮아 확인함)

`analysis/dynamic_analyzer.js`:
- `balanceAtFailure`(339-344행): `amount_eth === 0`인 모든 출금 시도 행의
  `contract_balance_eth`를 모아 **최댓값**을 취함(첫 실패도 마지막 실패도 아님).
  주석(334-338행)에 따르면 의도적 선택 — 오너 드레인 전/후로 실패 시점이 섞이면
  평균은 드레인 이후 값 쪽으로 끌려 내려가므로, 단 한 번이라도 잔고가 남아있던
  실패가 있었다면 그 증거를 보존하기 위해 최댓값을 쓴다고 명시.
- HoneyPot 판정(376-380행): `nonPrivilegedWithdrawals.length > 0 ∧
  nonPrivilegedSuccessRate <= 0.05 ∧ balanceAtFailure > 0 ∧ inflowContinues`.
- PumpAndDump 판정(416-417행): `someWithdrawalsSucceed ∧ someWithdrawalsFail ∧
  insiderExitDetected ∧ balanceAtFailure <= 0`(엡실론 미확정, 현재 엄격히 0).
- `insiderExitDetected`(293행~): 어떤 출금이 그 주소의 누적 입금액보다 많이
  받았으면 true. 오너가 입금 없이 인출만 하는 SelectiveTrap류에서는 구조적으로
  거의 항상 true가 됨(CLAUDE.md 672-674행 기존 기록과 일치).
- **구조적 함의(코드 리딩만으로 도출, 실데이터 미검증)**: `balanceAtFailure`가
  "실패 시점들 중 최댓값"이므로, 만약 실패한 비-오너 출금 시도가 **단 한 번이라도**
  오너가 자금을 빼가기 전(잔고가 아직 높을 때) 기록으로 남아있다면 최댓값 로직이
  이를 보존해 HoneyPot으로 정상 분류될 것이다. 가설이 실제로 문제가 되려면
  "비-오너의 실패한 출금 시도가 전부 오너 드레인 완료 이후에만 존재"하는 로그
  패턴이 필요하다 — 이는 최댓값 방어를 우회하는 특수 케이스이지 일반적 상황은
  아니다. 이 이상은 실데이터 없이 추측이므로 더 진행하지 않음.

## 다음 지시 대기

- "244/39, 67/39, 43.4%" 수치의 정확한 출처(파일 경로 또는 별도 세션 로그)를
  알려주시면 그 파일 기준으로 0단계부터 재시도 가능.
- 또는 실제 온체인 데이터 수집(새 `fetch_and_convert`류 스크립트 작성)부터
  시작할지 결정 필요 — 이 경우 코드 수정 없이 진행 가능한 순수 데이터 수집
  작업이므로 범위 재정의가 필요.
