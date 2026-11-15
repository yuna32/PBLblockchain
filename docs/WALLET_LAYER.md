# 지갑 레이어 (시연 최소안 v1)

- 작성: 2026-11-10, 지갑 레이어 담당
- 상태: **제안 (팀 확인 전)**. 11/14 시연 기준이며, 실데이터 검증 전까지 기준값은 임시다.
- 갱신: 2026-11-14 (시연 기준 확정: 시연 결과와 한계 추가)
- 기준 커밋: 83a66a6 (2026-10-28)

## 1. 범위

컨트랙트에서 빠져나간 돈이 여러 지갑을 거치는 레이어링을 지갑 단위로 판정한다.
11/14까지는 자금세탁 시뮬레이션 1건에서 LayeringWallet 판정과 HopLaundering 부착이 동작하고, 결과가 대시보드에 표시되는 것까지 한다.

하지 않는 것: 이더스캔 수집, 실주소 모드, 기준값 조정, Bybit·Upbit 검증, OWL 반영.

## 2. 정의 (fraud_ontology.js의 walletLayer 절)

### 클래스

| 클래스 | 상위 | 의미 |
| --- | --- | --- |
| Wallet | - | 이더리움 지갑(EOA) |
| LayeringWallet | Wallet | 불법 자금을 받아 대부분 다시 내보낸 경유 지갑 |
| DeployerWallet | Wallet | 분석 대상 컨트랙트를 배포한 지갑 |

### 관계

| 관계 | 방향 | 의미 |
| --- | --- | --- |
| deploys | 지갑 → 컨트랙트 | 배포 |
| transfersTo | 지갑 → 지갑 | ETH 이동 |
| collectedBy | 자금세탁 컨트랙트 → 지갑 | 컨트랙트 자금을 최종 수집한 지갑 |

### 데이터 속성

| 속성 | 값 | 의미 |
| --- | --- | --- |
| isSeed | 참/거짓 | 추적 시작점(시드) 여부 |
| isKnownService | 참/거짓 | 거래소 등 서비스 주소 여부 (services_v1.json) |
| taintRatio | 0~1 또는 null | 받은 금액 중 불법 자금 비율 |
| forwardRatio | 0 이상 또는 null | 받은 금액 대비 다시 보낸 금액 비율 |
| hopsFromSource | 정수 | 시드에서 몇 번째 지갑인지 (최단 경로) |

불리언은 부정 조건 때문에 참/거짓을 항상 명시한다. 값이 없으면 null이며 null은 판정하지 않는다.

## 3. 규칙

- **LayeringWallet** = isKnownService = 거짓 ∧ isSeed = 거짓 ∧ taintRatio ≥ θ ∧ forwardRatio ≥ θf
- **DeployerWallet** = deploys 관계가 있음
- **HopLaundering (새 정의)** = 컨트랙트 분류가 MoneyLaundering ∧ collectedBy(컨트랙트, w) ∧ w의 하류(최대 2홉)에 LayeringWallet이 1개 이상

### 폐기하는 조건

기존 HopLaundering의 INTERMEDIATE_WALLET 조건(`unique_withdraw_addresses NOT IN unique_deposit_addresses`)은 상위 MoneyLaundering 공리(수집자 = 입금자)와 모순되므로 폐기한다.
fraud_ontology.js에서는 기존 항목을 지우지 않고 새 정의를 가리키는 표시만 덧붙인다.

### 분류와의 관계

지갑 판정은 사기 유형 분류의 입력으로 쓰지 않는다. 자금세탁으로 분류된 컨트랙트에 하위 유형(HopLaundering)을 붙일 때만 쓴다.

## 4. 계산 방법

- 입력은 하류 거래 CSV에 기록된 이동만 쓴다. 가스비와 테스트용 잔고 설정은 기록되지 않으므로 계산에 들어가지 않는다.
- **추적**: 시드에서 너비 우선으로 따라간다. 최대 2홉까지의 지갑을 판정하고, 그 지갑의 출금은 전달 비율 계산에 쓴다. 서비스 주소는 기록만 하고 더 따라가지 않는다.
- **taintRatio (haircut, 임시)**: 시드가 보낸 돈은 오염 1.0으로 본다. 지갑 w의 오염 비율 = Σ(보낸 지갑의 오염 비율 × 금액) / Σ(w가 받은 금액)
- **forwardRatio** = Σ(w가 보낸 금액) / Σ(w가 받은 금액). 받은 금액이 0이면 null
- **hopsFromSource**: 시드 = 0, 시드에서 직접 받은 지갑 = 1

## 5. 시연용 임시값

| 키 | 값 | 비고 |
| --- | --- | --- |
| θ (minTaintRatio) | 0.5 | 임시 |
| θf (minForwardRatio) | 0.8 | 임시 |
| maxHops | 2 | 지침 기준 |
| taintMethod | haircut | 미결정 사항, 권장안을 임시 사용 |

근거: 아래 시뮬레이션에서 경유 지갑은 오염 1.0, 전달 약 0.99이고 보관 지갑은 전달 0이다. 따라서 θ가 0 초과 1 이하, θf가 0 초과 0.98 이하이면 결과가 같다. 시연 결과가 기준값 선택에 좌우되지 않는다.
실데이터 기준값은 2단계에서 조정용 사건으로 정하고 고정한다.

## 6. 출력 형식 (report.wallet_layer)

시연 기간에는 사실값과 판정을 리포트 안에 둔다. 별도 파일(wallet_facts.json, wallet_verdicts.json)은 1단계에서 만든다.

```json
{
  "status": "evaluated",
  "params": { "minTaintRatio": 0.5, "minForwardRatio": 0.8, "maxHops": 2, "taintMethod": "haircut" },
  "seed": "0x7099...79c8",
  "facts": {
    "contract": "0x5fbd...0aa3",
    "wallets": [
      { "address": "0x1a00...0001", "isSeed": false, "isKnownService": false,
        "taintRatio": 1.0, "forwardRatio": 0.99, "hopsFromSource": 1 }
    ],
    "transfers": [
      { "block": 45, "from": "0x7099...79c8", "to": "0x1a00...0001", "amount_eth": 2.0 }
    ],
    "deploys": [ { "wallet": "0xf39f...2266", "contract": "0x5fbd...0aa3" } ]
  },
  "verdicts": [
    { "address": "0x1a00...0001", "hopsFromSource": 1, "classes": ["LayeringWallet"],
      "reasons": { "LayeringWallet": [
        { "id": "NOT_KNOWN_SERVICE", "result": true, "text": "서비스 주소 아님: isKnownService = false" },
        { "id": "TAINT_RATIO_HIGH", "result": true, "text": "오염 비율 기준 이상: 1.00 ≥ 0.50" } ] } }
  ],
  "hopLaundering": { "attached": true, "result": true, "conditions": [
    { "id": "LAYERING_DOWNSTREAM", "result": true, "text": "수집 지갑 하류에 레이어링 경유 지갑 있음: LayeringWallet 2개 (2홉 이내)" } ] }
}
```

| status | 뜻 |
| --- | --- |
| evaluated | 지갑 레이어를 실행함 |
| not_applicable | 자금세탁 분류가 아니라 실행 대상이 아님 |
| missing | 실행 대상이지만 하류 거래 데이터가 없어 실행하지 못함 |

## 7. 시뮬레이션 설계 (simulate_laundering.js Phase 3)

기존 Phase 1·2와 laundering_log.csv는 그대로 두고, 전액 인출 뒤에 지갑 간 이동을 추가해 `laundering_transfers.csv`에 따로 기록한다.

### 주소

| 역할 | 주소 | 비고 |
| --- | --- | --- |
| 배포자 | 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 | hardhat 계정 0 (owner) |
| 컨트랙트 | 0x5fbdb2315678afecb367f032d93f642f64180aa3 | MoneyLaundering |
| 수집 지갑(시드) | 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 | 입금자 1번, 3.78 ETH 수령 (DEFAULT_SEED 기준) |
| 경유 A | 0x1a00000000000000000000000000000000000001 | impersonate |
| 경유 B | 0x1b00000000000000000000000000000000000002 | impersonate |
| 보관 C | 0x1c00000000000000000000000000000000000003 | impersonate |
| 거래소 X | 0x1e00000000000000000000000000000000000004 | services_v1.json에 등록 |

### 이동

| 시나리오 | 이동 | 금액 (ETH) |
| --- | --- | --- |
| 양성 (기본값) | 수집 지갑 → A | 2.00 |
| | 수집 지갑 → C | 1.00 |
| | A → B | 1.98 |
| | B → X | 1.96 |
| 음성 (WALLET_SCENARIO=negative) | 수집 지갑 → X | 3.00 |

금액은 고정값이라 실행마다 결과가 같다.

### 기대 결과

| 지갑 | 홉 | 오염 | 전달 | 판정 |
| --- | --- | --- | --- | --- |
| 수집 지갑 | 0 | - | - | 시드라 판정 대상 아님 |
| A | 1 | 1.00 | 0.99 | LayeringWallet |
| B | 2 | 1.00 | 0.99 | LayeringWallet |
| C | 1 | 1.00 | 0.00 | 아님 (보관) |
| X | - | - | - | 서비스라 판정 대상 아님 |

양성: HopLaundering 부착. 음성: LayeringWallet 0개, HopLaundering 미부착. 배포자는 두 경우 모두 DeployerWallet.

## 8. 파일 변경 (최소화 방식, 팀 합의 필요)

| 구분 | 파일 | 역할 |
| --- | --- | --- |
| 신규 | analysis/chain_graph_v2.js | 사실 계산 (추론 아님) |
| 신규 | analysis/wallet_reasoner_v1.js | 추론기: 온톨로지 walletLayer.rules를 읽어 적용 |
| 신규 | config/services_v1.json | 서비스 주소 |
| 신규 | demo/test/wallet_layer.test.js | 시험 10건 |
| 신규 | docs/WALLET_LAYER.md | 이 문서 |
| 덧붙이기 수정 | analysis/fraud_ontology.js | walletLayer 절 |
| 덧붙이기 수정 | scripts/simulate_laundering.js | Phase 3 |
| 덧붙이기 수정 | analysis/pipeline.js | report.wallet_layer 추가 |
| 덧붙이기 수정 | server/fixture_run.js | fixture의 하류 CSV 복사 |
| 덧붙이기 수정 | demo/lib/glossary.js | 지갑 라벨(온톨로지에서 생성), collectTerms |
| 덧붙이기 수정 | demo/lib/ontologygraph.js | 지갑 노드, HopLaundering 활성 |
| 재생성 | demo/fixtures/ 5개, dashboard/public/snapshot/ | build_fixtures, demo:export |

원칙: 기존 줄은 지우거나 바꾸지 않는다. demo/run.js와 demo/build_fixtures.js는 바꾸지 않는다. build_fixtures는 run.js가 DEMO_LOG_DIR를 fixture 폴더로 주므로 Phase 3의 하류 CSV가 자동으로 fixture에 저장된다.

### 연결 방식 (11/13)

- pipeline.js는 동적 분석 분류가 money_laundering일 때만 지갑 레이어를 실행한다. 하류 CSV는 컨트랙트 로그와 같은 폴더의 `<type>_transfers.csv`(laundering_transfers.csv)다.
- 다른 유형은 `wallet_layer.status = not_applicable`. 기존 리포트 필드는 바뀌지 않는다(5개 시나리오 확인).
- HopLaundering은 report.wallet_layer에만 둔다. report.dynamic(동적 분석기 결과)은 바꾸지 않으므로 decision.js에 영향이 없다.
- 온톨로지 그래프: 자금세탁 클래스에 wallet:Wallet, wallet:LayeringWallet, wallet:DeployerWallet 노드(kind role, group wallet_class)와 HopLaundering → LayeringWallet 링크를 붙인다. HopLaundering 노드는 지갑 레이어가 부착하면 활성이다.
- 시뮬레이션 실패 시 run.js 폴백은 하류 CSV를 복사하지 않으므로 지갑 레이어는 missing이다. 정적 스냅샷 경로(fixture_run)는 복사한다.
- envelope의 CSV 해시에는 하류 CSV가 들어가지 않는다. 하류 거래는 report.wallet_layer.facts.transfers에 들어가므로 리포트 해시로 확인된다.

## 9. JS·OWL 차이 (기록)

OWL 반영은 3단계에서 한다. 그 전까지 다음은 JS에만 있다.

- Wallet, LayeringWallet, DeployerWallet 클래스
- deploys, transfersTo, collectedBy 관계와 데이터 속성 5개
- LayeringWallet, DeployerWallet 규칙과 HopLaundering 새 정의
- OWL의 HopLaundering은 아직 예전 조건 기준이다.

### 시뮬레이션 전용 처리

- 수집 지갑은 `owner_withdraw_all` 행의 수령 주소로 찾는다. action 이름 기반이라 실데이터에서는 쓸 수 없다.
- 수집 지갑이 컨트랙트에서 받은 금액도 사실값에 넣는다(전달 비율 계산용). 시드는 판정 대상이 아니다.
- 배포 관계(deploys)는 pipeline에서 아직 넣지 않는다. DeployerWallet은 추론기 CLI와 시험에서만 확인한다.
- 임시 기준값과 haircut 방식.

## 10. 확인이 필요한 사항

| 항목 | 확인 대상 |
| --- | --- |
| 연결부 7개 파일의 덧붙이기 수정 허용 (버전 규칙 예외) | 팀 전체 |
| fraud_ontology.js에 walletLayer 절 추가 | 온톨로지 파일 담당 |
| services_v1.json의 유형 이름 | Risk Score 담당 |
| 사실·판정을 1단계까지 리포트 안에 두기 | Risk Score 담당 |
| report.wallet_layer 형식과 화면 표시 위치 | 대시보드 담당 |
| pipeline.js에서 HopLaundering 예전 판정을 무시하는 방식 | 엔진 담당 |

## 11. 시연 결과 (11/13 로컬 확인, 기준 커밋 ead3d65)

| 확인 | 결과 |
| --- | --- |
| 양성 시뮬레이션 | 경유 A·B만 LayeringWallet (오염 1.00, 전달 0.99). 수집 지갑(시드), 보관 C(전달 0.00), 거래소 X(서비스)는 아님. HopLaundering 부착 |
| 음성 시뮬레이션 | LayeringWallet 0개, HopLaundering 미부착 |
| 리포트 연결 | laundering `wallet_layer.status = evaluated`. normal·ponzi·rugpull·pumpdump는 `not_applicable`. 5개 시나리오 기존 리포트 필드 변화 없음 |
| 온톨로지 기반 판정 | 온톨로지 규칙에서 전달 비율 조건만 빼면 코드 수정 없이 C도 LayeringWallet이 됨 (시험 8번) |
| 시험 | 데모 145개(지갑 레이어 10개 포함), 대시보드 133개 통과 |
| 화면 | 온톨로지 그래프에 지갑 노드 3개, HopLaundering → LayeringWallet 링크, HopLaundering 활성 |

## 12. 한계 (발표에서 밝힐 것)

- 시뮬레이션 1건에서 동작을 확인한 것이며, 실데이터 검증(Bybit·Upbit)은 발표 이후 진행한다.
- 기준값 θ = 0.5, θf = 0.8과 haircut은 임시값이다. 시뮬레이션은 값 선택에 결과가 좌우되지 않게 설계했으므로, 기준값의 타당성은 실데이터로 확인해야 한다.
- 수집 지갑은 시뮬레이션 로그의 action 이름으로 찾는다. 실데이터에서는 다른 방법이 필요하다.
- 실데이터에서 자금세탁 컨트랙트 분류가 0건이라, 일반 컨트랙트 분석에서는 지갑 레이어 결과가 거의 나오지 않는다.
- 믹서, 크로스체인, 토큰 스왑에서 추적이 끊긴다.
- 지갑 규칙은 JS에만 있고 OWL에는 아직 없다(9절).
- 배포 관계(deploys)는 리포트에 아직 넣지 않았다. DeployerWallet은 추론기 명령어와 시험에서만 확인했다.
- 화면에서 지갑 노드는 기존 "역할" 종류로 표시된다. 구분된 라벨은 대시보드 담당과 정한다.
