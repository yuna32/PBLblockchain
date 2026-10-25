// eas-sepolia 백엔드 설정을 환경 변수에서 읽는다(모두 선택).
//   DEMO_EAS_RPC_URL          RPC 주소. 없으면 eas-sepolia는 "미설정"
//   DEMO_EAS_PRIVATE_KEY      기록용 키. 없으면 읽기 전용(조회·검증만)
//   DEMO_EAS_ADDRESS          EAS 컨트랙트 (기본 Sepolia)
//   DEMO_EAS_SCHEMA_REGISTRY  SchemaRegistry 컨트랙트 (기본 Sepolia)
//   DEMO_EAS_CHAIN_ID         체인 ID (기본 11155111)
//   DEMO_EAS_EXPLORER_BASE    탐색기 주소 (기본 https://sepolia.easscan.org)
// 이름에 EAS_가 들어 있어 demo/run.js가 시뮬레이션 하위 프로세스 환경에서 모두 뺀다(SECRET_ENV_PATTERN).
// 오류 메시지에는 값(특히 키)을 넣지 않는다.

// 주소·탐색기 출처: eas-contracts 1.7.1·1.9.0 README와 deployments/sepolia, EAS 문서 (~/pbl_backup/mvp/p4/P4_FINDINGS.md)
export const SEPOLIA_DEFAULTS = {
  easAddress: "0xC2679fBD37d54388Ce493F1DB75320D236e1815e",
  registryAddress: "0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0",
  chainId: 11155111,
  explorerBase: "https://sepolia.easscan.org"
};

// demo:eas:record-fixtures가 demo/fixtures/ 아래에 만드는 사전 기록 파일 이름 (비밀 정보 없음)
export const EAS_FIXTURES_BASENAME = "attestations.sepolia.json";

export const EAS_ENV_NAMES = [
  "DEMO_EAS_RPC_URL", "DEMO_EAS_PRIVATE_KEY", "DEMO_EAS_ADDRESS",
  "DEMO_EAS_SCHEMA_REGISTRY", "DEMO_EAS_CHAIN_ID", "DEMO_EAS_EXPLORER_BASE"
];

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY = /^(0x)?[0-9a-fA-F]{64}$/;

// → { configured, rpcUrl, privateKey, easAddress, registryAddress, chainId, explorerBase, errors: [문자열] }
export function easConfigFromEnv(env = {}) {
  const v = name => (typeof env[name] === "string" && env[name].trim() !== "" ? env[name].trim() : null);
  const errors = [];
  const rpcUrl = v("DEMO_EAS_RPC_URL");
  let privateKey = v("DEMO_EAS_PRIVATE_KEY");
  if (privateKey && !PRIVATE_KEY.test(privateKey)) {
    errors.push("DEMO_EAS_PRIVATE_KEY 형식이 올바르지 않습니다 (64자리 16진수, 값은 표시하지 않음)");
    privateKey = null;
  }
  if (privateKey && !privateKey.startsWith("0x")) privateKey = `0x${privateKey}`;
  if (rpcUrl) {
    try {
      const u = new URL(rpcUrl);
      if (!/^https?:$/.test(u.protocol)) errors.push("DEMO_EAS_RPC_URL은 http(s) 주소여야 합니다 (값은 표시하지 않음)");
    } catch {
      errors.push("DEMO_EAS_RPC_URL이 URL 형식이 아닙니다 (값은 표시하지 않음)");
    }
  }
  const easAddress = v("DEMO_EAS_ADDRESS") ?? SEPOLIA_DEFAULTS.easAddress;
  const registryAddress = v("DEMO_EAS_SCHEMA_REGISTRY") ?? SEPOLIA_DEFAULTS.registryAddress;
  if (!ADDRESS.test(easAddress)) errors.push("DEMO_EAS_ADDRESS가 주소 형식이 아닙니다");
  if (!ADDRESS.test(registryAddress)) errors.push("DEMO_EAS_SCHEMA_REGISTRY가 주소 형식이 아닙니다");
  const chainRaw = v("DEMO_EAS_CHAIN_ID");
  const chainId = chainRaw === null ? SEPOLIA_DEFAULTS.chainId : Number(chainRaw);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) errors.push("DEMO_EAS_CHAIN_ID가 양의 정수가 아닙니다");
  const explorerBase = (v("DEMO_EAS_EXPLORER_BASE") ?? SEPOLIA_DEFAULTS.explorerBase).replace(/\/+$/, "");
  return { configured: Boolean(rpcUrl), rpcUrl, privateKey, easAddress, registryAddress, chainId, explorerBase, errors };
}
