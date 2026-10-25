// 온체인 조회 (정적 모드, 상태 A일 때만 verifyBrowser.js가 동적 import한다 → viem은 이 청크에만 들어간다).
// 읽기 전용: 공개 RPC로 EAS.getAttestation(uid)를 호출하고 payload를 해독한다. 서명·키 관련 코드는 없다.
// createPublicClient 대신 기본 client + 필요한 action(getChainId, readContract)만 써서, 서명 검증용 타원곡선 코드가 번들에 들어오지 않게 한다.
// ABI와 스키마 문자열은 demo/lib/attest/abi.js·schema.js와 같고, src/lib/verifyBrowser.test.js가 비교한다.
import { createClient, decodeAbiParameters, http, parseAbi, parseAbiParameters, zeroHash } from "viem";
import { getChainId, readContract } from "viem/actions";

export const SCHEMA =
  "address contractAddress,bytes32 reportHash,string codeRiskGrade,uint8 trustScore," +
  "uint8 minWalletTrustScore,uint64 scanTimestamp,string analyzerVersion";
const SCHEMA_PARAMS = parseAbiParameters(SCHEMA);

export const EAS_READ_ABI = parseAbi([
  "struct Attestation { bytes32 uid; bytes32 schema; uint64 time; uint64 expirationTime; uint64 revocationTime; bytes32 refUID; address recipient; address attester; bool revocable; bytes data; }",
  "function getAttestation(bytes32 uid) view returns (Attestation)"
]);

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function decodePayload(data) {
  const v = decodeAbiParameters(SCHEMA_PARAMS, data);
  return {
    contractAddress: v[0].toLowerCase(),
    reportHash: v[1].toLowerCase(),
    codeRiskGrade: v[2],
    trustScore: Number(v[3]),
    minWalletTrustScore: Number(v[4]),
    scanTimestamp: Number(v[5]),
    analyzerVersion: v[6]
  };
}

// easAddress: attestation.json의 contract (EAS 컨트랙트 주소)
export function createReader({ rpcUrl, easAddress }) {
  if (!ADDRESS.test(easAddress ?? "")) throw new Error("EAS 주소 형식이 올바르지 않습니다.");
  const client = createClient({ transport: http(rpcUrl, { timeout: 15000, retryCount: 1 }) });
  return {
    getChainId: () => getChainId(client),
    async getAttestation(uid) {
      const att = await readContract(client, { address: easAddress, abi: EAS_READ_ABI, functionName: "getAttestation", args: [uid] });
      if (!att || att.uid === zeroHash) return null;
      return { uid: att.uid, schema: att.schema, attester: att.attester.toLowerCase(), revoked: att.revocationTime !== 0n, data: att.data };
    }
  };
}
