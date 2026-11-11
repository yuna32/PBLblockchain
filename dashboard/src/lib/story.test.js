import { describe, it, expect } from "vitest";
import { storyDomain, segmentBands, balanceAt, balanceBefore, stepPath, normalOverlay, calloutLanes } from "./story.js";
import { flowRows } from "./flowRows.js";
import { buildBlockSeries } from "./series.js";
import { SCENARIO_IDS, loadFixture } from "./testFixtures.js";
import { buildViewModel } from "../../../demo/lib/viewmodel.js";

const load = name => {
  const f = loadFixture(name);
  return { ...f, view: buildViewModel(f), points: buildBlockSeries(f.rows).points };
};

describe("쉬운 차트 배치", () => {
  it("마지막 구간 폭이 0이면 여백을 붙이고, 축의 실제 범위(min·max)는 그대로", () => {
    for (const name of ["ponzi", "rugpull", "laundering"]) {
      const { view, points } = load(name);
      const segs = view.decision.segments;
      expect(segs.at(-1).to - segs.at(-1).from).toBe(0);
      const d = storyDomain(points, segs);
      expect([d.min, d.max]).toEqual([points[0].block, points.at(-1).block]);
      expect(d.tail).toBe(true);
      expect(d.end).toBeGreaterThan(d.max);
      const bands = segmentBands(segs, d);
      expect(bands.at(-1).x2).toBe(d.end);
      expect(bands.slice(0, -1).every((b, i) => b.x2 === segs[i].to)).toBe(true);
    }
    for (const name of ["normal", "pumpdump"]) {
      const { view, points } = load(name);
      const d = storyDomain(points, view.decision.segments);
      expect(d.tail).toBe(false);
      expect(d.end).toBe(d.max);
    }
  });

  it("잔고 조회와 계단 경로", () => {
    const { points } = load("rugpull");
    expect(balanceAt(points, 35)).toBe(0);
    expect(balanceBefore(points, 35)).toBe(19);
    expect(balanceAt(points, 0)).toBe(0);
    const d = stepPath([{ block: 0, balance: 1 }, { block: 2, balance: 3 }], x => x * 10, y => y);
    expect(d).toBe("M0,1H20V3");
  });

  it("정상 곡선 겹치기: 이 컨트랙트의 최고점에서 시작해 차트 끝에서 끝나고, 최고 잔고를 넘지 않는다", () => {
    const normalRows = loadFixture("normal").rows;
    for (const name of ["ponzi", "rugpull", "laundering", "pumpdump"]) {
      const { view, points } = load(name);
      const d = storyDomain(points, view.decision.segments);
      const o = normalOverlay(normalRows, points, d);
      const peak = Math.max(...points.map(p => p.balance));
      expect(o[0].balance).toBeCloseTo(peak, 9);
      expect(o[0].block).toBe(points.find(p => p.balance === peak).block);
      expect(o.at(-1).block).toBeCloseTo(d.end, 9);
      expect(o.every(p => p.balance <= peak + 1e-9)).toBe(true);
    }
    expect(normalOverlay([], [{ block: 1, balance: 1 }], { end: 2 })).toEqual([]);
  });

  it("말풍선 줄 배치: 겹치면 다음 줄", () => {
    const lanes = calloutLanes([{ block: 10 }, { block: 11 }, { block: 50 }], b => b * 10, { boxWidth: 100, width: 1000 });
    expect(lanes.map(c => c.lane)).toEqual([0, 1, 0]);
    expect(lanes.map(c => c.no)).toEqual([1, 2, 3]);
    expect(calloutLanes([{ block: 99 }], b => b * 10, { boxWidth: 100, width: 1000 })[0].left).toBe(900);
  });
});

describe("흐름도 행", () => {
  it("시나리오별 라벨: 운영자/참여자, 모은 지갑, 내부자/후발, 정상의 운영자 0", () => {
    const rows = Object.fromEntries(SCENARIO_IDS.map(n => [n, flowRows(load(n).view.decision)]));
    const labels = n => rows[n].outs.map(o => `${o.label} ${o.ethText}${o.ratioText ? ` (${o.ratioText})` : ""}`);
    expect(labels("rugpull")).toEqual(["운영자 19 (100%)", "참여자 10명 0 (0%)", "컨트랙트에 남은 돈 0 (0%)"]);
    expect(labels("ponzi")).toEqual(["운영자 6.7 (67%)", "참여자 10명 3.3 (33%)", "컨트랙트에 남은 돈 0 (0%)"]);
    expect(rows.ponzi.outs[1].sub).toBe("그중 3명이 받음");
    expect(labels("laundering")).toEqual(["한 지갑(모은 지갑) 3.78 (100%)", "모은 지갑을 뺀 18개 지갑 0 (0%)", "컨트랙트에 남은 돈 0 (0%)"]);
    expect(rows.laundering.sources[0].label).toBe("입금 지갑 19개");
    expect(labels("pumpdump")).toEqual(["내부자 3개 지갑 19.5 (100%)", "후발 참여자 5명 0 (0%)", "컨트랙트에 남은 돈 0 (0%)"]);
    expect(labels("normal")).toEqual(["참여자 10명 10.445", "운영자 0", "컨트랙트에 남은 돈 4.555"]);
    expect(rows.normal.sources.map(s => s.label)).toEqual(["참여자 10명", "운영자 보상 풀"]);
    expect(rows.rugpull.outs[0].taker).toBe(true);
    expect(rows.normal.outs.some(o => o.taker)).toBe(false);
  });
});
