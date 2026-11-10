// 결론 배지 네 가지(위험 / 주의 / 근거 없음 / 판단 불가). 순수 함수.
// 결론은 view.decision.conclusion(demo/lib/decision.js)을 그대로 쓴다.
// decision이 없는 예전 응답에서만 헤드라인 톤과 유형으로 대신 정한다(같은 규칙).

// desc는 결론 배지 설명의 단일 출처: 히어로 "결론은 하나로 나옵니다"와 오른쪽 패널 배지 툴팁이 같이 쓴다.
export const CONCLUSIONS = {
  risk:         { label: "위험",      tone: "danger",  desc: "사기 유형과 비슷한 거래 패턴이 보입니다" },
  caution:      { label: "주의",      tone: "caution", desc: "출금이 막히는 것 같은 경고 신호가 있습니다" },
  no_evidence:  { label: "근거 없음", tone: "safe",    desc: "분석한 범위에서 신호가 보이지 않습니다. 안전이 보장된다는 뜻은 아닙니다" },
  undetermined: { label: "판단 불가", tone: "neutral", desc: "판단에 필요한 거래가 부족합니다" }
};

export const CONCLUSION_ORDER = ["risk", "caution", "no_evidence", "undetermined"];

export function conclusionOf(view) {
  if (!view) return null;
  const fromDecision = view.decision?.conclusion;
  if (fromDecision && CONCLUSIONS[fromDecision]) return fromDecision;
  const hint = view.patterns?.fraudTypeHint;
  if (hint === "unknown" || hint === "flash_loan" || !hint) return "undetermined";
  if (hint === "unclassified_warning") return "caution";
  if (hint === "normal_staking") return view.headline?.tone === "safe" ? "no_evidence" : "caution";
  return view.patterns?.fraudClassified ? "risk" : "undetermined";
}
