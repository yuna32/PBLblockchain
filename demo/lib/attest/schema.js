// 온체인 기록 스키마 v2와 payload (docs/ONCHAIN_ATTESTATION.md A절).
//   - 코드·거래·지갑 레이어 필드를 따로 둔다. 종합 등급(overall_grade)과 옛 지갑 신뢰 점수(trust.*)는 넣지 않는다.
//   - 배포자 Risk Score(높을수록 위험)는 자리만 두고, 데이터가 없으면 walletRiskAvailable=false, walletRiskScore=0으로 기록한다.
//   - 생애주기 연결(refUID)은 스키마 필드가 아니라 EAS 요청의 refUID로 한다(eas.js·local.js attestArgs).
// payload는 JSON으로 다루기 쉬운 형태다: 주소·해시는 소문자 0x 문자열, 정수는 number, 참거짓은 boolean.
// 순수 모듈 (viem과 ./jcs.js만 사용, 브라우저에서도 쓸 수 있음).
import { decodeAbiParameters, encodeAbiParameters, encodePacked, keccak256, parseAbiParameters, zeroAddress } from "viem";
import { CANONICAL_VERSION, canonicalize, sha256Hex } from "./jcs.js";

export const SCHEMA_VERSION = 2;
export const SCHEMA =
  "uint16 schemaVersion,uint64 subjectChainId,address contractAddress,bytes32 reportHash,bytes32 inputHash," +
  "string codeRiskLevel,string txPatternHint,string walletLayerStatus,uint16 walletRiskScore,bool walletRiskAvailable," +
  "uint64 scanTimestamp,string analyzerVersion";
export const SCHEMA_RESOLVER = zeroAddress;
export const SCHEMA_REVOCABLE = true;

// 시연 시나리오의 컨트랙트는 로컬 hardhat 체인(31337)에 배포한 시뮬레이션 주소다(실제 이더리움 주소가 아님).
// 실제 주소 분석을 붙일 때는 envelope.subject.chainId(예: 메인넷 1)를 넣으면 그 값을 쓴다(확장 지점, 지금은 없음).
export const SIMULATION_CHAIN_ID = 31337;

// SchemaRegistry의 UID 규칙: keccak256(abi.encodePacked(schema, resolver, revocable)). 체인 조회 없이 결정된다.
// (근거: SchemaRegistry 컨트랙트 코드. 등록할 때 이벤트의 UID와 같은지 eas.js register가 확인한다.)
export function schemaUID(schema = SCHEMA, resolver = SCHEMA_RESOLVER, revocable = SCHEMA_REVOCABLE) {
  return keccak256(encodePacked(["string", "address", "bool"], [schema, resolver, revocable]));
}
export const SCHEMA_PARAMS = parseAbiParameters(SCHEMA);
export const FIELD_NAMES = SCHEMA_PARAMS.map(p => p.name);
// 불일치해도 검증 결과(verified)에 영향을 주지 않는 정보성 필드
export const INFORMATIONAL_FIELDS = new Set(["scanTimestamp", "analyzerVersion"]);
export const ANALYZER_SUFFIX = CANONICAL_VERSION;

// analysis/dynamic_analyzer.js의 DEPOSIT_ACTIONS와 같은 집합
const DEPOSIT_ACTIONS = new Set(["deposit", "stake", "fund_reward_pool"]);
const HEX64 = /^[0-9a-f]{64}$/;

// 거래 행에서 첫 입금을 받은 주소 (실제 값 그대로)
export function contractAddressOf(rows) {
  const row = rows.find(r => DEPOSIT_ACTIONS.has(r.action));
  return row ? String(row.to).toLowerCase() : null;
}

// 입력 무결성 해시: envelope.input(CSV·.sol 정규화 해시, seed)의 canonical 직렬화 SHA-256 (0x 없음)
export function inputHashOf(envelope) {
  if (!envelope?.input || typeof envelope.input !== "object") throw new Error("envelope.input이 없음");
  return sha256Hex(canonicalize(envelope.input));
}

export function subjectChainIdOf(envelope) {
  const id = envelope?.subject?.chainId;
  return Number.isSafeInteger(id) && id > 0 ? id : SIMULATION_CHAIN_ID;
}

// 배포자 Risk Score: { score, available }. 리포트에 아직 없으므로 지금은 늘 "데이터 없음".
// 팀 결과 형식이 정해지면 walletRisk 인자로 { score: 0~65535 정수 } 를 넘긴다.
export function walletRiskOf(walletRisk) {
  if (walletRisk === null || walletRisk === undefined) return { walletRiskScore: 0, walletRiskAvailable: false };
  const n = Number(walletRisk.score);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`walletRisk.score가 0~65535 정수가 아님: ${walletRisk.score}`);
  return { walletRiskScore: n, walletRiskAvailable: true };
}

// report: 리포트 원본, envelope: 같은 분석의 envelope(입력 해시용), rows: 거래 행
// reportHashHex: 64자리 16진수(0x 없음, 기본 envelope.report_sha256), walletRisk: 배포자 Risk Score(없으면 null)
export function buildPayload({ report, envelope, rows, analyzerVersion, reportHashHex, walletRisk = null }) {
  const hash = reportHashHex ?? envelope?.report_sha256;
  if (!HEX64.test(hash ?? "")) throw new Error("reportHash가 없거나 형식이 다름");
  const contractAddress = contractAddressOf(rows);
  if (!contractAddress) throw new Error("거래 행에서 컨트랙트 주소를 찾을 수 없음");
  const ms = Date.parse(report.timestamp);
  if (Number.isNaN(ms)) throw new Error(`report.timestamp 형식이 다름: ${report.timestamp}`);
  return {
    schemaVersion: SCHEMA_VERSION,
    subjectChainId: subjectChainIdOf(envelope),
    contractAddress,
    reportHash: `0x${hash}`,
    inputHash: `0x${inputHashOf(envelope)}`,
    codeRiskLevel: String(report.prevention?.risk_level ?? ""),
    txPatternHint: String(report.dynamic?.fraud_type_hint ?? ""),
    walletLayerStatus: String(report.wallet_layer?.status ?? ""),
    ...walletRiskOf(walletRisk),
    scanTimestamp: Math.floor(ms / 1000),
    analyzerVersion
  };
}

export function encodePayload(p) {
  return encodeAbiParameters(SCHEMA_PARAMS, [
    p.schemaVersion, BigInt(p.subjectChainId), p.contractAddress, p.reportHash, p.inputHash,
    p.codeRiskLevel, p.txPatternHint, p.walletLayerStatus, p.walletRiskScore, p.walletRiskAvailable,
    BigInt(p.scanTimestamp), p.analyzerVersion
  ]);
}

export function decodePayload(data) {
  const v = decodeAbiParameters(SCHEMA_PARAMS, data);
  return {
    schemaVersion: Number(v[0]),
    subjectChainId: Number(v[1]),
    contractAddress: v[2].toLowerCase(),
    reportHash: v[3].toLowerCase(),
    inputHash: v[4].toLowerCase(),
    codeRiskLevel: v[5],
    txPatternHint: v[6],
    walletLayerStatus: v[7],
    walletRiskScore: Number(v[8]),
    walletRiskAvailable: v[9],
    scanTimestamp: Number(v[10]),
    analyzerVersion: v[11]
  };
}
