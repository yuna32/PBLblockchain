// node --test demo/test/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { computeOnset, isFraudHint } from "../lib/onset.js";
import { parseCsv } from "../lib/csv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "fixtures");
const CSV = { normal: "normal_log.csv", ponzi: "ponzi_log.csv", rugpull: "rugpull_log.csv", laundering: "laundering_log.csv", pumpdump: "pumpdump_log.csv" };

const row = (block, action, amount = "1") => ({ block: String(block), action, amount_eth: amount });
const fraud = { fraud_type_hint: "ponzi_scheme" };

test("사기 분류: 다섯 유형만 사기, 나머지는 비사기", () => {
  for (const h of ["ponzi_scheme", "rug_pull", "money_laundering", "pump_and_dump", "flash_loan"]) assert.equal(isFraudHint(h), true, h);
  for (const h of ["unclassified_warning", "unknown", "normal_staking", undefined, null, ""]) assert.equal(isFraudHint(h), false, String(h));
});

test("onset = 첫 출금(금액 > 0), 실패 출금은 onset이 아님", () => {
  const rows = [row(4, "deposit"), row(6, "withdraw", "0"), row(8, "withdraw", "2"), row(9, "deposit")];
  const { onset, events } = computeOnset(rows, fraud);
  assert.deepEqual(onset, { block: 8, type: "first_withdraw", label: "첫 출금" });
  assert.deepEqual(events.map(e => [e.type, e.block]), [["first_failed_withdraw", 6], ["first_withdraw", 8], ["inflow_stop", 9]]);
});

test("같은 행이 첫 출금이자 owner 전액 인출이면 둘 다 이벤트로", () => {
  const { events } = computeOnset([row(4, "deposit"), row(35, "owner_withdraw_all", "19")], fraud);
  assert.deepEqual(events, [
    { type: "inflow_stop", block: 4, label: "마지막 입금" },
    { type: "first_withdraw", block: 35, label: "첫 출금" },
    { type: "owner_withdraw_all", block: 35, label: "첫 owner 전액 인출" }
  ]);
});

test("비사기·값 없음이면 onset null, events는 계산", () => {
  const rows = [row(4, "stake"), row(53, "unstake", "1.04")];
  for (const d of [{ fraud_type_hint: "normal_staking" }, { fraud_type_hint: "unclassified_warning" }, {}, undefined]) {
    const r = computeOnset(rows, d);
    assert.equal(r.onset, null);
    assert.equal(r.events.length, 2);
  }
});

test("사기여도 성공한 출금이 없으면 onset null", () => {
  assert.equal(computeOnset([row(4, "deposit"), row(6, "withdraw", "0")], fraud).onset, null);
  assert.deepEqual(computeOnset([], fraud), { onset: null, events: [] });
});

const EXPECTED = { normal: null, ponzi: 33, rugpull: 35, laundering: 43, pumpdump: 23 };
for (const [name, block] of Object.entries(EXPECTED)) {
  test(`fixture ${name}: onset ${block ?? "null"}`, () => {
    const dir = path.join(FIXTURES, name);
    const rows = parseCsv(fs.readFileSync(path.join(dir, CSV[name]), "utf8"));
    const report = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8"));
    const { onset } = computeOnset(rows, report.dynamic);
    assert.equal(onset?.block ?? null, block);
  });
}
