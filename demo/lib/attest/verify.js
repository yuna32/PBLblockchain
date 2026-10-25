// 검증: 체인에서 읽은 payload와, 현재 리포트로 다시 만든 payload·canonical 해시를 비교한다.
// tamper(시연용 변조)는 리포트의 메모리 사본만 바꾼다 — 원본과 파일은 절대 바꾸지 않는다.
import { canonicalize, hashableReport, reportHash } from "../canonical.js";
import { buildPayload, FIELD_NAMES, INFORMATIONAL_FIELDS } from "./schema.js";

export class TamperError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// tamper = { path: "trust.overall_trust_score", value: 50 }. path는 리포트에 실제 있는 경로만 허용한다.
export function applyTamper(report, tamper) {
  if (!tamper || typeof tamper !== "object" || Array.isArray(tamper)) throw new TamperError("tamper는 { path, value } 객체여야 합니다.", "invalid_tamper");
  if (typeof tamper.path !== "string" || !tamper.path) throw new TamperError("tamper.path가 필요합니다.", "invalid_tamper");
  if (!("value" in tamper) || tamper.value === undefined) throw new TamperError("tamper.value가 필요합니다.", "invalid_tamper");
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
  // canonical 직렬화가 가능한 값인지 미리 확인 (NaN 등)
  try {
    canonicalize(copy);
  } catch (err) {
    throw new TamperError(`tamper.value를 직렬화할 수 없습니다: ${err.message}`, "invalid_tamper");
  }
  return copy;
}

// 두 JSON 값에서 달라진 경로 목록 (객체 키·배열 인덱스 단위)
export function diffPaths(a, b, prefix = "", out = [], limit = 100) {
  if (out.length >= limit) return out;
  const isObj = v => v !== null && typeof v === "object";
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...keys].sort()) {
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

// onChain: 체인에서 디코딩한 payload, snapshot: 기록 당시 canonical 문자열(없으면 null)
export function verifyAgainstChain({ report, rows, onChain, snapshot = null, tamper = null, analyzerVersion }) {
  const current = tamper ? applyTamper(report, tamper) : report;
  const currentHash = reportHash(current);
  let currentPayload;
  try {
    currentPayload = buildPayload({ report: current, rows, analyzerVersion, reportHashHex: currentHash });
  } catch (err) {
    if (tamper) throw new TamperError(`변조한 값으로 기록 필드를 만들 수 없습니다: ${err.message}`, "invalid_tamper");
    throw err;
  }
  const fields = FIELD_NAMES.map(name => {
    const a = onChain[name], b = currentPayload[name];
    const match = typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : a === b;
    return { name, onChain: a, current: b, match, informational: INFORMATIONAL_FIELDS.has(name) };
  });
  const hashMatch = String(onChain.reportHash).toLowerCase() === `0x${currentHash}`;
  const verified = hashMatch && fields.every(f => f.informational || f.match);
  const changedPaths = snapshot ? diffPaths(JSON.parse(snapshot), hashableReport(current)) : [];
  return {
    verified,
    hashMatch,
    onChainReportHash: onChain.reportHash,
    currentReportHash: `0x${currentHash}`,
    fields,
    changedPaths,
    snapshotAvailable: Boolean(snapshot),
    tamperDemo: Boolean(tamper)
  };
}
