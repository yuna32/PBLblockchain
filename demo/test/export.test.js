// demo/export.js 시험: 결정성, 증명 상태(A/B), 공개 값만 내보내기, 출력물 자체 검사, 커밋된 스냅샷이 최신인지.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { exportSnapshot, publicAttestation, scanOutput, sortKeys } from "../export.js";
import { schemaUID } from "../lib/attest/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const COMMITTED = path.join(ROOT, "dashboard", "public", "snapshot");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pbl-export-test-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const UID = `0x${"ab".repeat(32)}`;
const TX = `0x${"cd".repeat(32)}`;
const quiet = () => {};

function digest(dir) {
  const out = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else out.push(`${path.relative(dir, p)} ${crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")}`);
  });
  walk(dir);
  return out.sort();
}

function sepoliaEntry(reportHash, overrides = {}) {
  return {
    scenario: "ponzi", uid: UID, txHash: TX, chainId: 11155111, attester: "0x1111111111111111111111111111111111111111",
    schemaUID: schemaUID(), contract: "0xC2679fBD37d54388Ce493F1DB75320D236e1815e", blockNumber: 7, recordedAt: "2026-10-25T00:00:00.000Z",
    reportHash, payload: { contractAddress: "0x5fbdb2315678afecb367f032d93f642f64180aa3", reportHash, codeRiskGrade: "CRITICAL", trustScore: 49, minWalletTrustScore: 8, scanTimestamp: 1, analyzerVersion: "x", extra: "버려야 함" },
    privateKey: "should-not-be-copied", rpcUrl: "https://should-not-be-copied", ...overrides
  };
}

test("같은 입력이면 같은 출력 (두 번 내보내기), 증명 파일이 없으면 모두 상태 B", async () => {
  const a = path.join(tmp, "a"), b = path.join(tmp, "b");
  const logs = [];
  const r = await exportSnapshot({ outDir: a, attestationsFile: path.join(tmp, "none.json"), sourceCommit: "abc1234", log: m => logs.push(m) });
  await exportSnapshot({ outDir: b, attestationsFile: path.join(tmp, "none.json"), sourceCommit: "abc1234", log: quiet });
  assert.deepEqual(digest(a), digest(b));
  assert.equal(r.files.length, 31);
  assert.deepEqual(r.scenarios.map(s => s.attestStatus), ["B", "B", "B", "B", "B"]);
  assert.ok(logs.some(l => l.includes("증명 파일 없음")));
  for (const name of ["normal", "ponzi", "rugpull", "laundering", "pumpdump"]) {
    assert.deepEqual(fs.readdirSync(path.join(a, name)).sort(), ["canonical.json", "envelope.json", "ontology.json", "report.json", "timeseries.json", "viewmodel.json"]);
    const fixtureReport = JSON.parse(fs.readFileSync(path.join(ROOT, "demo/fixtures", name, "report.json"), "utf8"));
    const report = JSON.parse(fs.readFileSync(path.join(a, name, "report.json"), "utf8"));
    assert.equal(report.timestamp, fixtureReport.timestamp); // 실행 시각 대신 fixture 값으로 고정
  }
  const index = JSON.parse(fs.readFileSync(path.join(a, "index.json"), "utf8"));
  assert.equal(index.schemaVersion, 1);
  assert.match(index.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Object.keys(index.glossary).length > 50);
  // 키 정렬
  const text = fs.readFileSync(path.join(a, "ponzi", "envelope.json"), "utf8");
  assert.equal(text, `${JSON.stringify(sortKeys(JSON.parse(text)), null, 2)}\n`);
});

test("chainId 31337 기록은 제외(로그), 11155111 기록만 공개 값으로 attestation.json", async () => {
  const fixtureEnv = JSON.parse(fs.readFileSync(path.join(ROOT, "demo/fixtures/ponzi/envelope.json"), "utf8"));
  const rh = `0x${fixtureEnv.report_sha256}`;
  const file = path.join(tmp, "attestations.json");
  fs.writeFileSync(file, JSON.stringify({ ponzi: sepoliaEntry(rh), normal: sepoliaEntry(rh, { scenario: "normal", chainId: 31337 }) }));
  const out = path.join(tmp, "with-att");
  const logs = [];
  const r = await exportSnapshot({ outDir: out, attestationsFile: file, sourceCommit: "abc1234", log: m => logs.push(m) });
  assert.deepEqual(r.scenarios.map(s => [s.id, s.attestStatus]), [["normal", "B"], ["ponzi", "A"], ["rugpull", "B"], ["laundering", "B"], ["pumpdump", "B"]]);
  assert.ok(logs.some(l => /normal: 증명 제외 — chainId 31337/.test(l)));
  assert.equal(fs.existsSync(path.join(out, "normal", "attestation.json")), false);
  const att = JSON.parse(fs.readFileSync(path.join(out, "ponzi", "attestation.json"), "utf8"));
  assert.deepEqual(Object.keys(att).sort(), ["attester", "blockNumber", "chainId", "contract", "explorerBase", "explorerPathVerified", "matchesSnapshotReport", "payload", "recordedAt", "reportHash", "scenario", "schemaUID", "txHash", "uid"]);
  assert.deepEqual(Object.keys(att.payload).sort(), ["analyzerVersion", "codeRiskGrade", "contractAddress", "minWalletTrustScore", "reportHash", "scanTimestamp", "trustScore"]);
  assert.equal(att.matchesSnapshotReport, true);
  const all = digest(out).map(l => fs.readFileSync(path.join(out, l.split(" ")[0]), "utf8")).join("\n");
  assert.ok(!all.includes("should-not-be-copied") && !all.includes("버려야 함"));
  // 상태가 B로 돌아가면 옛 attestation.json이 남지 않는다
  await exportSnapshot({ outDir: out, attestationsFile: path.join(tmp, "none.json"), sourceCommit: "abc1234", log: quiet });
  assert.equal(fs.existsSync(path.join(out, "ponzi", "attestation.json")), false);
});

test("publicAttestation: 형식이 틀린 기록은 제외 사유와 함께 뺀다", () => {
  assert.deepEqual(publicAttestation("ponzi", null, "00"), { attestation: null, excluded: null });
  assert.match(publicAttestation("ponzi", sepoliaEntry("0x1", { uid: "0x12" }), "00").excluded, /형식/);
  assert.match(publicAttestation("ponzi", sepoliaEntry("0x1", { attester: "nope" }), "00").excluded, /attester/);
  assert.equal(publicAttestation("ponzi", sepoliaEntry(`0x${"ee".repeat(32)}`), "ff".repeat(32)).attestation.matchesSnapshotReport, false);
});

test("출력물 자체 검사: 허용 필드 밖 0x+64, alchemy, PRIVATE_KEY, 환경 변수 값", () => {
  const hex = `0x${"5a".repeat(32)}`;
  const ok = new Map([["a.json", JSON.stringify({ uid: hex, txHash: hex, schemaUID: hex, reportHash: hex, payload: { reportHash: hex } })]]);
  assert.deepEqual(scanOutput(ok, {}), []);
  const bad = new Map([
    ["b.json", JSON.stringify({ meta: { privateKey: hex } })],
    ["c.json", JSON.stringify({ note: "eth-mainnet.g.Alchemy.com" })],
    ["d.json", JSON.stringify({ x: "PRIVATE_KEY" })],
    ["e.json", JSON.stringify({ x: "value-of-secret-rpc" })],
    ["f.json", "not json"]
  ]);
  const problems = scanOutput(bad, { DEMO_EAS_RPC_URL: "value-of-secret-rpc", HOME: "/home/x" });
  assert.deepEqual(problems, [
    "b.json: meta.privateKey (허용 필드 밖의 0x+64자리 16진수)",
    "c.json: \"alchemy\" 문자열",
    "d.json: \"PRIVATE_KEY\" 문자열",
    "e.json: 환경 변수 DEMO_EAS_RPC_URL의 값",
    "f.json: JSON이 아님"
  ]);
  assert.ok(!problems.join(" ").includes(hex) && !problems.join(" ").includes("value-of-secret-rpc"));
});

test("커밋된 스냅샷(dashboard/public/snapshot)이 지금 코드로 내보낸 결과와 같다 (sourceCommit 제외)", async () => {
  assert.ok(fs.existsSync(path.join(COMMITTED, "index.json")), "npm run demo:export로 스냅샷을 만들어 커밋해야 합니다");
  const committedIndex = JSON.parse(fs.readFileSync(path.join(COMMITTED, "index.json"), "utf8"));
  const fresh = path.join(tmp, "fresh");
  await exportSnapshot({ outDir: fresh, sourceCommit: committedIndex.sourceCommit, log: quiet });
  const freshIndex = JSON.parse(fs.readFileSync(path.join(fresh, "index.json"), "utf8"));
  assert.deepEqual({ ...freshIndex, sourceCommit: null }, { ...committedIndex, sourceCommit: null });
  const strip = list => list.filter(l => !l.startsWith("index.json "));
  assert.deepEqual(strip(digest(fresh)), strip(digest(COMMITTED)));
});
