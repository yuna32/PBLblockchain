// node --test demo/test/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  canonicalize, sha256Hex, reportHash, hashableReport, normalizeCsv, normalizeSol,
  buildEnvelope, verifyEnvelope, EXCLUDED_REPORT_FIELDS
} from "../lib/canonical.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const FIXTURES = path.join(__dirname, "..", "fixtures");
const SCENARIOS = ["normal", "ponzi", "rugpull", "laundering", "pumpdump"];

test("RFC 8785 3.2.2 예시와 같은 출력", () => {
  const input = {
    numbers: [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],
    // RFC 8785 3.2.2 입력 문자열: 유로 기호, $, U+000F, 줄바꿈, A, ', B, ", \, \, ", /
    string: String.fromCharCode(0x20ac, 0x24, 0x0f, 0x0a, 0x41, 0x27, 0x42, 0x22, 0x5c, 0x5c, 0x22, 0x2f),
    literals: [null, true, false]
  };
  const expected = String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`;
  assert.equal(canonicalize(input), expected);
});

test("키 정렬·중첩·-0·undefined 처리", () => {
  assert.equal(canonicalize({ b: 1, a: { d: [1, undefined], c: -0 }, z: undefined }), '{"a":{"c":0,"d":[1,null]},"b":1}');
  assert.equal(canonicalize({ "é": 1, "z": 2, "A": 3 }), '{"A":3,"z":2,"é":1}');
});

test("유한하지 않은 숫자·짝 없는 서로게이트는 오류", () => {
  assert.throws(() => canonicalize({ x: NaN }));
  assert.throws(() => canonicalize({ x: Infinity }));
  assert.throws(() => canonicalize({ x: "\uD800" }));
});

function sampleReport() {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, "ponzi", "report.json"), "utf8"));
}

test("같은 리포트 두 번 → 같은 해시", () => {
  assert.equal(reportHash(sampleReport()), reportHash(sampleReport()));
});

test("제외 필드(timestamp·파일 이름)만 바꾸면 해시 그대로", () => {
  const a = sampleReport();
  const b = sampleReport();
  b.timestamp = "2000-01-01T00:00:00.000Z";
  b.dynamic.csv = "job-123.csv";
  b.trust.csv = "job-123.csv";
  b.static.file = "Other.sol";
  assert.equal(reportHash(a), reportHash(b));
  assert.deepEqual(EXCLUDED_REPORT_FIELDS, ["timestamp", "dynamic.csv", "trust.csv", "static.file"]);
  assert.equal(hashableReport(a).timestamp, undefined);
  assert.ok(a.timestamp, "원본 리포트는 바뀌지 않아야 함");
});

test("리포트 한 글자 변경 → 다른 해시", () => {
  const a = sampleReport();
  const b = sampleReport();
  b.trust.summary_ko = b.trust.summary_ko.replace("총", "춍");
  assert.notEqual(reportHash(a), reportHash(b));
  const c = sampleReport();
  c.overall_grade = "E";
  assert.notEqual(reportHash(a), reportHash(c));
});

test("CSV 정규화: CRLF·timestamp 열은 해시에 영향 없음, 금액 한 글자는 영향 있음", () => {
  const lf = "block,timestamp,from,amount_eth\n4,100,0xa,1.0\n7,101,0xb,2.0";
  const crlf = "block,timestamp,from,amount_eth\r\n4,999,0xa,1.0\r\n7,998,0xb,2.0\r\n";
  assert.equal(normalizeCsv(lf), "block,from,amount_eth\n4,0xa,1.0\n7,0xb,2.0");
  assert.equal(sha256Hex(normalizeCsv(lf)), sha256Hex(normalizeCsv(crlf)));
  assert.notEqual(sha256Hex(normalizeCsv(lf)), sha256Hex(normalizeCsv(lf.replace("2.0", "2.1"))));
  assert.equal(normalizeSol("a\r\nb\n"), "a\nb\n");
});

for (const name of SCENARIOS) {
  test(`fixture ${name}: envelope 해시 3개가 다시 계산한 값과 같음`, () => {
    const dir = path.join(FIXTURES, name);
    const envelope = JSON.parse(fs.readFileSync(path.join(dir, "envelope.json"), "utf8"));
    const report = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8"));
    const csvText = fs.readFileSync(path.join(dir, envelope.input.csv.file), "utf8");
    const solText = fs.readFileSync(path.join(ROOT, "contracts", envelope.input.sol.file), "utf8");
    assert.deepEqual(verifyEnvelope(envelope, { report, csvText, solText }), { report: true, csv: true, sol: true });
    const rebuilt = buildEnvelope({ ...envelope, report, csvText, csvFile: envelope.input.csv.file, solText, solFile: envelope.input.sol.file, seed: envelope.input.seed, createdAt: envelope.created_at });
    assert.deepEqual(rebuilt, envelope);
  });
}
