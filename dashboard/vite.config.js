import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api는 시연 API 서버(npm run demo:server)로 넘긴다. DEMO_API_TARGET으로 바꿀 수 있다.
const apiTarget = process.env.DEMO_API_TARGET || "http://127.0.0.1:8787";
const proxy = { "/api": { target: apiTarget } };

// 정적 모드(VITE_STATIC=1): public/snapshot/을 함께 내보내고, 상대 경로(base "./")로 빌드해 어느 경로에 올려도 동작한다.
// 해시 라우팅이라 호스팅 rewrite가 필요 없다. 서버 모드 빌드는 예전과 같다(public 폴더를 복사하지 않음).
const STATIC = process.env.VITE_STATIC === "1";

export default defineConfig({
  plugins: [react()],
  base: STATIC ? "./" : "/",
  publicDir: STATIC ? "public" : false,
  server: {
    host: process.env.DEMO_UI_HOST || "127.0.0.1",
    port: Number(process.env.DEMO_UI_PORT) || 5173,
    strictPort: true,
    proxy
  },
  preview: {
    host: process.env.DEMO_UI_HOST || "127.0.0.1",
    port: Number(process.env.DEMO_UI_PORT) || 4173,
    proxy
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.js"]
  }
});
