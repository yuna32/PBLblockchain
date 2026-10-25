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
상단 메뉴 5개, 오른쪽 패널(시나리오 / 실행 기록), 아이콘 레일. 헤더에 "시뮬레이션 데이터" 배지와 서버 연결 점, 그 아래 진행 표시(입력 → 분석 → 온체인 기록(다음 단계) → 시각화).
주소에 시나리오를 담는다: `#/trade?scenario=ponzi` (열면 그 시나리오의 사전 생성본을 자동 로드, 거래 분석은 `&block=31`로 슬라이더 시작 위치 지정).

1. 개요: headline 결론과 근거(누르면 해당 화면), 조합 판정 2x2, 핵심 수치 4개, 요약 띠, 접히는 패턴·경고.
2. 거래 분석: 블록별 입출금·잔액 차트(시점 이벤트 기준선, 사기면 발현 추정 구간)와 거래 네트워크가 블록 슬라이더·재생(1x/2x)을 공유한다.
3. 신뢰 시트: 코드 위험 카드, 지갑 신뢰 카드(평균과 최저 등급), 지갑별 5축 레이더, 지갑 표, 면책 문구.
4. 온톨로지: 추론 그래프(path 실선, evasionPath 점선, 추론 경로 재생), 시연용 매핑 안내, 노드 설명.
5. 온체인 리포트: 리포트 해시, 입력 해시, canonical JSON, Attestation(다음 단계에서 연결).
