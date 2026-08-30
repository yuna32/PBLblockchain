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
