// 온체인 기록 스키마와 payload (계획서 기능 5, 종합 등급 없음).
// payload는 JSON으로 다루기 쉬운 형태다: 주소·해시는 소문자 0x 문자열, 정수는 number.
import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters } from "viem";
import { CANONICAL_VERSION } from "../canonical.js";

export const SCHEMA =
  "address contractAddress,bytes32 reportHash,string codeRiskGrade,uint8 trustScore," +
  "uint8 minWalletTrustScore,uint64 scanTimestamp,string analyzerVersion";
export const SCHEMA_PARAMS = parseAbiParameters(SCHEMA);
export const FIELD_NAMES = SCHEMA_PARAMS.map(p => p.name);
// 불일치해도 검증 결과(verified)에 영향을 주지 않는 정보성 필드
export const INFORMATIONAL_FIELDS = new Set(["scanTimestamp", "analyzerVersion"]);
export const ANALYZER_SUFFIX = CANONICAL_VERSION;

// analysis/dynamic_analyzer.js의 DEPOSIT_ACTIONS와 같은 집합
const DEPOSIT_ACTIONS = new Set(["deposit", "stake", "fund_reward_pool"]);

// 거래 행에서 첫 입금을 받은 주소 (실제 값 그대로)
export function contractAddressOf(rows) {
  const row = rows.find(r => DEPOSIT_ACTIONS.has(r.action));
  return row ? String(row.to).toLowerCase() : null;
}

function uint8(value, name) {
  const n = Math.round(Number(value));
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(`${name}가 0~255 정수가 아님: ${value}`);
  return n;
}

// report: 리포트 원본, rows: 거래 행, reportHashHex: 64자리 16진수(0x 없음, 기본 envelope.report_sha256)
export function buildPayload({ report, envelope, rows, analyzerVersion, reportHashHex }) {
  const hash = reportHashHex ?? envelope?.report_sha256;
  if (!/^[0-9a-f]{64}$/.test(hash ?? "")) throw new Error("reportHash가 없거나 형식이 다름");
  const contractAddress = contractAddressOf(rows);
  if (!contractAddress) throw new Error("거래 행에서 컨트랙트 주소를 찾을 수 없음");
  const wallets = report.trust?.wallet_scores ?? [];
  if (!wallets.length) throw new Error("지갑 점수가 없음");
  const ms = Date.parse(report.timestamp);
  if (Number.isNaN(ms)) throw new Error(`report.timestamp 형식이 다름: ${report.timestamp}`);
  return {
    contractAddress,
    reportHash: `0x${hash}`,
    codeRiskGrade: String(report.prevention?.risk_level ?? ""),
    trustScore: uint8(report.trust.overall_trust_score, "trustScore"),
    minWalletTrustScore: uint8(Math.min(...wallets.map(w => w.trust_score)), "minWalletTrustScore"),
    scanTimestamp: Math.floor(ms / 1000),
    analyzerVersion: analyzerVersion
  };
}

export function encodePayload(p) {
  return encodeAbiParameters(SCHEMA_PARAMS, [
    p.contractAddress, p.reportHash, p.codeRiskGrade, p.trustScore, p.minWalletTrustScore, BigInt(p.scanTimestamp), p.analyzerVersion
  ]);
}

export function decodePayload(data) {
  const v = decodeAbiParameters(SCHEMA_PARAMS, data);
  return {
    contractAddress: v[0].toLowerCase(),
    reportHash: v[1].toLowerCase(),
    codeRiskGrade: v[2],
    trustScore: Number(v[3]),
    minWalletTrustScore: Number(v[4]),
    scanTimestamp: Number(v[5]),
    analyzerVersion: v[6]
  };
}
