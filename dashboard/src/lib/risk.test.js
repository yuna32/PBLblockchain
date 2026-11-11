import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeployerRiskView } from "../components/RiskParts.jsx";
import fs from "node:fs";
import path from "node:path";
import {
  INDICATORS, PREVIEW_BANNER, RISK_COPY, RISK_ERROR_COPY, RISK_LEVELS, RISK_LOADING, RISK_LOADING_COPY,
  indicatorRatio, levelBasis, normalizeRisk, partialScore, riskForScenario, scoreText
} from "./risk.js";
import { PREVIEW_KEYS, RISK_FIXTURES, previewRisk } from "./riskFixtures.js";
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

// ── S8b: 정규화·미리보기·상태별 렌더 ──
const ind = (r, key) => r.indicators.find(i => i.key === key);
const render = (risk, opts = {}) => renderToStaticMarkup(h(DeployerRiskView, { risk, code: null, preview: true, ...opts }));

describe("normalizeRisk", () => {
  it("데이터 자체가 없으면 missing, 객체가 아니거나 level이 없거나 모르는 값이면 format", () => {
    for (const v of [null, undefined, ""]) expect(normalizeRisk(v).error.kind).toBe("missing");
    for (const v of ["x", 3, [], [{ level: "strong" }]]) expect(normalizeRisk(v).error.kind).toBe("format");
    expect(normalizeRisk({ score: 10, indicators: [] }).error).toEqual({ kind: "format", detail: "필수 필드 없음: level" });
    expect(normalizeRisk({ level: null, indicators: [] }).error.kind).toBe("format");
    expect(normalizeRisk({ level: "very_bad", indicators: [] }).error.detail).toBe("알 수 없는 수준 값: very_bad");
    expect(normalizeRisk({ level: "strong" }).error).toEqual({ kind: "format", detail: "필수 필드 없음: indicators" });
    expect(normalizeRisk({ level: "some", indicators: "x" }).error.kind).toBe("format");
    const e = normalizeRisk(null);
    expect([e.status, e.level, e.indicators.length]).toEqual(["error", null, 5]);
  });

  it("수준 별칭(영문·대문자·한글)을 받는다", () => {
    expect(normalizeRisk({ level: "STRONG", indicators: [] }).level).toBe("strong");
    expect(normalizeRisk({ risk_level: "근거 있음", indicators: [] }).level).toBe("some");
    expect(normalizeRisk({ level: "no_evidence", indicators: [] }).level).toBe("none");
    expect(normalizeRisk({ level: "데이터 없음" }).level).toBe("nodata"); // nodata는 지표가 없어도 된다
  });

  it("null과 0을 구분한다: 0은 근거 없음(0점), null·누락은 데이터 없음", () => {
    const r = normalizeRisk({ level: "none", indicators: [{ key: "first_funding", points: 0, cap: 30 }, { key: "wallet_maturity", points: null, cap: 20 }] });
    expect([ind(r, "first_funding").status, ind(r, "first_funding").points]).toEqual(["none", 0]);
    expect([ind(r, "wallet_maturity").status, ind(r, "wallet_maturity").points]).toEqual(["nodata", null]);
    expect(ind(r, "external_flags").status).toBe("nodata"); // 누락된 지표도 5개를 채운다
    expect(r.indicators.length).toBe(5);
    expect(normalizeRisk({ level: "none", score: 0, indicators: [] }).score).toBe(0);
    expect(normalizeRisk({ level: "nodata", score: null }).score).toBe(null);
    expect(normalizeRisk({ level: "some", indicators: [] }).pastDeployments).toBe(null);
    expect(normalizeRisk({ level: "some", indicators: [], past_deployments: [] }).pastDeployments).toEqual([]);
  });

  it("수준은 원본 level을 쓰고 점수로 바꾸지 않는다", () => {
    expect(normalizeRisk({ level: "none", score: 95, score_max: 100, indicators: [] }).level).toBe("none");
    expect(normalizeRisk({ level: "strong", score: 5, score_max: 100, indicators: [] }).level).toBe("strong");
    const strong = previewRisk("strong"), some = previewRisk("some");
    expect(strong.score).toBeLessThan(some.score); // 예시: 강한 근거가 근거 있음보다 점수가 낮다
    expect([strong.level, some.level]).toEqual(["strong", "some"]);
    expect(levelBasis(strong).strength).toBe("strong");
  });

  it("숫자가 아닌 값은 null로 바꾸고 수집 실패에 남긴다, 모르는 필드와 모르는 지표 근거는 버린다", () => {
    const r = normalizeRisk({
      level: "some", score: "40", extra: 1,
      indicators: { first_funding: { points: "x", cap: 30 }, wallet_maturity: 5 },
      evidence: [{ indicator: "nope", text: "a" }, { indicator_key: "wallet_maturity", strength: "약한", text: "b", points: 5 }],
      first_funding: { hops: 3, category: "CEX" }, scope: { activity_days: "10", failures: ["x 실패"] }
    });
    expect(r.score).toBe(null);
    expect(ind(r, "first_funding").status).toBe("nodata");
    expect([ind(r, "wallet_maturity").status, ind(r, "wallet_maturity").points]).toEqual(["evidence", 5]);
    expect(r.evidence).toEqual([{ indicatorKey: "wallet_maturity", strength: "weak", text: "b", source: null, points: 5 }]);
    expect(r.firstFunding).toEqual({ hops: null, category: "exchange" });
    expect(r.scope.failures).toEqual(["x 실패", "첫 자금원(형식 오류)", "점수(형식 오류)", "활동 일수(형식 오류)"]);
    expect(r).not.toHaveProperty("extra");
  });

  it("partial: 일부 지표만 null이면 부분 합계", () => {
    const p = previewRisk("partial");
    expect(p.indicators.filter(i => i.status === "nodata").map(i => i.key)).toEqual(["external_flags", "past_rug_recovery"]);
    expect(partialScore(p)).toEqual({ missing: 2, note: "데이터 없음 지표 2개는 합계에 들어가지 않았습니다" });
    expect(partialScore(previewRisk("strong"))).toBe(null);
    expect(partialScore(previewRisk("nodata"))).toBe(null); // 점수가 없으면 부분 합계도 아님
  });
});

describe("배포자 위험도: 상태별 렌더", () => {
  const LEVEL_OF = { strong: "strong", some: "some", none: "none", nodata: "nodata", partial: "some" };

  it("미리보기 5종: 배너, 수준 배지, 지표 상태, 영역", () => {
    for (const k of Object.keys(RISK_FIXTURES)) {
      const r = previewRisk(k);
      const html = render(r);
      expect(html).toContain(PREVIEW_BANNER);
      expect(html).toContain(`data-level="${LEVEL_OF[k]}"`);
      expect(html).toContain(`badge-${RISK_LEVELS[LEVEL_OF[k]].tone}">${RISK_LEVELS[LEVEL_OF[k]].label}`);
      for (const i of r.indicators) expect(html).toContain(`data-indicator="${i.key}" data-status="${i.status}"`);
      for (const e of r.evidence) expect(html).toContain(e.text);
      expect(html).toContain(RISK_COPY.disclaimer);
      expect(html).toContain(RISK_COPY.combinationTitle);
      expect(html).toContain("미리보기에서는 코드 점검 결과를 함께 보여 주지 않습니다");
      // 배포자 판정 카드·배포자 쪽 칸에는 "위험" 배지가 없다(과거 배포 표의 "우리 판정"은 그 컨트랙트의 거래 판정이라 별도)
      const verdict = html.slice(html.indexOf("risk-verdict"), html.indexOf("risk-scope"));
      const side = html.slice(html.indexOf('data-side="deployer"'), html.indexOf("risk-combo"));
      for (const part of [verdict, side]) expect(part).not.toMatch(/badge-[a-z]+"[^>]*>위험</);
    }
  });

  it("상태별 차이: 점수·막대·부분 합계·과거 배포·첫 자금", () => {
    const strong = render(previewRisk("strong"));
    expect(strong).toContain('aria-label="35 / 100 · 높을수록 위험"');
    expect(strong).toContain("수준을 정한 근거");
    expect(strong).toContain("risk-cap-caution");
    expect(strong).toContain('data-category="mixer"');
    expect(strong).toContain("공개 라벨");
    expect(strong).toContain("<th>이 컨트랙트의 거래 판정</th>");
    expect(strong).not.toContain("우리 판정");
    expect(strong).toContain("미분석");
    expect(strong).not.toContain("부분 합계");
    const none = render(previewRisk("none"));
    expect(none).toContain('aria-label="0 / 100 · 높을수록 위험"');
    expect(none).toContain(RISK_COPY.zeroPast);
    expect(none).not.toContain("수준을 정한 근거");
    expect((none.match(/data-status="none"/g) ?? []).length).toBe(5);
    const nodata = render(previewRisk("nodata"));
    expect(nodata).toContain('aria-label="— · 높을수록 위험"');
    expect(nodata).toContain(RISK_COPY.noPast);
    expect(nodata).toContain(RISK_COPY.noFunding);
    expect(nodata).toContain("배포자 거래 기록을 가져오지 못해 평가하지 않았습니다(예시)");
    const partial = render(previewRisk("partial"));
    expect(partial).toContain("부분 합계");
    expect(partial).toContain("데이터 없음 지표 2개는 합계에 들어가지 않았습니다");
    expect(partial).toContain("외부 위험 플래그 수집 실패(예시)");
  });

  it("로딩·오류(missing·format): 상태 안내만, 근거 목록 등은 숨김", () => {
    const loading = render(RISK_LOADING);
    expect(loading).toContain('data-state="loading"');
    expect(loading).toContain(RISK_LOADING_COPY);
    expect(loading).toContain("불러오는 중</span>");
    for (const [key, kind] of [["error-missing", "missing"], ["error-format", "format"]]) {
      const html = render(previewRisk(key));
      expect(html).toContain(`data-state="error-${kind}"`);
      expect(html).toContain(RISK_ERROR_COPY[kind]);
      expect(html).toContain(RISK_COPY.disclaimer);
      expect(html).not.toContain("risk-inds");
      expect(html).not.toContain("첫 자금 흐름");
    }
    expect(render(previewRisk("error-format"))).toContain("사유: 알 수 없는 수준 값");
    // 실제 화면(미리보기 아님)에는 배너가 없다
    const { risk, code } = scenario("rugpull");
    expect(renderToStaticMarkup(h(DeployerRiskView, { risk, code }))).not.toContain(PREVIEW_BANNER);
  });

  it("미리보기 예시는 가짜 주소·예시 표기만 쓰고, 어떤 화면에서도 미리보기로 연결하지 않는다", () => {
    const text = JSON.stringify(RISK_FIXTURES);
    expect(text).not.toMatch(/0x[0-9a-fA-F]{40}(?![0-9a-zA-Z])/); // 실제 주소 형식 없음
    expect(text.match(/0x[0-9A-Za-z]{40}/g).every(a => a.startsWith("0xEXAMPLE"))).toBe(true);
    for (const e of Object.values(RISK_FIXTURES).flatMap(f => f.evidence)) expect(e.text).toContain("(예시)");
    expect(PREVIEW_KEYS.slice(0, 5)).toEqual(["strong", "some", "none", "nodata", "partial"]);
    const src = path.resolve(__dirname, "..");
    const files = [];
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(f => (f.isDirectory() ? walk(path.join(d, f.name)) : files.push(path.join(d, f.name))));
    walk(src);
    const linking = files.filter(f => /\.(jsx?|css)$/.test(f) && !/risk(Fixtures)?(\.test)?\.js$/.test(f) && /preview=/.test(fs.readFileSync(f, "utf8")));
    expect(linking.map(f => path.basename(f))).toEqual(["Deployer.jsx"]); // 주석의 경로 설명뿐
    expect(fs.readFileSync(path.join(src, "pages/Deployer.jsx"), "utf8")).not.toMatch(/to=\{?["`'][^"`']*preview=/);
    // 미리보기 키 8개(로딩·오류 3개 포함) 모두: 정의·처리 파일 밖에서는 키 이름이나 "preview" 쿼리를 만들지 않는다
    expect(PREVIEW_KEYS).toEqual(["strong", "some", "none", "nodata", "partial", "loading", "error-missing", "error-format"]);
    const allowed = /(risk|riskFixtures|risk\.test)\.js$|Deployer\.jsx$/;
    for (const f of files.filter(f => /\.(jsx?|css)$/.test(f) && !allowed.test(f))) {
      const s = fs.readFileSync(f, "utf8");
      expect([path.basename(f), /error-missing|error-format|[?&]preview|preview:\s*["'`]|set\(\s*["'`]preview/.test(s)]).toEqual([path.basename(f), false]);
    }
  });
});
