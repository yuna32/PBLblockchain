// node --test demo/test/
import test from "node:test";
import assert from "node:assert/strict";
import { computeOnset } from "../lib/onset.js";

const row = (block, action, ts = String(1000 + block)) => ({ block: String(block), timestamp: ts, action, to: "0xowner", amount_eth: "1" });

test("(1) owner_withdraw_all이 있으면 첫 행 블록", () => {
  const rows = [row(4, "deposit"), row(41, "owner_withdraw_all"), row(45, "owner_withdraw_all")];
  const dynamic = { anomaly_signals: { INFLOW_STOP: { detected: true, last_deposit_block: 4 } } };
  const o = computeOnset(rows, dynamic);
  assert.equal(o.block, 41);
  assert.equal(o.timestamp, 1041);
  assert.equal(o.basis, "owner_withdraw_all");
});

test("(2) 없으면 INFLOW_STOP.last_deposit_block (detected와 무관)", () => {
  const rows = [row(4, "deposit"), row(20, "deposit"), row(22, "withdraw")];
  const o = computeOnset(rows, { anomaly_signals: { INFLOW_STOP: { detected: false, last_deposit_block: 20 } } });
  assert.equal(o.block, 20);
  assert.equal(o.timestamp, 1020);
  assert.equal(o.basis, "inflow_stop_last_deposit_block");
  assert.equal(o.detail.inflow_stop_detected, false);
});

test("(3) 둘 다 없으면 null", () => {
  assert.equal(computeOnset([row(4, "withdraw")], { anomaly_signals: { INFLOW_STOP: { detected: false, last_deposit_block: null } } }), null);
  assert.equal(computeOnset([], undefined), null);
});
