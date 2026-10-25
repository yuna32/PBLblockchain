// node --test demo/test/  (체인 없이 도는 단위 시험)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SCHEMA, FIELD_NAMES, buildPayload, contractAddressOf, decodePayload, encodePayload } from "../lib/attest/schema.js";
import { applyTamper, diffPaths, TamperError, verifyAgainstChain } from "../lib/attest/verify.js";
import { analyzerVersion } from "../lib/attest/version.js";
import { redact } from "../lib/attest/redact.js";
import { createAttestService } from "../lib/attest/index.js";
import { sanitizeEnv, SECRET_ENV_PATTERN } from "../run.js";
import { toTimeseries } from "../lib/timeseries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CSV = { normal: "normal_log.csv", ponzi: "ponzi_log.csv", rugpull: "rugpull_log.csv", laundering: "laundering_log.csv", pumpdump: "pumpdump_log.csv" };
const VERSION = "abc1234+jcs-rfc8785/pbl-demo-v1";

function load(name) {
  const dir = path.join(ROOT, "demo", "fixtures", name);
  return {
    report: JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")),
    envelope: JSON.parse(fs.readFileSync(path.join(dir, "envelope.json"), "utf8")),
    rows: toTimeseries(fs.readFileSync(path.join(dir, CSV[name]), "utf8"))
  };
}

// 시나리오별 기대값: [trustScore, minWalletTrustScore, codeRiskGrade]
const EXPECTED = {
  normal: [86, 78, "LOW"], ponzi: [49, 8, "CRITICAL"], rugpull: [46, 8, "CRITICAL"],
  laundering: [57, 30, "CRITICAL"], pumpdump: [73, 58, "CRITICAL"]
};

test("스키마: 7필드, 종합 등급 없음", () => {
  assert.deepEqual(FIELD_NAMES, ["contractAddress", "reportHash", "codeRiskGrade", "trustScore", "minWalletTrustScore", "scanTimestamp", "analyzerVersion"]);
  assert.ok(!/grade\b.*overall|overall/i.test(SCHEMA));
});

for (const [name, [trust, minWallet, grade]] of Object.entries(EXPECTED)) {
  test(`payload ${name}: 값 출처와 인코딩 왕복`, () => {
    const { report, envelope, rows } = load(name);
    const p = buildPayload({ report, envelope, rows, analyzerVersion: VERSION });
    assert.equal(p.contractAddress, "0x5fbdb2315678afecb367f032d93f642f64180aa3");
    assert.equal(p.contractAddress, contractAddressOf(rows));
    assert.equal(p.reportHash, `0x${envelope.report_sha256}`);
    assert.equal(p.codeRiskGrade, grade);
    assert.equal(p.trustScore, trust);
    assert.equal(p.minWalletTrustScore, minWallet);
    assert.equal(p.scanTimestamp, Math.floor(Date.parse(report.timestamp) / 1000));
    assert.equal(p.analyzerVersion, VERSION);
    assert.deepEqual(decodePayload(encodePayload(p)), p);
  });
}

test("payload 입력 오류", () => {
  const { report, envelope, rows } = load("ponzi");
  assert.throws(() => buildPayload({ report, envelope: { report_sha256: "xyz" }, rows, analyzerVersion: VERSION }), /reportHash/);
  assert.throws(() => buildPayload({ report, envelope, rows: [], analyzerVersion: VERSION }), /주소/);
  const bad = structuredClone(report);
  bad.trust.overall_trust_score = 300;
  assert.throws(() => buildPayload({ report: bad, envelope, rows, analyzerVersion: VERSION }), /0~255/);
});

test("applyTamper: 사본만 바꾸고, 없는 경로는 거부", () => {
  const { report } = load("ponzi");
  const before = JSON.stringify(report);
  const t = applyTamper(report, { path: "trust.overall_trust_score", value: 50 });
  assert.equal(t.trust.overall_trust_score, 50);
  assert.equal(JSON.stringify(report), before, "원본은 그대로");
  assert.equal(applyTamper(report, { path: "trust.wallet_scores.0.trust_score", value: 1 }).trust.wallet_scores[0].trust_score, 1);
  for (const bad of [{ path: "trust.nope", value: 1 }, { path: "trust.wallet_scores.99.trust_score", value: 1 }, { path: "__proto__.x", value: 1 }]) {
    assert.throws(() => applyTamper(report, bad), e => e instanceof TamperError && e.code === "invalid_tamper_path", bad.path);
  }
  for (const bad of [null, [], { value: 1 }, { path: "trust.overall_trust_score" }]) {
    assert.throws(() => applyTamper(report, bad), e => e instanceof TamperError && e.code === "invalid_tamper");
  }
});

test("diffPaths", () => {
  assert.deepEqual(diffPaths({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 3] } }), ["b.c.1"]);
  assert.deepEqual(diffPaths({ a: 1 }, { a: 1, z: 2 }), ["z"]);
  assert.deepEqual(diffPaths({ a: 1 }, { a: 1 }), []);
});

test("verifyAgainstChain: 일치, 변조, 정보성 필드", async () => {
  const { report, envelope, rows } = load("pumpdump");
  const onChain = buildPayload({ report, envelope, rows, analyzerVersion: VERSION });
  const { canonicalize, hashableReport } = await import("../lib/canonical.js");
  const snapshot = canonicalize(hashableReport(report));

  const ok = verifyAgainstChain({ report, rows, onChain, snapshot, analyzerVersion: VERSION });
  assert.equal(ok.verified, true);
  assert.equal(ok.hashMatch, true);
  assert.deepEqual(ok.changedPaths, []);
  assert.equal(ok.tamperDemo, false);
  assert.ok(ok.fields.every(f => f.match));
  assert.deepEqual(ok.fields.filter(f => f.informational).map(f => f.name), ["scanTimestamp", "analyzerVersion"]);

  const tampered = verifyAgainstChain({ report, rows, onChain, snapshot, analyzerVersion: VERSION, tamper: { path: "trust.overall_trust_score", value: 50 } });
  assert.equal(tampered.verified, false);
  assert.equal(tampered.hashMatch, false);
  assert.equal(tampered.tamperDemo, true);
  assert.deepEqual(tampered.changedPaths, ["trust.overall_trust_score"]);
  assert.deepEqual(tampered.fields.filter(f => !f.match).map(f => f.name), ["reportHash", "trustScore"]);

  // 해시에서 빠지는 timestamp만 바꾸면 해시는 같고, scanTimestamp 불일치는 정보성이라 verified 유지
  const ts = verifyAgainstChain({ report, rows, onChain, snapshot, analyzerVersion: VERSION, tamper: { path: "timestamp", value: "2030-01-01T00:00:00.000Z" } });
  assert.equal(ts.hashMatch, true);
  assert.equal(ts.verified, true);
  assert.equal(ts.fields.find(f => f.name === "scanTimestamp").match, false);

  // 서버 분석기 버전이 달라도 verified 유지
  assert.equal(verifyAgainstChain({ report, rows, onChain, analyzerVersion: "other+x" }).verified, true);

  // 스냅샷이 없으면 changedPaths는 비고 snapshotAvailable=false
  const noSnap = verifyAgainstChain({ report, rows, onChain, analyzerVersion: VERSION, tamper: { path: "dynamic.dynamic_risk_score", value: 1 } });
  assert.deepEqual([noSnap.hashMatch, noSnap.snapshotAvailable, noSnap.changedPaths], [false, false, []]);

  // 변조값이 기록 필드 범위를 벗어나면 invalid_tamper
  assert.throws(() => verifyAgainstChain({ report, rows, onChain, analyzerVersion: VERSION, tamper: { path: "trust.overall_trust_score", value: 999 } }),
    e => e instanceof TamperError && e.code === "invalid_tamper");
});

test("analyzerVersion 형식 (git 최상위가 아니면 unknown)", () => {
  assert.match(analyzerVersion(ROOT), /^([0-9a-f]{7,}|unknown)\+jcs-rfc8785\/pbl-demo-v1$/);
  assert.equal(analyzerVersion(path.join(ROOT, "demo")), "unknown+jcs-rfc8785/pbl-demo-v1");
});

test("redact: 지정한 비밀 문자열과 URL을 가림", () => {
  const out = redact("connect to https://rpc.example.org/v3/secret-xyz failed (key abc-key)", ["abc-key"]);
  assert.ok(!out.includes("secret-xyz") && !out.includes("rpc.example.org") && !out.includes("abc-key"), out);
  assert.match(out, /<rpc>/);
});

test("sanitizeEnv: 키·니모닉·RPC·EAS·DEMO_ATTEST 변수 제외", () => {
  const env = sanitizeEnv({ PATH: "/bin", HOME: "/h", EAS_PRIVATE_KEY: "k", MY_PRIVATE_KEY: "k", MNEMONIC: "m", SEPOLIA_RPC_URL: "u", DEMO_ATTEST_RPC_URL: "u", eas_x: "x", DEMO_SEED: "s" });
  assert.deepEqual(Object.keys(env).sort(), ["DEMO_SEED", "HOME", "PATH"]);
  assert.ok(SECRET_ENV_PATTERN.test("ALCHEMY_RPC"));
});

test("서비스: 꺼져 있으면 local 비활성, eas-sepolia는 미설정 표시", async () => {
  const svc = createAttestService({ enabled: false });
  assert.deepEqual(await svc.start(), { available: false, reason: "비활성 (서버 설정에서 꺼짐)" });
  assert.deepEqual(svc.list(), [
    { id: "local", label: "로컬 체인 (hardhat)", available: false, reason: "비활성 (서버 설정에서 꺼짐)" },
    { id: "eas-sepolia", label: "EAS (Sepolia 테스트넷)", available: false, reason: "미설정(4c에서 구현)" }
  ]);
  await assert.rejects(svc.get("eas-sepolia").attest({}), /4c/);
  assert.equal(svc.get("nope"), null);
});
