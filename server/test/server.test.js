// 통합 시험: node --test server/test/  (hardhat 시뮬레이션을 실제로 실행한다. Node 22.10 이상)
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createApp } from "../app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

// 시험 전후로 해시가 같아야 하는 파일
function protectedDigest() {
  const files = [];
  for (const dir of ["analysis/logs", "analysis/reports", "demo/fixtures"]) {
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else files.push(p);
    });
    walk(path.join(ROOT, dir));
  }
  return files.sort().map(f => `${path.relative(ROOT, f)} ${crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")}`);
}
const PROTECTED_BEFORE = protectedDigest();

const runsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pbl-demo-runs-"));
const servers = [];

async function start(options = {}) {
  const { server } = createApp({ runsDir: fs.mkdtempSync(path.join(runsRoot, "r-")), ...options });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function api(base, method, p, body, headers = {}) {
  const res = await fetch(base + p, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json", ...headers } : headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

// 끝날 때까지 폴링하며 관찰한 (status, stage)를 모은다
async function waitJob(base, jobId, timeoutMs = 120000) {
  const seen = [];
  const t0 = Date.now();
  for (;;) {
    const { status, body } = await api(base, "GET", `/api/jobs/${jobId}`);
    assert.equal(status, 200);
    const key = `${body.status}/${body.stage}`;
    if (seen.at(-1) !== key) seen.push(key);
    if (body.status === "done" || body.status === "error") return { job: body, seen };
    if (Date.now() - t0 > timeoutMs) throw new Error(`작업 시간 초과: ${jobId}`);
    await new Promise(r => setTimeout(r, 15));
  }
}

let base;
const attestApps = [];
test.before(async () => { base = await start(); });
test.after(async () => {
  await Promise.all(attestApps.map(a => a.stop()));
  await Promise.all(servers.map(s => new Promise(r => s.close(r))));
  fs.rmSync(runsRoot, { recursive: true, force: true });
});

test("GET /api/health", async () => {
  const { status, body } = await api(base, "GET", "/api/health");
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body), ["node", "hardhatUsable", "fixturesAvailable"]);
  assert.match(body.node, /^v22\./);
  assert.equal(body.hardhatUsable, true);
  assert.equal(body.fixturesAvailable, true);
});

test("GET /api/scenarios: 5개, 한국어 라벨", async () => {
  const { status, body } = await api(base, "GET", "/api/scenarios");
  assert.equal(status, 200);
  assert.deepEqual(body.map(s => s.id), ["normal", "ponzi", "rugpull", "laundering", "pumpdump"]);
  assert.deepEqual(body.map(s => s.expectedType), ["normal_staking", "ponzi_scheme", "rug_pull", "money_laundering", "pump_and_dump"]);
  for (const s of body) {
    assert.deepEqual(Object.keys(s), ["id", "label", "expectedType", "description"]);
    assert.match(s.label + s.description, /[가-힣]/);
  }
});

test("잘못된 입력 400, 없는 id 404, 그 밖의 오류 형식", async () => {
  const cases = [
    [{ scenario: "nope" }, "unknown_scenario"],
    [{}, "unknown_scenario"],
    [{ scenario: "ponzi", mode: "live" }, "invalid_mode"],
    ["{not json", "invalid_json"],
    [[1, 2], "invalid_body"]
  ];
  for (const [body, code] of cases) {
    const r = await api(base, "POST", "/api/analyze", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.code, code);
    assert.equal(typeof r.body.error, "string");
  }
  const missingJob = await api(base, "GET", "/api/jobs/00000000-0000-0000-0000-000000000000");
  assert.deepEqual([missingJob.status, missingJob.body.code], [404, "job_not_found"]);
  for (const p of ["/api/report/nope", "/api/report/nope/timeseries", "/api/report/nope/canonical", "/api/report/nope/ontology"]) {
    const r = await api(base, "GET", p);
    assert.deepEqual([r.status, r.body.code], [404, "report_not_found"], p);
  }
  const route = await api(base, "GET", "/api/nothing");
  assert.deepEqual([route.status, route.body.code], [404, "not_found"]);
  const method = await api(base, "GET", "/api/analyze");
  assert.deepEqual([method.status, method.body.code], [405, "method_not_allowed"]);
});

test("CORS: localhost:5173만 허용", async () => {
  const pre = await fetch(base + "/api/analyze", { method: "OPTIONS", headers: { Origin: "http://localhost:5173" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.match(pre.headers.get("access-control-allow-methods"), /POST/);
  const other = await fetch(base + "/api/health", { headers: { Origin: "http://evil.example" } });
  assert.equal(other.headers.get("access-control-allow-origin"), null);
});

let fixtureReportId;
test("mode=fixture: analyze → hash, source=fixture, 해시가 fixture와 같음", async () => {
  const post = await api(base, "POST", "/api/analyze", { scenario: "pumpdump", mode: "fixture" });
  assert.equal(post.status, 202);
  const { job, seen } = await waitJob(base, post.body.jobId);
  assert.equal(job.status, "done");
  assert.equal(job.source, "fixture");
  assert.equal(job.stage, null);
  assert.deepEqual(job.stages, ["analyze", "hash"]);
  assert.equal(job.reportId, post.body.jobId);
  assert.equal(job.error, null);
  assert.ok(seen.at(-1) === "done/null", seen.join(" → "));
  const fixtureEnvelope = JSON.parse(fs.readFileSync(path.join(ROOT, "demo/fixtures/pumpdump/envelope.json"), "utf8"));
  const r = await api(base, "GET", `/api/report/${job.reportId}`);
  assert.equal(r.body.envelope.report_sha256, fixtureEnvelope.report_sha256);
  fixtureReportId = job.reportId;
});

test("mode=auto (live 성공): simulate → analyze → hash, source=live", async () => {
  const post = await api(base, "POST", "/api/analyze", { scenario: "ponzi" });
  assert.equal(post.status, 202);
  const { job, seen } = await waitJob(base, post.body.jobId);
  assert.equal(job.status, "done", job.error);
  assert.equal(job.source, "live");
  assert.equal(job.fallbackReason, null);
  assert.deepEqual(job.stages, ["simulate", "analyze", "hash"]);
  assert.ok(seen.includes("running/simulate"), `관찰: ${seen.join(" → ")}`);
  const fixtureEnvelope = JSON.parse(fs.readFileSync(path.join(ROOT, "demo/fixtures/ponzi/envelope.json"), "utf8"));
  const r = await api(base, "GET", `/api/report/${job.reportId}`);
  assert.equal(r.body.envelope.source, "live");
  assert.equal(r.body.envelope.report_sha256, fixtureEnvelope.report_sha256, "시드 고정 live = fixture 해시");
  console.log(`  [auto] 관찰한 상태: ${seen.join(" → ")}  (${job.finishedAt - job.startedAt} ms)`);
});

test("hardhat 실패 흉내: Node 18 → fixture 폴백", async () => {
  const b = await start({ runOptions: { nodeBin: "/usr/bin/node" } });
  const health = await api(b, "GET", "/api/health");
  assert.equal(health.body.hardhatUsable, false);
  const post = await api(b, "POST", "/api/analyze", { scenario: "rugpull", mode: "auto" });
  const { job } = await waitJob(b, post.body.jobId);
  assert.equal(job.status, "done");
  assert.equal(job.source, "fixture");
  assert.deepEqual(job.stages, ["simulate", "analyze", "hash"]);
  assert.match(job.fallbackReason, /22\.10\.0 이상 필요/);
  console.log(`  [node18] fallbackReason: ${job.fallbackReason}`);
});

test("hardhat 실패 흉내: 시간 초과 → fixture 폴백", async () => {
  const b = await start({ runOptions: { timeoutMs: 1 } });
  const post = await api(b, "POST", "/api/analyze", { scenario: "laundering" });
  const { job } = await waitJob(b, post.body.jobId);
  assert.equal(job.status, "done");
  assert.equal(job.source, "fixture");
  assert.match(job.fallbackReason, /시간 초과/);
});

test("동시에 POST 3개 → 직렬 처리(실행 구간이 겹치지 않음)", async () => {
  const names = ["normal", "rugpull", "laundering"];
  const posts = await Promise.all(names.map(scenario => api(base, "POST", "/api/analyze", { scenario, mode: "auto" })));
  assert.ok(posts.every(p => p.status === 202));
  const queued = await Promise.all(posts.map(p => api(base, "GET", `/api/jobs/${p.body.jobId}`)));
  assert.ok(queued.filter(q => q.body.status === "queued").length >= 2, "제출 직후 최소 2개는 대기 중이어야 함");
  const jobs = (await Promise.all(posts.map(p => waitJob(base, p.body.jobId)))).map(r => r.job);
  assert.ok(jobs.every(j => j.status === "done" && j.source === "live"), JSON.stringify(jobs.map(j => [j.status, j.source, j.error])));
  const spans = jobs.map(j => [j.startedAt, j.finishedAt]).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1], `겹침: ${JSON.stringify(spans)}`);
  console.log(`  [serial] 구간(ms, 첫 시작 기준): ${spans.map(([s, e]) => `${s - spans[0][0]}~${e - spans[0][0]}`).join(", ")}`);
});

test("report / timeseries / canonical 응답 구조", async () => {
  const r = await api(base, "GET", `/api/report/${fixtureReportId}`);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), ["report", "envelope", "view"]);
  assert.equal(r.body.report.contract, "PumpDump");
  assert.ok("overall_grade" in r.body.report, "원본 리포트는 그대로");
  assert.ok(!("overall_grade" in r.body.view));
  assert.deepEqual(Object.keys(r.body.view), ["scenario", "contract", "source", "reportHash", "codeAssessment", "walletAssessment", "warnings", "patterns", "phase", "disclaimer", "headline", "combination"]);
  assert.deepEqual(Object.keys(r.body.view.headline), ["tone", "text", "reasons"]);
  assert.deepEqual(Object.keys(r.body.view.combination), ["codeRisk", "walletRisk", "quadrant", "label", "basis", "criteriaNote"]);
  assert.equal(r.body.view.walletAssessment.extractorCount, 3);
  assert.equal(r.body.view.phase.onset.block, 23);

  const ts = await api(base, "GET", `/api/report/${fixtureReportId}/timeseries`);
  assert.equal(ts.status, 200);
  assert.equal(ts.body.length, r.body.report.dynamic.rows_analyzed);
  for (const row of ts.body) {
    for (const k of ["block", "timestamp", "amount_eth", "contract_balance_eth", "participant_count"]) assert.equal(typeof row[k], "number", k);
    assert.ok(!JSON.stringify(row).includes("\\r"));
  }

  const c = await api(base, "GET", `/api/report/${fixtureReportId}/canonical`);
  assert.equal(c.status, 200);
  assert.deepEqual(Object.keys(c.body), ["canonical", "hash"]);
  assert.equal(c.body.hash, r.body.envelope.report_sha256);
  assert.equal(crypto.createHash("sha256").update(c.body.canonical).digest("hex"), c.body.hash);
  assert.ok(!c.body.canonical.includes('"timestamp":"20'), "리포트 timestamp는 canonical에서 빠짐");
});

test("GET /api/glossary: fixture 5개의 모든 ID 포함", async () => {
  const { status, body } = await api(base, "GET", "/api/glossary");
  assert.equal(status, 200);
  const { collectTerms } = await import("../../demo/lib/glossary.js");
  const missing = [];
  for (const name of ["normal", "ponzi", "rugpull", "laundering", "pumpdump"]) {
    const report = JSON.parse(fs.readFileSync(path.join(ROOT, "demo/fixtures", name, "report.json"), "utf8"));
    for (const id of collectTerms(report)) if (!body[id]?.ko || !body[id]?.desc) missing.push(`${name}:${id}`);
  }
  assert.deepEqual(missing, []);
  console.log(`  [glossary] 항목 ${Object.keys(body).length}개, 누락 ${missing.length}건`);
});

test("5개 시나리오: view.headline·combination, /ontology 응답 (mode=fixture)", async () => {
  const rows = [];
  for (const scenario of ["normal", "ponzi", "rugpull", "laundering", "pumpdump"]) {
    const post = await api(base, "POST", "/api/analyze", { scenario, mode: "fixture" });
    const { job } = await waitJob(base, post.body.jobId);
    assert.equal(job.status, "done");
    const { body: { view } } = await api(base, "GET", `/api/report/${job.reportId}`);
    const o = await api(base, "GET", `/api/report/${job.reportId}/ontology`);
    assert.equal(o.status, 200);
    assert.deepEqual(Object.keys(o.body), ["nodes", "links", "highlight", "meta"]);
    assert.equal(o.body.meta.owlMismatch, null);
    assert.ok(Array.isArray(o.body.meta.owlInferred));
    assert.equal(view.combination.quadrant, scenario === "normal" ? "low-low" : "high-high");
    rows.push({
      scenario,
      tone: view.headline.tone,
      text: view.headline.text,
      reasons: view.headline.reasons.map(r => `${r.label}[${r.page}]`).join(" / "),
      combination: `${view.combination.codeRisk}/${view.combination.walletRisk} ${view.combination.label}`,
      nodes: `${o.body.nodes.length} (active ${o.body.nodes.filter(n => n.active).length})`,
      links: `${o.body.links.length} (active ${o.body.links.filter(l => l.active).length})`,
      paths: o.body.highlight.path.length,
      owl: o.body.meta.owlInferred.join(",") || "[]"
    });
  }
  console.log("  [summary] " + JSON.stringify(rows));
});

// ── 4a: 온체인 기록 (임의 포트의 hardhat node) ──
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on("error", reject);
  });
}

function dirDigest(dir) {
  const out = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else out.push(`${path.relative(dir, p)} ${crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")}`);
  });
  walk(dir);
  return out.sort();
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function startAttest(attestOptions) {
  const runsDir = fs.mkdtempSync(path.join(runsRoot, "a-"));
  const app = createApp({ runsDir, attest: attestOptions });
  await new Promise(r => app.server.listen(0, "127.0.0.1", r));
  servers.push(app.server);
  attestApps.push(app.attest);
  return { base: `http://127.0.0.1:${app.server.address().port}`, app, runsDir };
}

const SECRET_TOKEN = "secret-token-xyz";
const seenBodies = [];
const seenLogs = [];
const origConsole = {};
async function aapi(b, method, p, body) {
  const r = await api(b, method, p, body);
  seenBodies.push(JSON.stringify(r.body));
  return r;
}
async function waitAttestJob(b, id, timeoutMs = 60000) {
  const t0 = Date.now();
  for (;;) {
    const { status, body } = await aapi(b, "GET", `/api/attest-jobs/${id}`);
    assert.equal(status, 200);
    if (body.status === "done" || body.status === "error") return body;
    if (Date.now() - t0 > timeoutMs) throw new Error(`기록 작업 시간 초과: ${id}`);
    await new Promise(r => setTimeout(r, 20));
  }
}
const fixtureEnvelope = name => JSON.parse(fs.readFileSync(path.join(ROOT, "demo/fixtures", name, "envelope.json"), "utf8"));

let A;
const PRERECORD_EXPECTED = {
  normal: [86, 78, "LOW"], ponzi: [49, 8, "CRITICAL"], rugpull: [46, 8, "CRITICAL"],
  laundering: [57, 30, "CRITICAL"], pumpdump: [73, 58, "CRITICAL"]
};

test("온체인 기록: 로컬 체인 시작, fixture 5개 사전 기록과 조회", async () => {
  for (const m of ["log", "warn", "error"]) {
    origConsole[m] = console[m];
    console[m] = (...args) => { seenLogs.push(args.map(String).join(" ")); origConsole[m](...args); };
  }
  const rpcUrl = `http://127.0.0.1:${await freePort()}`;
  A = await startAttest({ enabled: true, rpcUrl, startTimeoutMs: 60000 });
  A.rpcUrl = rpcUrl;
  const starting = await aapi(A.base, "GET", "/api/attest/backends");
  assert.deepEqual([starting.body[0].id, starting.body[0].available, starting.body[0].reason], ["local", false, "시작 중"]);

  const s = await A.app.attest.start();
  assert.deepEqual([s.available, s.chainId, s.spawned, s.prerecorded], [true, 31337, true, 5]);
  const { body: backends } = await aapi(A.base, "GET", "/api/attest/backends");
  assert.deepEqual(backends, [
    { id: "local", label: "로컬 체인 (hardhat)", available: true, chainId: 31337 },
    { id: "eas-sepolia", label: "EAS (Sepolia 테스트넷)", available: false, reason: "미설정(4c에서 구현)" }
  ]);

  const { status, body: pre } = await aapi(A.base, "GET", "/api/fixtures/attestations");
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(pre), ["normal", "ponzi", "rugpull", "laundering", "pumpdump"]);
  const summary = [];
  for (const [name, [trust, minWallet, grade]] of Object.entries(PRERECORD_EXPECTED)) {
    const r = pre[name];
    assert.match(r.uid, /^0x[0-9a-f]{64}$/);
    assert.deepEqual([r.backend, r.chainId, r.explorerUrl, r.prerecorded, r.canonicalSnapshot, r.scenario], ["local", 31337, null, true, true, name]);
    assert.equal(r.payload.reportHash, `0x${fixtureEnvelope(name).report_sha256}`);
    assert.deepEqual([r.payload.trustScore, r.payload.minWalletTrustScore, r.payload.codeRiskGrade], [trust, minWallet, grade]);
    assert.equal(r.payload.contractAddress, "0x5fbdb2315678afecb367f032d93f642f64180aa3");
    assert.match(r.payload.analyzerVersion, /^([0-9a-f]{7,}|unknown)\+jcs-rfc8785\/pbl-demo-v1$/);
    assert.ok(!("snapshot" in r));
    summary.push(`${name} ${r.payload.reportHash.slice(2, 10)} trust=${trust} min=${minWallet} ${grade} uid=${r.uid.slice(0, 10)}`);
  }
  assert.equal(new Set(Object.values(pre).map(r => r.uid)).size, 5);
  origConsole.log(`  [prerecord] ${summary.join(" | ")}`);
});

test("온체인 기록: fixture 리포트는 사전 기록과 연결, 재기록은 force일 때만 새 uid", async () => {
  const post = await aapi(A.base, "POST", "/api/analyze", { scenario: "ponzi", mode: "fixture" });
  const { job } = await waitJob(A.base, post.body.jobId);
  const id = job.reportId;
  const { body: pre } = await aapi(A.base, "GET", "/api/fixtures/attestations");

  const linked = await aapi(A.base, "GET", `/api/report/${id}/attestation`);
  assert.equal(linked.status, 200);
  assert.deepEqual([linked.body.uid, linked.body.prerecorded, linked.body.reportId], [pre.ponzi.uid, true, id]);

  const again = await aapi(A.base, "POST", `/api/report/${id}/attest`, { backend: "local" });
  assert.equal(again.status, 202);
  const reused = await waitAttestJob(A.base, again.body.attestJobId);
  assert.deepEqual([reused.status, reused.reused, reused.attestation.uid], ["done", true, pre.ponzi.uid]);

  const forced = await waitAttestJob(A.base, (await aapi(A.base, "POST", `/api/report/${id}/attest`, { backend: "local", force: true })).body.attestJobId);
  assert.deepEqual([forced.status, forced.reused, forced.attestation.prerecorded], ["done", false, false]);
  assert.notEqual(forced.attestation.uid, pre.ponzi.uid);
  const now = await aapi(A.base, "GET", `/api/report/${id}/attestation`);
  assert.equal(now.body.uid, forced.attestation.uid);
  assert.deepEqual(Object.keys(now.body).sort(), ["attester", "backend", "blockNumber", "canonicalSnapshot", "chainId", "contract", "explorerUrl", "payload", "prerecorded", "recordedAt", "reportId", "scenario", "schemaUID", "txHash", "uid"]);
  A.ponzi = { id, uid: forced.attestation.uid, prerecordUid: pre.ponzi.uid };
});

test("온체인 기록: 검증 일치와 변조 시연(저장하지 않음)", async () => {
  const { id, uid, prerecordUid } = A.ponzi;
  const ok = await aapi(A.base, "POST", `/api/report/${id}/verify`, {});
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.verified, ok.body.hashMatch, ok.body.tamperDemo, ok.body.uid, ok.body.changedPaths], [true, true, false, uid, []]);
  assert.equal(ok.body.fields.length, 7);
  assert.deepEqual(ok.body.fields.filter(f => f.informational).map(f => f.name), ["scanTimestamp", "analyzerVersion"]);

  const runsBefore = dirDigest(A.runsDir);
  const protectedBefore = protectedDigest();
  const reportBefore = (await aapi(A.base, "GET", `/api/report/${id}`)).body.report;

  const t = await aapi(A.base, "POST", `/api/report/${id}/verify`, { tamper: { path: "trust.overall_trust_score", value: 50 } });
  assert.equal(t.status, 200);
  assert.deepEqual([t.body.verified, t.body.hashMatch, t.body.tamperDemo], [false, false, true]);
  assert.deepEqual(t.body.changedPaths, ["trust.overall_trust_score"]);
  assert.deepEqual(t.body.fields.filter(f => !f.match).map(f => [f.name, f.onChain, f.current]).filter(([n]) => n !== "reportHash"), [["trustScore", 49, 50]]);
  origConsole.log(`  [tamper] verified=${t.body.verified} hashMatch=${t.body.hashMatch} changedPaths=${JSON.stringify(t.body.changedPaths)} ` +
    `onChain=${t.body.onChainReportHash.slice(0, 10)} current=${t.body.currentReportHash.slice(0, 10)}`);

  const ts = await aapi(A.base, "POST", `/api/report/${id}/verify`, { tamper: { path: "timestamp", value: "2030-01-01T00:00:00.000Z" } });
  assert.deepEqual([ts.body.verified, ts.body.hashMatch, ts.body.tamperDemo], [true, true, true]);

  // 변조는 저장되지 않는다: demo/runs, fixtures·analysis, 리포트, 기록 모두 그대로
  assert.deepEqual(dirDigest(A.runsDir), runsBefore);
  assert.deepEqual(protectedDigest(), protectedBefore);
  assert.deepEqual((await aapi(A.base, "GET", `/api/report/${id}`)).body.report, reportBefore);
  assert.equal((await aapi(A.base, "GET", `/api/report/${id}/attestation`)).body.uid, uid);
  assert.equal((await aapi(A.base, "POST", `/api/report/${id}/verify`, {})).body.verified, true);

  // 사전 기록 uid로도 검증 (같은 리포트 해시)
  const old = await aapi(A.base, "POST", `/api/report/${id}/verify`, { uid: prerecordUid });
  assert.deepEqual([old.body.verified, old.body.uid], [true, prerecordUid]);

  const cases = [
    [{ tamper: { path: "trust.nope", value: 1 } }, 400, "invalid_tamper_path"],
    [{ tamper: { path: "trust.overall_trust_score", value: 999 } }, 400, "invalid_tamper"],
    [{ tamper: "x" }, 400, "invalid_tamper"],
    [{ uid: "0x1234" }, 400, "invalid_uid"],
    [{ uid: `0x${"ab".repeat(32)}` }, 404, "attestation_not_found_onchain"],
    [{ backend: "eas-sepolia" }, 409, "backend_unavailable"]
  ];
  for (const [body, statusCode, code] of cases) {
    const r = await aapi(A.base, "POST", `/api/report/${id}/verify`, body);
    assert.deepEqual([r.status, r.body.code], [statusCode, code], JSON.stringify(body));
  }
});

test("온체인 기록: live 리포트는 기록 전 404, 기록 후 검증 일치, 입력 오류", async () => {
  const post = await aapi(A.base, "POST", "/api/analyze", { scenario: "rugpull", mode: "auto" });
  const { job } = await waitJob(A.base, post.body.jobId);
  assert.equal(job.source, "live");
  const id = job.reportId;
  const before = await aapi(A.base, "GET", `/api/report/${id}/attestation`);
  assert.deepEqual([before.status, before.body.code], [404, "attestation_not_found"]);
  const nf = await aapi(A.base, "POST", `/api/report/${id}/verify`, {});
  assert.deepEqual([nf.status, nf.body.code], [404, "attestation_not_found"]);
  const done = await waitAttestJob(A.base, (await aapi(A.base, "POST", `/api/report/${id}/attest`, {})).body.attestJobId);
  assert.deepEqual([done.status, done.reused, done.backend], ["done", false, "local"]);
  assert.equal((await aapi(A.base, "POST", `/api/report/${id}/verify`, {})).body.verified, true);

  const cases = [
    [`/api/report/${id}/attest`, { backend: "nope" }, 400, "unknown_backend"],
    [`/api/report/${id}/attest`, { backend: "eas-sepolia" }, 409, "backend_unavailable"],
    ["/api/report/nope/attest", {}, 404, "report_not_found"],
    [`/api/report/${id}/attest`, "{bad", 400, "invalid_json"]
  ];
  for (const [p, body, statusCode, code] of cases) {
    const r = await aapi(A.base, "POST", p, body);
    assert.deepEqual([r.status, r.body.code], [statusCode, code], p);
  }
  const nj = await aapi(A.base, "GET", "/api/attest-jobs/nope");
  assert.deepEqual([nj.status, nj.body.code], [404, "attest_job_not_found"]);
  const na = await aapi(A.base, "GET", "/api/report/nope/attestation");
  assert.deepEqual([na.status, na.body.code], [404, "report_not_found"]);
});

test("온체인 기록: 체인 시작 실패 시 local 사용 불가, 나머지 API는 정상", async () => {
  const rpcUrl = `http://127.0.0.1:${await freePort()}/${SECRET_TOKEN}`;
  const F = await startAttest({ enabled: true, rpcUrl, hardhatCli: "/nonexistent/hardhat/cli.js", startTimeoutMs: 3000 });
  const r = await F.app.attest.start();
  assert.equal(r.available, false);
  const { body: backends } = await aapi(F.base, "GET", "/api/attest/backends");
  assert.equal(backends[0].available, false);
  assert.match(backends[0].reason, /^사용 불가: hardhat 실행 파일을 찾을 수 없습니다/);
  assert.equal((await aapi(F.base, "GET", "/api/health")).status, 200);
  assert.equal((await aapi(F.base, "GET", "/api/scenarios")).body.length, 5);
  const post = await aapi(F.base, "POST", "/api/analyze", { scenario: "normal", mode: "fixture" });
  const { job } = await waitJob(F.base, post.body.jobId);
  assert.equal(job.status, "done");
  assert.equal((await aapi(F.base, "GET", `/api/report/${job.reportId}`)).status, 200);
  const at = await aapi(F.base, "POST", `/api/report/${job.reportId}/attest`, {});
  assert.deepEqual([at.status, at.body.code], [409, "backend_unavailable"]);
  assert.deepEqual(Object.values((await aapi(F.base, "GET", "/api/fixtures/attestations")).body), [null, null, null, null, null]);
  assert.equal((await aapi(F.base, "GET", `/api/report/${job.reportId}/attestation`)).status, 404);
});

test("온체인 기록: 응답·로그에 RPC 주소와 키가 없고, 종료하면 자식 노드가 정리됨", async () => {
  for (const m of Object.keys(origConsole)) console[m] = origConsole[m];
  const rpcHostPort = new URL(A.rpcUrl).host;
  const haystack = [...seenBodies, ...seenLogs].join("\n");
  for (const needle of [A.rpcUrl, rpcHostPort, SECRET_TOKEN, "Private Key", "PRIVATE_KEY", "Account #0"]) {
    assert.ok(!haystack.includes(needle), `노출: ${needle}`);
  }
  assert.ok(seenBodies.length > 40, `수집한 응답 ${seenBodies.length}개`);
  const pid = A.app.attest.chainPid;
  assert.ok(pid && alive(pid));
  await A.app.attest.stop();
  for (let i = 0; i < 30 && alive(pid); i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(alive(pid), false);
});

test("analysis/logs, analysis/reports, demo/fixtures 해시가 그대로", () => {
  assert.deepEqual(protectedDigest(), PROTECTED_BEFORE);
});
