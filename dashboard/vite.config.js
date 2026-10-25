import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api는 시연 API 서버(npm run demo:server)로 넘긴다. DEMO_API_TARGET으로 바꿀 수 있다.
const apiTarget = process.env.DEMO_API_TARGET || "http://127.0.0.1:8787";
const proxy = { "/api": { target: apiTarget } };

export default defineConfig({
  plugins: [react()],
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
