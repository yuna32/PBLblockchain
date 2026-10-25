import { describe, it, expect } from "vitest";
import { sortWallets, lowestWallet, radarData, walletRole, TRUST_AXES } from "./wallets.js";
import { nodeState, stateGroup, highlightSets, playbackSteps, visibleAtStep, edgeKey, countGraph } from "./ontology.js";
import { flowSteps, stageSteps } from "./flow.js";
import { QUADRANT_LABELS, matrixCells } from "./combination.js";
import { term, pagePath } from "./terms.js";
import { shortAddr, shortHash, fmtEth } from "./format.js";
import { COMBINATION_RULES } from "../../../demo/lib/combination.js";
import { buildOntologyGraph } from "../../../demo/lib/ontologygraph.js";
import { GLOSSARY } from "../../../demo/lib/glossary.js";
import { buildViewModel } from "../../../demo/lib/viewmodel.js";
import { SCENARIO_IDS, loadFixture } from "./testFixtures.js";

describe("지갑 정렬", () => {
  it("pumpdump: 최저 지갑 B(58), 평균 A와 다름", () => {
    const { report } = loadFixture("pumpdump");
    const sorted = sortWallets(report.trust.wallet_scores);
    expect(sorted[0].trust_score).toBe(58);
    expect(sorted.map(w => w.trust_score)).toEqual([...sorted.map(w => w.trust_score)].sort((a, b) => a - b));
    expect(lowestWallet(report.trust.wallet_scores).grade).toBe("B");
    expect(report.trust.trust_grade).toBe("A");
    expect(sortWallets(report.trust.wallet_scores, "desc")[0].trust_score).toBe(98);
  });

  it("레이더 5축과 역할", () => {
    const { report } = loadFixture("ponzi");
    const w = lowestWallet(report.trust.wallet_scores);
    expect(radarData(w).map(d => d.axis)).toEqual(TRUST_AXES);
    expect(walletRole(w)).toBe("drainer");
    expect(TRUST_AXES.every(a => GLOSSARY[a])).toBe(true);
    expect(radarData(null)).toEqual([]);
  });
});

describe("온톨로지 표시", () => {
  it("nodeState: 조건·근거·기법은 status, 나머지는 active", () => {
    expect(nodeState({ status: "met", active: true })).toBe("met");
    expect(nodeState({ status: "unmet", active: false })).toBe("unmet");
    expect(nodeState({ status: "no_data", active: false })).toBe("no_data");
    expect(nodeState({ active: true })).toBe("active");
    expect(nodeState({ active: false })).toBe("inactive");
    expect(stateGroup({ status: "met" })).toBe("on");
    expect(stateGroup({ active: true })).toBe("on");
  });

  for (const name of SCENARIO_IDS) {
    it(`${name}: 강조 집합과 재생 순서`, () => {
      const g = buildOntologyGraph(loadFixture(name).report);
      const sets = highlightSets(g.highlight);
      const steps = playbackSteps(g.highlight);
      const nPath = g.highlight.path.length, nEv = g.highlight.evasionPath.length;
      expect(steps.length).toBe(2 * nPath + 2 * nEv);
      expect(steps.slice(0, 2 * nPath).every(s => s.kind === "primary")).toBe(true);
      expect(steps.slice(2 * nPath).every(s => s.kind === "secondary")).toBe(true);
      // 강조 링크는 실제 그래프 링크와 대응해야 한다 (방향 무관)
      const graphEdges = new Set(g.links.map(l => edgeKey(l.source, l.target)));
      for (const k of [...sets.primary, ...sets.secondary]) expect(graphEdges.has(k)).toBe(true);
      expect(visibleAtStep(steps, steps.length).primary).toEqual(sets.primary);
      expect(visibleAtStep(steps, 0).primary.size).toBe(0);
      const c = countGraph(g);
      expect(c.nodes).toBe(g.nodes.length);
      if (name === "normal") expect(sets.primary.size).toBe(0);
    });
  }

  it("상태 세 가지가 실제 그래프에 모두 나온다 (normal: 충족·미충족·근거 없음)", () => {
    const g = buildOntologyGraph(loadFixture("normal").report);
    const states = new Set(g.nodes.map(nodeState));
    expect(states.has("met")).toBe(true);
    expect(states.has("unmet")).toBe(true);
    expect(states.has("no_data")).toBe(true);
  });
});

describe("진행 표시", () => {
  it("flowSteps: 온체인 기록은 리포트의 기록 상태를 따르고, 시각화는 기존 동작 그대로", () => {
    expect(flowSteps({ scenario: null, job: null, hasReport: false }).map(s => s.state)).toEqual(["current", "pending", "pending", "pending"]);
    expect(flowSteps({ scenario: "ponzi", job: { status: "running" }, hasReport: true, onchain: "prerecorded" }).map(s => s.state)).toEqual(["done", "running", "pending", "pending"]);
    expect(flowSteps({ scenario: "ponzi", job: { status: "done" }, hasReport: true }).map(s => s.state)).toEqual(["done", "done", "pending", "done"]);
    expect(flowSteps({ scenario: "ponzi", job: { status: "error" }, hasReport: false })[1].state).toBe("error");
    const chain = phase => flowSteps({ scenario: "ponzi", job: { status: "done" }, hasReport: true, onchain: phase });
    expect([chain("none")[2].state, chain("none")[2].sub]).toEqual(["pending", "기록 전"]);
    expect([chain("running")[2].state, chain("running")[2].sub]).toEqual(["running", "기록 중"]);
    expect([chain("recorded")[2].state, chain("recorded")[2].sub]).toEqual(["done", "완료"]);
    expect([chain("prerecorded")[2].state, chain("prerecorded")[2].sub]).toEqual(["done", "완료 (사전 기록)"]);
    expect([chain("error")[2].state, chain("unavailable")[2].state]).toEqual(["error", "disabled"]);
    for (const p of ["none", "running", "recorded", "prerecorded", "error", "unavailable"]) expect(chain(p)[3].state).toBe("done");
  });

  it("stageSteps: auto와 fixture", () => {
    expect(stageSteps({ mode: "auto", status: "running", stage: "simulate", stages: ["simulate"] }).map(s => s.state)).toEqual(["running", "pending", "pending"]);
    expect(stageSteps({ mode: "auto", status: "done", stage: null, stages: ["simulate", "analyze", "hash"] }).map(s => s.state)).toEqual(["done", "done", "done"]);
    expect(stageSteps({ mode: "fixture", status: "done", stage: null, stages: ["analyze", "hash"] }).map(s => s.state)).toEqual(["skipped", "done", "done"]);
    expect(stageSteps(null).every(s => s.state === "pending")).toBe(true);
  });
});

describe("조합 판정 배치", () => {
  it("칸 이름이 demo/lib/combination.js와 같음", () => {
    expect(QUADRANT_LABELS).toEqual(COMBINATION_RULES.labels);
  });

  it("fixture: normal은 낮음/낮음, 나머지는 높음/높음 칸이 활성", () => {
    for (const name of SCENARIO_IDS) {
      const cells = matrixCells(buildViewModel(loadFixture(name)).combination).flat();
      expect(cells.filter(c => c.active).map(c => c.key)).toEqual([name === "normal" ? "low-low" : "high-high"]);
    }
    expect(matrixCells(null).flat().some(c => c.active)).toBe(false);
  });
});

describe("용어·포맷", () => {
  it("term: 한글 라벨 우선, 없으면 id", () => {
    expect(term(GLOSSARY, "BALANCE_DROP").label).toBe("잔고 급락");
    expect(term(GLOSSARY, "NOPE")).toEqual({ id: "NOPE", label: "NOPE", desc: "", known: false });
    expect(pagePath("trust")).toBe("/trust");
    expect(pagePath("x")).toBe("/overview");
  });

  it("포맷", () => {
    expect(shortAddr("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266")).toBe("0xf39f…2266");
    expect(shortHash("abcdef0123456789")).toBe("abcdef01");
    expect(fmtEth(6.5)).toBe("6.5 ETH");
    expect(fmtEth(null)).toBe("-");
  });
});
