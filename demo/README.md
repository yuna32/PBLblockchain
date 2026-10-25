# demo/ — 시연용 MVP

시나리오 선택 → 시뮬레이션(거래 로그) → 분석(정적·동적·예방·신뢰) → 리포트 JSON과 해시 → 대시보드.
Node 22.10 이상이 필요하다(hardhat 3). 저장소 루트에서 `nvm use`.

## 실행

```
cd ~/pbl
nvm use
npm run demo:server      # 시연 API  http://127.0.0.1:8787/api  (PORT, HOST로 변경)
npm run demo:ui          # 대시보드  http://localhost:5173       (다른 터미널, /api는 8787로 프록시)
```

- 대시보드 의존성은 `dashboard/`에 따로 있다. 처음 한 번 `npm --prefix dashboard ci`.
- 프록시 대상은 `DEMO_API_TARGET`(기본 `http://127.0.0.1:8787`), 대시보드 포트는 `DEMO_UI_PORT`(기본 5173).
- Windows 브라우저에서는 `http://localhost:5173`으로 연다(WSL2 localhost 전달).
- 서버를 저장소에서 띄우면 작업 결과가 `demo/runs/`(git 무시)에 쌓이고, 실시간 시뮬레이션은 `cache/`, `artifacts/`(git 무시)를 갱신할 수 있다.
- 시험: `node --test demo/test/*.test.js`(단위), `node --test server/test/*.test.js`(hardhat 실행 포함), `npm --prefix dashboard test`(대시보드 순수 함수).

## 구성

| 경로 | 내용 |
|---|---|
| `run.js` | `runScenario(name, outDir, options)` — 시뮬레이션(hardhat 하위 프로세스) → `buildReport` → `outDir`에 CSV, `report.json`, `envelope.json`. 시뮬레이션이 실패하면(Node 22.10 미만, 비정상 종료, 시간 초과, CSV 미생성) `fixtures/<name>/`의 CSV로 분석하고 `source: "fixture"`. `options.onStage(stage, info)`로 단계(simulate → analyze → hash)를 알린다 |
| `build_fixtures.js` | `fixtures/` 다시 만들기 (폴백 없음, laundering 시드 `pbl-demo`) |
| `lib/canonical.js` | RFC 8785(JCS) 방식 canonical 직렬화, SHA-256, envelope |
| `lib/onset.js` | 사기 발현 시점(onset)과 시점 이벤트(events) |
| `lib/viewmodel.js` | 화면용 뷰모델 (headline, combination 포함) |
| `lib/combination.js` | 코드 위험 × 지갑 위험 조합 판정 (`COMBINATION_RULES`, 시연용 임시 기준) |
| `lib/glossary.js` | 용어집 (리포트·온톨로지 그래프의 ID → 한글 라벨과 설명) |
| `lib/ontologygraph.js` | 온톨로지 그래프 `buildOntologyGraph(report)` |
| `lib/timeseries.js`, `lib/csv.js` | 거래 행 정규화 (CR 제거, 숫자 열 숫자화) |
| `fixtures/<scenario>/` | normal, ponzi, rugpull, laundering, pumpdump의 CSV, `report.json`, `envelope.json` |
| `../server/` | 시연 API (node:http, 외부 패키지 없음) |
| `../dashboard/` | React(Vite) 대시보드 |

## 규칙

### 사기 분류와 onset, events (`lib/onset.js`)
- 사기 분류: `dynamic.fraud_type_hint`가 ponzi_scheme, rug_pull, money_laundering, pump_and_dump, flash_loan 중 하나일 때만 사기다. unclassified_warning, unknown, normal_staking, 값 없음은 비사기.
- onset: 사기로 분류된 경우에만 값이 있다 = 첫 출금 블록(금액 > 0인 출금 계열 행). 비사기면 `null`. fixture 기준 normal null, ponzi 33, rugpull 35, laundering 43, pumpdump 23.
- events: 분류와 관계없이 항상 계산하고 CSV 행 순서로 정렬한다. `inflow_stop`(마지막 입금), `first_withdraw`(첫 출금), `owner_withdraw_all`(첫 owner 전액 인출), `first_failed_withdraw`(첫 실패 출금). 해당 없는 것은 생략.

### 뷰모델 (`lib/viewmodel.js`)
- 종합 등급(`overall_grade`, `raw_grade`)은 넣지 않는다. 코드 등급과 지갑 등급을 따로 보여 준다.
- `headline`: `{ tone: danger | caution | safe, text, reasons }`. text는 유형별 템플릿(단정하지 않는 ~습니다 체), reasons는 최대 4개로 우선순위는 경고 → 첫 출금 → 회피 패턴 → 최저 지갑 등급·drainer/extractor → 코드 위험 수준. 각 reason의 `page`는 근거를 볼 화면(overview, trade, trust, ontology, report).
- `combination`: `{ codeRisk, walletRisk, quadrant, label, basis, criteriaNote }`. 코드 위험 높음 = prevention HIGH/CRITICAL, 지갑 위험 높음 = drainer ≥ 1 또는 extractor ≥ 1 또는 최저 지갑 등급 D/E/F. 평균 등급이 A인데 지갑 위험이 높으면 basis에 명시한다(PumpDump).
- extractor = `!is_drainer && profit_ratio > 1.3` (analysis/trust_scorer.js와 같은 기준).

### 용어집 (`lib/glossary.js`, `GET /api/glossary`)
- `{ [id]: { ko, desc, category } }`. 예방 체크리스트 항목과 회피 서브클래스는 `analysis/fraud_ontology.js`의 라벨을 그대로 쓴다. fixture 5개에 나오는 모든 ID가 들어 있는지 시험한다.

### 온톨로지 그래프 (`lib/ontologygraph.js`, `GET /api/report/:id/ontology`)
- `{ nodes, links, highlight, meta }`. 노드 kind: class, parent, condition, evidence, evasion, role, patch. 링크 kind: subClassOf, requires, supportedBy, exhibits, affects, mitigatedBy.
- 조건·근거·회피 기법 노드의 상태 세 가지: `met`(충족), `unmet`(미충족), `no_data`(근거 데이터 없음 — 미충족과 구분). 그 밖의 노드는 `active`로만 구분한다. 링크는 양 끝이 모두 active일 때 active.
- `highlight.path`: 분류 추론 경로. 충족된 조건마다 `[증거, 조건, 분류 클래스]`.
- `highlight.evasionPath`: 활성 회피 기법마다 `[증거, 회피 기법, 분류 클래스]`. 회피 기법은 분류 조건이 아니라서 path와 분리한다.
- 조건 근거(`CONDITION_EVIDENCE`)와 회피 기법 판정(`TECHNIQUE_EVIDENCE`)은 시연용 매핑이며 온톨로지 정의가 아니다(`meta.mappingNote`). 근사 조건은 `approx: true`와 사유를 desc에 적는다. 회피 기법은 해당 유형의 `usesEvasion`에 있는 것만 그린다.
- 사기로 분류되지 않으면 후보 사기 유형 4개와 조건 상태를 비활성 클래스 아래에 그린다. `meta.owlInferred`는 `ontology/owl_results.json`(저장소의 예전 로그 기준) 참고값이다.

### 해시 (`lib/canonical.js`)
- 리포트 해시는 `timestamp`, `dynamic.csv`, `trust.csv`, `static.file`을 뺀 리포트의 canonical 문자열(SHA-256). 입력 해시(정규화 CSV, .sol)는 `envelope.input`에 따로 있다.
- 시뮬레이션 출력은 `DEMO_LOG_DIR`, laundering 금액은 `DEMO_SEED`로 고정한다(`run.js`가 설정). `analysis/logs`, `analysis/reports`에는 쓰지 않는다.

## 대시보드 페이지 (`dashboard/`)
상단 메뉴 5개, 오른쪽 패널(시나리오 / 실행 기록), 아이콘 레일. 헤더에 "시뮬레이션 데이터" 배지와 서버 연결 점, 그 아래 진행 표시(입력 → 분석 → 온체인 기록 → 시각화).
주소에 시나리오를 담는다: `#/trade?scenario=ponzi` (열면 그 시나리오의 사전 생성본을 자동 로드, 거래 분석은 `&block=31`로 슬라이더 시작 위치 지정).

1. 개요: headline 결론과 근거(누르면 해당 화면), 조합 판정 2x2, 핵심 수치 4개, 요약 띠, 접히는 패턴·경고.
2. 거래 분석: 블록별 입출금·잔액 차트(시점 이벤트 기준선, 사기면 발현 추정 구간)와 거래 네트워크가 블록 슬라이더·재생(1x/2x)을 공유한다.
3. 신뢰 시트: 코드 위험 카드, 지갑 신뢰 카드(평균과 최저 등급), 지갑별 5축 레이더, 지갑 표, 면책 문구.
4. 온톨로지: 추론 그래프(path 실선, evasionPath 점선, 추론 경로 재생), 시연용 매핑 안내, 노드 설명.
5. 온체인 리포트: 리포트 해시, 온체인 기록(방식 선택·기록 카드), 검증과 변조 시연, 입력 해시, canonical JSON.

## 온체인 기록·검증 화면 (대시보드 "온체인 리포트")

`npm run demo:server`가 로컬 체인(hardhat node)을 띄우고 fixture 5개 리포트를 사전 기록한다(서버 로그 "사전 기록 5/5"). 체인을 띄우는 동안 화면에는 "체인 시작 중"이 보인다. 서버를 다시 띄우면 체인도 새로 시작하므로 이전 UID는 사라진다.

- 기록: 기록 방식(로컬 시연 체인 / EAS Sepolia)을 고르고 "온체인에 기록"을 누른다. 진행 표시·시나리오 패널·개요 배지는 고른 방식을 기준으로 한다(기본 로컬). 기록 작업은 400ms마다 상태를 확인하고 진행(요청 → 대기열 → 체인에 기록 → 완료)을 보여 준다. 기록이 있으면 기록 카드(UID, 트랜잭션 해시, 블록 번호, 체인 ID, 기록자 주소, 스키마 UID, 기록 시각, 기록한 값 7개 필드)가 보이고 버튼은 "다시 기록(새 UID)"로 바뀐다. 사전 기록분에는 "사전 기록" 배지가 붙는다.
- 검증: "검증"은 체인에서 기록을 다시 읽어 현재 리포트와 비교한다. 해시를 나란히 보여 주고 7개 필드를 표로 비교한다. 스캔 시각과 분석기 버전은 "참고용"이라 달라도 결과에 영향을 주지 않는다.
- 변조 시연(기본 접힘): "리포트를 일부러 바꿔서 검증해 보기"에서 항목(신뢰 점수, 코드 위험 등급, 감지 유형, 최저 지갑 신뢰 점수)을 하나 골라 검증하면, 서버가 메모리 사본만 바꿔 검증하므로 "시연용 · 저장되지 않음" 배너와 함께 불일치와 바뀐 경로가 나온다. "원래대로 다시 검증"으로 일치로 돌아온다. 프리셋 값은 현재 리포트의 실제 값에서 만들고, 리포트에 없는 경로의 프리셋은 숨긴다.
- 다른 화면: 진행 표시의 "온체인 기록" 단계(기록 전 / 기록 중 / 완료 / 완료(사전 기록) / 기록 실패 / 사용 불가), 개요 요약 띠의 온체인 배지(누르면 이 화면, 검증을 했으면 마지막 결과), 오른쪽 시나리오 행의 "사전 기록"·"기록됨" 표시. 검증 결과는 메모리에만 두어 새로고침하면 사라진다.
- `DEMO_ATTEST=off`로 서버를 띄우면 로컬 체인이 "사용 불가"로 표시되고 기록·검증 버튼이 꺼진다. 나머지 화면은 그대로 동작한다.
- 시연 환경에서는 모든 시나리오가 같은 컨트랙트 주소(새 체인의 첫 배포 주소)를 쓰며, 시나리오는 리포트 해시로 구분한다.

### 시연 순서 제안
1. 폰지 사기를 고르고 "온체인 리포트"를 연다. 사전 기록된 기록 카드(UID, 블록, 리포트 해시 7필드)를 보여 준다.
2. "검증" → 일치. 해시 두 개가 같고 7개 필드가 일치(스캔 시각은 참고용)임을 짚는다.
3. "리포트를 일부러 바꿔서 검증해 보기" → "신뢰 점수를 다른 값으로" → 불일치. 해시가 달라지고 바뀐 경로 `trust.overall_trust_score`가 나오며, 배너로 저장되지 않음을 설명한다.
4. "원래대로 다시 검증" → 일치로 돌아온다. 파일과 기록이 바뀌지 않았음을 보여 준다.
5. (선택) 펌프앤덤프를 실시간 분석 → 진행 표시가 "기록 전" → "온체인에 기록" → "완료" → 검증 일치. 개요의 온체인 배지도 확인한다.

## EAS 공개 체인 기록 (eas-sepolia)

공개 테스트넷 Sepolia의 EAS에 기록·조회·검증한다. 로컬 체인과 같은 스키마·같은 검증 코드를 쓰고, RPC와 계정만 다르다.
로컬 체인은 서버를 켤 때마다 새로 만들어지지만 Sepolia 기록은 **영구적**이며 누구나 탐색기에서 볼 수 있다.

### 설정 (.env, 모두 선택 — `.env.example` 참고)
| 변수 | 내용 |
|---|---|
| `DEMO_EAS_RPC_URL` | Sepolia RPC 주소. 없으면 eas-sepolia는 "미설정" |
| `DEMO_EAS_PRIVATE_KEY` | 기록용 키. 없으면 읽기 전용(조회·검증만, 기록 요청은 409 `backend_read_only`) |
| `DEMO_EAS_ADDRESS` | 기본 `0xC2679fBD37d54388Ce493F1DB75320D236e1815e` |
| `DEMO_EAS_SCHEMA_REGISTRY` | 기본 `0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0` |
| `DEMO_EAS_CHAIN_ID` | 기본 11155111 |
| `DEMO_EAS_EXPLORER_BASE` | 기본 `https://sepolia.easscan.org` |

- 주소와 탐색기는 eas-contracts 1.7.1·1.9.0 문서(deployments/sepolia) 기준이며, 체인에서 직접 확인하는 것은 `demo:eas:check`가 한다.
- 키와 RPC 주소는 서버 메모리에서만 쓰고 로그·API 응답·오류·스크립트 출력에 나오지 않는다(`lib/attest/redact.js`). 이름에 `EAS_`가 들어 있어 시뮬레이션 하위 프로세스 환경에서도 빠진다.
- 키는 테스트넷 전용으로 새로 만든 지갑의 것을 쓴다. 실제 자금이 있는 키를 넣지 않는다.

### 사람이 실행하는 스크립트 (`demo/scripts/eas.js`)
각 스크립트는 `.env`를 읽고, 할 일과 필요 잔액을 출력한 뒤 확인을 받는다(`-- --yes`로 생략). 서버는 시작할 때 연결만 점검하며 스키마 등록이나 기록을 자동으로 하지 않는다.

| 명령 | 내용 |
|---|---|
| `npm run demo:eas:check` | 읽기 전용 점검: RPC 연결, 체인 ID, EAS/SchemaRegistry 코드, 스키마 등록, 계정 잔액(키가 있을 때), 기록된 fixture UID가 체인에 있고 현재 fixture의 리포트 해시와 같은지 |
| `npm run demo:eas:register` | 스키마가 없을 때만 등록(트랜잭션 1건). 스키마 UID는 스키마 문자열에서 계산한 값과 같다 |
| `npm run demo:eas:record-fixtures` | `demo/fixtures` 5개 리포트를 기록하고 `demo/fixtures/attestations.sepolia.json`에 저장(비밀 정보 없음). 같은 리포트 해시로 이미 기록된 시나리오는 건너뛰고 `-- --force`일 때만 다시 기록 |

종료 코드: 0 정상, 1 실패·불일치, 3 취소.

### 주의: fixture를 확정(freeze)한 뒤 기록할 것
Sepolia 기록은 지울 수 없다. 분석 코드나 fixture를 다시 만들어 리포트가 바뀌면 리포트 해시가 달라져, 이전에 기록한 fixture는 검증에서 **불일치**로 나온다(화면의 기록 카드에는 "fixture와 해시 다름" 배지).
`npm run demo:eas:check`가 이런 시나리오를 "불일치"로 알려 주며, 확정한 fixture로 `npm run demo:eas:record-fixtures -- --force`를 실행해 다시 기록한다(새 UID, 수수료 발생).

### 서버와 화면
- `attestations.sepolia.json`이 있으면 서버가 시나리오별 Sepolia 기록을 fixture 리포트에 연결한다(로컬 사전 기록과 따로 보관). 체인 ID나 EAS 주소가 지금 설정과 다른 기록은 무시한다.
- API는 `backend`로 구분한다: `GET /api/report/:id/attestation?backend=eas-sepolia`, `POST /api/report/:id/verify { backend }`, `GET /api/fixtures/attestations?backend=`. 생략하면 local.
- 기록 전 점검: 잔액이 예상 수수료보다 적으면 체인에 보내기 전에 409 `insufficient_funds`, 스키마가 없으면 409 `schema_not_registered`, RPC 오류·시간 초과는 재시도 후 503 `rpc_unavailable`(주소는 가림). 기록은 큐에서 하나씩 처리한다(nonce 충돌 방지).
- 탐색기 링크: 기록은 `<탐색기>/attestation/view/<uid>`, 스키마는 `<탐색기>/schema/view/<스키마 UID>`. 기록 화면 경로는 문서로 확인하지 못해 화면에 "형식 미확인"을 붙인다.
- 검증 코어(`lib/attest/verify.js`, `jcs.js`, `schema.js`, `abi.js`)는 Node 전용 모듈 없이 viem만 쓰므로 나중에 브라우저에서 RPC로 직접 검증할 때도 쓸 수 있다. `jcs.js`는 `lib/canonical.js`와 같은 규칙의 순수 구현이며 시험으로 같은 결과임을 확인한다.
