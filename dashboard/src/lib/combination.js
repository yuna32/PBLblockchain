// 조합 판정 2x2 매트릭스 배치 (순수).
// 칸 이름은 demo/lib/combination.js COMBINATION_RULES.labels와 같아야 한다(combination.test.js가 비교한다).
export const QUADRANT_LABELS = {
  "low-low":   "낮은 위험",
  "high-low":  "코드 취약 위험 (운영자 신호는 정상 범위)",
  "low-high":  "운영자 위험 (코드는 정상 범위)",
  "high-high": "복합 고위험"
};

// 화면 배치: x = 코드 위험(왼쪽 낮음, 오른쪽 높음), y = 지갑 위험(아래 낮음, 위 높음)
export function matrixCells(combination) {
  const active = combination ? `${combination.codeRisk}-${combination.walletRisk}` : null;
  const order = [["low-high", "high-high"], ["low-low", "high-low"]];
  return order.map(row => row.map(key => ({
    key,
    label: QUADRANT_LABELS[key],
    code: key.split("-")[0],
    wallet: key.split("-")[1],
    active: key === active
  })));
}

export const RISK_LABELS = { low: "낮음", high: "높음" };
