// 리포트 해시용 canonical 직렬화 — 브라우저용 사본 (의존성 없음).
// 규칙은 demo/lib/canonical.js와 같다(RFC 8785 JCS 방식). 대시보드 런타임은 배포 루트(dashboard/) 밖을 import하지 않으므로
// 여기 두고, 같은 결과인지는 src/lib/verifyBrowser.test.js가 demo/lib/canonical.js와 비교해 확인한다.
export const CANONICAL_VERSION = "jcs-rfc8785/pbl-demo-v1";
export const EXCLUDED_REPORT_FIELDS = ["timestamp", "dynamic.csv", "trust.csv", "static.file"];

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
