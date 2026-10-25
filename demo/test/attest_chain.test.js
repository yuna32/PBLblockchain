// node --test demo/test/  (임의 포트에 hardhat node를 띄우는 통합 시험. Node 22.10 이상)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { LocalChain, rpcChainId } from "../lib/attest/chain.js";
import { createLocalBackend } from "../lib/attest/local.js";
import { createAttestService } from "../lib/attest/index.js";
import { buildPayload } from "../lib/attest/schema.js";
import { runScenario } from "../run.js";
import { toTimeseries } from "../lib/timeseries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on("error", reject);
  });
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test("LocalChain + local 백엔드: 노드 시작 → 배포 → attest → read → 종료", async () => {
  const rpcUrl = `http://127.0.0.1:${await freePort()}`;
  const chain = new LocalChain({ rpcUrl, startTimeoutMs: 60000 });
  const started = await chain.start();
  assert.deepEqual(started, { chainId: 31337, spawned: true });
  const pid = chain.pid;
  try {
    const backend = await createLocalBackend({ rpcUrl, chainId: started.chainId });
    assert.match(backend.schemaUID, /^0x[0-9a-f]{64}$/);
    const dir = path.join(ROOT, "demo", "fixtures", "ponzi");
    const payload = buildPayload({
      report: JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")),
      envelope: JSON.parse(fs.readFileSync(path.join(dir, "envelope.json"), "utf8")),
      rows: toTimeseries(fs.readFileSync(path.join(dir, "ponzi_log.csv"), "utf8")),
      analyzerVersion: "test+jcs-rfc8785/pbl-demo-v1"
    });
    const att = await backend.attest(payload);
    assert.equal(att.backend, "local");
    assert.equal(att.chainId, 31337);
    assert.equal(att.explorerUrl, null);
    assert.match(att.uid, /^0x[0-9a-f]{64}$/);
    assert.match(att.txHash, /^0x[0-9a-f]{64}$/);
    const read = await backend.read(att.uid);
    assert.deepEqual(read.payload, payload);
    assert.equal(read.attester, att.attester);
    assert.equal(read.schemaMatches, true);
    assert.equal(await backend.read(`0x${"00".repeat(32)}`), null);
    // 같은 payload를 다시 기록하면 새 uid
    assert.notEqual((await backend.attest(payload)).uid, att.uid);
  } finally {
    await chain.stop();
  }
  assert.equal(alive(pid), false, "자식 hardhat node가 종료되어야 함");
  assert.equal(await rpcChainId(rpcUrl, 500), null);
});

test("시작 실패: hardhat 경로가 없으면 사용 불가와 이유, RPC 주소는 가림", async () => {
  const rpcUrl = `http://127.0.0.1:${await freePort()}/secret-token-xyz`;
  const svc = createAttestService({ enabled: true, rpcUrl, hardhatCli: "/nonexistent/hardhat/cli.js", startTimeoutMs: 3000 });
  const r = await svc.start();
  assert.equal(r.available, false);
  assert.match(r.reason, /^사용 불가: hardhat 실행 파일을 찾을 수 없습니다/);
  const listed = JSON.stringify(svc.list());
  assert.ok(!listed.includes("secret-token-xyz") && !listed.includes("127.0.0.1"), listed);
  await assert.rejects(svc.get("local").attest({}), /사용 불가/);
});

test("demo/run.js: 시뮬레이션 하위 프로세스 환경에 키·RPC·EAS 변수가 없음", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pbl-env-"));
  const dump = path.join(tmp, "env.txt");
  const fakeNode = path.join(tmp, "fake-node.sh");
  // -v에는 22.22.2로 답하고, 실제 실행 때는 받은 환경을 파일로 남긴 뒤 실패(→ fixture 폴백)
  fs.writeFileSync(fakeNode, `#!/bin/sh\nif [ "$1" = "-v" ]; then echo v22.22.2; exit 0; fi\nenv > "$PBL_ENV_DUMP"\nexit 3\n`, { mode: 0o755 });
  const injected = { EAS_PRIVATE_KEY: "not-a-real-key", WALLET_MNEMONIC: "m", ALCHEMY_RPC_URL: "u", DEMO_ATTEST_RPC_URL: "u", PBL_ENV_DUMP: dump };
  const saved = Object.fromEntries(Object.keys(injected).map(k => [k, process.env[k]]));
  Object.assign(process.env, injected);
  try {
    const r = await runScenario("ponzi", path.join(tmp, "out"), { nodeBin: fakeNode });
    assert.equal(r.source, "fixture");
    const names = fs.readFileSync(dump, "utf8").split("\n").map(l => l.split("=")[0]).filter(Boolean);
    for (const k of ["EAS_PRIVATE_KEY", "WALLET_MNEMONIC", "ALCHEMY_RPC_URL", "DEMO_ATTEST_RPC_URL"]) assert.ok(!names.includes(k), k);
    assert.ok(names.includes("DEMO_LOG_DIR") && names.includes("DEMO_SEED") && names.includes("PBL_ENV_DUMP"));
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
