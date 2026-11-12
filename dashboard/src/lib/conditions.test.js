import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChainCard, DecisionGraph, IntegrityBand, WhyNotCard } from "../components/ConditionsParts.jsx";
import { buildDecisionGraph, conditionsTitle, peopleRow, withRo } from "./conditions.js";
import { rawRows } from "./rawRows.js";
import { integrityStatus } from "./overview.js";
import { SCENARIO_IDS, loadFixture } from "./testFixtures.js";
import { buildViewModel } from "../../../demo/lib/viewmodel.js";
import { buildDecision, TYPE_LABELS, withRo as demoWithRo } from "../../../demo/lib/decision.js";

const vm = name => buildViewModel(loadFixture(name));
function cautionDecision() {
  const C = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
  const w = i => `0x${String(i).repeat(40)}`;
  const rows = [];
  for (let i = 1; i <= 5; i++) rows.push({ block: i, action: "deposit", from: w(i), to: C, amount_eth: 1, contract_balance_eth: i });
  for (let i = 1; i <= 3; i++) rows.push({ block: 10 + i, action: "withdraw", from: C, to: w(i), amount_eth: 0, contract_balance_eth: 5 });
  return buildDecision({ report: { dynamic: { triggered_rules: [] } }, rows });
}
const undetermined = () => buildDecision({ report: {}, rows: [] });

describe("판정 조건: 제목·질문 사슬", () => {
  it("조사 함수는 demo/lib/decision.js와 같은 규칙", () => {
    for (const label of Object.values(TYPE_LABELS)) expect(withRo(label)).toBe(demoWithRo(label));
  });

  it("5개 시나리오: 제목, 사슬 길이, 결론 띠", () => {
    const expected = {
      normal: ["정상 스테이킹으로 판정된 이유", 6], ponzi: ["폰지로 판정된 이유", 4], rugpull: ["러그풀로 판정된 이유", 3],
      laundering: ["자금세탁으로 판정된 이유", 2], pumpdump: ["펌프앤덤프로 판정된 이유", 1]
    };
    for (const n of SCENARIO_IDS) {
      const d = vm(n).decision;
      expect([conditionsTitle(d), d.chain.length]).toEqual(expected[n]);
      const html = renderToStaticMarkup(h(ChainCard, { decision: d }));
      expect(html.match(/class="chain-step /g)?.length ?? html.match(/class="chain-step"/g)?.length ?? 0).toBeGreaterThan(0);
      expect((html.match(/data-step="/g) ?? []).length).toBe(d.chain.length);
      expect(html).toContain(d.chainSummary);
      d.chain.forEach(s => s.conditions.forEach(c => expect(html).toContain(c.valueText)));
      const why = renderToStaticMarkup(h(WhyNotCard, { decision: d }));
      d.whyNot.forEach(w => expect(why).toContain(w.reason));
      expect(why).toContain("기준값은 연구 단계의 잠정값입니다");
    }
  });

  it("주의·판단 불가(합성 decision)도 렌더링된다", () => {
    const c = cautionDecision();
    expect(conditionsTitle(c)).toBe("출금 차단 경고로 판정된 이유");
    const ch = renderToStaticMarkup(h(ChainCard, { decision: c }));
    expect(ch).toContain('data-conclusion="caution"');
    expect(ch).toContain("chain-band-caution");
    expect((ch.match(/data-step="/g) ?? []).length).toBe(5);
    const u = undetermined();
    expect(conditionsTitle(u)).toBe("결론을 내리지 못한 이유");
    const uh = renderToStaticMarkup(h(ChainCard, { decision: u }));
    expect(uh).toContain(u.chainSummary);
    expect((uh.match(/data-step="/g) ?? []).length).toBe(6);
    expect(renderToStaticMarkup(h(DecisionGraph, { decision: u }))).toContain("확인한 유형 6개");
  });

  it("임계값 막대는 결과 JSON의 기준과 같은 위치 (러그풀 ②는 rugpull.thresholds.netDrain)", () => {
    const d = vm("rugpull").decision;
    const bar = d.chain[2].conditions.find(c => c.id === "net_drain").bar;
    expect(bar.threshold).toBe(d.rugpull.thresholds.netDrain);
    expect(bar.threshold).toBe(loadFixture("rugpull").report.dynamic.rugpull_axiom.thresholds.netDrain);
    const html = renderToStaticMarkup(h(ChainCard, { decision: d }));
    expect(html).toContain(`left:${d.rugpull.thresholds.netDrain * 100}%`);
    // 자금세탁 단계의 단일 대형 유출 막대는 그대로 decision.thresholds
    const l = vm("laundering").decision;
    expect(l.chain[1].conditions[0].bar.threshold).toBe(l.thresholds.singleLargeOutflowRatio);
  });

  it("러그풀 범위 밖 조건은 '판단 불가' 중립 표시 (데이터 없음·미충족과 구분)", () => {
    const d = vm("rugpull").decision;
    const out = { ...d, chain: d.chain.map(s => s.type !== "rug_pull" ? s : { ...s, matched: false, answer: "아니요",
      conditions: s.conditions.map(c => ({ ...c, status: "out_of_scope", met: false })) }) };
    const html = renderToStaticMarkup(h(ChainCard, { decision: out }));
    expect(html).toContain("cond-out_of_scope");
    expect(html).toContain("판단 불가");
  });

  it("사람 아이콘 줄: 참여자 수와 원금 이상 회수 수 (자금세탁은 모은 지갑 제외)", () => {
    expect(peopleRow(vm("rugpull").decision).text).toBe("참여자 10명 중 원금 이상 돌려받은 사람 0명");
    expect(peopleRow(vm("ponzi").decision).text).toBe("참여자 10명 중 원금 이상 돌려받은 사람 3명");
    expect(peopleRow(vm("laundering").decision).text).toBe("모은 지갑을 뺀 18개 지갑 중 원금 이상 돌려받은 지갑 0개");
    expect(peopleRow(undetermined())).toBe(null);
  });
});

describe("판정 조건: 축약 그래프는 decision.chain과 일치", () => {
  it("매칭된 단계의 조건 전부 + 다른 유형은 한 노드로", () => {
    for (const n of SCENARIO_IDS) {
      const d = vm(n).decision;
      const g = buildDecisionGraph(d);
      const matched = d.chain.find(s => s.no === d.matchedStep);
      const conds = g.nodes.filter(x => x.col === 1 && x.id.startsWith(`cond:${matched.no}:`));
      expect(conds.map(x => x.label)).toEqual(matched.conditions.map(c => c.label));
      expect(conds.every(x => x.status === "met")).toBe(true);
      const others = g.nodes.find(x => x.id === "type:others");
      const no = d.chain.filter(s => !s.matched).length;
      if (no) expect(others.label).toBe(`다른 유형 ${no}개`); else expect(others).toBeUndefined();
      expect(g.nodes.find(x => x.kind === "conclusion").label).toBe(d.conclusionLabel);
      for (const l of g.links) expect(g.nodes.some(x => x.id === l.from) && g.nodes.some(x => x.id === l.to)).toBe(true);
    }
    const rug = buildDecisionGraph(vm("rugpull").decision);
    expect(rug.nodes.filter(x => x.col === 1 && x.status !== "met").map(x => x.status)).toEqual(["unmet", "unmet"]);
  });
});

describe("변조 확인 띠·원자료", () => {
  it("변조 확인 띠 4가지 상태", () => {
    const t = s => renderToStaticMarkup(h(IntegrityBand, { integrity: integrityStatus(s) }));
    expect(t({ status: "checking" })).toContain("확인하는 중");
    expect(t({ status: "done", ok: true })).toContain("이 리포트는 분석 당시와 같습니다");
    expect(t({ status: "done", ok: false })).toContain("이 리포트가 분석 당시와 다릅니다");
    expect(t({ status: "error", error: "x" })).toContain("확인하지 못했습니다");
  });

  it("거래 로그 행: 핵심 출금 강조와 실패 출금", () => {
    const rug = rawRows(loadFixture("rugpull").rows, vm("rugpull").decision);
    expect(rug.length).toBe(11);
    expect(rug.filter(r => r.key).map(r => [r.block, r.action])).toEqual([[35, "owner_withdraw_all"]]);
    const pump = rawRows(loadFixture("pumpdump").rows, vm("pumpdump").decision);
    expect(pump.filter(r => r.failed).length).toBe(5);
    expect(pump.some(r => r.key && r.block === vm("pumpdump").decision.decisive.block)).toBe(true);
    expect(rawRows(loadFixture("normal").rows, vm("normal").decision).some(r => r.key)).toBe(true); // 최대 단일 출금 행
  });
});
