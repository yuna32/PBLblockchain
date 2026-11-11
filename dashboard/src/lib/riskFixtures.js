// 배포자 위험도 미리보기 예시 (#/trust?preview=...). 화면 틀 확인용 가짜 값이며 실제 분석이 아니다.
// 실제 사건·서비스·주소를 쓰지 않는다. 주소는 16진수가 아닌 글자가 섞인 가짜 표기(0xEXAMPLE…)만 쓴다.
// 값은 팀 결과 파일 형식을 추정한 "원본" 모양이라 화면에서는 normalizeRisk를 거친다.
import { RISK_LOADING, normalizeRisk } from "./risk.js";

const FAKE = n => `0xEXAMPLE${String(n).padStart(33, "0")}`; // 42자, 실제 주소 형식이 아님
const DEPLOYER = FAKE("D1"), CONTRACT = FAKE("C1");
const SRC = "예시 데이터";
const target = { deployer: DEPLOYER, contract: CONTRACT };
const scope = extra => ({ activity_days: 41, tx_count: 23, as_of: "2026-01-01(예시)", failures: [], sources: [SRC], ...extra });

export const RISK_FIXTURES = {
  // 강한 근거 1건이 있어 수준은 "강한 근거", 합계 점수는 낮다(수준은 점수에서 계산하지 않는다).
  strong: {
    level: "strong", score: 35, score_max: 100, target,
    indicators: [
      { key: "first_funding", points: 10, cap: 30 },
      { key: "wallet_maturity", points: 0, cap: 20 },
      { key: "past_scam_deployments", points: 25, cap: 30 },
      { key: "external_flags", points: 0, cap: 10 },
      { key: "past_rug_recovery", points: 0, cap: 10 }
    ],
    evidence: [
      { indicator_key: "past_scam_deployments", strength: "strong", text: "과거 배포 컨트랙트 1건이 공개 라벨에서 사기로 분류됨(예시)", source: SRC, points: 25 },
      { indicator_key: "first_funding", strength: "weak", text: "첫 자금이 믹서(예시)에서 중간 지갑 1개를 거쳐 들어옴", source: SRC, points: 10 }
    ],
    first_funding: { hops: 2, category: "mixer" },
    past_deployments: [
      { contract: FAKE("P1"), deployed_at: "2025-11-02(예시)", public_label: "scam", our_verdict: "risk" },
      { contract: FAKE("P2"), deployed_at: "2025-12-15(예시)", public_label: null, our_verdict: null }
    ],
    scope: scope()
  },
  // 약한 근거만 있어 "근거 있음". 점수는 strong 예시보다 높다.
  some: {
    level: "some", score: 40, score_max: 100, target,
    indicators: [
      { key: "first_funding", points: 25, cap: 30 },
      { key: "wallet_maturity", points: 15, cap: 20 },
      { key: "past_scam_deployments", points: 0, cap: 30 },
      { key: "external_flags", points: 0, cap: 10 },
      { key: "past_rug_recovery", points: 0, cap: 10 }
    ],
    evidence: [
      { indicator_key: "first_funding", strength: "weak", text: "첫 자금이 믹서(예시)에서 바로 들어옴", source: SRC, points: 25 },
      { indicator_key: "wallet_maturity", strength: "weak", text: "배포 3일 전에 처음 쓰인 지갑(예시)", source: SRC, points: 15 }
    ],
    first_funding: { hops: 1, category: "mixer" },
    past_deployments: [],
    scope: scope({ activity_days: 3, tx_count: 4 })
  },
  // 확인했고 모든 지표가 0점: "근거 없음". 과거 배포 0건.
  none: {
    level: "none", score: 0, score_max: 100, target,
    indicators: [
      { key: "first_funding", points: 0, cap: 30 },
      { key: "wallet_maturity", points: 0, cap: 20 },
      { key: "past_scam_deployments", points: 0, cap: 30 },
      { key: "external_flags", points: 0, cap: 10 },
      { key: "past_rug_recovery", points: 0, cap: 10 }
    ],
    evidence: [],
    first_funding: { hops: 1, category: "exchange" },
    past_deployments: [],
    scope: scope({ activity_days: 412, tx_count: 318 })
  },
  // 배포자 정보를 가져오지 못함: 지표 전부 null, 점수 없음
  nodata: {
    level: "nodata", score: null, score_max: 100, target,
    indicators: [
      { key: "first_funding", points: null, cap: 30 },
      { key: "wallet_maturity", points: null, cap: 20 },
      { key: "past_scam_deployments", points: null, cap: 30 },
      { key: "external_flags", points: null, cap: 10 },
      { key: "past_rug_recovery", points: null, cap: 10 }
    ],
    evidence: [],
    first_funding: null,
    past_deployments: null,
    scope: scope({ activity_days: null, tx_count: null, failures: ["배포자 거래 기록 수집 실패(예시)"], reason: "배포자 거래 기록을 가져오지 못해 평가하지 않았습니다(예시)" })
  },
  // 일부 지표만 null(외부 플래그 수집 실패, 확장 지표 미수집): 합계는 부분 합계
  partial: {
    level: "some", score: 20, score_max: 100, target,
    indicators: [
      { key: "first_funding", points: 20, cap: 30 },
      { key: "wallet_maturity", points: 0, cap: 20 },
      { key: "past_scam_deployments", points: 0, cap: 30 },
      { key: "external_flags", points: null, cap: 10 },
      { key: "past_rug_recovery", points: null, cap: 10 }
    ],
    evidence: [
      { indicator_key: "first_funding", strength: "weak", text: "첫 자금이 분류되지 않은 주소(예시)에서 중간 지갑 1개를 거쳐 들어옴", source: SRC, points: 20 }
    ],
    first_funding: { hops: 2, category: "other" },
    past_deployments: [{ contract: FAKE("P3"), deployed_at: "2025-10-20(예시)", public_label: "normal", our_verdict: "no_evidence" }],
    scope: scope({ failures: ["외부 위험 플래그 수집 실패(예시)", "과거 배포 자금 회수 이력 미수집(예시)"] })
  }
};

// 미리보기 키. 5종 외에 로딩·오류 2종도 같은 미리보기 경로에서만 연다.
export const PREVIEW_KEYS = ["strong", "some", "none", "nodata", "partial", "loading", "error-missing", "error-format"];

export function previewRisk(key) {
  if (key === "loading") return RISK_LOADING;
  if (key === "error-missing") return normalizeRisk(null);
  if (key === "error-format") return normalizeRisk({ level: "unknown_level(예시)", score: 50 });
  return RISK_FIXTURES[key] ? normalizeRisk(RISK_FIXTURES[key]) : null;
}
