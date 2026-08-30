# HopLaundering 실데이터 파일럿 결과 (Step 3-2)

> 생성: 2026-08-09
>
> ⚠ **스코프**: 이 파일럿은 온톨로지 **HopLaundering 서브클래스**(경유 지갑 탐지)
> 로직이 실제 자금 흐름에서 작동하는지를 본다. 시드 주소는 EthereumHeist
> 라벨셋의 "탈취 사건 공격자 지갑"이며, 온톨로지 5-1절 **MoneyLaundering 유형**
> (다수 입금자 → 단일 스마트컨트랙트 주소 패턴) 분류를 검증하는 것이 **아니다.**
> 아래 결과를 "이 사건이 MoneyLaundering으로 분류됨"처럼 읽지 말 것.

## 실행 개요

- 시드 8개(사건 유형별로 고르게 선정: 러그풀/CEX 해킹/DeFi 익스플로잇/
  플래시론 공격/허니팟/폰지) 전부 수집 성공
- 홉 후보는 시드당 최대 3개까지만 실제로 추가 수집(API 예산 통제)
- 실제 API 호출 수: **52콜** (사전 추정 64콜 이내, rate-limit 재시도 몇 건 포함)
- 원본 파이프라인 파일 미수정, `evaluation/hoplaundering/` 내 신규 파일로만 작업

## 표 1. 시드별 결과 요약

| Case Name | deposit | withdraw | hopAddrs | bothSides | SET조건 충족 | passThrough 확인(depth1) |
|---|---:|---:|---:|---:|:---:|:---:|
| AnubisDAO Liquidity Rug 1 | 12 | 10 | 9 | 1 | ❌ | ✅ (2건) |
| BadgerDAO Exploiter | 5 | 0 | 0 | 0 | ❌ | — (출금 자체 없음) |
| Bitmart Hacker | 11 | 2 | 2 | 0 | ❌ | ✅ (1건) |
| PolyNetwork Exploiter 1 | 621 | 1 | 1 | 0 | ❌ | ❌ |
| Kucoin Hacker | 41 | 6 | 5 | 1 | ❌ | ✅ (3건) |
| **Plus Token Ponzi 1** | 579 | 177 | 175 | **2** | **✅** | ✅ (3건) |
| Cream Finance Flash Loan Exploiter | 17 | 3 | 3 | 0 | ❌ | ✅ (3건) |
| **BELLE Honeypot Rug Pull** | 5 | 7 | 4 | **3** | **✅** | 부분 (1/2건) |

**SET조건**(기존 dynamic_analyzer.js와 동일한 hopAddrs≥1 AND bothSides≥2)을 충족한 건: **2/8 (25%)**.
**passThrough 확인**(depth1 홉 후보 중 실제로 "받은 뒤 내보냄"이 시계열로 확인된 경우가 하나라도 있음): **6/8 (75%)**.

두 지표의 차이 자체가 의미 있다 — SET조건은 엄격한 임계값(bothSides≥2)에 걸려 대부분 미충족이지만, 시계열 추적으로 보면 6개 사건에서 실제 자금 전달이 확인된다. 즉 기존 집합 기반 조건은 **경유 자체는 흔하지만 "양방향 주소 2개 이상"이라는 엄격한 기준 탓에 과소 탐지**하는 경향이 있어 보인다(N=8 파일럿 규모라 확정적 결론은 아님).

## 표 2. 상세 — SET조건 충족 2건

### Plus Token Ponzi 1 (`0xf4a2eff88a408ff4c4550148151c33c93442619e`)
- 사상 최대급 크립토 폰지 사건(2019, 피해액 약 30억 달러 추정) 관련 라벨.
- deposit=579, withdraw=177 — 수백 건의 개별 인출.
- bothSides=2 (`0x6ce110b2...`, `0x32b0ccd7...`) — 두 주소 모두 시드로부터 자금을 받고, 시드에도 자금을 보낸 적 있음(양방향).
- 홉 후보 3개(예산 상한) 모두 depth1에서 `passThroughConfirmed=True` — 세 곳 모두 시드로부터 받은 블록 이후 실제로 자금을 내보냄이 시계열로 확인됨. 다만 depth2 확장 대상(그 다음 수신자)은 예산 상 미수집이라 `hasData=False`로 정직하게 멈춤.

### BELLE Honeypot Rug Pull (`0xf80f6fa4ccb6550c9dc58d58d51fb0928f9b323c`)
- bothSides=3 인데, 그 목록이 `0x7a250d5630b4cf539739df2c5dacb4c659f2488d`(**Uniswap V2 Router**), `0xdef1c0ded9bec7f1a1670819833240f027b25eff`(**1inch Router**), `0x44fe4535369dcef2e6559e85dfd3e1d590bf3d83` — **잘 알려진 DEX 라우터가 섞여 있다.**
- 이건 중요한 해석상 주의점이다: Uniswap/1inch 라우터는 활성 지갑이면 거의 누구나 상호작용하는 범용 인프라라, "양방향 주소"로 잡히는 게 실제 세탁 의도라기보다 **정상적인 토큰 스왑 활동의 부산물**일 가능성이 크다. bothSides 카운트를 순진하게 임계값 비교만 하면 이런 인프라 주소 때문에 과대 판정될 위험이 있다.

## 표 3. 중요 관찰 — Tornado Cash 라우터 등장과 그 함의

홉 후보 중 `0x722122df12d4e14e13ac3b6895a86e84145b6967`(**잘 알려진 Tornado Cash 라우터**)가 AnubisDAO, Bitmart, BELLE 세 사건에서 반복 등장했다. BELLE 사건에서는 이 주소까지 실제로 데이터를 수집했는데(depth2, `hasData=True`), `passThroughConfirmed=False`로 나왔다.

이건 버그가 아니라 **믹서(mixer)의 설계 자체가 주소 그래프 추적을 깨뜨리기 때문**이다. Tornado Cash는 입금과 출금 사이에 온체인 연결고리를 의도적으로 끊는 게 핵심 기능이라, "이 주소가 받은 뒤 내보냈는지"를 from/to 그래프로 보는 이번 방식은 **믹서를 통과하는 자금은 원천적으로 추적 불가**하다. 이는 이번 chain_graph.js뿐 아니라 기존 dynamic_analyzer.js의 집합 기반 HopLaundering 조건도 마찬가지로 갖는 근본적 한계다 — 설계서 8-1절 한계 서술에 추가할 가치가 있는 발견이다.

## 스코프 재확인 사항

- `Service_Provider_Map.csv`에는 실제 주소가 없어(이름/카테고리/웹사이트만) "최종 목적지가 알려진 서비스인지" 자동 대조는 이번에 수행하지 못했다. 위에서 Uniswap/1inch/Tornado Cash를 특정한 건 이 CSV 대조가 아니라 **공개적으로 잘 알려진 주소를 육안으로 식별**한 것이며, 별도의 비공식 주소-서비스 매핑을 만들어 자동화하지는 않았다(임의 라벨링 방지 원칙).
- 이 결과는 "HopLaundering 서브클래스 조건이 실제 자금 흐름에서 관측 가능하다"는 것을 보여주는 것이지, 8개 사건이 온톨로지의 MoneyLaundering 유형으로 분류돼야 한다는 뜻이 아니다.

## 산출물

- `evaluation/hoplaundering/pilot_hoplaundering.js` (오케스트레이션)
- `evaluation/hoplaundering/results/pilot_result.json` (전체 원시 결과)
- `evaluation/hoplaundering/results/pilot_report.md` (본 문서)
- `evaluation/hoplaundering/data/logs_v2/*.csv`, `*_edges.csv` (수집된 원본 데이터, 시드 8 + 홉후보 최대 24)
