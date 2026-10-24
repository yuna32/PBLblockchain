// 종합 등급 계산: 정적·동적·신뢰 점수 가중식과 예방 등급 상한.
// 메인 pipeline, 중첩 pipeline, scenarios/run_all_scenarios.js가 함께 쓴다.

export const GRADE_ORDER = ["A", "B", "C", "D", "E", "F"];
const CAPS = { CRITICAL: "D", HIGH: "C" };

export function computeRawGrade(staticResult, dynamicResult, trustResult) {
  const combined = Math.round(
    staticResult.static_risk_score   * 0.30 +
    dynamicResult.dynamic_risk_score * 0.40 +
    (100 - trustResult.overall_trust_score) * 0.30
  );
  if (combined <= 19) return "A";
  if (combined <= 39) return "B";
  if (combined <= 59) return "C";
  if (combined <= 79) return "D";
  return "F";
}

export function applyPreventionCap(rawGrade, preventionLevel) {
  const cap = CAPS[preventionLevel];
  if (!cap) return rawGrade;
  const rawIdx = GRADE_ORDER.indexOf(rawGrade);
  const capIdx = GRADE_ORDER.indexOf(cap);
  return rawIdx >= capIdx ? rawGrade : cap;
}

export function computeGrade(staticResult, dynamicResult, trustResult, preventionResult) {
  const rawGrade = computeRawGrade(staticResult, dynamicResult, trustResult);
  return applyPreventionCap(rawGrade, preventionResult?.risk_level);
}
