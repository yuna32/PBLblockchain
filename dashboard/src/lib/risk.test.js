import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeployerRiskView } from "../components/RiskParts.jsx";
import { INDICATORS, RISK_COPY, RISK_LEVELS, indicatorRatio, riskForScenario, scoreText } from "./risk.js";
import { codeConclusion, codeLines } from "./overview.js";
import { term } from "./terms.js";
import { CHECK_CARDS } from "./hero.js";
import { SCENARIO_IDS, loadFixture } from "./testFixtures.js";
import { GLOSSARY } from "../../../demo/lib/glossary.js";
import { buildViewModel } from "../../../demo/lib/viewmodel.js";

const CONTRACT = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const OWNER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

function scenario(name) {
  const fx = loadFixture(name);
  const view = buildViewModel(fx);
  const codeC = codeConclusion(view.codeAssessment, view.warnings);
  const code = { conclusion: codeC, ...codeLines(view.codeAssessment, codeC, term(GLOSSARY, view.codeAssessment.preventionRiskLevel).label) };
  return { view, rows: fx.rows, code, risk: riskForScenario(view, fx.rows) };
}

describe("배포자 위험도: 시나리오 기본값(데이터 없음)", () => {
  it("5개 시나리오 모두 데이터 없음, 대상은 시뮬레이션 배포 계정과 컨트랙트", () => {
    for (const n of SCENARIO_IDS) {
      const { risk } = scenario(n);
      expect(risk.level).toBe("nodata");
      expect([risk.score, risk.scoreMax]).toEqual([null, null]);
      expect(risk.target).toEqual({ deployer: OWNER, contract: CONTRACT, simulated: true });
      expect(risk.indicators.map(i => i.key)).toEqual(INDICATORS.map(i => i.key));
      expect(risk.indicators.every(i => i.status === "nodata" && i.points === null)).toBe(true);
      expect(risk.pastDeployments).toBe(null);
      expect(risk.scope.reason).toBe(RISK_COPY.simulationReason);
    }
  });

  it("점수가 없으면 '— · 높을수록 위험', 데이터 없음 지표는 막대 없음", () => {
    expect(scoreText({ score: null, scoreMax: null })).toBe("— · 높을수록 위험");
    expect(scoreText({ score: 0, scoreMax: 100 })).toBe("0 / 100 · 높을수록 위험");
    expect(indicatorRatio({ status: "nodata", points: null, cap: 30 })).toBe(null);
    expect(indicatorRatio({ status: "none", points: 0, cap: 30 })).toBe(0);
    expect(indicatorRatio({ status: "evidence", points: 45, cap: 30 })).toBe(1);
  });

  it("데이터 없음 화면: 영역 전부, 배지·문구, '위험' 배지 없음", () => {
    for (const n of SCENARIO_IDS) {
      const { risk, code } = scenario(n);
      const html = renderToStaticMarkup(h(DeployerRiskView, { risk, code }));
      expect(html).toContain('data-level="nodata"');
      expect(html).toContain(`badge-neutral">${RISK_LEVELS.nodata.label}`);
      expect(html).toContain(RISK_LEVELS.nodata.summary);
      expect(html).toContain(RISK_COPY.simulatedDeployer);
      expect(html).toContain(OWNER);
      expect(html).toContain(CONTRACT);
      expect(html).toContain('aria-label="— · 높을수록 위험"');
      expect((html.match(/data-status="nodata"/g) ?? []).length).toBe(5);
      expect(html).not.toContain("risk-cap");
      expect(html).toContain(RISK_COPY.noFunding);
      expect(html).toContain(RISK_COPY.noPast);
      expect(html).toContain(RISK_COPY.simulationReason);
      expect(html).toContain(RISK_COPY.simulationAssumption);
      expect(html).toContain(RISK_COPY.combinationTitle);
      expect(html).toContain(RISK_COPY.distinction);
      expect(html).toContain(RISK_COPY.disclaimer);
      expect(html).toContain(code.text.replaceAll("'", "&#x27;"));
      // 배포자 쪽 배지에는 "위험"을 쓰지 않는다(코드 배지는 결론 배지 그대로)
      const deployerSide = html.slice(html.indexOf('data-side="deployer"'));
      expect(deployerSide).not.toMatch(/badge-[a-z]+">위험</);
      // 옛 신뢰 점수·등급은 이 화면에 없다
      expect(html).not.toMatch(/신뢰 점수|평균 등급|지갑 신뢰/);
    }
  });

  it("이름: 히어로 카드 '배포자'", () => {
    expect(CHECK_CARDS.find(c => c.key === "creator").title).toBe("배포자");
  });
});
