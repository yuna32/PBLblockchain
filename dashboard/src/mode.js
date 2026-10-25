// 실행 모드: VITE_STATIC=1로 빌드하면 정적 모드(서버 없이 public/snapshot/의 사전 계산 결과를 읽음), 아니면 서버 모드.
export const STATIC_MODE = import.meta.env?.VITE_STATIC === "1";
