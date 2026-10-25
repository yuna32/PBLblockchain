import { describe, it, expect } from "vitest";
import { blockRange, buildBlockSeries, chartMarkers, clampBlock, nextBlock, crossedOnset, mergeEvents } from "./series.js";
import { buildViewModel } from "../../../demo/lib/viewmodel.js";
import { SCENARIO_IDS, loadFixture } from "./testFixtures.js";

describe("buildBlockSeries (fixture 5개)", () => {
  for (const name of SCENARIO_IDS) {
    it(`${name}: 블록 수, 누적 입출금, 마지막 잔액`, () => {
      const { report, rows } = loadFixture(name);
      const { points, balanceSource } = buildBlockSeries(rows);
      expect(balanceSource).toBe("contract_balance_eth");
      expect(points.length).toBe(new Set(rows.map(r => r.block)).size);
      expect(points.map(p => p.block)).toEqual([...points.map(p => p.block)].sort((a, b) => a - b));
      expect(points.at(-1).cumIn).toBeCloseTo(report.dynamic.metrics.total_in_eth, 4);
      expect(points.at(-1).cumOut).toBeCloseTo(report.dynamic.metrics.total_out_eth, 4);
      expect(points.at(-1).balance).toBeCloseTo(report.dynamic.metrics.final_balance_eth, 4);
      expect(Math.max(...points.map(p => p.balance))).toBeCloseTo(report.dynamic.metrics.peak_balance_eth, 4);
    });
  }

  it("pumpdump: 실패 출금 5건", () => {
    const { points } = buildBlockSeries(loadFixture("pumpdump").rows);
    expect(points.reduce((s, p) => s + p.failed, 0)).toBe(5);
  });

  it("잔액 열이 없으면 누적 입금 - 누적 출금", () => {
    const rows = [
      { block: 1, action: "deposit", amount_eth: 2 },
      { block: 2, action: "withdraw", amount_eth: 0.5 },
      { block: 2, action: "deposit", amount_eth: 1 }
    ];
    const { points, balanceSource } = buildBlockSeries(rows);
    expect(balanceSource).toBe("cumulative");
    expect(points).toEqual([
      { block: 1, deposit: 2, withdraw: 0, failed: 0, balance: 2, cumIn: 2, cumOut: 0 },
      { block: 2, deposit: 1, withdraw: 0.5, failed: 0, balance: 2.5, cumIn: 3, cumOut: 0.5 }
    ]);
  });
});

describe("슬라이더 범위와 표시", () => {
  it("blockRange·clamp·nextBlock", () => {
    const range = blockRange([{ block: 9 }, { block: 3 }, { block: 3 }, { block: 6 }]);
    expect(range).toEqual({ min: 3, max: 9, blocks: [3, 6, 9] });
    expect(clampBlock(1, range)).toBe(3);
    expect(clampBlock(12, range)).toBe(9);
    expect(nextBlock(range, 3)).toBe(6);
    expect(nextBlock(range, 4)).toBe(6);
    expect(nextBlock(range, 9)).toBe(null);
  });

  it("mergeEvents: 같은 블록 이벤트를 하나로 (rugpull 35)", () => {
    const view = buildViewModel(loadFixture("rugpull"));
    const merged = mergeEvents(view.phase.events);
    expect(merged.map(e => e.block)).toEqual([31, 35]);
    expect(merged[1].label).toBe("첫 출금 · 첫 owner 전액 인출");
    expect(merged[1].types).toEqual(["first_withdraw", "owner_withdraw_all"]);
  });

  it("crossedOnset: 지나가는 순간만 true", () => {
    expect(crossedOnset(31, 33, 33)).toBe(true);
    expect(crossedOnset(33, 35, 33)).toBe(false);
    expect(crossedOnset(20, 31, 33)).toBe(false);
    expect(crossedOnset(20, 40, null)).toBe(false);
  });

  it("chartMarkers: 정상은 onset 강조 없음, 사기는 onset부터 끝까지", () => {
    for (const name of SCENARIO_IDS) {
      const input = loadFixture(name);
      const view = buildViewModel(input);
      const range = blockRange(input.rows);
      const m = chartMarkers(view.phase, range);
      expect(m.events.length).toBe(view.phase.events.length);
      if (name === "normal") expect(m.onset).toBe(null);
      else expect(m.onset).toEqual({ x1: view.phase.onset.block, x2: range.max, label: "첫 출금" });
    }
  });
});
