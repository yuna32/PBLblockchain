// 통합 시험: node --test server/test/  (hardhat 시뮬레이션을 실제로 실행한다. Node 22.10 이상)
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
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
test.before(async () => { base = await start(); });
test.after(async () => {
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
  for (const p of ["/api/report/nope", "/api/report/nope/timeseries", "/api/report/nope/canonical"]) {
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
  assert.deepEqual(Object.keys(r.body.view), ["scenario", "contract", "source", "reportHash", "codeAssessment", "walletAssessment", "warnings", "patterns", "phase", "disclaimer"]);
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

test("analysis/logs, analysis/reports, demo/fixtures 해시가 그대로", () => {
  assert.deepEqual(protectedDigest(), PROTECTED_BEFORE);
});
