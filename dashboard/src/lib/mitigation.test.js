// 완화 레이어 "확인해 볼 것" 시험: 시나리오 5개 기대 항목·상태, 문구 규칙, 카드 렌더링.
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RiskActionCard } from "../components/OverviewParts.jsx";
import { checkItems, CHECK_DISCLAIMER, CHECK_STATUS, ITEMS_BY_CONCLUSION, NONE_NOTE } from "./mitigation.js";
import { riskForScenario } from "./risk.js";
import { loadFixture, SCENARIO_IDS } from "./testFixtures.js";
import { buildViewModel } from "../../../demo/lib/viewmodel.js";
import { buildDecision } from "../../../demo/lib/decision.js";
import { GLOSSARY } from "../../../demo/lib/glossary.js";

function itemsOf(name) {
  const fx = loadFixture(name);
  const view = buildViewModel(fx);
  return { view, items: checkItems({ view, risk: riskForScenario(view, fx.rows), glossary: GLOSSARY }) };
}
const statuses = items => Object.fromEntries(items.map(i => [i.key, i.status]));

// 시나리오별 기대 상태 (flow, code, withdrawBlock, deployer)
const EXPECTED = {
  normal:     { flow: "none",     code: "none",     withdrawBlock: "none", deployer: "nodata" },
  ponzi:      { flow: "detected", code: "detected", withdrawBlock: "none", deployer: "nodata" },
  rugpull:    { flow: "detected", code: "detected", withdrawBlock: "none", deployer: "nodata" },
  laundering: { flow: "detected", code: "detected", withdrawBlock: "none", deployer: "nodata" },
  pumpdump:   { flow: "detected", code: "detected", withdrawBlock: "none", deployer: "nodata" }
};

// 금지 표현: 단정·지시·투자 권유, 합친 등급
const BANNED = [/안전합니다/, /안전해/, /입금하지/, /입금하세요/, /투자하세요/, /투자하지/, /사세요/, /파세요/, /종합/, /등급/];

describe("확인해 볼 것: 시나리오 5개", () => {
  for (const name of SCENARIO_IDS) {
    it(`${name}: 결론별 항목·상태·링크`, () => {
      const { view, items } = itemsOf(name);
      expect(items.map(i => i.key)).toEqual(ITEMS_BY_CONCLUSION[view.decision.conclusion]);
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items.length).toBeLessThanOrEqual(4);
      expect(statuses(items)).toEqual(EXPECTED[name]);
      for (const i of items) {
        expect(i.statusLabel).toBe(CHECK_STATUS[i.status].label);
        expect(i.tone).not.toBe("safe"); // "이상 없음"에 안전색을 쓰지 않는다
        expect(i.value).toBeTruthy();
        expect(["/trade", "/detail/raw", "/trust"]).toContain(i.link.path);
        for (const re of BANNED) expect(`${i.question} ${i.value} ${i.sub ?? ""}`).not.toMatch(re);
      }
      // 데이터 없음은 배포자 한 항목뿐
      expect(items.filter(i => i.status === "nodata").map(i => i.key)).toEqual(["deployer"]);
    });
  }

  it("돈의 흐름·코드 문구는 기존 개요 규칙과 같은 값", () => {
    const by = n => Object.fromEntries(itemsOf(n).items.map(i => [i.key, i]));
    expect(by("ponzi").flow.value).toBe("들어온 돈의 67%가 운영자에게 갔습니다");
    expect(by("laundering").flow.value).toBe("들어온 돈의 100%가 한 지갑(모은 지갑)으로 갔습니다");
    expect(by("pumpdump").flow.value).toBe("들어온 돈의 100%가 내부자 3개 지갑으로 갔습니다");
    expect(by("normal").flow.value).toBe(itemsOf("normal").view.decision.copy.chartNotes[0]);
    expect(by("normal").code.value).toBe("배포 전 코드 점검 위험 수준: 낮음");
    expect(by("ponzi").code.value).toBe("배포 전 코드 점검 위험 수준: 매우 높음");
    expect(by("ponzi").code.link.label).toBe("컨트랙트 소스");
  });

  it("출금 차단 경고: 이상 없음은 '이번 분석에서는 없었다'는 뜻, 출금 시도 없음·잔고 바닥 뒤 실패는 이유를 적는다", () => {
    const wb = n => itemsOf(n).items.find(i => i.key === "withdrawBlock");
    expect(wb("normal")).toMatchObject({ status: "none", tag: "출금 차단 경고", value: "거래와 코드 모두 이 경고가 나오지 않았습니다", sub: NONE_NOTE });
    expect(wb("rugpull")).toMatchObject({ status: "none", value: "거래: 참여자 출금 시도가 없어 확인하지 못함 · 코드: 출금 차단 항목 없음" });
    expect(wb("pumpdump").sub).toBe("실패한 참여자 출금 5건은 잔고가 바닥난 뒤라 이 경고에 해당하지 않습니다. 이 실패는 위 결론의 근거로 쓰였습니다.");
    expect(wb("pumpdump").link).toMatchObject({ path: "/detail/raw", label: "감지된 패턴과 경고" });
  });

  it("배포자: 시뮬레이션이라 데이터 없음(지금 화면 문구 그대로)", () => {
    const d = itemsOf("ponzi").items.find(i => i.key === "deployer");
    expect(d).toMatchObject({ status: "nodata", value: "시뮬레이션이라 배포자 이력이 없습니다", link: { path: "/trust" } });
  });
});

describe("확인해 볼 것: 스냅샷에 없는 결론(합성)", () => {
  it("주의(unclassified_warning): 출금 차단 경고가 감지로 맨 앞", () => {
    const C = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
    const w = i => `0x${String(i).repeat(40)}`;
    const rows = [];
    for (let i = 1; i <= 5; i++) rows.push({ block: i, action: "deposit", from: w(i), to: C, amount_eth: 1, contract_balance_eth: i });
    for (let i = 1; i <= 3; i++) rows.push({ block: 10 + i, action: "withdraw", from: C, to: w(i), amount_eth: 0, contract_balance_eth: 5 });
    const decision = buildDecision({ report: { dynamic: { triggered_rules: [] } }, rows });
    expect(decision.conclusion).toBe("caution");
    const view = {
      decision,
      codeAssessment: { preventionRiskLevel: "LOW", mainRules: [] },
      warnings: [
        { source: "dynamic.withdraw_block_warning", detected: true, detail: "" },
        { source: "prevention.withdraw_block_warning", detected: false, detail: [] }
      ]
    };
    const items = checkItems({ view, risk: riskForScenario({ decision }, rows), glossary: GLOSSARY });
    expect(items.map(i => [i.key, i.status])).toEqual([["withdrawBlock", "detected"], ["code", "none"], ["deployer", "nodata"]]);
    expect(items[0].value).toBe("참여자 출금 3건 중 0건만 성공했고, 실패할 때 잔고가 5 ETH 남아 있었습니다");
  });

  it("판단 불가: 2개, 데이터 없음", () => {
    const decision = buildDecision({ report: {}, rows: [] });
    const items = checkItems({ view: { decision, codeAssessment: null, warnings: [] }, risk: riskForScenario({ decision }, []), glossary: GLOSSARY });
    expect(items.map(i => [i.key, i.status])).toEqual([["flow", "nodata"], ["deployer", "nodata"]]);
  });

  it("decision이 없으면 빈 목록", () => {
    expect(checkItems({ view: {}, risk: null, glossary: GLOSSARY })).toEqual([]);
  });
});

describe("카드 렌더링·문구", () => {
  it("항목·상태 배지·링크·안내 문구를 그린다(링크는 페이지가 넘긴다)", () => {
    const { view, items } = itemsOf("ponzi");
    const html = renderToStaticMarkup(h(RiskActionCard, {
      conclusion: view.decision.conclusion, checks: items,
      renderLink: i => h("a", { href: `#${i.link.path}` }, i.link.label)
    }));
    expect(html).toContain("확인해 볼 것");
    expect((html.match(/class="check-item /g) ?? []).length).toBe(4);
    expect(html).toContain(">감지<");
    expect(html).toContain(">이상 없음<");
    expect(html).toContain(">데이터 없음<");
    expect(html).toContain('href="#/trade"');
    expect(html).toContain('href="#/trust"');
    expect(html).toContain(CHECK_DISCLAIMER);
    // 목록이 없으면 그리지 않는다(기존 렌더 그대로)
    expect(renderToStaticMarkup(h(RiskActionCard, { conclusion: "risk" }))).not.toContain("확인해 볼 것");
  });
});
