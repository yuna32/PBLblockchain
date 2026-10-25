// 코드 위험 × 지갑 위험 조합 판정 (시연용 임시 기준, 추후 조정 가능).
// 입력은 뷰모델의 codeAssessment, walletAssessment. 순수 함수.

export const COMBINATION_RULES = {
  // 코드 위험 높음: prevention.risk_level이 이 중 하나
  codeHighLevels: ["HIGH", "CRITICAL"],
  // 지갑 위험 높음: drainer >= minDrainers 또는 extractor >= minExtractors 또는 최저 지갑 등급이 lowGrades 중 하나
  walletHigh: { minDrainers: 1, minExtractors: 1, lowGrades: ["D", "E", "F"] },
  // 평균 지갑 등급이 이 중 하나인데 지갑 위험이 높으면 basis에 그 사실을 적는다
  safeLookingGrades: ["A"],
  labels: {
    "low-low":   "낮은 위험",
    "high-low":  "코드 취약 위험 (운영자 신호는 정상 범위)",
    "low-high":  "운영자 위험 (코드는 정상 범위)",
    "high-high": "복합 고위험"
  },
  criteriaNote: "시연용 임시 기준"
};

export function computeCombination({ codeAssessment, walletAssessment }, rules = COMBINATION_RULES) {
  const level = codeAssessment?.preventionRiskLevel ?? null;
  const codeHigh = rules.codeHighLevels.includes(level);

  const drainers   = walletAssessment?.drainerCount ?? 0;
  const extractors = walletAssessment?.extractorCount ?? 0;
  const lowest     = walletAssessment?.lowestWallet?.grade ?? null;
  const average    = walletAssessment?.trustGrade ?? null;
  const walletHits = [];
  if (drainers >= rules.walletHigh.minDrainers) walletHits.push(`운영자 전액 인출 지갑(drainer) ${drainers}개`);
  if (extractors >= rules.walletHigh.minExtractors) walletHits.push(`과도 수익 지갑(extractor) ${extractors}개`);
  if (rules.walletHigh.lowGrades.includes(lowest)) walletHits.push(`최저 지갑 등급 ${lowest}`);
  const walletHigh = walletHits.length > 0;

  const basis = [];
  basis.push(codeHigh
    ? `예방 분석 위험 수준이 ${level}로, 코드 위험 높음 기준(${rules.codeHighLevels.join(" 또는 ")})에 해당합니다.`
    : `예방 분석 위험 수준이 ${level ?? "확인 불가"}로, 코드 위험 높음 기준(${rules.codeHighLevels.join(" 또는 ")})에 해당하지 않습니다.`);
  basis.push(walletHigh
    ? `${walletHits.join(", ")}로 지갑 위험 높음 기준에 해당합니다.`
    : `drainer ${drainers}개, extractor ${extractors}개, 최저 지갑 등급 ${lowest ?? "확인 불가"}로 지갑 위험 높음 기준에 해당하지 않습니다.`);
  if (walletHigh && rules.safeLookingGrades.includes(average)) {
    basis.push(`평균 지갑 등급은 ${average}로 안전해 보이지만, 개별 지갑 기준으로는 지갑 위험이 높습니다.`);
  }

  const quadrant = `${codeHigh ? "high" : "low"}-${walletHigh ? "high" : "low"}`;
  return {
    codeRisk:   codeHigh ? "high" : "low",
    walletRisk: walletHigh ? "high" : "low",
    quadrant,
    label: rules.labels[quadrant],
    basis,
    criteriaNote: rules.criteriaNote
  };
}
