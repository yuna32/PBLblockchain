// 증명 상태 판정 (순수, 의존성 없음). demo/export.js와 대시보드 정적 모드가 같이 쓴다.
//   A "Sepolia 기록 있음": attestation이 있고 chainId == 11155111, uid·txHash가 0x+64자리 16진수
//   B "온체인 기록 없음":  attestation이 없거나 chainId가 11155111이 아님(로컬 hardhat 31337 등은 공개 검증 불가라 B)
//   (C "조회 불가"는 A인데 브라우저 RPC 조회가 실패한 경우로, 화면에서만 생긴다 — verifyBrowser.js)
export const SEPOLIA_CHAIN_ID = 11155111;
export const EAS_EXPLORER_BASE = "https://sepolia.easscan.org";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

export function attestStatusOf(attestation) {
  if (!attestation || typeof attestation !== "object") return "B";
  if (attestation.chainId !== SEPOLIA_CHAIN_ID) return "B";
  if (!HEX32.test(attestation.uid ?? "") || !HEX32.test(attestation.txHash ?? "")) return "B";
  return "A";
}
