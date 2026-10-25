import { describe, it, expect } from "vitest";
import { buildNetwork, detectContract, walletRoles, OWNER_ADDRESS } from "./network.js";
import { SCENARIO_IDS, loadFixture } from "./testFixtures.js";

// fixture별 기대값: 노드 수(컨트랙트 포함), 링크 수(보낸 주소 → 받은 주소 쌍), 역할별 수
const EXPECTED = {
  normal:     { nodes: 12, links: 21, roles: { contract: 1, owner: 1, wallet: 10 } },
  ponzi:      { nodes: 12, links: 14, roles: { contract: 1, drainer: 1, wallet: 10 } },
  rugpull:    { nodes: 12, links: 11, roles: { contract: 1, drainer: 1, wallet: 10 } },
  laundering: { nodes: 20, links: 20, roles: { contract: 1, drainer: 1, wallet: 18 } },
  pumpdump:   { nodes: 9,  links: 16, roles: { contract: 1, extractor: 3, wallet: 5 } }
};

describe("buildNetwork (fixture 5개)", () => {
  for (const name of SCENARIO_IDS) {
    it(`${name}: 노드·링크 수, 역할, 누적 금액`, () => {
      const { report, rows } = loadFixture(name);
      const net = buildNetwork(rows, report.trust.wallet_scores);
      const exp = EXPECTED[name];
      expect(net.nodes.length).toBe(exp.nodes);
      expect(net.links.length).toBe(exp.links);
      const roles = {};
      net.nodes.forEach(n => { roles[n.role] = (roles[n.role] ?? 0) + 1; });
      expect(roles).toEqual(exp.roles);

      // 누적 금액: 리포트 동적 분석 metrics와 같아야 한다
      expect(net.totals.deposit).toBeCloseTo(report.dynamic.metrics.total_in_eth, 4);
      expect(net.totals.withdraw).toBeCloseTo(report.dynamic.metrics.total_out_eth, 4);
      const depLinks = net.links.filter(l => l.kind === "deposit").reduce((s, l) => s + l.amount, 0);
      const wdLinks = net.links.filter(l => l.kind === "withdraw").reduce((s, l) => s + l.amount, 0);
      expect(depLinks).toBeCloseTo(report.dynamic.metrics.total_in_eth, 4);
      expect(wdLinks).toBeCloseTo(report.dynamic.metrics.total_out_eth, 4);

      // 링크 방향: 입금은 컨트랙트로, 출금은 컨트랙트에서
      for (const l of net.links) {
        if (l.kind === "deposit") expect(l.target).toBe(net.contract);
        else expect(l.source).toBe(net.contract);
      }
      // 거래 행 수 = 링크 거래 수 합
      expect(net.links.reduce((s, l) => s + l.count, 0)).toBe(rows.length);
    });
  }

  it("ponzi: drainer는 운영자, 받은 금액 6.7", () => {
    const { report, rows } = loadFixture("ponzi");
    const net = buildNetwork(rows, report.trust.wallet_scores);
    const drainer = net.nodes.find(n => n.role === "drainer");
    expect(drainer.id).toBe(OWNER_ADDRESS);
    expect(drainer.received).toBeCloseTo(6.7, 6);
  });

  it("pumpdump: 실패 출금 5건이 링크에 기록되고 extractor는 각 6.5 수령", () => {
    const { report, rows } = loadFixture("pumpdump");
    const net = buildNetwork(rows, report.trust.wallet_scores);
    expect(net.links.reduce((s, l) => s + l.failed, 0)).toBe(5);
    expect(net.nodes.filter(n => n.role === "extractor").map(n => n.received)).toEqual([6.5, 6.5, 6.5]);
  });

  it("upToBlock: 해당 블록까지의 거래만", () => {
    const { report, rows } = loadFixture("ponzi");
    const early = buildNetwork(rows, report.trust.wallet_scores, 10);
    expect(early.nodes.length).toBe(4); // 지갑 3 + 컨트랙트
    expect(early.links.length).toBe(3);
    expect(early.totals).toEqual({ deposit: 3, withdraw: 0 });
    expect(buildNetwork(rows, report.trust.wallet_scores, 0).nodes).toEqual([]);
  });

  it("detectContract·walletRoles", () => {
    const { report, rows } = loadFixture("laundering");
    expect(detectContract(rows)).toBe("0x5fbdb2315678afecb367f032d93f642f64180aa3");
    const roles = walletRoles(report.trust.wallet_scores);
    expect([...roles.values()]).toEqual(["drainer"]);
  });
});
