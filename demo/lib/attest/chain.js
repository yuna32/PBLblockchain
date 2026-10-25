// 로컬 체인: RPC가 닿으면 그대로 쓰고, 닿지 않으면(로컬 주소일 때만) hardhat node를 자식 프로세스로 띄운다.
// 자식의 stdio는 모두 버린다 — hardhat node는 시작할 때 기본 계정 키를 출력하므로 서버 로그·API로 새지 않게 한다.
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkNode, sanitizeEnv } from "../../run.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function defaultHardhatCli() {
  try {
    const pkgDir = path.join(PROJECT_ROOT, "node_modules", "hardhat");
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    return path.join(pkgDir, typeof pkg.bin === "string" ? pkg.bin : pkg.bin.hardhat);
  } catch {
    return null;
  }
}

export async function rpcChainId(rpcUrl, timeoutMs = 1000) {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await res.json();
    return typeof body.result === "string" ? Number(BigInt(body.result)) : null;
  } catch {
    return null;
  }
}

export class LocalChain {
  // rpcUrl, hardhatCli(기본 node_modules의 hardhat), nodeBin(기본 현재 node), startTimeoutMs
  constructor({ rpcUrl, hardhatCli = defaultHardhatCli(), nodeBin = process.execPath, startTimeoutMs = 30000 }) {
    this.rpcUrl = rpcUrl;
    this.hardhatCli = hardhatCli;
    this.nodeBin = nodeBin;
    this.startTimeoutMs = startTimeoutMs;
    this.child = null;
    this.exit = null;
    this.spawned = false;
  }

  get pid() {
    return this.child?.pid ?? null;
  }

  async start() {
    const existing = await rpcChainId(this.rpcUrl);
    if (existing !== null) return { chainId: existing, spawned: false };

    const url = new URL(this.rpcUrl);
    if (!LOCAL_HOSTS.has(url.hostname)) throw new Error("RPC에 연결할 수 없고, 로컬 주소가 아니라 hardhat node를 띄우지 않았습니다.");
    const node = checkNode(this.nodeBin);
    if (!node.ok) throw new Error(node.message ?? "Node를 실행할 수 없습니다.");
    if (!this.hardhatCli || !fs.existsSync(this.hardhatCli)) throw new Error("hardhat 실행 파일을 찾을 수 없습니다 (node_modules 확인 필요).");

    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    this.child = spawn(this.nodeBin, [this.hardhatCli, "node", "--hostname", "127.0.0.1", "--port", port], {
      cwd: PROJECT_ROOT,
      env: sanitizeEnv(process.env),
      stdio: "ignore"
    });
    this.spawned = true;
    this.child.on("exit", (code, signal) => { this.exit = { code, signal }; });
    this.child.on("error", err => { this.exit = { code: null, signal: null, error: err.message }; });

    const t0 = Date.now();
    while (Date.now() - t0 < this.startTimeoutMs) {
      if (this.exit) throw new Error(`hardhat node가 바로 종료되었습니다 (code ${this.exit.code ?? "-"}).`);
      const chainId = await rpcChainId(this.rpcUrl, 500);
      if (chainId !== null) return { chainId, spawned: true };
      await sleep(250);
    }
    await this.stop();
    throw new Error(`hardhat node가 ${this.startTimeoutMs}ms 안에 준비되지 않았습니다.`);
  }

  async stop() {
    const child = this.child;
    if (!child || this.exit) return;
    child.kill("SIGTERM");
    for (let i = 0; i < 30 && !this.exit; i++) await sleep(100);
    if (!this.exit) child.kill("SIGKILL");
  }

  // process 'exit' 처리기용 (동기)
  killSync() {
    if (this.child && !this.exit) {
      try { this.child.kill("SIGKILL"); } catch { /* 이미 종료 */ }
    }
  }
}
