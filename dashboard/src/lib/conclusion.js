// 결론 배지 네 가지(위험 / 주의 / 근거 없음 / 판단 불가). 순수 함수.
// view.decision.conclusion(demo/lib/decision.js)이 있으면 그 값을 쓰고, 없으면(예전 스냅샷) 헤드라인 톤과 유형으로 정한다.

export const CONCLUSIONS = {
  risk:         { label: "위험",      tone: "danger",  desc: "사기 유형으로 판정" },
  caution:      { label: "주의",      tone: "caution", desc: "출금 차단 등 경고 신호" },
  no_evidence:  { label: "근거 없음", tone: "safe",    desc: "분석 범위에서 신호 없음" },
  undetermined: { label: "판단 불가", tone: "neutral", desc: "판단에 필요한 거래가 부족" }
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
