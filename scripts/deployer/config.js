// 배포자 위험 점수(Risk Score) 시연용 v0 기준.
// - 0점에서 시작해 근거마다 더한다(높을수록 위험). 지표마다 상한이 있다.
// - 수준(4단계)은 점수 구간이 아니라 근거의 강도로 정한다: 강한 근거 1개 이상 → strong, 약한 근거만 → some,
//   확인했지만 근거 없음 → none, 배포자 데이터를 못 받음 → nodata.
// - 값은 실데이터 검증 전 임시 기준이다. 검증 후 이 파일만 고친다.

export const RULES_VERSION = "v1 (조정용 절반으로 정한 기준)";

// 지표 5개. key는 대시보드 lib/risk.js INDICATORS와 같아야 한다.
// 강함·약함은 조정용 절반(배포자 기준 분할, scripts/deployer/evaluate.js)에서 "정상 대비 사기에서 몇 배 더 자주 나오나"로 정했다:
//   5배 이상 → 강함(30), 1.5~5배 → 약함(10), 1.5배 미만 → 점수 제외(참고로만 표시).
//   과거 사기 배포(24시간 이상 앞선 것) 6.9배 · 첫 자금원 사기 배포자 33.5배 · 받자마자 보냄 1.5배 · 새 지갑 1.3배
//   믹서는 이 데이터(2016~2017년)에 사례가 없어 검증하지 못했고, 설계 근거(Nansen 등)로 강함을 유지한다.
export const INDICATOR_RULES = {
  first_funding:         { cap: 30, mixer: { strength: "strong", points: 30 }, malicious: { strength: "strong", points: 30 } },
  wallet_maturity:       { cap: 20, young: { maxDays: 7, info: true } }, // 구분력이 낮아(1.3배) 점수에 넣지 않고 참고로만
  past_scam_deployments: { cap: 30, any:   { strength: "strong", points: 30, minCount: 1 } },
  external_flags:        { cap: 10 }, // GoPlus 미연결: 데이터 없음
  fund_flow:             { cap: 10, passThrough: { strength: "weak", points: 10, minEvents: 2 } }
};

// 점수 구간(onchainrisk 방식): 단계마다 구간을 정하고, 구간 안에서는 발견된 근거가 많을수록 높게.
//   근거 없음 0 · 근거 있음 26~50 · 강한 근거 76~100
export const SCORE_BANDS = {
  none:   { base: 0,  span: 0 },
  some:   { base: 26, span: 24 },
  strong: { base: 76, span: 24 }
};

export const SCORE_MAX = Object.values(INDICATOR_RULES).reduce((s, r) => s + r.cap, 0); // 100

// 자금 이동 패턴: 받은 금액(minInEth 이상)의 shareOut 이상을 withinSeconds 안에 내보낸 일이 minEvents번 이상
// (블록 수 대신 시간 기준: 이더리움 블록 간격이 시기마다 달라서)
export const FUND_FLOW = { minInEth: 0.1, shareOut: 0.8, withinSeconds: 30 * 60 };

// 같은 날 재배포는 별개의 사기로 세지 않는다: 기준 시점보다 이만큼 이상 앞선 배포만 "과거 사기 배포"로 본다
export const PAST_SCAM_MIN_GAP_SECONDS = 24 * 3600;

// 이력 부족: 기준 시점 이전 거래가 이보다 적으면 "판단 근거 부족"으로 표시한다(근거 없음이 안전처럼 보이지 않게)
export const MIN_HISTORY_TXS = 5;

// 첫 자금원 분류용 믹서 주소(Tornado Cash ETH 풀). v0에서는 믹서만 분류하고 나머지는 "기타".
export const MIXER_ADDRESSES = new Set([
  "0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc", // 0.1 ETH
  "0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936", // 1 ETH
  "0x910cbd523d972eb0a6f4cae4618ad62622b39dbf", // 10 ETH
  "0xa160cdab225685da1d56aa342ad8841c3b53f291"  // 100 ETH
]);
