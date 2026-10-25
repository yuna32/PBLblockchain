// node --test demo/test/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GLOSSARY, collectTerms } from "../lib/glossary.js";
import { CONDITION_EVIDENCE, buildOntologyGraph } from "../lib/ontologygraph.js";
import { FraudOntology } from "../../analysis/fraud_ontology.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "fixtures");
const SCENARIOS = ["normal", "ponzi", "rugpull", "laundering", "pumpdump"];
const load = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, name, "report.json"), "utf8"));

test("모든 항목에 ko·desc가 있음", () => {
  for (const [id, entry] of Object.entries(GLOSSARY)) {
    assert.equal(typeof entry.ko, "string", id);
    assert.ok(entry.ko.length > 0, id);
    assert.ok(typeof entry.desc === "string" && entry.desc.length > 0, id);
  }
});

test("fixture 5개에 나온 ID가 모두 용어집에 있음 (누락 0건)", () => {
  const missing = [];
  let total = 0;
  for (const name of SCENARIOS) {
    for (const id of collectTerms(load(name))) {
      total++;
      if (!GLOSSARY[id]) missing.push(`${name}:${id}`);
    }
  }
  assert.ok(total > 0);
  assert.deepEqual(missing, []);
});

test("핵심 용어가 있음", () => {
  for (const id of ["drainer", "extractor", "lowest_wallet_grade", "INFLOW_STOP", "trust_grade", "onset", "report_hash"]) assert.ok(GLOSSARY[id], id);
});

test("headline·basis 문장이 한글 라벨로 바꾸는 ID가 모두 있음 (위험 수준, 경고)", () => {
  const ids = ["LOW", "MEDIUM", "HIGH", "CRITICAL", "ZeroWithdrawBlock", "unclassified_warning",
               "HIDDEN_WITHDRAW_BLOCK", "NO_PUBLIC_WITHDRAW_ACTIVATE", "HiddenStateUpdate", "StrawManContract"];
  assert.deepEqual(ids.filter(id => !GLOSSARY[id]), []);
  assert.deepEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"].map(id => GLOSSARY[id].ko), ["낮음", "보통", "높음", "매우 높음"]);
});

test("온톨로지 조건·근거·역할·회피 기법·회피 서브클래스가 모두 있음", () => {
  const ids = new Set();
  for (const ft of Object.values(FraudOntology.fraudTypes)) {
    [...ft.necessaryConditions, ...ft.sufficientConditions, ...ft.usesEvasion, ...ft.affectedRoles, ...ft.beneficiaryRoles].forEach(x => ids.add(x));
    Object.values(ft.evasionSubclasses).forEach(s => ids.add(s.id));
  }
  CONDITION_EVIDENCE.forEach(c => { ids.add(c.condition); ids.add(c.evidenceLabelKey); });
  const missing = [...ids].filter(id => !GLOSSARY[id]);
  assert.deepEqual(missing, []);
});

test("온톨로지 그래프 노드 라벨이 id 그대로 남지 않음", () => {
  for (const name of SCENARIOS) {
    for (const n of buildOntologyGraph(load(name)).nodes) {
      const raw = n.id.split(":")[1];
      assert.ok(n.label && n.label !== raw, `${name} ${n.id} → ${n.label}`);
    }
  }
});
