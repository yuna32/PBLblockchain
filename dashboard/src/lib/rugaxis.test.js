import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { rugVsPonzi, scopeNotice, walletLedgerRows, SCOPE_NOTICE_NOTE, SCOPE_NOTICE_TITLE } from "./rugaxis.js";
import { buildNetwork } from "./network.js";
import { RugVsPonzi, ScopeNotice, WalletLedger } from "../components/RugAxisParts.jsx";
import { loadFixture, SCENARIO_IDS } from "./testFixtures.js";
import { buildViewModel } from "../../../demo/lib/viewmodel.js";
import { RUG_SCOPE_REASONS } from "../../../demo/lib/decision.js";

const vm = name => buildViewModel(loadFixture(name));
const round6 = x => Math.round(x * 1e6) / 1e6;

describe("지갑별 낸 돈 vs 받은 돈: 원천은 rugpull_axiom.wallets", () => {
  it("거래 관계도(network.js)의 넣은 돈·받은 돈과 같은 값 (5개 시나리오)", () => {
    for (const name of SCENARIO_IDS) {
      const fx = loadFixture(name);
      const d = buildViewModel(fx).decision;
      expect(d.rugpull.wallets).toEqual(fx.report.dynamic.rugpull_axiom.wallets);
      const net = buildNetwork(fx.rows, fx.report.trust.wallet_scores, Infinity, { ownerAddress: d.ownerAddress });
      const nodes = new Map(net.nodes.filter(n => n.role !== "contract").map(n => [n.id, n]));
      expect([...nodes.keys()].sort()).toEqual(d.rugpull.wallets.map(w => w.address).sort());
      for (const w of d.rugpull.wallets) {
        expect([nodes.get(w.address).deposited, nodes.get(w.address).received], `${name} ${w.address}`)
          .toEqual([round6(w.deposited), round6(w.received)]);
      }
    }
  });

  it("러그풀: 순유출 기여는 운영자 지갑 하나, 수익자 없음 / 폰지: 수익자 3명", () => {
    const rug = walletLedgerRows(vm("rugpull").decision.rugpull, vm("rugpull").decision.ownerAddress);
    expect(rug.rows.filter(r => r.contributor).map(r => r.isOwner)).toEqual([true]);
    expect(rug.sharerCount).toBe(0);
    expect(rug.rows[0].contributor).toBe(true);
    const ponzi = walletLedgerRows(vm("ponzi").decision.rugpull, vm("ponzi").decision.ownerAddress);
    expect(ponzi.sharerCount).toBe(3);
    expect(ponzi.rows.filter(r => r.sharer).every(r => r.contributor && !r.isOwner)).toBe(true);
    expect(ponzi.contributorCount).toBe(4);
  });

  it("화면: 순유출 기여 지갑은 강조, 수익자는 표시가 따로 붙는다", () => {
    const rugHtml = renderToStaticMarkup(h(WalletLedger, { decision: vm("rugpull").decision }));
    expect((rugHtml.match(/wl-row wl-contrib/g) ?? []).length).toBe(1);
    expect(rugHtml).toContain("원금보다 +19 ETH");
    expect(rugHtml).not.toContain("수익자 · ");
    const ponziHtml = renderToStaticMarkup(h(WalletLedger, { decision: vm("ponzi").decision }));
    expect((ponziHtml.match(/수익자 · 원금의 105% 이상/g) ?? []).length).toBe(3);
    expect((ponziHtml.match(/wl-row wl-contrib/g) ?? []).length).toBe(4);
    const launderingHtml = renderToStaticMarkup(h(WalletLedger, { decision: vm("laundering").decision }));
    expect(launderingHtml).toContain("지갑 9개 더 보기");   // 입금 지갑 19개 중 10개만 먼저
  });
});

describe("러그풀 vs 폰지: 같은 기록이 갈리는 지점", () => {
  it("러그풀은 몰아 가져감, 폰지는 나눠 가짐, 정상·펌프앤덤프는 유출 기준 미만", () => {
    const side = n => rugVsPonzi(vm(n).decision.rugpull).side;
    expect(SCENARIO_IDS.map(side)).toEqual([null, "ponzi", "rug", "rug", null]);
    const html = renderToStaticMarkup(h(RugVsPonzi, { decision: vm("ponzi").decision }));
    expect(html).toContain("이 예시: 여럿이 나눠 가짐");
    expect(html).toContain("기준 70% 이상");
    expect(html).toContain("<strong>3명</strong>");
  });

  it("기준값은 결과 JSON에서만 온다 (thresholds·display를 바꾸면 화면도 바뀐다)", () => {
    const d = vm("rugpull").decision;
    const changed = { ...d, rugpull: { ...d.rugpull, thresholds: { ...d.rugpull.thresholds, netDrain: 0.8, profitSharers: 3 },
      display: { ...d.rugpull.display, netDrainThreshold: "80%", profitSharersThreshold: "3명", profitRatio: "110%" } } };
    const html = renderToStaticMarkup(h(RugVsPonzi, { decision: changed }));
    expect(html).toContain("기준 80% 이상");
    expect(html).toContain("원금의 110% 이상 돌려받은 참여자");
    expect(html).toContain("3명 미만 → 러그풀 쪽");
    expect(html).toContain("left:80%");
  });
});

describe("러그풀 축 범위 밖: '정상'이 아니라 '이 장부로는 판단할 수 없음' (중립)", () => {
  it("사유 4개 모두 회색 안내와 사유 문구, 안전·근거 없음으로 읽히지 않음", () => {
    expect(Object.keys(RUG_SCOPE_REASONS).sort()).toEqual(["eoa", "no_flow", "no_wallet_ledger", "pass_through"]);
    for (const [reason, txt] of Object.entries(RUG_SCOPE_REASONS)) {
      const d = vm("rugpull").decision;
      const rug = { ...d.rugpull, shape: "out_of_scope", shapeLabel: SCOPE_NOTICE_TITLE,
        scope: { ...d.rugpull.scope, inScope: false, reason, reasonLabel: txt.label, reasonText: txt.text } };
      expect(scopeNotice(rug)).toEqual({ title: SCOPE_NOTICE_TITLE, reason: txt.label, text: txt.text, note: SCOPE_NOTICE_NOTE });
      const html = renderToStaticMarkup(h(ScopeNotice, { rug }));
      expect(html).toContain("scope-notice");
      expect(html).toContain(txt.label);
      expect(html).not.toMatch(/정상|근거 없음|badge-safe/);
      // 지갑 표에서는 순유출 기여·수익자 강조를 하지 않는다
      const ledger = renderToStaticMarkup(h(WalletLedger, { decision: { ...d, rugpull: rug } }));
      expect(ledger).not.toContain("wl-contrib");
      expect(ledger).toContain(SCOPE_NOTICE_TITLE);
      expect(rugVsPonzi(rug).side).toBe(null);
    }
    expect(scopeNotice(vm("rugpull").decision.rugpull)).toBe(null);
  });
});
