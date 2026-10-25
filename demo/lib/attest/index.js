// 온체인 기록 백엔드 공통 인터페이스: { id, available, attest(payload), read(uid) }.
// local: 로컬 hardhat 체인 + 직접 배포한 EAS. eas-sepolia: 설정한 RPC·주소의 EAS(기본 Sepolia, lib/attest/eas.js).
import { LocalChain } from "./chain.js";
import { createLocalBackend } from "./local.js";
import { createEasBackend } from "./eas.js";
import { BackendError } from "./errors.js";
import { redact } from "./redact.js";

export const BACKEND_LABELS = {
  local: "로컬 체인 (hardhat)",
  "eas-sepolia": "EAS (Sepolia 테스트넷)"
};

export const EAS_NOT_CONFIGURED = "미설정 (DEMO_EAS_RPC_URL 없음)";

const unavailable = (id, reason, code = "backend_unavailable") => ({
  id, available: false, reason,
  async attest() { throw new BackendError(code, reason); },
  async read() { throw new BackendError(code, reason); }
});

// options: { enabled, rpcUrl, hardhatCli, nodeBin, startTimeoutMs, eas, easTuning }
//   eas: lib/attest/config.js easConfigFromEnv()의 값 (없으면 eas-sepolia 미설정)
export function createAttestService(options = {}) {
  const { enabled = false, rpcUrl = "http://127.0.0.1:8545", eas: easConfig = null } = options;
  const secrets = [rpcUrl, easConfig?.rpcUrl, easConfig?.privateKey].filter(Boolean);
  let local = unavailable("local", enabled ? "시작 중" : "비활성 (서버 설정에서 꺼짐)");
  let chain = null;

  let sepolia;
  if (!easConfig?.configured) sepolia = unavailable("eas-sepolia", EAS_NOT_CONFIGURED);
  else if (easConfig.errors?.length) sepolia = unavailable("eas-sepolia", `설정 오류: ${easConfig.errors.join("; ")}`);
  else sepolia = createEasBackend(easConfig, options.easTuning);

  async function startLocal() {
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
  }

  // eas-sepolia 연결 점검 (체인 ID·컨트랙트·스키마). 자동 등록·자동 기록은 하지 않는다.
  async function startEas() {
    if (!sepolia.available) return { available: false, reason: sepolia.reason };
    const status = await sepolia.init();
    return { available: true, mode: sepolia.mode, chainId: sepolia.chainId, ok: status.ok, reason: status.reason, schemaRegistered: sepolia.schemaRegistered };
  }

  return {
    async start() {
      const [localResult, easResult] = await Promise.all([startLocal(), startEas()]);
      return { ...localResult, eas: easResult };
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
        ...(!b.available ? { reason: b.reason } : b.describe ? b.describe() : { chainId: b.chainId })
      }));
    },

    redact: text => redact(text, secrets)
  };
}
