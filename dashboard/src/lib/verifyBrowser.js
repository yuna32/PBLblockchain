// 브라우저 검증 (정적 모드). 서버 호출 없음.
//   verifyIntegrity: 리포트 무결성 — 스냅샷 리포트를 canonical로 직렬화해 WebCrypto SHA-256으로 해시하고 envelope의 해시와 비교.
//                    온체인 검증이 아니라 "배포된 파일이 변조되지 않았음"을 보여 준다.
//   verifyOnchain:   상태 A일 때만. viem을 동적 import해(./onchain.js) 읽기 전용 RPC로 EAS.getAttestation(uid)를 읽고 필드별로 비교.
//                    상태 B에서는 import 자체를 하지 않는다(번들에 viem이 로드되지 않음).
// 변조 시연은 리포트의 메모리 사본만 바꿔 verifyIntegrity를 다시 실행한다(원본·파일·서버 변경 없음).
import { canonicalize, hashableReport } from "./jcs.js";
import { attestStatusOf, SEPOLIA_CHAIN_ID } from "./attestStatus.js";

export { attestStatusOf } from "./attestStatus.js";

// 공개 RPC 주소는 빌드할 때 VITE_SEPOLIA_RPC로만 정한다(선택). 기본값을 코드에 두지 않는다.
export const CONFIGURED_RPC = import.meta.env?.VITE_SEPOLIA_RPC || null;

export async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("이 브라우저 환경에서는 WebCrypto(crypto.subtle)를 쓸 수 없습니다 (https 또는 localhost에서 여세요).");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export class TamperError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// tamper = { path, value }. 리포트에 실제 있는 경로만 허용하고, 사본만 바꾼다 (demo/lib/attest/verify.js applyTamper와 같은 규칙).
export function applyTamper(report, tamper) {
  if (!tamper || typeof tamper !== "object" || typeof tamper.path !== "string" || !tamper.path || tamper.value === undefined) {
    throw new TamperError("tamper는 { path, value } 객체여야 합니다.", "invalid_tamper");
  }
  const segments = tamper.path.split(".");
  const copy = structuredClone(report);
  let node = copy;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const exists = node !== null && typeof node === "object" &&
      (Array.isArray(node) ? /^\d+$/.test(seg) && Number(seg) < node.length : Object.prototype.hasOwnProperty.call(node, seg));
    if (!exists) throw new TamperError(`리포트에 없는 경로입니다: ${tamper.path}`, "invalid_tamper_path");
    if (i === segments.length - 1) node[seg] = tamper.value;
    else node = node[seg];
  }
  return copy;
}

// 두 JSON 값에서 달라진 경로 (객체 키·배열 인덱스 단위)
export function diffPaths(a, b, prefix = "", out = [], limit = 100) {
  if (out.length >= limit) return out;
  const isObj = v => v !== null && typeof v === "object";
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (!(k in a) || !(k in b)) out.push(p);
      else diffPaths(a[k], b[k], p, out, limit);
      if (out.length >= limit) break;
    }
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(prefix || "(root)");
  return out;
}

// snapshot: { report, envelope, canonical: { canonical, hash } }
// → { ok, localHash, expectedHash, canonicalMatches, changedPaths, tamperDemo } (해시는 0x 접두사)
export async function verifyIntegrity(snapshot, { tamper = null } = {}) {
  const { report, envelope } = snapshot;
  const current = tamper ? applyTamper(report, tamper) : report;
  const text = canonicalize(hashableReport(current));
  const localHash = `0x${await sha256Hex(text)}`;
  const expectedHash = `0x${envelope.report_sha256}`;
  // 배포된 canonical.json도 같은 해시인지 (원본 검증일 때만 의미가 있다)
  const deployedCanonical = snapshot.canonical?.canonical ?? null;
  const canonicalMatches = deployedCanonical === null ? null : `0x${await sha256Hex(deployedCanonical)}` === expectedHash;
  const changedPaths = tamper ? diffPaths(hashableReport(report), hashableReport(current)) : [];
  const ok = localHash === expectedHash && (tamper ? true : canonicalMatches !== false);
  return { ok, localHash, expectedHash, canonicalMatches, changedPaths, tamperDemo: Boolean(tamper) };
}

// verifyView(lib/attest.js)에 넘길 수 있는 모양으로
export function integrityResult(r) {
  return {
    uid: null, verified: r.ok, hashMatch: r.localHash === r.expectedHash,
    onChainReportHash: r.expectedHash, currentReportHash: r.localHash,
    fields: [], changedPaths: r.changedPaths, snapshotAvailable: true, tamperDemo: r.tamperDemo
  };
}

// 현재 리포트에서 다시 만든 비교 필드 (demo/lib/attest/schema.js buildPayload와 같은 규칙)
const DEPOSIT_ACTIONS = new Set(["deposit", "stake", "fund_reward_pool"]);
export const ONCHAIN_FIELDS = ["reportHash", "contractAddress", "codeRiskGrade", "trustScore", "minWalletTrustScore"];
export function currentFields(report, rows, localHash) {
  const deposit = (rows ?? []).find(r => DEPOSIT_ACTIONS.has(r.action));
  const wallets = report.trust?.wallet_scores ?? [];
  return {
    reportHash: localHash.toLowerCase(),
    contractAddress: deposit ? String(deposit.to).toLowerCase() : null,
    codeRiskGrade: String(report.prevention?.risk_level ?? ""),
    trustScore: Math.round(Number(report.trust?.overall_trust_score)),
    minWalletTrustScore: wallets.length ? Math.round(Math.min(...wallets.map(w => w.trust_score))) : null
  };
}

// 조회 실패(상태 C) 메시지. RPC 주소나 원래 오류 문자열은 넣지 않는다.
export const LOOKUP_MESSAGES = {
  rpc_not_configured: "RPC 미설정: 빌드할 때 VITE_SEPOLIA_RPC를 지정해야 온체인 조회를 할 수 있습니다.",
  network: "조회 실패: RPC에 연결할 수 없습니다(네트워크 오류). 잠시 뒤 다시 시도하세요.",
  chain_mismatch: "조회 실패: RPC가 Sepolia(체인 ID 11155111)가 아닙니다. VITE_SEPOLIA_RPC를 확인하세요.",
  uid_not_found: "조회 실패: 이 UID의 기록이 체인에 없습니다.",
  schema_mismatch: "조회 실패: 체인의 기록이 이 데모의 스키마와 다릅니다.",
  decode: "조회 실패: 체인의 기록을 해석할 수 없습니다."
};
export const MISMATCH_MESSAGE = "검증 실패(불일치): 체인에 기록된 값과 배포된 리포트가 다릅니다.";

const lookupFailed = (reason, extra = {}) => ({ status: "lookup_failed", reason, message: LOOKUP_MESSAGES[reason], ...extra });

// snapshot: { report, envelope, timeseries, attestation }
// options: rpcUrl(기본 VITE_SEPOLIA_RPC), loadModule(시험용 — 기본은 ./onchain.js 동적 import)
// → { status: "match" | "mismatch", fields, onChainReportHash, currentReportHash }
//   | { status: "lookup_failed", reason, message } | { status: "not_applicable" }
export async function verifyOnchain(uid, snapshot, { rpcUrl = CONFIGURED_RPC, loadModule = () => import("./onchain.js") } = {}) {
  if (attestStatusOf(snapshot.attestation) !== "A") return { status: "not_applicable" };
  if (!rpcUrl) return lookupFailed("rpc_not_configured");
  const mod = await loadModule();
  const reader = mod.createReader({ rpcUrl, easAddress: snapshot.attestation.contract });
  let chainId;
  try {
    chainId = await reader.getChainId();
  } catch {
    return lookupFailed("network");
  }
  if (chainId !== SEPOLIA_CHAIN_ID) return lookupFailed("chain_mismatch", { chainId });
  let att;
  try {
    att = await reader.getAttestation(uid);
  } catch {
    return lookupFailed("network");
  }
  if (!att) return lookupFailed("uid_not_found");
  if (String(att.schema).toLowerCase() !== String(snapshot.attestation.schemaUID).toLowerCase()) return lookupFailed("schema_mismatch");
  let onChain;
  try {
    onChain = mod.decodePayload(att.data);
  } catch {
    return lookupFailed("decode");
  }
  const { localHash } = await verifyIntegrity(snapshot);
  const current = currentFields(snapshot.report, snapshot.timeseries, localHash);
  const fields = ONCHAIN_FIELDS.map(name => {
    const a = onChain[name], b = current[name];
    const match = typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : a === b;
    return { name, onChain: a, current: b, match, informational: false };
  });
  const ok = fields.every(f => f.match);
  return {
    status: ok ? "match" : "mismatch",
    message: ok ? null : MISMATCH_MESSAGE,
    uid, fields,
    onChainReportHash: onChain.reportHash, currentReportHash: current.reportHash
  };
}

// verifyView(lib/attest.js)에 넘길 수 있는 모양으로
export function onchainResult(r) {
  return {
    uid: r.uid, verified: r.status === "match", hashMatch: r.onChainReportHash === r.currentReportHash,
    onChainReportHash: r.onChainReportHash, currentReportHash: r.currentReportHash,
    fields: r.fields, changedPaths: [], snapshotAvailable: false, tamperDemo: false
  };
}
