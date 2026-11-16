# 온체인 기록 (EAS, Sepolia) — 스키마 v2

OntoTrace 시연에서 분석 결과(리포트)의 지문을 Sepolia 테스트넷의 EAS(Ethereum Attestation Service)에 기록하고, 대시보드에서 누구나 다시 확인할 수 있게 하는 기능의 설계와 현재 상태를 정리한다.

- 브랜치: `feat/onchain-attestation` (`feat/wallet-layer` 3e06721에서 분기)
- 1단계 조사·설계: 2026-11-17, 2단계 구현: 같은 날
- 이 문서의 범위: 시연 시나리오 5개(정상, 폰지, 러그풀, 자금세탁, 펌프앤덤프). 폰지 실제 주소 흐름은 범위 밖이다(확장 지점은 8절).

## 1. 현재 상태

| 항목 | 상태 |
|---|---|
| 스키마 | v2로 교체(코드에 반영). **Sepolia에는 아직 등록하지 않았다** |
| 기록 | 아직 없음. `demo/fixtures/attestations.sepolia.json`이 없어 스냅샷 5개가 모두 "기록 대기"(상태 B) |
| 서명·호출 | viem으로 EAS·SchemaRegistry를 직접 호출한다. EAS SDK와 ethers는 쓰지 않는다 |
| 탐색기(easscan) 링크 | 꺼져 있음. 첫 기록 뒤 경로를 확인하면 켠다(7절 6단계) |
| 분석기·온톨로지 | 바꾸지 않았다(6절) |

Sepolia 등록과 기록은 되돌릴 수 없고 수수료가 들어서, 사람이 직접 실행한다(7절).

## 2. 승인된 결정

| # | 결정 |
|---|---|
| G-1 | `feat/wallet-layer` 위에 `feat/onchain-attestation`을 만든다 |
| G-2 | 옛 지갑 신뢰 점수(`trustScore`, `minWalletTrustScore`)를 빼고 스키마 v2로 바꾼다. 코드·거래·지갑 필드를 분리하고, 종합 등급 필드는 두지 않는다. `schemaVersion`을 넣고 `refUID`는 자리만 둔다 |
| G-3 | 배포자 Risk Score(높을수록 위험) 필드를 두고, 지금은 "데이터 없음"으로 기록한다 |
| G-4 | 시뮬레이션 컨트랙트 주소는 그대로 기록하고 `subjectChainId = 31337`을 함께 적는다. 화면에는 "시연용 로컬 주소" 안내를 붙인다 |
| G-5 | 폰지 실제 주소 흐름은 이번 범위에서 뺀다. 확장 지점만 남긴다 |
| G-6 | 탐색기 링크는 첫 기록 뒤 경로를 확인한 다음에 켠다 |
| G-7 | 회귀 기준은 `scripts/regression/regress.sh`의 정규화 비교(CR 제거, md `> 생성:` 줄 제외)다. 분석기·온톨로지 파일은 `git diff`로 변경이 없는지 따로 확인한다 |
| G-8 | fixture를 확정한 뒤 한 번만 기록한다 |
| G-9 | v1 해독기는 두지 않는다. Sepolia에 v1 기록이 없기 때문이다. 다른 스키마 UID의 기록은 "이전 형식"으로 보고 비교하지 않는다 |

## 3. 스키마 v2

```
uint16 schemaVersion,uint64 subjectChainId,address contractAddress,bytes32 reportHash,bytes32 inputHash,string codeRiskLevel,string txPatternHint,string walletLayerStatus,uint16 walletRiskScore,bool walletRiskAvailable,uint64 scanTimestamp,string analyzerVersion
```

- resolver 없음(`0x0`), revocable
- 스키마 UID는 `0x9b6bc478cbc260152d400da3c421649562f30e714307b1377888f72de94b1c19`다.
  - 계산식: `keccak256(abi.encodePacked(schema, resolver, revocable))`. SchemaRegistry 컨트랙트 규칙을 따르며, 등록할 때 이벤트의 UID와 같은지 `eas.js` register가 확인한다.
  - 스키마 문자열을 바꾸면 UID가 바뀌고 다시 등록해야 한다. `demo/test/attest.test.js`가 이 값을 고정한다.
- 정의 위치: `demo/lib/attest/schema.js`. 대시보드 사본은 `dashboard/src/lib/onchain.js`에 있고, 같은지는 `verifyBrowser.test.js`가 확인한다.

| 필드 | 값 출처 | 레이어 | 검증 비교 |
|---|---|---|---|
| `schemaVersion` | 상수 2 | — | 같아야 함 |
| `subjectChainId` | `envelope.subject.chainId`. 없으면 31337(시연용 로컬 체인) | 대상 | 같아야 함 |
| `contractAddress` | 거래 행에서 첫 입금을 받은 주소 | 대상 | 같아야 함 |
| `reportHash` | `envelope.report_sha256` (4절) | 전체 | 핵심 |
| `inputHash` | `SHA-256(canonical(envelope.input))`. CSV·.sol 정규화 해시와 seed | 입력 | 같아야 함 |
| `codeRiskLevel` | `prevention.risk_level` | 코드 | 같아야 함 |
| `txPatternHint` | `dynamic.fraud_type_hint` | 거래 | 같아야 함 |
| `walletLayerStatus` | `wallet_layer.status` (`not_applicable` / `evaluated`) | 지갑 | 같아야 함 |
| `walletRiskScore`, `walletRiskAvailable` | 배포자 Risk Score. 지금은 `0`, `false`(데이터 없음) | 지갑(배포자) | 같아야 함 |
| `scanTimestamp` | `report.timestamp` | — | 참고용 |
| `analyzerVersion` | `<git short HEAD>+jcs-rfc8785/pbl-demo-v1` | — | 참고용 |

- 넣지 않은 값:
  - 종합 등급 `report.overall_grade`·`raw_grade`. 분석기 출력이라 리포트에는 남아 있고 해시에도 포함되지만, 기록 필드와 화면에는 쓰지 않는다.
  - 옛 지갑 신뢰 점수 `report.trust.*`(높을수록 안전). 이 값을 뒤집어 Risk Score처럼 쓰지 않는다.
- `recipient`는 `0x0`이다. 시뮬레이션 주소는 Sepolia에서 의미가 없다.
- 시나리오 5개의 기대값:

| 시나리오 | codeRiskLevel | txPatternHint | walletLayerStatus |
|---|---|---|---|
| normal | LOW | normal_staking | not_applicable |
| ponzi | CRITICAL | ponzi_scheme | not_applicable |
| rugpull | CRITICAL | rug_pull | not_applicable |
| laundering | CRITICAL | money_laundering | evaluated |
| pumpdump | CRITICAL | pump_and_dump | not_applicable |

## 4. 해시와 정규화 (v1 규칙 그대로)

- 직렬화 규칙은 RFC 8785 JCS 방식이다(`jcs-rfc8785/pbl-demo-v1`).
  - 키는 UTF-16 코드 단위 순으로 정렬하고 공백을 두지 않는다.
  - 숫자는 ECMAScript 표기를 따르고 NaN·Infinity는 오류로 처리한다.
  - 짝 없는 서로게이트는 오류로 처리하고, undefined는 뺀다.
- `reportHash = SHA-256(canonical(report − 제외 필드))`다. 제외 필드는 `timestamp`, `dynamic.csv`, `trust.csv`, `static.file`로, 실행 시각과 파일 이름이다. keccak이 아니라 SHA-256이다.
- 입력 정규화(envelope.input):
  - CSV: CR·빈 줄·timestamp 열을 빼고 LF로 잇는다.
  - .sol: CRLF를 LF로 바꾼다.
- 재현성 근거:
  1. 구현 세 벌(`demo/lib/canonical.js`, `demo/lib/attest/jcs.js`, `dashboard/src/lib/jcs.js`)이 같은 결과를 내는지 시험한다.
  2. 시뮬레이션 seed가 고정돼 있다.
  3. 줄바꿈 차이는 정규화로 지운다.
  4. 실행마다 바뀌는 필드는 제외 목록에 있다.
  - 시험 "해시 재현성"(`demo/test/attest.test.js`): 키 순서를 뒤집고 파일 이름만 바꾼 사본도 같은 `reportHash`·`inputHash`를 낸다.
- 규칙을 바꾸면 envelope 5개와 스냅샷 해시가 모두 바뀐다. 바꾸지 않는다.

## 5. 서명 방식과 화면

**서명: 오프라인 CLI로 미리 기록하고, 정적 JSON에 저장한다.**
- `demo:eas:record-fixtures`가 `attestations.sepolia.json`을 만들고, `demo:export`가 시나리오별 `attestation.json`을 만든다. 대시보드는 읽고 확인만 한다.
- 키는 사람 PC의 `.env`에만 있고 배포물에는 없다.
- 브라우저 지갑 서명과 서버리스 함수는 쓰지 않는다. 서버리스는 키가 공개 엔드포인트 뒤에 놓여 남용될 위험이 있다.

**화면 (탭 4개는 그대로, 진행 표시 바는 없음)**
- 개요 › 요약 박스: "블록체인 기록" 한 줄.
  - 기록 대기 / 블록체인에 기록됨 / 기록과 일치 / 기록과 다름 / 확인 중 / 지금은 확인 못 함
  - 변조 시연 결과와 파일 무결성 검증 결과는 이 줄에 쓰지 않는다.
- 상세 분석 › 리포트 변조 확인: "블록체인 기록" 카드(`pages/ReportStatic.jsx`).
  - 설명: 지문을 누구나 볼 수 있는 블록체인에 남긴다.
  - "지금 다시 확인하기" 버튼, 결과 한 줄, 필드별 비교표
  - "시연용 로컬 주소" 안내
  - "기록됐다는 것은 결과가 바뀌지 않았다는 뜻이지, 이 컨트랙트가 안전하다는 뜻은 아닙니다."
- 서버 모드 기록 카드(`pages/Report.jsx`)도 12필드와 로컬 주소 안내를 같은 방식으로 보여 준다.
- 변조 시연 예시: 코드 위험 수준, 감지 유형, 출금 합계. 옛 신뢰 점수 예시는 뺐다. 출금 합계는 체인에 따로 적지 않은 값도 지문으로 잡힌다는 것을 보여 준다.

**실패 처리 (`dashboard/src/lib/verifyBrowser.js` `LOOKUP_MESSAGES`)**

조회는 버튼을 눌렀을 때만 하고 페이지 렌더링과 분리돼 있다. viem은 "기록됨"일 때만 동적으로 불러온다. 실패해도 다른 화면은 그대로 동작한다.

| 상황 | 화면 |
|---|---|
| 기록 파일 없음 / Sepolia가 아님 | 기록 대기 |
| `VITE_SEPOLIA_RPC` 없음 | 버튼 꺼짐, "이 배포판에는 블록체인 조회 설정이 없어…" |
| 네트워크·RPC 실패(15초 제한) | 지금은 확인 못 함 — "블록체인에 연결하지 못했습니다. 잠시 뒤 다시 눌러 주세요." |
| 체인 ID 다름 / UID 없음 / 스키마·버전 다름 / 철회됨 / 해독 실패 | 각 사유 문구. RPC 주소와 오류 원문은 노출하지 않는다 |
| 필드 불일치 | 기록과 다름 + 필드별 표 |

## 6. 회귀 기준과 확인 결과 (G-7)

- 기준: `bash scripts/regression/regress.sh --working-tree`(레포 `~/pbl`에서 실행, 사본 트리는 스크립트가 따로 만든다)가 종료 코드 0이어야 한다.
  - 비교는 정규화 비교다: CR 제거, 파일 끝 개행 통일, md의 `> 생성:` 줄 제외, 사본 트리 절대경로를 `<TREE>`로 바꿈.
  - md 원본 바이트는 생성 시각 줄 때문에 실행마다 다를 수 있으므로 byte-identical 요구는 이 정규화 기준으로 대신한다.
- 추가 확인: 분기점 대비 `git diff --stat feat/wallet-layer -- analysis ontology evaluation contracts scripts/regression` 출력이 없어야 한다.
  - 대상에는 `fraud_ontology.js`, `prevention_reasoner.js`, `dynamic_analyzer.js`, `fraud.owl`이 포함된다.
- 2026-11-17 결과:
  - `regress.sh --working-tree`: PASS(exit 0). runPrevention 8개 컨트랙트 main·nested, N=272 생성 4파일, response_reasoner 스모크, 발동 규칙 모두 PASS. 기준선은 `20261014T062358Z_fc9c426`이다.
  - 보호 경로 변경: 0
  - 참고: main 대비로는 `analysis/fraud_ontology.js` 등에 차이가 있지만, 분기점인 `feat/wallet-layer`(3e06721)의 지갑 레이어 커밋에서 생긴 것이고 이번 작업과 관계없다.
- 시험(Node 22, 사본 트리): `node --test demo/test/*.test.js` 152/152, `node --test server/test/*.test.js` 28/28, `npm --prefix dashboard test` 12개 파일 통과, `build:static` 성공

## 7. 사용자가 실행할 순서

모두 WSL `~/pbl`에서 nvm Node 22로 실행한다. 2~3단계만 트랜잭션을 보내며, 되돌릴 수 없고 수수료가 든다.

0. **준비물 확인**
   - 테스트 전용 새 지갑의 개인키. 실제 자금이 있는 지갑은 쓰지 않는다.
   - 그 지갑의 Sepolia ETH. 등록 1건과 기록 5건 분량이며, 스크립트가 보내기 전에 필요한 양을 계산해 보여 준다.
   - 기록용 Sepolia RPC URL
   - 화면 조회용 공개 읽기 전용 RPC URL. 공개 번들에 들어가므로 키가 없거나 도메인 제한이 걸린 주소를 쓴다.
   - `.env.example`을 복사해 `.env`를 만들고 `DEMO_EAS_RPC_URL`, `DEMO_EAS_PRIVATE_KEY`만 채운다.
   - `git check-ignore .env`가 `.env`를 출력하는지(커밋되지 않는지) 확인한다.
   - fixture를 확정한다. 앞으로 분석 코드를 바꿔 리포트가 바뀔 예정이면 기록을 미룬다.
1. `npm run demo:eas:check`
   - 기대 결과: RPC·체인 ID·EAS·SchemaRegistry가 OK이고 스키마는 "미등록"이다. 사전 기록 파일이 없으므로 실패로 끝나는 것이 정상이다.
2. `npm run demo:eas:register`
   - 출력된 스키마 UID가 `0x9b6bc478…94b1c19`(3절)과 같은지 본다.
3. `npm run demo:eas:record-fixtures`
   - 5건을 기록하고 `demo/fixtures/attestations.sepolia.json`을 만든다.
   - 다시 `npm run demo:eas:check`를 돌려 "기록 <시나리오> 일치" 5줄과 "결과: 모두 정상입니다"가 나오는지 확인한다.
4. **UID 반영**
   - `npm run demo:export`를 실행하면 5개가 상태 A가 되고 `dashboard/public/snapshot/<시나리오>/attestation.json`이 생긴다.
   - `node --test demo/test/*.test.js`로 커밋된 스냅샷과 같은지 확인한다.
   - `attestations.sepolia.json`과 스냅샷을 커밋한다. 공개 값만 있고 키는 없다.
5. **화면 확인(로컬)**
   - `VITE_SEPOLIA_RPC=<공개 RPC> npm --prefix dashboard run build:static && npm --prefix dashboard run preview:static`
   - 개요 "블록체인에 기록됨", 상세 분석 › 리포트 변조 확인 "지금 다시 확인하기" → "기록과 일치"(5개)를 확인한다.
6. **easscan 링크 켜기**
   - 기록된 UID 하나로 `https://sepolia.easscan.org/attestation/view/<uid>`를 브라우저에서 연다.
   - 그 기록이 보이면 `demo/lib/attest/config.js`의 `EXPLORER_ATTESTATION_PATH_VERIFIED`를 `true`로 바꾼다.
   - `npm run demo:export`를 다시 실행하고(`explorerUrl`이 채워짐) 시험을 돌린 뒤 커밋한다. 열리지 않으면 `false`로 두고 알려 준다.
7. **Vercel**
   - 프로젝트 환경 변수에 `VITE_SEPOLIA_RPC`(공개 읽기 전용 RPC)를 넣고 재배포한다.
   - https://pb-lblockchain.vercel.app 에서 5단계와 같은 결과가 나오는지 확인한다.

나중에 분석 코드가 바뀌어 fixture 해시가 달라지면 `demo:eas:check`가 "불일치"로 알려 준다. 그때는 확정한 fixture로 `npm run demo:eas:record-fixtures -- --force`를 실행해 새 UID로 다시 기록한다.

## 8. 확장 지점 (구현하지 않음)

- **생애주기 연결(refUID)**: `eas.js`·`local.js`의 `attest(payload, { refUID })` 자리만 있고, 지금은 모두 0으로 기록한다.
  - 같은 대상(`subjectChainId` + `contractAddress`)을 다시 기록할 때 이전 UID를 넣어 잇는다.
  - 이전 기록을 철회할지는 그때 정한다. 화면은 이미 "철회된 기록"을 구분한다.
- **폰지 실제 주소**: 분석 흐름을 붙일 때 envelope에 `subject: { chainId: 1 }`을 넣으면 `subjectChainId`가 1로 기록되고, 화면은 "이더리움 메인넷 (1)"로 보여 준다.
  - 기록은 정적 배포가 아니라 로컬 서버 모드(`POST /api/report/:id/attest`, 시연 PC의 `.env` 키)로 한다.
  - 아직 실제 주소 분석 코드는 이 브랜치에 없다.
- **배포자 Risk Score**: 팀 결과 형식이 정해지면 `buildPayload({ walletRisk: { score } })`로 넘긴다.
  - 0~65535 정수이고, 이때 `walletRiskAvailable = true`가 된다.
  - 대시보드 비교값(`verifyBrowser.js` `currentFields`)도 같은 출처를 읽도록 함께 바꾼다.

## 9. 바뀐 파일

| 구분 | 파일 |
|---|---|
| 스키마·기록 | `demo/lib/attest/schema.js`(v2), `verify.js`(envelope 입력, refUID 반환), `eas.js`·`local.js`(refUID 자리, 탐색기 확인 플래그), `config.js`(`EXPLORER_ATTESTATION_PATH_VERIFIED`), `demo/scripts/eas.js`(이전 형식 판별, 필드 비교, `schemaVersion` 저장), `demo/export.js`(v2 필드, 이전 형식 제외, `explorerUrl`), `server/attest.js` |
| 대시보드 | `dashboard/src/lib/onchain.js`, `verifyBrowser.js`, `attest.js`, `pages/ReportStatic.jsx`, `pages/Report.jsx`, `pages/Overview.jsx`, `components/OverviewParts.jsx` |
| 시험 | `demo/test/attest.test.js`, `attest_eas.test.js`, `export.test.js`, `server/test/server.test.js`, `dashboard/src/lib/attest.test.js`, `verifyBrowser.test.js` |
| 문서 | 이 문서, `demo/README.md` |
| 바꾸지 않음 | `analysis/**`, `ontology/**`, `evaluation/**`, `contracts/**`, `scripts/regression/**`, `demo/lib/canonical.js`, 스냅샷(상태 B라 내용 변화 없음) |

## 10. 출처

- Sepolia EAS `0xC2679fBD37d54388Ce493F1DB75320D236e1815e`, SchemaRegistry `0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0` ("Version 0.26")
  - docs.attest.org 계약 페이지의 원본 Markdown: https://raw.githubusercontent.com/ethereum-attestation-service/eas-docs-site/main/docs/quick--start/contracts.md (docs.attest.org는 클라이언트 렌더링이라 원본을 읽었다)
  - 같은 값이 https://github.com/ethereum-attestation-service/eas-contracts 와 https://github.com/ethereum-attestation-service/eas-sdk README에도 있다.
- SDK 사용법(참고만 하고 의존성으로 들이지 않음): eas-sdk README. refUID는 "참조할 attestation UID, 없으면 ZERO_BYTES32"로 설명돼 있다.
- 문서로 확인하지 못한 것: easscan 기록 화면 경로, SDK의 ethers·Node 요구 사항(npm 페이지가 403을 돌려줬다), 스키마 UID 공식(컨트랙트 코드 근거).
