// eas-sepolia 코드 경로를 로컬 hardhat node + 로컬 배포 EAS로 시험한다(실제 Sepolia·외부 RPC 호출 없음).
// 시험용 키는 hardhat 기본 계정(기본 니모닉에서 유도)이며 어디에도 출력하지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { bytesToHex, createPublicClient, http, parseAbiItem } from "viem";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { LocalChain } from "../lib/attest/chain.js";
import { deployEasContracts } from "../lib/attest/local.js";
import { createEasBackend } from "../lib/attest/eas.js";
import { easConfigFromEnv } from "../lib/attest/config.js";
import { buildPayload, schemaUID } from "../lib/attest/schema.js";
import { reportHash } from "../lib/attest/jcs.js";
import { verifyAgainstChain } from "../lib/attest/verify.js";
import { secretVariants } from "../lib/attest/redact.js";
import { sanitizeEnv } from "../run.js";
import { toTimeseries } from "../lib/timeseries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CSV = { normal: "normal_log.csv", ponzi: "ponzi_log.csv", rugpull: "rugpull_log.csv", laundering: "laundering_log.csv", pumpdump: "pumpdump_log.csv" };
const FAST = { pollingIntervalMs: 50, receiptTimeoutMs: 20000, rpcTimeoutMs: 2000, retries: 2, retryDelayMs: 50 };
const VERSION = "test+jcs-rfc8785/pbl-demo-v1";

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on("error", reject);
  });
}

// hardhat 기본 계정 #0의 키 (기본 니모닉에서 유도, 출력 금지)
function hardhatKey() {
  return bytesToHex(mnemonicToAccount("test test test test test test test test test test test junk").getHdKey().privateKey);
}

function load(name, dir = path.join(ROOT, "demo", "fixtures")) {
  const d = path.join(dir, name);
  return {
    report: JSON.parse(fs.readFileSync(path.join(d, "report.json"), "utf8")),
    envelope: JSON.parse(fs.readFileSync(path.join(d, "envelope.json"), "utf8")),
    rows: toTimeseries(fs.readFileSync(path.join(d, CSV[name]), "utf8"))
  };
}

let chain, rpcUrl, deployed, key, pub;
const outputs = [];   // 모든 스크립트 출력·오류 메시지 (노출 검사용)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pbl-eas-"));
const outFile = path.join(tmp, "attestations.sepolia.json");

const easEnv = (extra = {}) => ({
  DEMO_EAS_RPC_URL: rpcUrl, DEMO_EAS_ADDRESS: deployed.easAddress, DEMO_EAS_SCHEMA_REGISTRY: deployed.registryAddress,
  DEMO_EAS_CHAIN_ID: "31337", ...extra
});
const backendWith = (extra = {}) => createEasBackend(easConfigFromEnv(easEnv(extra)), FAST);

function script(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, ["demo/scripts/eas.js", ...args, "--poll-ms", "50"], {
    cwd: ROOT, encoding: "utf8", input: "",
    env: { ...sanitizeEnv(process.env), ...easEnv(extraEnv) }
  });
  const text = `${r.stdout}\n${r.stderr}`;
  outputs.push(text);
  return { code: r.status, text };
}
const nonceOf = address => pub.getTransactionCount({ address });

test.before(async () => {
  rpcUrl = `http://127.0.0.1:${await freePort()}`;
  chain = new LocalChain({ rpcUrl, startTimeoutMs: 60000 });
  await chain.start();
  deployed = await deployEasContracts({ rpcUrl, chainId: 31337, register: false });
  key = hardhatKey();
  pub = createPublicClient({ transport: http(rpcUrl) });
});
test.after(async () => {
  await chain?.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("시험 키 = 노드의 첫 계정, 키가 있으면 readwrite·없으면 readonly", async () => {
  assert.equal(privateKeyToAccount(key).address.toLowerCase(), deployed.attester);
  const rw = backendWith({ DEMO_EAS_PRIVATE_KEY: key });
  const ro = backendWith();
  assert.equal(rw.mode, "readwrite");
  assert.equal(ro.mode, "readonly");
  assert.equal(rw.attester, deployed.attester);
  assert.equal(ro.attester, null);
  assert.ok(!JSON.stringify(rw.describe()).includes(key.slice(2)));
  assert.ok(!Object.values(rw).some(v => typeof v === "string" && v.toLowerCase().includes(key.slice(2).toLowerCase())));
});

test("스키마 미등록: 연결 점검은 통과, 기록은 체인에 보내기 전에 schema_not_registered", async () => {
  const b = backendWith({ DEMO_EAS_PRIVATE_KEY: key });
  const status = await b.init();
  assert.deepEqual([status.ok, b.schemaRegistered], [true, false]);
  const before = await nonceOf(deployed.attester);
  const { report, envelope, rows } = load("ponzi");
  await assert.rejects(b.attest(buildPayload({ report, envelope, rows, analyzerVersion: VERSION })), e => e.code === "schema_not_registered" && /demo:eas:register/.test(e.message));
  assert.equal(await nonceOf(deployed.attester), before);
  const chk = script(["check", "--yes", "--out", outFile]);
  assert.equal(chk.code, 1);
  assert.match(chk.text, /스키마 등록\s+미등록\s+npm run demo:eas:register/);
});

test("register: 두 번 실행해도 한 번만 등록, UID는 문자열에서 계산한 값과 같다", async () => {
  const before = await nonceOf(deployed.attester);
  const first = script(["register", "--yes"], { DEMO_EAS_PRIVATE_KEY: key });
  assert.equal(first.code, 0, first.text);
  assert.match(first.text, /등록했습니다\. 스키마 UID: (0x[0-9a-f]{64})/);
  assert.equal(first.text.match(/스키마 UID: (0x[0-9a-f]{64}), tx/)[1], schemaUID());
  const second = script(["register", "--yes"], { DEMO_EAS_PRIVATE_KEY: key });
  assert.equal(second.code, 0);
  assert.match(second.text, /이미 등록되어 있습니다\. 보내지 않습니다/);
  assert.equal(await nonceOf(deployed.attester), before + 1);
  const logs = await pub.getLogs({
    address: deployed.registryAddress, fromBlock: 0n,
    event: parseAbiItem("event Registered(bytes32 indexed uid, address indexed registerer, (bytes32 uid, address resolver, bool revocable, string schema) schema)")
  });
  assert.deepEqual(logs.map(l => l.args.uid), [schemaUID()]);
  const ro = script(["register", "--yes"]);
  assert.equal(ro.code, 1);
  assert.match(ro.text, /읽기 전용/);
});

test("record-fixtures: 확인 없이는 취소, 기록·건너뛰기·--force, 파일에 비밀 없음", async () => {
  const n0 = await nonceOf(deployed.attester);
  const cancelled = script(["record-fixtures", "--out", outFile], { DEMO_EAS_PRIVATE_KEY: key });
  assert.equal(cancelled.code, 3);
  assert.match(cancelled.text, /--yes를 붙이세요/);
  assert.match(cancelled.text, /필요 잔액 약 [0-9.]+ ETH/);
  assert.equal(fs.existsSync(outFile), false);
  assert.equal(await nonceOf(deployed.attester), n0);

  const rec = script(["record-fixtures", "--yes", "--out", outFile], { DEMO_EAS_PRIVATE_KEY: key });
  assert.equal(rec.code, 0, rec.text);
  assert.equal(await nonceOf(deployed.attester), n0 + 5);
  const saved = JSON.parse(fs.readFileSync(outFile, "utf8"));
  assert.deepEqual(Object.keys(saved), Object.keys(CSV));
  for (const [name, e] of Object.entries(saved)) {
    assert.deepEqual(Object.keys(e), ["scenario", "uid", "txHash", "chainId", "attester", "schemaUID", "contract", "blockNumber", "recordedAt", "reportHash", "payload"]);
    assert.equal(e.scenario, name);
    assert.equal(e.reportHash, `0x${load(name).envelope.report_sha256}`);
    assert.equal(e.schemaUID, schemaUID());
    assert.equal(e.contract, deployed.easAddress);
  }
  const fileText = fs.readFileSync(outFile, "utf8");
  for (const v of [...secretVariants(key), ...secretVariants(rpcUrl)]) assert.ok(!fileText.includes(v), "파일에 비밀 값");

  const again = script(["record-fixtures", "--yes", "--out", outFile], { DEMO_EAS_PRIVATE_KEY: key });
  assert.equal(again.code, 0);
  assert.match(again.text, /기록할 것이 없습니다/);
  assert.equal((again.text.match(/건너뜀\s+이미 기록됨/g) ?? []).length, 5);
  assert.equal(await nonceOf(deployed.attester), n0 + 5);

  const forced = script(["record-fixtures", "--yes", "--force", "--out", outFile], { DEMO_EAS_PRIVATE_KEY: key });
  assert.equal(forced.code, 0, forced.text);
  assert.equal(await nonceOf(deployed.attester), n0 + 10);
  const resaved = JSON.parse(fs.readFileSync(outFile, "utf8"));
  for (const name of Object.keys(CSV)) assert.notEqual(resaved[name].uid, saved[name].uid);
});

test("check: 일치, fixture가 바뀌면 불일치와 --force 안내", async () => {
  const ok = script(["check", "--yes", "--out", outFile]);
  assert.equal(ok.code, 0, ok.text);
  assert.equal((ok.text.match(/기록 \w+\s+일치/g) ?? []).length, 5);
  assert.match(ok.text, /결과: 모두 정상입니다/);
  assert.match(ok.text, /계정\s+없음\s+\(읽기 전용\)/);

  const fx = path.join(tmp, "fixtures");
  fs.cpSync(path.join(ROOT, "demo", "fixtures"), fx, { recursive: true });
  const p = path.join(fx, "ponzi", "report.json");
  const r = JSON.parse(fs.readFileSync(p, "utf8"));
  r.trust.overall_trust_score += 1;
  fs.writeFileSync(p, JSON.stringify(r, null, 2));
  const stale = script(["check", "--yes", "--out", outFile, "--fixtures-dir", fx]);
  assert.equal(stale.code, 1);
  assert.match(stale.text, /기록 ponzi\s+불일치/);
  assert.equal((stale.text.match(/기록 \w+\s+일치/g) ?? []).length, 4);
  assert.match(stale.text, /fixture를 확정\(freeze\)한 뒤/);
  assert.match(stale.text, /npm run demo:eas:record-fixtures -- --force/);
});

test("백엔드 직접: 기록 → 조회 → 검증 일치, 변조 불일치, 탐색기 링크(형식 미확인)", async () => {
  const b = backendWith({ DEMO_EAS_PRIVATE_KEY: key });
  const { report, envelope, rows } = load("laundering");
  const payload = buildPayload({ report, envelope, rows, analyzerVersion: VERSION });
  const att = await b.attest(payload);
  assert.equal(att.backend, "eas-sepolia");
  assert.equal(att.explorerUrl, `https://sepolia.easscan.org/attestation/view/${att.uid}`);
  assert.deepEqual(att.meta, { explorerUrlVerified: false, schemaUrl: `https://sepolia.easscan.org/schema/view/${schemaUID()}` });
  const ro = backendWith();
  const read = await ro.read(att.uid);
  assert.deepEqual(read.payload, payload);
  assert.equal(verifyAgainstChain({ report, rows, onChain: read.payload, analyzerVersion: VERSION }).verified, true);
  const t = verifyAgainstChain({ report, rows, onChain: read.payload, analyzerVersion: VERSION, tamper: { path: "prevention.risk_level", value: "LOW" } });
  assert.deepEqual([t.verified, t.hashMatch], [false, false]);
  assert.equal(await ro.read(`0x${"00".repeat(31)}01`), null);
  await assert.rejects(ro.attest(payload), e => e.code === "backend_read_only");
});

test("잔액 부족: 체인에 보내기 전에 insufficient_funds (트랜잭션 없음)", async () => {
  const poorKey = generatePrivateKey();
  const poor = privateKeyToAccount(poorKey).address;
  const b = backendWith({ DEMO_EAS_PRIVATE_KEY: poorKey });
  const block = await pub.getBlockNumber();
  const { report, envelope, rows } = load("normal");
  const err = await b.attest(buildPayload({ report, envelope, rows, analyzerVersion: VERSION })).catch(e => e);
  assert.equal(err.code, "insufficient_funds");
  outputs.push(err.message);
  assert.equal(await nonceOf(poor), 0);
  assert.equal(await pub.getBlockNumber(), block);
  const s = script(["register", "--yes"], { DEMO_EAS_PRIVATE_KEY: poorKey });
  assert.equal(s.code, 0); // 이미 등록되어 있어 보내지 않음
});

test("RPC 불가: 재시도 후 rpc_unavailable, 주소는 가림", async () => {
  const deadUrl = `http://127.0.0.1:${await freePort()}/secret-path-xyz?apikey=hidden-val`;
  const b = createEasBackend(easConfigFromEnv({ ...easEnv({ DEMO_EAS_PRIVATE_KEY: key }), DEMO_EAS_RPC_URL: deadUrl }), FAST);
  const status = await b.init();
  assert.deepEqual([status.ok, status.code], [false, "rpc_unavailable"]);
  const e1 = await b.read(`0x${"11".repeat(32)}`).catch(e => e);
  const { report, envelope, rows } = load("normal");
  const e2 = await b.attest(buildPayload({ report, envelope, rows, analyzerVersion: VERSION })).catch(e => e);
  for (const e of [e1, e2]) {
    assert.equal(e.code, "rpc_unavailable");
    for (const leak of ["secret-path-xyz", "hidden-val", new URL(deadUrl).host]) assert.ok(!e.message.includes(leak), e.message);
    outputs.push(e.message);
  }
  const s = script(["check", "--yes", "--out", outFile], { DEMO_EAS_RPC_URL: deadUrl });
  assert.equal(s.code, 1);
  assert.match(s.text, /RPC 연결\s+실패/);
  for (const leak of ["secret-path-xyz", "hidden-val", new URL(deadUrl).host]) assert.ok(!s.text.includes(leak), s.text);
});

test("모든 스크립트 출력·오류 메시지에 키와 RPC 주소가 없다", () => {
  assert.ok(outputs.length >= 10);
  const all = outputs.join("\n");
  for (const v of [...secretVariants(key), ...secretVariants(rpcUrl)]) assert.ok(!all.includes(v), `노출: ${v.slice(0, 6)}…`);
  assert.ok(!/Private Key|Account #0/.test(all));
});
