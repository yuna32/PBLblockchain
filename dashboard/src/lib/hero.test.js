import { describe, it, expect } from "vitest";
import { activeStep, checkScene, heroSteps, progressOf, CARD_AT, GATHER_AT, CHECK_CARDS, FRAUD_CARDS, VALUE_LINES, ADDRESS_NOTICE } from "./hero.js";
import { CONCLUSIONS } from "./conclusion.js";
import { loadFixture } from "./testFixtures.js";
import { buildViewModel } from "../../../demo/lib/viewmodel.js";

describe("히어로 ③ 5단계", () => {
  it("러그풀 decision에서 예시 숫자를 만든다", () => {
    const steps = heroSteps(buildViewModel(loadFixture("rugpull")).decision);
    expect(steps.map(s => s.example)).toEqual([
      "입금 10건 · 출금 1건을 읽었습니다",
      "블록 31의 마지막 입금 뒤, 블록 35에서 잔고가 한 번에 빠졌습니다",
      "원금을 넘어 빠져나간 돈이 최고 잔고의 100% (기준 70% 이상)",
      "3번째 질문(러그풀)에서 조건이 모두 맞았습니다",
      "러그풀 의심 → 위험"
    ]);
    expect(steps.every(s => s.fromData)).toBe(true);
    expect(steps.map(s => s.label)).toEqual(["관측", "신호", "조건", "유형", "판정"]);
  });

  it("데이터를 못 읽으면(없음·모양이 다름) 숫자 없는 문구", () => {
    const fallback = [
      "입금과 출금 기록을 블록 순서대로 읽습니다",
      "잔고가 갑자기 줄어든 순간 같은 신호를 찾습니다",
      "원금을 넘어 빠져나간 돈의 비율 같은 조건을 기준과 비교합니다",
      "사기 유형 네 가지를 정해진 순서대로 확인합니다",
      "네 가지 결론 중 하나로 정리합니다"
    ];
    for (const bad of [null, undefined, {}, { copy: {}, segments: [], chain: [] }, "x"]) {
      const steps = heroSteps(bad);
      expect(steps.map(s => s.example)).toEqual(fallback);
      expect(steps.some(s => s.fromData)).toBe(false);
      expect(steps.every(s => !/\d/.test(s.example))).toBe(true);
    }
  });
});

describe("히어로 스크롤 계산", () => {
  it("진행도: 장면 위가 화면 위에 닿으면 0, 끝까지 지나가면 1", () => {
    expect(progressOf(0, 3000, 1000)).toBe(0);
    expect(progressOf(-1000, 3000, 1000)).toBe(0.5);
    expect(progressOf(-2500, 3000, 1000)).toBe(1);
    expect(progressOf(200, 3000, 1000)).toBe(0);
    expect(progressOf(0, 800, 1000)).toBe(0);
  });

  it("② 카드가 차례로 나타나고 결론으로 모인다", () => {
    expect(checkScene(0)).toEqual({ shown: [false, false, false], gathered: false });
    expect(checkScene(0.2).shown).toEqual([true, false, false]);
    expect(checkScene(0.5)).toEqual({ shown: [true, true, true], gathered: false });
    expect(checkScene(0.9)).toEqual({ shown: [true, true, true], gathered: true });
    expect(CARD_AT.every((t, i) => i === 0 || t > CARD_AT[i - 1]) && GATHER_AT > CARD_AT.at(-1)).toBe(true);
  });

  it("③ 진행도에 따라 단계가 하나씩 켜진다", () => {
    expect([0, 0.1, 0.25, 0.45, 0.6, 0.8, 1].map(p => activeStep(p))).toEqual([0, 0, 1, 2, 3, 4, 4]);
  });
});

describe("히어로 문구", () => {
  it("승인된 문구와 결론 설명 단일 출처", () => {
    expect(ADDRESS_NOTICE).toBe("시연판에서는 예시 컨트랙트만 확인할 수 있습니다. 아래 버튼으로 골라 주세요");
    expect(CHECK_CARDS.find(c => c.key === "code").desc).toBe("컨트랙트 코드에 출금을 막거나 운영자만 돈을 뺄 수 있는 기능이 있는지 점검합니다.");
    expect(FRAUD_CARDS.map(c => c.nick)).toEqual(["돌려막기", "들고 나가기", "모아서 흘려보내기", "띄우고 먼저 팔기"]);
    expect(VALUE_LINES.map(v => v.badge ?? null)).toEqual([null, null, "개발 중"]);
    expect(Object.fromEntries(Object.entries(CONCLUSIONS).map(([k, v]) => [k, v.desc]))).toEqual({
      risk: "사기 유형과 비슷한 거래 패턴이 보입니다",
      caution: "출금이 막히는 것 같은 경고 신호가 있습니다",
      no_evidence: "분석한 범위에서 신호가 보이지 않습니다. 안전이 보장된다는 뜻은 아닙니다",
      undetermined: "판단에 필요한 거래가 부족합니다"
    });
  });
});
