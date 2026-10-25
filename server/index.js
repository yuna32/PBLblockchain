// 시연용 로컬 API 서버 진입점: npm run demo:server (Node 22.10 이상, 저장소 루트에서 nvm use)
// PORT (기본 8787), HOST (기본 127.0.0.1)
// 온체인 기록: DEMO_ATTEST_RPC_URL (기본 http://127.0.0.1:8545), DEMO_ATTEST=off 로 끈다.
//   RPC가 닿지 않으면 hardhat node를 자식 프로세스로 띄우고, 서버를 끌 때 함께 끈다.
import { createApp, DEFAULT_RUNS_DIR, DEV_ORIGIN } from "./app.js";
import { checkNode } from "../demo/run.js";

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || "127.0.0.1";

const node = checkNode(process.execPath);
if (!node.ok) {
  console.warn(`⚠ ${node.message}`);
  console.warn("  live 시뮬레이션은 실패하고 모든 분석이 fixture로 폴백한다.");
}

const { server, attest } = createApp({
  attest: {
    enabled: process.env.DEMO_ATTEST !== "off",
    rpcUrl: process.env.DEMO_ATTEST_RPC_URL || "http://127.0.0.1:8545"
  }
});

server.listen(port, host, () => {
  console.log(`시연 API: http://${host}:${port}/api  (Node ${process.version}, CORS 허용: ${DEV_ORIGIN})`);
  console.log(`작업 결과: ${DEFAULT_RUNS_DIR}`);
  console.log("온체인 기록(local): 시작 중…");
  attest.start().then(r => {
    // RPC 주소는 출력하지 않는다
    console.log(r.available
      ? `온체인 기록(local): 사용 가능 (chainId ${r.chainId}, ${r.spawned ? "hardhat node 자식 프로세스" : "기존 노드"}, 사전 기록 ${r.prerecorded}/5, 분석기 버전 ${attest.analyzerVersion})`
      : `온체인 기록(local): ${r.reason}`);
  });
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections?.();
  await attest.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, shutdown);
process.on("exit", () => attest.killSync());
