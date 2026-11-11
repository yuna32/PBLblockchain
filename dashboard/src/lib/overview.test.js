import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HeadlineCard, RiskActionCard, SummaryBox } from "../components/OverviewParts.jsx";
import { codeConclusion, codeLines, flowLine, integrityStatus, startIntegrityCheck, typeTag, CONCLUSION_GUIDE } from "./overview.js";
import { loadFixture } from "./testFixtures.js";
import { buildViewModel } from "../../../demo/lib/viewmodel.js";
import { buildDecision } from "../../../demo/lib/decision.js";

const vm = name => buildViewModel(loadFixture(name));

// 스냅샷에 없는 결론은 합성 decision으로 (스냅샷은 바꾸지 않는다)
function cautionDecision() {
  const C = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
  const w = i => `0x${String(i).repeat(40)}`;
  const rows = [];
  for (let i = 1; i <= 5; i++) rows.push({ block: i, action: "deposit", from: w(i), to: C, amount_eth: 1, contract_balance_eth: i });
  for (let i = 1; i <= 3; i++) rows.push({ block: 10 + i, action: "withdraw", from: C, to: w(i), amount_eth: 0, contract_balance_eth: 5 });
  return buildDecision({ report: { dynamic: { triggered_rules: [] } }, rows });
}
const undeterminedDecision = () => buildDecision({ report: {}, rows: [] });

const CASES = {
  risk:         { decision: () => vm("rugpull").decision, badge: "위험", step: "ladder-danger" },
  caution:      { decision: cautionDecision, badge: "주의", step: "ladder-caution" },
  no_evidence:  { decision: () => vm("normal").decision, badge: "근거 없음", step: "ladder-safe" },
  undetermined: { decision: undeterminedDecision, badge: "판단 불가", step: null }
};

describe("개요: 결론 4가지 렌더링", () => {
  for (const [key, c] of Object.entries(CASES)) {
    it(`${key}: 판정 카드·위험 단계 카드`, () => {
      const d = c.decision();
      expect(d.conclusion).toBe(key);
      const head = renderToStaticMarkup(h(HeadlineCard, { decision: d }));
      expect(head).toContain(`data-conclusion="${key}"`);
      expect(head).toContain(`>${c.badge}<`);
      expect(head).toContain("휴리스틱 판정");
      expect(head).toContain(d.copy.headline);
      d.copy.reasons.forEach(r => expect(head).toContain(r));

      const card = renderToStaticMarkup(h(RiskActionCard, { conclusion: key }));
      expect(card).toContain("입금하기 전에 다시 확인하세요");
      expect(card).toContain(CONCLUSION_GUIDE[key]);
      const onSteps = card.match(/ladder-step on/g) ?? [];
      if (c.step) {
        expect(onSteps.length).toBe(1);
        expect(card).toContain(c.step);
      } else {
        expect(onSteps.length).toBe(0); // 판단 불가는 전부 회색
        expect(card).toContain("판단 불가");
      }
    });
  }

  it("안내 문구: 위험은 확정처럼 읽히지 않게, 근거 없음은 안전 보장 아님", () => {
    expect(CONCLUSION_GUIDE.risk).toBe("이 컨트랙트에서 사기 유형과 비슷한 거래 패턴이 보입니다. 아래 판단 근거와 거래 기록을 먼저 살펴보시길 권합니다.");
    expect(CONCLUSION_GUIDE.no_evidence).toContain("신호가 없다고 안전이 보장되는 것은 아닙니다");
    expect(Object.values(CONCLUSION_GUIDE).some(t => t.includes("확인됐습니다"))).toBe(false);
  });

  it("유형 표시: 사기는 '{유형} 의심', 판단 불가는 없음", () => {
    expect(typeTag(vm("rugpull").decision)).toBe("러그풀 의심");
    expect(typeTag(vm("normal").decision)).toBe("정상 스테이킹");
    expect(typeTag(cautionDecision())).toBe("출금 차단 경고");
    expect(typeTag(undeterminedDecision())).toBe(null);
  });
});

describe("개요: 요약·배지 규칙", () => {
  it("리포트 변조 확인 상태 (확인 중 / 같음 / 다름 / 오류)", () => {
    expect(integrityStatus({ status: "checking" })).toMatchObject({ text: "확인 중", tone: "neutral" });
    expect(integrityStatus({ status: "done", ok: true })).toMatchObject({ text: "분석 당시와 같음", tone: "safe" });
    expect(integrityStatus({ status: "done", ok: false })).toMatchObject({ text: "분석 당시와 다름", tone: "danger" });
    expect(integrityStatus({ status: "error", error: "x" })).toMatchObject({ text: "확인하지 못함", tone: "caution", detail: "x" });
    const html = renderToStaticMarkup(h(SummaryBox, { summary: vm("rugpull").decision.copy.summary, integrity: integrityStatus({ status: "done", ok: false }) }));
    expect(html).toContain("분석 당시와 다름");
    expect(html).toContain("text-danger");
    expect(html).toContain("10번째 입금 뒤 첫 출금 (블록 35)");
  });

  it("변조 확인 실행: 취소 뒤 끝난 이전 검사 결과는 반영되지 않는다 (시나리오 빠르게 바꾸기)", async () => {
    const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
    const states = [];
    const slow = deferred(), fast = deferred();
    // 첫 시나리오(느림) 시작 → 취소 → 둘째 시나리오(빠름) 시작
    const cancelA = startIntegrityCheck({ snapshot: { id: "A" }, loadCanonical: async () => null, verify: () => slow.p, onState: s => states.push(["A", s]) });
    cancelA();
    startIntegrityCheck({ snapshot: { id: "B" }, loadCanonical: async () => { throw new Error("canonical 없음"); }, verify: s => (s.id === "B" && s.canonical === null ? fast.p : null), onState: s => states.push(["B", s]) });
    fast.resolve({ ok: true });
    await new Promise(r => setTimeout(r, 0));
    slow.resolve({ ok: false });   // 취소된 A가 늦게 "다름"으로 끝나도
    await new Promise(r => setTimeout(r, 0));
    expect(states).toEqual([["A", { status: "checking" }], ["B", { status: "checking" }], ["B", { status: "done", ok: true }]]);
    // 오류도 취소 뒤에는 보내지 않는다
    const errStates = [];
    const failing = deferred();
    const cancelC = startIntegrityCheck({ snapshot: {}, loadCanonical: async () => null, verify: () => failing.p, onState: s => errStates.push(s) });
    cancelC();
    failing.reject(new Error("x"));
    await new Promise(r => setTimeout(r, 0));
    expect(errStates).toEqual([{ status: "checking" }]);
    // 취소하지 않은 오류는 error 상태
    const ok = [];
    startIntegrityCheck({ snapshot: {}, loadCanonical: async () => null, verify: async () => { throw new Error("해시 실패"); }, onState: s => ok.push(s) });
    await new Promise(r => setTimeout(r, 0));
    expect(ok.at(-1)).toEqual({ status: "error", error: "해시 실패" });
  });

  it("코드 배지 매핑: CRITICAL·HIGH 위험, MEDIUM 주의, LOW 근거 없음(코드 출금 차단 감지 시 주의), 그 밖 판단 불가", () => {
    const c = level => codeConclusion({ preventionRiskLevel: level });
    expect([c("CRITICAL"), c("HIGH"), c("MEDIUM"), c("LOW"), c("FILE_NOT_FOUND"), c(null)])
      .toEqual(["risk", "risk", "caution", "no_evidence", "undetermined", "undetermined"]);
    expect(codeConclusion({ preventionRiskLevel: "LOW" }, [{ source: "prevention.withdraw_block_warning", detected: true }])).toBe("caution");
    for (const n of ["ponzi", "rugpull", "laundering", "pumpdump"]) expect(codeConclusion(vm(n).codeAssessment, vm(n).warnings)).toBe("risk");
    expect(codeConclusion(vm("normal").codeAssessment, vm("normal").warnings)).toBe("no_evidence");
    expect(codeLines({ mainRules: [] }, "risk", "매우 높음").text).toBe("배포 전 코드 점검에서 위험 수준이 '매우 높음'으로 나왔습니다");
    expect(codeLines({ mainRules: [] }, "caution", "보통").text).toBe("배포 전 코드 점검에서 위험 수준이 '보통'으로 나왔습니다");
    expect(codeLines(vm("normal").codeAssessment, "no_evidence", "낮음").sub).toContain("참고 신호:");
  });

  it("돈의 흐름 한 줄: 가져간 쪽과 비율은 decision.flow에서", () => {
    expect(flowLine(vm("rugpull").decision)).toBe("들어온 돈의 100%가 운영자에게 갔습니다");
    expect(flowLine(vm("ponzi").decision)).toBe("들어온 돈의 67%가 운영자에게 갔습니다");
    expect(flowLine(vm("laundering").decision)).toBe("들어온 돈의 100%가 한 지갑(모은 지갑)으로 갔습니다");
    expect(flowLine(vm("pumpdump").decision)).toBe("들어온 돈의 100%가 내부자 3개 지갑으로 갔습니다");
    expect(flowLine(vm("normal").decision)).toBe(vm("normal").decision.copy.chartNotes[0]);
  });
});
