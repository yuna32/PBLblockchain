# v0.3 변경사항 — DEX_WHITELIST (HopLaundering bothSides 오탐 완화)

> 이 파일은 `온톨로지_방법론_letter.docx`를 이 세션에서 직접 편집하는 대신
> 작성한 별도 부록이다. docx는 바이너리 포맷이라 이 환경에서 python-docx
> 설치가 실패했고, zip/XML 직접 조작은 결과를 시각적으로 검증할 수 없어
> 서식이 깨질 위험이 있어 사용자 확인 후 편집을 보류했다(2026-08-30).
> 아래 내용을 docx에 수동 반영할 때는 본문 중 **"이 외에 기존에 파악한
> 한계도 남아 있다..."** 단락(HopLaundering이 시뮬레이션 데이터 설계
> 제약으로 탐지되지 못했다는 서술) 바로 뒤, **"본 실데이터 비교는..."**
> 단락 앞에 삽입할 것을 권장한다.

## 배경

`MoneyLaundering_HopLaundering` 서브클래스 공리("경유 지갑" 판정)는
출금 주소와 입금 주소 집합의 멤버십만 비교하는 순수 집합 연산이다:

```
hopAddrs  = 출금 주소 중 입금 주소 집합에 없는 주소 (경유 지갑 후보, ≥1)
bothSides = 출금 주소 중 입금 주소 집합에도 있는 주소 (양방향 주소, ≥2)
발동 조건: hopAddrs.length >= 1 AND bothSides.length >= 2
```

기존 문서는 시뮬레이션 로그에서 수신 주소를 첫 입금자 주소와 동일하게
설정한 탓에 이 서브클래스가 탐지되지 못했다는 한계를 이미 기술하고
있다. 이번 v0.3 조사는 이 한계를 실데이터(EthereumHeist 파일럿, n=8)로
재검증하는 과정에서 **별도의, 더 근본적인 문제**를 발견했다: bothSides
조건이 실제로 계산 가능한 경우, "양방향 주소"로 잡히는 것이 세탁
경유가 아니라 활성 지갑이면 거의 누구나 상호작용하는 **범용 DEX
인프라**일 수 있다.

## 발견

EthereumHeist 파일럿 8건 중 BELLE Honeypot Rug Pull 케이스에서
bothSides 3개 주소 중 2개가 공개적으로 알려진 DEX 계약으로 확인됐다
(Etherscan 라벨 기준):

- `0x7a250d5630b4cf539739df2c5dacb4c659f2488d` — **Uniswap V2: Router 2**
- `0xdef1c0ded9bec7f1a1670819833240f027b25eff` — **0x: Exchange Proxy**

이 파일럿의 목적은 8개 사건을 MoneyLaundering으로 분류하는 것이
아니라 bothSides 계산 로직이 실제 자금 흐름에서 계산 가능한지를
보는 것이었으므로, 위 발견은 프로덕션 파이프라인이 실제로 오탐을
낸 사례가 아니라 **메커니즘 차원의 잠재 위험**으로 해석한다 — N=272
실데이터 평가에는 애초에 주소 단위 데이터가 없어 이 조건이 발동한
적이 없다.

## 변경 내용

`analysis/dynamic_analyzer.js`에 하드코딩 상수 `DEX_WHITELIST`(2개
주소)를 추가하고, bothSides 계산 필터에 이 화이트리스트를 제외하는
조건을 추가했다. 개입 지점은 판정 후 후처리가 아니라 bothSides 집합이
만들어지는 시점이다 — 그래야 트리거 조건과 점수 산식이 둘 다 정합된
값을 쓴다. 제외된 주소는 기존 `EXCLUDE_ADDRESSES` 관례와 동일하게
실행 시 콘솔 로그로 노출한다.

범위는 이번에 실증된 2개 주소로 한정했다. n=8이라는 파일럿 규모를
근거로 1inch·PancakeSwap 등 아직 실제로 걸리지 않은 다른 DEX까지
선제적으로 추가하지는 않았다 — 새 주소는 실제로 bothSides에 걸린
사례가 나올 때만 추가한다.

## 회귀 검증

BELLE 케이스 HopLaundering 점수는 bothSides 3→1 (트리거 조건
`>=2` 미달로 완전히 비활성화)에 따라 100→0으로 바뀐다. Plus Token
Ponzi 1 케이스(화이트리스트 미해당 주소만 보유)는 100→100으로
불변. 기존 6개 컨트랙트 + 3개 회피 시나리오(A/B/C) 및 N=272 XBlock
실데이터 평가는 변경 전후 출력이 완전히 동일함을 확인했다 — 두
경우 모두 bothSides 계산에 쓰일 실제 주소 데이터 자체가 없거나
화이트리스트와 무관한 주소만 있어 회귀가 발생할 수 없는 구조다.
상세 수치는 `EVASION_ANALYSIS.md`의 "DEX_WHITELIST — HopLaundering
bothSides 오탐 완화" 절 참고.

## 라벨 정정

이전 세션의 `evaluation/hoplaundering/results/pilot_report.md`가
`0xdef1c0ded9bec7f1a1670819833240f027b25eff`를 "1inch Router"로
기록했으나, 이번에 Etherscan에서 재확인한 결과 정확한 라벨은 **"0x:
Exchange Proxy"**(0x Protocol)다. 1inch와 0x Protocol은 둘 다 DEX
애그리게이터 계열이지만 서로 다른 프로젝트이며, 화이트리스트 상수에는
정정된 라벨을 주석으로 반영했다.

---

## 대시보드 Panel 5 "탐지 근거" (2026-08-30, 별도 세션)

> ⚠ **이름 충돌 주의**: 이 파일 제목의 "v0.3"과 이 절이 다루는 작업은
> 이 설계서(`온톨로지_방법론_letter.docx`) 자체의 "5. 한계 및 향후
> 계획"절이 말하는 **v0.3 로드맵과는 다른 작업이다.** 그 문서의
> v0.3은 "추론 근거를 UI로 연결하는 작업과 사후 대응 추론기
> (response_reasoner.js) 추가"를 가리키는데, 공교롭게도 이번 Panel 5
> 작업이 바로 그 "추론 근거 UI 연결"에 해당한다 — 즉 이번 건은
> **이름만 우연히 겹친 게 아니라 설계서의 v0.3 로드맵 항목 중
> 하나(reasoning_chain UI 연결)를 실제로 이행한 것**이다. 다만
> `response_reasoner.js`(사후 대응 추론기)는 여전히 미구현 상태로
> 남아 있어, 설계서 v0.3 항목이 완전히 끝난 것은 아니다.

### 배경

이전 세션의 대시보드 현황 조사(Phase 1)에서 `prevention_reasoner.js`의
`ontology_reasoning_chain`과 `dynamic_analyzer.js`의 `reasoning_steps`/
`evasion_*` 필드가 `analysis/dashboard.html` 어디에도 렌더링되지
않는다는 것을 확인했다(전체 리포지토리 grep으로 검증). 설계 단계(Phase
2)에서 "Panel 5(탐지 근거)"라는 신규 확장 패널을 제안했고, 이번
세션에서 구현했다.

### 구현 내용

- `analysis/dashboard.html`에 Panel 5 추가 — 기존 `openPanel(id)`/
  `renderPanel(id)`/`P_TITLES` 패턴을 그대로 확장(신규 아키텍처 도입
  없음). thumb-grid에 5번째 카드, pipe-strip에 "탐지 근거 보기" 버튼.
- **탭1(배포 전 예방 진단)**: `prevention.checklist`를 `riskWeight`
  내림차순 정렬한 아코디언 트리(✗/✓ + evidence/consequence/fix) +
  하단 `ontology_reasoning_chain`을 접힌 상태의 번호 타임라인으로.
- **탭2(배포 후 행동 탐지)**: `evasion_detected/subclass/confidence`
  배지(감지 시 빨강, 미감지 시 초록, **필드 자체가 없는 구버전
  리포트는 셋째 상태로 별도 표시** — 아래 "발견한 버그" 참고) +
  `triggered_rules`를 Panel 4의 기존 `.b4`/`.bg4` 배지 스타일로 재사용
  + `reasoning_steps`(접힘)/`evasion_all_scores`(접힘). `counter_detection`은
  설계대로 렌더링하지 않음.
- `lastReport`(모듈 스코프)에 `loadReport()`가 불러온 리포트를 저장해
  Panel 5가 재사용. mock 데모 모드(`lastReport===null`)에서는 5번째
  카드와 버튼을 비활성화.
- Trust Vector 카드에 "이 5개 축은 온체인 트랜잭션 데이터에서 계산된
  추정치이며, 외부 블랙리스트 조회가 아닙니다" 캡션 추가(2-3번 설계
  판단에 따라 `trust_scorer.js` 로직 자체는 변경하지 않음).

### 구현 중 발견한 버그와 수정

`analysis/reports/*.json` 중 다수(PonziLab, RugPull, PumpDump,
NormalStaking, FlashLoanPattern)가 `evasion_detected` 등 필드가 아예
없는 **구버전 파이프라인 산출물**이었다(이 필드들이 `dynamic_analyzer.js`에
추가되기 전 스냅샷). 최초 구현에서 `dy.evasion_detected`가 `undefined`인
경우를 `false`와 동일하게 취급해 "정상적으로 회피 시도 없음 확인"이라고
표시했는데, 이는 **"확인해봤는데 없었다"와 "애초에 확인한 적이
없다"를 혼동시키는 표시**라 헤드리스 브라우저 테스트 중 직접 발견해
`dy.evasion_detected===undefined`인 경우를 별도 문구("이 리포트는 회피
탐지 기능 이전 버전으로 생성되어 정보가 없습니다")로 분리했다.

이 버그를 계기로 위 5개 리포트를 `node analysis/pipeline.js --contract
<이름>`으로 재실행해 최신 필드를 포함하도록 갱신했다(코드 변경 없이
현재 `dynamic_analyzer.js`/`prevention_reasoner.js`를 그대로 재실행한
것 — 로직 변경 아님). 그 결과 PonziLab/PumpDump/FlashLoanPattern은
실제 evasion_detected:true 사례를, RugPull/NormalStaking은 정상적으로
계산된 evasion_detected:false 사례를 보여주게 되어 Panel 5의 두 상태
모두 실데이터로 시연 가능해졌다.

### 회귀 검증 (헤드리스 브라우저)

Playwright/chromium-cli 등 브라우저 자동화 도구가 이 환경에 설치돼
있지 않아, Windows에 이미 설치된 `msedge.exe`를 `--remote-debugging-port`로
직접 띄우고 Node 내장 `WebSocket`으로 Chrome DevTools Protocol을 구사하는
임시 드라이버 스크립트로 실제 헤드리스 브라우저에서 검증했다(스크린샷
포함, 리포지토리에는 포함하지 않음 — 세션 스크래치 영역에만 저장).

- Panel 1(네트워크)/Panel 4(이상신호)를 mock 모드로 열어 기존 렌더링이
  픽셀 단위로 이전과 동일함을 스크린샷으로 확인.
- 새로고침 직후(리포트 미로드) 5번째 카드가 `disabled` 상태이고 클릭해도
  패널이 열리지 않음을 확인.
- PonziLab 리포트 로드 → Panel 5 진입 → 탭1 체크리스트 5건(리스크
  내림차순) + 탭2에서 "⚠ 회피 시도 감지: PonziScheme_MaxTxEvasion
  (신뢰도 78)" 빨간 배지 + triggered_rules 4건 배지 확인.
- RugPull 리포트 로드 → 탭2에서 "✓ 정상적으로 회피 시도 없음 확인"
  초록 배지 확인(위 버그 수정 후 진짜 계산된 negative임).
