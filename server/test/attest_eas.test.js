// 통합 시험: eas-sepolia 백엔드를 로컬 hardhat node + 로컬 배포 EAS로 구동해 API의 backend 파라미터 경로를 시험한다.
// 실제 Sepolia·외부 RPC 호출은 없다. 시험용 키(hardhat 기본 계정)는 출력하지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { bytesToHex, createPublicClient, http } from "viem";
import { generatePrivateKey, mnemonicToAccount } from "viem/accounts";
import { createApp } from "../app.js";
import { LocalChain } from "../../demo/lib/attest/chain.js";
import { deployEasContracts } from "../../demo/lib/attest/local.js";
import { createEasBackend } from "../../demo/lib/attest/eas.js";
import { easConfigFromEnv } from "../../demo/lib/attest/config.js";
import { buildPayload, schemaUID } from "../../demo/lib/attest/schema.js";
import { secretVariants } from "../../demo/lib/attest/redact.js";
import { toTimeseries } from "../../demo/lib/timeseries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CSV = { normal: "normal_log.csv", ponzi: "ponzi_log.csv", rugpull: "rugpull_log.csv", laundering: "laundering_log.csv", pumpdump: "pumpdump_log.csv" };
const FAST = { pollingIntervalMs: 50, receiptTimeoutMs: 20000, rpcTimeoutMs: 2000, retries: 2, retryDelayMs: 50 };
const EXPLORER = "https://sepolia.easscan.org";

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pbl-eas-server-"));
const fixturesDigest = dirDigest(path.join(ROOT, "demo", "fixtures"));
let chain, rpcUrl, deployed, key, pub, prerecordFile;
const apps = [];
const bodies = [];
const logs = [];
const origConsole = {};

const env = (extra = {}) => ({
  DEMO_EAS_RPC_URL: rpcUrl, DEMO_EAS_ADDRESS: deployed.easAddress, DEMO_EAS_SCHEMA_REGISTRY: deployed.registryAddress,
  DEMO_EAS_CHAIN_ID: "31337", ...extra
});

async function startApp(easEnv, extra = {}) {
  const runsDir = fs.mkdtempSync(path.join(tmp, "runs-"));
  const app = createApp({ runsDir, attest: { enabled: false, eas: easConfigFromEnv(easEnv), easTuning: FAST, easFixturesFile: prerecordFile, ...extra } });
  await new Promise(r => app.server.listen(0, "127.0.0.1", r));
  apps.push(app);
  const started = await app.attest.start();
  return { base: `http://127.0.0.1:${app.server.address().port}`, app, runsDir, started };
}

async function api(base, method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  bodies.push(text);
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function waitFor(base, p, done, timeoutMs = 60000) {
  const t0 = Date.now();
  for (;;) {
    const { body } = await api(base, "GET", p);
    if (done(body)) return body;
    if (Date.now() - t0 > timeoutMs) throw new Error(`시간 초과: ${p}`);
    await new Promise(r => setTimeout(r, 20));
  }
}
const fixtureReport = async (base, scenario) => {
  const { body } = await api(base, "POST", "/api/analyze", { scenario, mode: "fixture" });
  const job = await waitFor(base, `/api/jobs/${body.jobId}`, j => j.status === "done" || j.status === "error");
  assert.equal(job.status, "done");
  return job.reportId;
};
const attestJob = async (base, id, body) => {
  const r = await api(base, "POST", `/api/report/${id}/attest`, body);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  return waitFor(base, `/api/attest-jobs/${r.body.attestJobId}`, j => j.status === "done" || j.status === "error");
};

test.before(async () => {
  for (const m of ["log", "warn", "error"]) {
    origConsole[m] = console[m];
    console[m] = (...a) => { logs.push(a.map(String).join(" ")); origConsole[m](...a); };
  }
  rpcUrl = `http://127.0.0.1:${await freePort()}`;
  chain = new LocalChain({ rpcUrl, startTimeoutMs: 60000 });
  await chain.start();
  deployed = await deployEasContracts({ rpcUrl, chainId: 31337, register: true });
  key = bytesToHex(mnemonicToAccount("test test test test test test test test test test test junk").getHdKey().privateKey);
  pub = createPublicClient({ transport: http(rpcUrl) });
  // 사전 기록 JSON (demo:eas:record-fixtures와 같은 형식)을 임시 파일에 만든다
  const b = createEasBackend(easConfigFromEnv(env({ DEMO_EAS_PRIVATE_KEY: key })), FAST);
  const records = {};
  for (const name of Object.keys(CSV)) {
    const d = path.join(ROOT, "demo", "fixtures", name);
    const report = JSON.parse(fs.readFileSync(path.join(d, "report.json"), "utf8"));
    const envelope = JSON.parse(fs.readFileSync(path.join(d, "envelope.json"), "utf8"));
    const payload = buildPayload({ report, envelope, rows: toTimeseries(fs.readFileSync(path.join(d, CSV[name]), "utf8")), analyzerVersion: "pre+jcs-rfc8785/pbl-demo-v1" });
    const r = await b.attest(payload);
    records[name] = { scenario: name, uid: r.uid, txHash: r.txHash, chainId: r.chainId, attester: r.attester, schemaUID: r.schemaUID, contract: r.contract, blockNumber: r.blockNumber, recordedAt: r.recordedAt, reportHash: payload.reportHash, payload };
  }
  prerecordFile = path.join(tmp, "attestations.sepolia.json");
  fs.writeFileSync(prerecordFile, JSON.stringify(records, null, 2));
});

test.after(async () => {
  for (const m of Object.keys(origConsole)) console[m] = origConsole[m];
  await Promise.all(apps.map(a => new Promise(r => a.server.close(r))));
  await chain?.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

let RW;
test("backends: eas-sepolia 사용 가능(readwrite), 체인·탐색기·사전 기록 수", async () => {
  RW = await startApp(env({ DEMO_EAS_PRIVATE_KEY: key }));
  assert.deepEqual(RW.started.eas, { available: true, mode: "readwrite", chainId: 31337, ok: true, reason: null, schemaRegistered: true });
  const { body } = await api(RW.base, "GET", "/api/attest/backends");
  assert.deepEqual(body[1], {
    id: "eas-sepolia", label: "EAS (Sepolia 테스트넷)", available: true, mode: "readwrite", chainId: 31337,
    explorerBase: EXPLORER, explorerUrlVerified: false, schemaUID: schemaUID(), schemaRegistered: true,
    attester: deployed.attester, prerecorded: 5, prerecordedStale: 0
  });
  assert.equal(body[0].available, false); // local은 이 앱에서 끔
});

test("사전 기록 JSON 연결: ?backend=eas-sepolia, backend 생략 시 기존 동작(local)", async () => {
  const { body: pre } = await api(RW.base, "GET", "/api/fixtures/attestations?backend=eas-sepolia");
  const saved = JSON.parse(fs.readFileSync(prerecordFile, "utf8"));
  for (const name of Object.keys(CSV)) {
    assert.equal(pre[name].uid, saved[name].uid);
    assert.deepEqual([pre[name].backend, pre[name].prerecorded, pre[name].stale, pre[name].canonicalSnapshot], ["eas-sepolia", true, false, true]);
    assert.equal(pre[name].explorerUrl, `${EXPLORER}/attestation/view/${saved[name].uid}`);
    assert.deepEqual(pre[name].meta, { explorerUrlVerified: false, schemaUrl: `${EXPLORER}/schema/view/${schemaUID()}` });
  }
  assert.deepEqual(Object.values((await api(RW.base, "GET", "/api/fixtures/attestations")).body), [null, null, null, null, null]);
  const bad = await api(RW.base, "GET", "/api/fixtures/attestations?backend=nope");
  assert.deepEqual([bad.status, bad.body.code], [400, "unknown_backend"]);

  const id = await fixtureReport(RW.base, "ponzi");
  const linked = await api(RW.base, "GET", `/api/report/${id}/attestation?backend=eas-sepolia`);
  assert.deepEqual([linked.status, linked.body.uid, linked.body.reportId], [200, saved.ponzi.uid, id]);
  const def = await api(RW.base, "GET", `/api/report/${id}/attestation`);
  assert.deepEqual([def.status, def.body.code], [404, "attestation_not_found"]);
  const defVerify = await api(RW.base, "POST", `/api/report/${id}/verify`, {});
  assert.deepEqual([defVerify.status, defVerify.body.code], [409, "backend_unavailable"]);
  RW.ponzi = id;
});

test("검증·변조(저장 안 함)·재기록: backend=eas-sepolia", async () => {
  const id = RW.ponzi;
  const ok = await api(RW.base, "POST", `/api/report/${id}/verify`, { backend: "eas-sepolia" });
  assert.deepEqual([ok.status, ok.body.verified, ok.body.backend, ok.body.hashMatch], [200, true, "eas-sepolia", true]);
  const runsBefore = dirDigest(RW.runsDir);
  const t = await api(RW.base, "POST", `/api/report/${id}/verify`, { backend: "eas-sepolia", tamper: { path: "trust.overall_trust_score", value: 95 } });
  assert.deepEqual([t.body.verified, t.body.hashMatch, t.body.tamperDemo, t.body.changedPaths], [false, false, true, ["trust.overall_trust_score"]]);
  assert.deepEqual(dirDigest(RW.runsDir), runsBefore);
  assert.equal((await api(RW.base, "POST", `/api/report/${id}/verify`, { backend: "eas-sepolia" })).body.verified, true);

  const reused = await attestJob(RW.base, id, { backend: "eas-sepolia" });
  assert.deepEqual([reused.status, reused.reused, reused.attestation.prerecorded], ["done", true, true]);
  const fresh = await attestJob(RW.base, id, { backend: "eas-sepolia", force: true });
  assert.deepEqual([fresh.status, fresh.reused, fresh.backend], ["done", false, "eas-sepolia"]);
  assert.equal(fresh.attestation.explorerUrl, `${EXPLORER}/attestation/view/${fresh.attestation.uid}`);
  assert.equal(fresh.attestation.meta.explorerUrlVerified, false);
  const now = await api(RW.base, "GET", `/api/report/${id}/attestation?backend=eas-sepolia`);
  assert.deepEqual([now.body.uid, now.body.prerecorded], [fresh.attestation.uid, false]);
  assert.equal((await api(RW.base, "POST", `/api/report/${id}/verify`, { backend: "eas-sepolia" })).body.verified, true);
});

test("읽기 전용(키 없음): 조회·검증은 정상, 기록은 409 backend_read_only", async () => {
  const RO = await startApp(env());
  const { body } = await api(RO.base, "GET", "/api/attest/backends");
  assert.deepEqual([body[1].mode, body[1].attester, body[1].prerecorded], ["readonly", null, 5]);
  const id = await fixtureReport(RO.base, "rugpull");
  assert.equal((await api(RO.base, "GET", `/api/report/${id}/attestation?backend=eas-sepolia`)).status, 200);
  assert.equal((await api(RO.base, "POST", `/api/report/${id}/verify`, { backend: "eas-sepolia" })).body.verified, true);
  for (const force of [false, true]) {
    const r = await api(RO.base, "POST", `/api/report/${id}/attest`, { backend: "eas-sepolia", force });
    assert.deepEqual([r.status, r.body.code], [409, "backend_read_only"]);
  }
});

test("잔액 부족: 409 insufficient_funds, 체인에 트랜잭션이 가지 않음", async () => {
  const P = await startApp(env({ DEMO_EAS_PRIVATE_KEY: generatePrivateKey() }));
  const id = await fixtureReport(P.base, "normal");
  const block = await pub.getBlockNumber();
  const r = await api(P.base, "POST", `/api/report/${id}/attest`, { backend: "eas-sepolia", force: true });
  assert.deepEqual([r.status, r.body.code], [409, "insufficient_funds"]);
  assert.match(r.body.error, /0 ETH/);
  assert.equal(await pub.getBlockNumber(), block);
});

test("스키마 미등록: 409 schema_not_registered (register 안내)", async () => {
  const fresh = await deployEasContracts({ rpcUrl, chainId: 31337, register: false });
  const U = await startApp(env({ DEMO_EAS_PRIVATE_KEY: key, DEMO_EAS_ADDRESS: fresh.easAddress, DEMO_EAS_SCHEMA_REGISTRY: fresh.registryAddress }));
  const { body } = await api(U.base, "GET", "/api/attest/backends");
  assert.deepEqual([body[1].schemaRegistered, body[1].prerecorded], [false, 0]); // 다른 EAS 주소라 사전 기록은 무시
  assert.equal(U.started.easPrerecorded.ignored, 5);
  const id = await fixtureReport(U.base, "normal");
  const r = await api(U.base, "POST", `/api/report/${id}/attest`, { backend: "eas-sepolia" });
  assert.deepEqual([r.status, r.body.code], [409, "schema_not_registered"]);
  assert.match(r.body.error, /demo:eas:register/);
});

test("RPC 불가: 503 rpc_unavailable, 주소·토큰은 응답·로그에 없음", async () => {
  const deadUrl = `http://127.0.0.1:${await freePort()}/v3/secret-token-abc`;
  const D = await startApp(env({ DEMO_EAS_PRIVATE_KEY: key, DEMO_EAS_RPC_URL: deadUrl }));
  assert.equal(D.started.eas.ok, false);
  const { body } = await api(D.base, "GET", "/api/attest/backends");
  assert.deepEqual([body[1].available, body[1].reasonCode], [true, "rpc_unavailable"]);
  const id = await fixtureReport(D.base, "normal");
  const v = await api(D.base, "POST", `/api/report/${id}/verify`, { backend: "eas-sepolia" });
  assert.deepEqual([v.status, v.body.code], [503, "rpc_unavailable"]);
  const a = await api(D.base, "POST", `/api/report/${id}/attest`, { backend: "eas-sepolia", force: true });
  assert.deepEqual([a.status, a.body.code], [503, "rpc_unavailable"]);
  const all = bodies.join("\n") + logs.join("\n");
  for (const v of secretVariants(deadUrl)) assert.ok(!all.includes(v), `노출: ${v}`);
});

test("fixture가 기록 뒤 바뀐 경우(stale): 연결은 하되 검증은 불일치", async () => {
  const saved = JSON.parse(fs.readFileSync(prerecordFile, "utf8"));
  const staleFile = path.join(tmp, "stale.json");
  // ponzi 자리에 다른 리포트 해시의 기록(= 기록 뒤 fixture가 바뀐 것과 같은 상황), 그 기록의 원래 시나리오는 파일에서 뺀다
  const { rugpull, ...rest } = saved;
  fs.writeFileSync(staleFile, JSON.stringify({ ...rest, ponzi: { ...rugpull, scenario: "ponzi" }, normal: { ...saved.normal, chainId: 1 } }));
  const S = await startApp(env(), { easFixturesFile: staleFile });
  assert.deepEqual([S.started.easPrerecorded.loaded, S.started.easPrerecorded.stale, S.started.easPrerecorded.ignored], [3, 1, 1]);
  const { body } = await api(S.base, "GET", "/api/fixtures/attestations?backend=eas-sepolia");
  assert.deepEqual([body.ponzi.stale, body.ponzi.canonicalSnapshot, body.normal], [true, false, null]);
  const id = await fixtureReport(S.base, "ponzi");
  const v = await api(S.base, "POST", `/api/report/${id}/verify`, { backend: "eas-sepolia" });
  assert.deepEqual([v.body.verified, v.body.hashMatch, v.body.snapshotAvailable, v.body.changedPaths], [false, false, false, []]);
});

test("키와 RPC 주소가 모든 응답·로그에 없고, demo/fixtures는 그대로", () => {
  const all = bodies.join("\n") + logs.join("\n");
  assert.ok(bodies.length > 40);
  for (const v of [...secretVariants(key), ...secretVariants(rpcUrl)]) assert.ok(!all.includes(v), `노출: ${v.slice(0, 8)}…`);
  assert.deepEqual(dirDigest(path.join(ROOT, "demo", "fixtures")), fixturesDigest);
});
