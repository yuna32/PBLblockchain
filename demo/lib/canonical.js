// 리포트 해시용 canonical 직렬화 (RFC 8785 JCS 방식)와 SHA-256.
//
// 직렬화 규칙 (RFC 8785):
//   - 객체 키는 UTF-16 코드 단위 순으로 정렬 (JS 기본 sort와 같음)
//   - 공백 없음
//   - 숫자는 ECMAScript Number→String 표기 (JSON.stringify와 같음, -0은 "0"), NaN/Infinity는 오류
//   - 문자열 이스케이프는 JSON.stringify와 같음 (", \, U+0000~U+001F만 이스케이프, 16진수 소문자)
//   - 짝 없는 서로게이트가 든 문자열은 오류
//   - undefined·함수 값을 가진 키는 빼고, 배열 안의 undefined·함수는 null (JSON.stringify와 같음)
//
// 리포트 해시에서 빼는 필드 (실행마다, 또는 파일 이름에 따라 바뀌는 값):
//   timestamp, dynamic.csv, trust.csv, static.file
// 리포트에는 거래 행이 없으므로 입력 무결성은 envelope.input에 따로 담는다:
//   CSV: CR 제거, 빈 줄 제거, timestamp 열 제외 후 LF로 이어 SHA-256
//   .sol: CRLF→LF 후 SHA-256 (저장소 .sol 8개 중 2개가 CRLF)

import crypto from "node:crypto";
import { splitCsvLines } from "./csv.js";

export const CANONICAL_VERSION = "jcs-rfc8785/pbl-demo-v1";
export const EXCLUDED_REPORT_FIELDS = ["timestamp", "dynamic.csv", "trust.csv", "static.file"];
export const CSV_NORMALIZATION = "CR 제거, 빈 줄 제거, timestamp 열 제외, LF로 연결 (마지막 줄바꿈 없음)";
export const SOL_NORMALIZATION = "CRLF→LF";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function serializeString(s) {
  if (LONE_SURROGATE.test(s)) throw new TypeError("canonicalize: 짝 없는 서로게이트가 든 문자열");
  return JSON.stringify(s);
}

function isOmitted(v) {
  return v === undefined || typeof v === "function" || typeof v === "symbol";
}

export function canonicalize(value) {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`canonicalize: 유한하지 않은 숫자 ${value}`);
      return JSON.stringify(value);
    case "string":
      return serializeString(value);
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map(v => (isOmitted(v) ? "null" : canonicalize(v))).join(",") + "]";
      }
      const keys = Object.keys(value).filter(k => !isOmitted(value[k])).sort();
      return "{" + keys.map(k => serializeString(k) + ":" + canonicalize(value[k])).join(",") + "}";
    }
    default:
      throw new TypeError(`canonicalize: 지원하지 않는 타입 ${typeof value}`);
  }
}

export function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// 해시 대상 리포트: 원본은 그대로 두고 복사본에서 EXCLUDED_REPORT_FIELDS를 지운다.
export function hashableReport(report) {
  const copy = structuredClone(report);
  for (const field of EXCLUDED_REPORT_FIELDS) {
    const parts = field.split(".");
    let obj = copy;
    for (const p of parts.slice(0, -1)) obj = obj?.[p];
    if (obj && typeof obj === "object") delete obj[parts[parts.length - 1]];
  }
  return copy;
}

export function reportHash(report) {
  return sha256Hex(canonicalize(hashableReport(report)));
}

export function normalizeCsv(text) {
  const lines = splitCsvLines(text);
  if (lines.length === 0) return "";
  const tsIdx = lines[0].split(",").indexOf("timestamp");
  const kept = tsIdx === -1
    ? lines
    : lines.map(line => line.split(",").filter((_, i) => i !== tsIdx).join(","));
  return kept.join("\n");
}

export function normalizeSol(text) {
  return text.replace(/\r\n/g, "\n");
}

// envelope: 해시 값과 메타 정보. envelope 자체는 해시 대상이 아니다.
export function buildEnvelope({ scenario, contract, source, report, csvText, csvFile, solText, solFile, seed = null, createdAt = new Date().toISOString() }) {
  return {
    canonical_version: CANONICAL_VERSION,
    scenario,
    contract,
    source,
    report_sha256: reportHash(report),
    report_hash_excluded: EXCLUDED_REPORT_FIELDS,
    input: {
      csv: { file: csvFile, sha256: sha256Hex(normalizeCsv(csvText)), normalization: CSV_NORMALIZATION },
      sol: { file: solFile, sha256: sha256Hex(normalizeSol(solText)), normalization: SOL_NORMALIZATION },
      seed
    },
    created_at: createdAt
  };
}

// envelope의 세 해시를 다시 계산해 비교한다.
export function verifyEnvelope(envelope, { report, csvText, solText }) {
  return {
    report: envelope.report_sha256 === reportHash(report),
    csv:    envelope.input.csv.sha256 === sha256Hex(normalizeCsv(csvText)),
    sol:    envelope.input.sol.sha256 === sha256Hex(normalizeSol(solText))
  };
}
