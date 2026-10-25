// 온체인 기록 백엔드 공통 인터페이스: { id, available, attest(payload), read(uid) }.
// local(로컬 hardhat 체인 + EAS)만 구현하고, eas-sepolia는 목록에 "미설정(4c에서 구현)"으로만 표시한다.
import { LocalChain } from "./chain.js";
import { createLocalBackend } from "./local.js";
import { redact } from "./redact.js";

export const BACKEND_LABELS = {
  local: "로컬 체인 (hardhat)",
  "eas-sepolia": "EAS (Sepolia 테스트넷)"
};

const unavailable = (id, reason) => ({
  id, available: false, reason,
  async attest() { throw new Error(reason); },
  async read() { throw new Error(reason); }
});

// options: { enabled, rpcUrl, hardhatCli, nodeBin, startTimeoutMs }
export function createAttestService(options = {}) {
  const { enabled = false, rpcUrl = "http://127.0.0.1:8545" } = options;
  const secrets = [rpcUrl];
  const sepolia = unavailable("eas-sepolia", "미설정(4c에서 구현)");
  let local = unavailable("local", enabled ? "시작 중" : "비활성 (서버 설정에서 꺼짐)");
  let chain = null;

  return {
    async start() {
      if (!enabled) return { available: false, reason: local.reason };
      chain = new LocalChain({ rpcUrl, hardhatCli: options.hardhatCli, nodeBin: options.nodeBin, startTimeoutMs: options.startTimeoutMs });
      try {
        const { chainId, spawned } = await chain.start();
        local = await createLocalBackend({ rpcUrl, chainId });
        local.spawnedNode = spawned;
        return { available: true, chainId, spawned };
      } catch (err) {
        local = unavailable("local", `사용 불가: ${redact(err.shortMessage ?? err.message, secrets)}`);
        await chain.stop();
        return { available: false, reason: local.reason };
      }
    },

    async stop() {
      await chain?.stop();
    },

    killSync() {
      chain?.killSync();
    },

    get chainPid() {
      return chain?.pid ?? null;
    },

    get(id) {
      if (id === "local") return local;
      if (id === "eas-sepolia") return sepolia;
      return null;
    },

    list() {
      return [local, sepolia].map(b => ({
        id: b.id,
        label: BACKEND_LABELS[b.id],
        available: b.available,
        ...(b.available ? { chainId: b.chainId } : { reason: b.reason })
      }));
    },

    redact: text => redact(text, secrets)
  };
}
