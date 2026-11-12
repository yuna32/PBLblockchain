// 상세 분석 > 판정 조건 화면의 표시 규칙 (순수 함수). 모두 view.decision에서만 만든다.
// 축약 그래프도 전체 온톨로지 그래프(ontology.json)와 섞지 않고 decision.chain으로 만들어 판정 조건 카드와 항상 일치시킨다.

// 조사 "(으)로": 받침 없음·ㄹ → 로, 그 밖 → 으로 (demo/lib/decision.js withRo와 같은 규칙, 테스트로 비교)
export function withRo(word) {
  const s = String(word ?? "");
  const code = s.charCodeAt(s.length - 1);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return `${s}(으)로`;
  const jong = (code - 0xac00) % 28;
  return `${s}${jong === 0 || jong === 8 ? "로" : "으로"}`;
}

// 화면 제목: "{유형}로 판정된 이유" / 판단 불가는 "결론을 내리지 못한 이유"
export function conditionsTitle(decision) {
  const step = decision.chain.find(s => s.no === decision.matchedStep);
  return step ? `${withRo(step.label)} 판정된 이유` : "결론을 내리지 못한 이유";
}

// 조건 → 관측한 사실(그래프 왼쪽 열) 이름
const FACT_OF = {
  mixed_withdrawals: "출금 성공·실패",
  insider_exit: "지갑별 입금·수령",
  balance_at_failure_zero: "실패 시점 잔고",
  balance_left_at_failure: "실패 시점 잔고",
  single_large_outflow: "최고 잔고·최대 출금",
  distributed_inflow: "입금 지갑 수",
  recipient_is_depositor: "출금 받은 주소",
  rug_scope: "거래 기록 종류",
  net_drain: "지갑별 낸 돈·받은 돈",
  not_shared_profit: "지갑별 낸 돈·받은 돈",
  mid_exit: "참여자 중도 출금",
  balance_drop: "잔고 급락 신호",
  flow_spike: "대량 유출 신호",
  non_owner_attempts: "운영자 외 출금",
  non_owner_success_low: "운영자 외 출금",
  stake_pattern: "스테이킹 거래"
};
export const factOf = id => FACT_OF[id] ?? "거래 기록";

// 축약 그래프: 관측한 사실 → 조건 → 사기 유형 → 결론
//   매칭된 단계의 조건 전부 + 앞서 "아니요"였던 단계마다 첫 번째로 맞지 않은 조건 하나(→ "다른 유형 N개 · 미충족" 노드)
//   status: met(충족, 채움) | unmet(미충족, 빈 테두리) | no_data(데이터 없음, 점선)
export function buildDecisionGraph(decision) {
  const nodes = [], links = [];
  const matched = decision.chain.find(s => s.no === decision.matchedStep) ?? null;
  const others = decision.chain.filter(s => s !== matched);
  const facts = new Map();
  const fact = id => {
    const label = factOf(id);
    if (!facts.has(label)) {
      facts.set(label, `fact:${facts.size}`);
      nodes.push({ id: facts.get(label), col: 0, label, status: "fact" });
    }
    return facts.get(label);
  };
  const addCond = (c, stepNo) => {
    const id = `cond:${stepNo}:${c.id}`;
    nodes.push({ id, col: 1, label: c.label, value: c.valueText, status: c.status });
    links.push({ from: fact(c.id), to: id, status: c.status });
    return id;
  };
  const conclusion = { id: "conclusion", col: 3, label: decision.conclusionLabel, status: decision.conclusion, kind: "conclusion" };
  if (matched) {
    const typeId = `type:${matched.type}`;
    const condIds = matched.conditions.map(c => addCond(c, matched.no));
    nodes.push({ id: typeId, col: 2, label: matched.label, value: matched.answer === "예" ? "충족" : "", status: "met", kind: "type" });
    condIds.forEach((id, i) => links.push({ from: id, to: typeId, status: matched.conditions[i].status }));
    links.push({ from: typeId, to: conclusion.id, status: "met" });
  }
  if (others.length) {
    const otherId = "type:others";
    const condIds = others.map(s => {
      const miss = s.conditions.find(c => c.status !== "met") ?? s.conditions[0];
      return addCond(miss, s.no);
    });
    nodes.push({ id: otherId, col: 2, label: `${matched ? "다른 유형" : "확인한 유형"} ${others.length}개`, value: "미충족", status: "unmet", kind: "type" });
    condIds.forEach(id => links.push({ from: id, to: otherId, status: "unmet" }));
    if (!matched) links.push({ from: otherId, to: conclusion.id, status: "unmet" });
  }
  nodes.push(conclusion);
  // 열마다 위에서부터 줄 번호
  const rowOf = {};
  for (const n of nodes) { n.row = rowOf[n.col] ?? 0; rowOf[n.col] = n.row + 1; }
  return { nodes, links, rows: Math.max(...Object.values(rowOf)) };
}

// 사람 아이콘 줄: 참여자 중 원금 이상 돌려받은 사람 / 일부만 / 못 받은 사람 (decision.principal, 정의 A)
export function peopleRow(decision) {
  const p = decision.principal?.participants;
  if (!p || !p.count) return null;
  const wallets = decision.hint === "money_laundering";
  const label = wallets ? `모은 지갑을 뺀 ${p.count}개 지갑` : `참여자 ${p.count}명`;
  const [noun, unit] = wallets ? ["지갑", "개"] : ["사람", "명"];
  return {
    label,
    full: p.fullCount, partial: p.partialCount, none: p.noneCount,
    text: `${label} 중 원금 이상 돌려받은 ${noun} ${p.fullCount}${unit}` + (p.partialCount ? `, 일부만 받은 ${noun} ${p.partialCount}${unit}` : "")
  };
}
