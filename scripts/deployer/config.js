// 배포자 위험 점수(Risk Score) 시연용 v0 기준.
// - 0점에서 시작해 근거마다 더한다(높을수록 위험). 지표마다 상한이 있다.
// - 수준(4단계)은 점수 구간이 아니라 근거의 강도로 정한다: 강한 근거 1개 이상 → strong, 약한 근거만 → some,
//   확인했지만 근거 없음 → none, 배포자 데이터를 못 받음 → nodata.
// - 값은 실데이터 검증 전 임시 기준이다. 검증 후 이 파일만 고친다.

export const RULES_VERSION = "v0 (시연용 임시 기준, 검증 전)";

// 지표 5개. key는 대시보드 lib/risk.js INDICATORS와 같아야 한다.
export const INDICATOR_RULES = {
  first_funding:         { cap: 30, mixer: { strength: "strong", points: 30 } },
  wallet_maturity:       { cap: 20, young: { strength: "weak", points: 10, maxDays: 7 } },
  past_scam_deployments: { cap: 30, any:   { strength: "strong", points: 30, minCount: 1 } },
  external_flags:        { cap: 10 }, // v0에서는 GoPlus를 쓰지 않아 데이터 없음
  fund_flow:             { cap: 10, passThrough: { strength: "weak", points: 10, minEvents: 2 } }
};
export const SCORE_MAX = Object.values(INDICATOR_RULES).reduce((s, r) => s + r.cap, 0); // 100

// 자금 이동 패턴: 받은 금액(minInEth 이상)의 shareOut 이상을 withinBlocks 블록 안에 내보낸 일이 minEvents번 이상
export const FUND_FLOW = { minInEth: 0.1, shareOut: 0.8, withinBlocks: 100 };

// 첫 자금원 분류용 믹서 주소(Tornado Cash ETH 풀). v0에서는 믹서만 분류하고 나머지는 "기타".
export const MIXER_ADDRESSES = new Set([
  "0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc", // 0.1 ETH
  "0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936", // 1 ETH
  "0x910cbd523d972eb0a6f4cae4618ad62622b39dbf", // 10 ETH
  "0xa160cdab225685da1d56aa342ad8841c3b53f291"  // 100 ETH
]);
