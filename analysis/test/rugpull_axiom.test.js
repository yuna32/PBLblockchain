// 러그풀 교차공리 (analysis/dynamic_analyzer.js computeRugPullAxiom, RUGPULL_AXIOM) 단위 테스트.
// 실행: node --test analysis/test/*.test.js
// 기준값 경계(정확히 70%, 정확히 105%)는 wei 정수 비교로 고정한다 — 부동소수점이면 뒤집히는 값도 함께 넣었다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { analyzeDynamic, computeRugPullAxiom, RUGPULL_AXIOM } from "../dynamic_analyzer.js";

const C = "0x00000000000000000000000000000000000000cc";   // 컨트랙트
const OWNER = "0x00000000000000000000000000000000000000aa";
const U = i => `0x${String(i).padStart(40, "0")}`;

// 이벤트 [kind, addr, amount(문자열)] → 거래 행. 잔고는 wei 정수로 누적해 문자열로 적는다.
function rowsOf(events) {
  let bal = 0n, block = 0;
  const wei = s => { const [i, f = ""] = s.split("."); return BigInt(i) * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18)); };
  const eth = v => { const i = v / 10n ** 18n, f = (v % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, ""); return f ? `${i}.${f}` : `${i}`; };
  return events.map(([kind, addr, amount]) => {
    block += 3;
    const dep = kind === "deposit";
    bal += dep ? wei(amount) : -wei(amount);
    return { block: String(block), timestamp: "0", from: dep ? addr : C, to: dep ? C : addr,
             action: kind, amount_eth: amount, contract_balance_eth: eth(bal), participant_count: "0" };
  });
}
function analyzeRows(rows, opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rugaxiom-"));
  const p = path.join(dir, "t.csv");
  const H = "block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count";
  fs.writeFileSync(p, [H, ...rows.map(r => H.split(",").map(k => r[k]).join(","))].join("\n") + "\n");
  try { return analyzeDynamic(p, opts); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const deposits = (n, amount = "1") => Array.from({ length: n }, (_, i) => ["deposit", U(i + 1), amount]);

test("상수: 기준값은 RUGPULL_AXIOM 한 곳에서 온다", () => {
  assert.deepEqual(
    { netDrain: RUGPULL_AXIOM.netDrain, profitRatio: RUGPULL_AXIOM.profitRatio, profitSharers: RUGPULL_AXIOM.profitSharers,
      passThroughMinWithdrawals: RUGPULL_AXIOM.passThroughMinWithdrawals, passThroughMatchShare: RUGPULL_AXIOM.passThroughMatchShare },
    computeRugPullAxiom(rowsOf([...deposits(1), ["withdraw", OWNER, "1"]])).thresholds);
  assert.ok(Object.isFrozen(RUGPULL_AXIOM));
});

// ── NetDrain 경계: 순유출 7 / 최고 잔고 10 = 정확히 70% ──
test("NetDrain 경계: 정확히 70%는 충족, 1 wei 모자라면 미충족, 1 wei 넘으면 충족", () => {
  const at = out => computeRugPullAxiom(rowsOf([...deposits(10), ["withdraw", OWNER, out]])).netDrain;
  assert.equal(at("7").met, true);
  assert.equal(at("7").value, 0.7);
  assert.equal(at("6.999999999999999999").met, false);
  assert.equal(at("7.000000000000000001").met, true);
  assert.equal(at("6").met, false);
});

test("NetDrain: 부동소수점이면 뒤집히는 경계도 wei 비교로는 충족", () => {
  // 0.1+0.2 = 0.30000000000000004 같은 누적 오차: 출금 0.1·0.2·0.4 = 0.7, 최고 잔고 1
  const r = computeRugPullAxiom(rowsOf([["deposit", U(1), "1"], ["withdraw", OWNER, "0.1"], ["withdraw", OWNER, "0.2"], ["withdraw", OWNER, "0.4"]]));
  assert.equal(r.netDrain.met, true);
  assert.equal(r.netDrain.netOutflowEth, 0.7);
});

// ── 수익 경계: 받은 돈 ≥ 1.05 × 낸 돈 ──
test("수익 경계: 정확히 105%는 수익자, 직전 값은 아님, 직후 값은 수익자", () => {
  const sharer = recv => computeRugPullAxiom(rowsOf([["deposit", U(1), "1"], ["deposit", U(2), "1"], ["withdraw", U(1), recv]])).wallets[0].profitSharer;
  assert.equal(sharer("1.05"), true);
  assert.equal(sharer("1.049999999999999999"), false);
  assert.equal(sharer("1.050000000000000001"), true);
  assert.equal(sharer("1"), false, "정확히 100% 환불은 수익이 아님");
});

test("수익 경계: 0.1 입금 → 0.105 수령 (float로는 0.1*1.05 = 0.10500000000000001이라 미달)", () => {
  assert.ok(0.105 < 0.1 * 1.05, "전제: 부동소수점 비교는 뒤집힌다");
  const r = computeRugPullAxiom(rowsOf([["deposit", U(1), "0.1"], ["deposit", U(2), "1"], ["withdraw", U(1), "0.105"]]));
  assert.equal(r.wallets[0].profitSharer, true);
});

// ── T(반복 중계): 성공 출금 5건 이상, 그중 과반이 직전 입금과 같은 금액 ──
const relay = (n, matchedIdx) => rowsOf(Array.from({ length: n }, (_, i) => [
  ["deposit", U(i + 1), "1"], ["withdraw", U(100 + i), matchedIdx.includes(i) ? "1" : "0.5"]]).flat());
test("T: 5건 모두 일치 → 반복 중계 (범위 밖)", () => {
  const r = computeRugPullAxiom(relay(5, [0, 1, 2, 3, 4]));
  assert.equal(r.scope.passThrough, true);
  assert.equal(r.scope.reason, "pass_through");
  assert.equal(r.verdict, false);
});
test("T: 4건은 최소 건수 미달, 5건 중 2건 일치는 과반 아님, 3건 일치는 과반", () => {
  assert.equal(computeRugPullAxiom(relay(4, [0, 1, 2, 3])).scope.passThrough, false);
  assert.equal(computeRugPullAxiom(relay(5, [0, 1])).scope.passThrough, false);
  assert.equal(computeRugPullAxiom(relay(5, [0, 1, 2])).scope.passThrough, true);
});
test("T: 금액 일치 허용치 1e-9 ETH (경계 포함), 2e-9는 불일치", () => {
  const rows = d => rowsOf(Array.from({ length: 5 }, (_, i) => [["deposit", U(i + 1), "1"], ["withdraw", U(100 + i), d]]).flat());
  assert.equal(computeRugPullAxiom(rows("1.000000001")).scope.passThrough, true);
  assert.equal(computeRugPullAxiom(rows("1.000000002")).scope.passThrough, false);
});
test("T: 실패 출금(금액 0)은 세지 않는다", () => {
  const ev = [];
  for (let i = 0; i < 5; i++) ev.push(["deposit", U(i + 1), "1"], ["withdraw", U(100 + i), "0"]);
  const r = computeRugPullAxiom(rowsOf(ev));
  assert.equal(r.scope.passThroughDetail.withdrawals, 0);
  assert.equal(r.scope.reason, "no_flow");
});

// ── 적용 범위 사유 4개 ──
test("범위: eoa / no_flow / no_wallet_ledger", () => {
  const rows = rowsOf([...deposits(10), ["withdraw", OWNER, "9"]]);
  assert.equal(computeRugPullAxiom(rows, { isContract: false }).scope.reason, "eoa");
  assert.equal(computeRugPullAxiom(rows, { isContract: true }).scope.isContractSource, "input");
  assert.equal(computeRugPullAxiom(rows).scope.isContractSource, "assumed");
  assert.equal(computeRugPullAxiom(rowsOf(deposits(3))).scope.reason, "no_flow");
  const agg = computeRugPullAxiom(rows, { ledger: "aggregated" });
  assert.equal(agg.scope.reason, "no_wallet_ledger");
  assert.deepEqual([agg.verdict, agg.wallets.length, agg.netDrain.value, agg.sharedProfit.count], [false, 0, null, null]);
});

// ── 판정 체인 (analyzeDynamic) ──
test("위장 운영자: 운영자 1 입금 + 9명 각 1, 운영자에게 2.4×4 → rug_pull", () => {
  const rows = rowsOf([["deposit", OWNER, "1"], ...deposits(9), ...Array(4).fill(["withdraw", OWNER, "2.4"])]);
  const r = analyzeRows(rows);
  assert.equal(r.rugpull_axiom.netDrain.value, 0.86);
  assert.equal(r.rugpull_axiom.sharedProfit.count, 1);
  assert.equal(r.fraud_type_hint, "rug_pull");
});
test("반복 중계: 범위 밖이면 러그풀이 아니다 (T 없으면 NetDrain 500%)", () => {
  const r = analyzeRows(relay(5, [0, 1, 2, 3, 4]));
  assert.equal(r.rugpull_axiom.scope.reason, "pass_through");
  assert.ok(r.rugpull_axiom.netDrain.value >= 5);
  assert.notEqual(r.fraud_type_hint, "rug_pull");
});
test("정확히 100% 환불 2명 + 운영자 8 → rug_pull, 105% 환불 2명이면 러그풀 아님", () => {
  const base = refund => [...deposits(10), ["withdraw", U(1), refund], ["withdraw", U(2), refund], ["withdraw", OWNER, "7"]];
  const full = analyzeRows(rowsOf(base("1")));
  assert.equal(full.rugpull_axiom.sharedProfit.count, 0);
  assert.equal(full.fraud_type_hint, "rug_pull");
  const profit = analyzeRows(rowsOf(base("1.05")));
  assert.equal(profit.rugpull_axiom.sharedProfit.count, 2);
  assert.equal(profit.rugpull_axiom.verdict, false);
  assert.notEqual(profit.fraud_type_hint, "rug_pull");
});
test("수익자 2명(폰지 모양)은 러그풀 아님, 1명이면 rug_pull", () => {
  const two = analyzeRows(rowsOf([...deposits(10), ["withdraw", U(1), "1.2"], ["withdraw", U(2), "1.2"], ["withdraw", OWNER, "7.6"]]));
  assert.equal(two.rugpull_axiom.netDrain.value, 0.8);
  assert.equal(two.rugpull_axiom.verdict, false);
  assert.notEqual(two.fraud_type_hint, "rug_pull");
  const one = analyzeRows(rowsOf([...deposits(10), ["withdraw", U(1), "1.2"], ["withdraw", OWNER, "8.8"]]));
  assert.equal(one.fraud_type_hint, "rug_pull");
});
test("부분 인출: 60%는 러그풀 아님, 70%는 rug_pull (경계 포함)", () => {
  assert.equal(analyzeRows(rowsOf([...deposits(10), ["withdraw", OWNER, "6"]])).rugpull_axiom.verdict, false);
  assert.equal(analyzeRows(rowsOf([...deposits(10), ["withdraw", OWNER, "7"]])).fraud_type_hint, "rug_pull");
});
test("집계 장부: 러그풀 축은 범위 밖, 판정 체인은 옛 술어 그대로", () => {
  // 위장 운영자 모양: 옛 술어로는 중도 출금이 있어 러그풀이 아니고, 새 공리로는 러그풀
  const rows = rowsOf([["deposit", OWNER, "1"], ...deposits(9), ...Array(4).fill(["withdraw", OWNER, "2.4"])]);
  const agg = analyzeRows(rows, { ledger: "aggregated" });
  assert.equal(agg.rugpull_axiom.scope.reason, "no_wallet_ledger");
  assert.notEqual(agg.fraud_type_hint, "rug_pull");
  assert.ok(!agg.reasoning_steps.some(s => s.startsWith("rugpullScope") || s.startsWith("netDrain") || s.startsWith("sharedProfit")),
    "집계 장부에서는 판단 과정 줄을 늘리지 않는다");
  // 한 번에 전액 인출: 옛 술어로 rug_pull
  const drain = analyzeRows(rowsOf([...deposits(10), ["owner_withdraw_all", OWNER, "10"]]), { ledger: "aggregated" });
  assert.equal(drain.fraud_type_hint, "rug_pull");
});
test("지갑 목록: 순유출 기여·수익자 표시, 주소는 소문자", () => {
  const r = computeRugPullAxiom(rowsOf([["deposit", "0xABCDEF0000000000000000000000000000000001", "1"], ...deposits(9),
    ["withdraw", "0xABCDEF0000000000000000000000000000000001", "1.2"], ["withdraw", OWNER, "7"]]));
  const w = Object.fromEntries(r.wallets.map(x => [x.address, x]));
  assert.ok(w["0xabcdef0000000000000000000000000000000001"].profitSharer);
  assert.ok(w["0xabcdef0000000000000000000000000000000001"].drainContributor);
  assert.ok(w[OWNER].drainContributor && !w[OWNER].profitSharer);
  assert.equal(w[U(1)].drainContributor, false);
  assert.deepEqual(r.sharedProfit.wallets, ["0xabcdef0000000000000000000000000000000001"]);
});
