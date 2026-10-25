// 시연용 로컬 API 서버 진입점: npm run demo:server (Node 22.10 이상, 저장소 루트에서 nvm use)
// PORT (기본 8787), HOST (기본 127.0.0.1)
import { createApp, DEFAULT_RUNS_DIR, DEV_ORIGIN } from "./app.js";
import { checkNode } from "../demo/run.js";

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || "127.0.0.1";

const node = checkNode(process.execPath);
if (!node.ok) {
  console.warn(`⚠ ${node.message}`);
  console.warn("  live 시뮬레이션은 실패하고 모든 분석이 fixture로 폴백한다.");
}

const { server } = createApp();
server.listen(port, host, () => {
  console.log(`시연 API: http://${host}:${port}/api  (Node ${process.version}, CORS 허용: ${DEV_ORIGIN})`);
  console.log(`작업 결과: ${DEFAULT_RUNS_DIR}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
