// 개요 화면의 표시 규칙 (순수 함수). 문구의 숫자는 view.decision(demo/lib/decision.js)에서 온 글자만 쓴다.

// 결론별 행동 안내: 투자를 권유·지시하지 않고 확인을 권하는 수준으로 쓴다.
export const CONCLUSION_GUIDE = {
  risk:         "이 컨트랙트에서 사기 유형과 비슷한 거래 패턴이 보입니다. 아래 판단 근거와 거래 기록을 먼저 살펴보시길 권합니다.",
  caution:      "사기 유형으로 정해지지는 않았지만 확인이 필요한 신호가 있습니다. 출금이 실제로 되는지 근거를 함께 확인해 보세요.",
  no_evidence:  "분석한 범위에서는 사기 신호가 보이지 않았습니다. 신호가 없다고 안전이 보장되는 것은 아닙니다.",
  undetermined: "판단에 필요한 거래가 부족해 결론을 내지 못했습니다. 거래가 더 쌓인 뒤 다시 확인해 보세요."
};
export const ACTION_TITLE = "입금하기 전에 다시 확인하세요";

// 위험 단계 사다리 (위에서 아래로). 판단 불가는 어느 칸도 강조하지 않는다(전부 회색).
export const LADDER = ["no_evidence", "caution", "risk"];

// 코드 점검 위험 수준(report.prevention.risk_level) → 코드 카드 배지
//   CRITICAL·HIGH → 위험, MEDIUM → 주의, LOW → 근거 없음, 그 밖(FILE_NOT_FOUND·없음) → 판단 불가
//   LOW여도 코드에서 출금 차단 항목이 감지되면(warnings: prevention.withdraw_block_warning) 주의로 올린다.
export const CODE_LEVEL_CONCLUSION = { CRITICAL: "risk", HIGH: "risk", MEDIUM: "caution", LOW: "no_evidence" };

export function codeConclusion(codeAssessment, warnings = []) {
  const base = CODE_LEVEL_CONCLUSION[codeAssessment?.preventionRiskLevel] ?? "undetermined";
  const blocked = warnings.some(w => w.detected && w.source === "prevention.withdraw_block_warning");
  return base === "no_evidence" && blocked ? "caution" : base;
}

// 코드 카드 문구: levelLabel은 용어집의 한글 등급 이름(예: 매우 높음)
export function codeLines(codeAssessment, conclusion, levelLabel) {
  const rules = codeAssessment?.mainRules ?? [];
  const first = rules[0]?.description ?? null;
  const more = rules.length > 1 ? ` 외 ${rules.length - 1}개` : "";
  switch (conclusion) {
    case "risk":
    case "caution":
      return { text: `배포 전 코드 점검에서 위험 수준이 '${levelLabel}${withRoQuote(levelLabel)} 나왔습니다`, sub: first ? `${first}${more}` : null };
    case "no_evidence":
      return { text: "배포 전 코드 점검에서 위험 항목이 나오지 않았습니다", sub: first ? `참고 신호: ${first}${more}` : null };
    default:
      return { text: "코드 점검 결과가 없습니다", sub: null };
  }
}

// '매우 높음'으로 / '보통'으로 / '높음'으로: 따옴표 뒤 조사 (받침 없음·ㄹ → 로)
function withRoQuote(label) {
  const s = String(label ?? "");
  const code = s.charCodeAt(s.length - 1);
  const hangul = code >= 0xac00 && code <= 0xd7a3;
  const jong = hangul ? (code - 0xac00) % 28 : -1;
  return `'${jong === 0 || jong === 8 ? "로" : "으로"}`;
}

// 돈의 흐름 카드 한 줄: 위험이고 가져간 쪽이 있으면 "들어온 돈의 {비율}가 {가져간 쪽} 갔습니다", 아니면 그림 설명 첫 줄
export function flowLine(decision) {
  const taker = decision.flow.outs.find(o => o.kind === "owner" || o.kind === "collector" || o.kind === "insiders");
  if (decision.conclusion === "risk" && taker?.ratioText) {
    const to = taker.kind === "owner" ? "운영자에게" : taker.kind === "collector" ? "한 지갑(모은 지갑)으로" : `내부자 ${taker.count}개 지갑으로`;
    return `들어온 돈의 ${taker.ratioText}가 ${to} 갔습니다`;
  }
  return decision.copy.chartNotes[0];
}

// 헤드라인 위 유형 표시: 사기 유형이면 "{유형} 의심", 정상·출금 차단 경고는 이름 그대로, 판단 불가는 없음
export function typeTag(decision) {
  if (!decision.typeLabel || decision.conclusion === "undetermined") return null;
  return decision.conclusion === "risk" ? `${decision.typeLabel} 의심` : decision.typeLabel;
}

// 리포트 변조 확인 실행: canonical을 읽고(실패해도 계속) verify를 돌려 onState로 알린다.
// 돌려주는 함수를 부르면 취소된다 — 취소 뒤 끝난 결과는 onState로 보내지 않는다(시나리오를 빨리 바꿔도 이전 결과가 섞이지 않음).
// verify: lib/verifyBrowser.js verifyIntegrity (테스트에서는 가짜 함수)
export function startIntegrityCheck({ snapshot, loadCanonical, verify, onState }) {
  let alive = true;
  onState({ status: "checking" });
  Promise.resolve()
    .then(() => loadCanonical())
    .catch(() => null)
    .then(canonical => verify({ ...snapshot, canonical }))
    .then(r => { if (alive) onState({ status: "done", ok: r.ok }); })
    .catch(err => { if (alive) onState({ status: "error", error: err?.message ?? String(err) }); });
  return () => { alive = false; };
}

// 리포트 변조 확인 (브라우저 무결성 검증 lib/verifyBrowser.js verifyIntegrity 결과)
//   state: { status: "checking" } | { status: "done", ok } | { status: "error", error }
export function integrityStatus(state) {
  if (!state || state.status === "checking") return { tone: "neutral", text: "확인 중", key: "checking" };
  if (state.status === "error") return { tone: "caution", text: "확인하지 못함", key: "error", detail: state.error ?? null };
  return state.ok
    ? { tone: "safe", text: "분석 당시와 같음", key: "same" }
    : { tone: "danger", text: "분석 당시와 다름", key: "different" };
}
