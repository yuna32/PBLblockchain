// node --test demo/test/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildOntologyGraph, conditionStatuses, techniqueStatuses, TECHNIQUE_EVIDENCE, MAPPING_NOTE, TECHNIQUE_MAPPING_NOTE, OWL_NOTE } from "../lib/ontologygraph.js";
import { GLOSSARY } from "../lib/glossary.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const FIXTURES = path.join(__dirname, "..", "fixtures");
const load = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, name, "report.json"), "utf8"));
const owlResults = JSON.parse(fs.readFileSync(path.join(ROOT, "ontology", "owl_results.json"), "utf8"));

const NODE_KINDS = new Set(["class", "parent", "condition", "evidence", "evasion", "role", "patch"]);
const LINK_KINDS = new Set(["subClassOf", "requires", "supportedBy", "exhibits", "affects", "mitigatedBy"]);

// 시나리오별 조건 상태 기대값 (met/unmet/no_data)
const EXPECTED_STATUS = {
  normal:     { BalanceDrop: false, FlowSpike: false, MaxTxAlert: false, MidWithdrawalsExist: true, NoMidWithdrawals: false,
                UniqueParticipants: true, SingleDrain: false, InsiderPrivilege: false, AsymmetricWithdrawal: false, LateParticipantLoss: false },
  ponzi:      { BalanceDrop: true, FlowSpike: true, MaxTxAlert: false, MidWithdrawalsExist: true },
  rugpull:    { BalanceDrop: true, MaxTxAlert: true, NoMidWithdrawals: true },
  laundering: { UniqueParticipants: true, MaxTxAlert: true, SingleDrain: true },
  pumpdump:   { InsiderPrivilege: true, AsymmetricWithdrawal: true, LateParticipantLoss: true }
};
const CLASS = { normal: null, ponzi: "PonziScheme", rugpull: "RugPull", laundering: "MoneyLaundering", pumpdump: "PumpDump" };

for (const [name, expected] of Object.entries(EXPECTED_STATUS)) {
  test(`fixture ${name}: 구조·조건 상태·추론 경로`, () => {
    const report = load(name);
    const before = structuredClone(report);
    const g = buildOntologyGraph(report, { owlResults });
    assert.deepEqual(report, before, "리포트 원본이 바뀌면 안 됨");

    const ids = new Set(g.nodes.map(n => n.id));
    assert.equal(ids.size, g.nodes.length, "노드 id 중복");
    for (const n of g.nodes) {
      assert.ok(NODE_KINDS.has(n.kind), n.kind);
      for (const k of ["id", "label", "kind", "group", "active", "desc"]) assert.ok(k in n, `${n.id}.${k}`);
    }
    for (const l of g.links) {
      assert.ok(LINK_KINDS.has(l.kind), l.kind);
      assert.ok(ids.has(l.source) && ids.has(l.target), `${l.source} → ${l.target}`);
      const s = g.nodes.find(n => n.id === l.source), t = g.nodes.find(n => n.id === l.target);
      assert.equal(l.active, s.active && t.active);
    }
    for (const l of g.links.filter(x => x.kind === "supportedBy")) {
      assert.equal(g.nodes.find(n => n.id === l.source).kind, "evidence");
      const target = g.nodes.find(n => n.id === l.target);
      assert.ok(target.kind === "condition" || target.group === "evasion_technique", `${l.target} (${target.kind})`);
    }

    // 조건 상태
    for (const [cond, value] of Object.entries(expected)) {
      const node = g.nodes.find(n => n.id === `condition:${cond}`);
      assert.ok(node, cond);
      assert.equal(node.status, value ? "met" : "unmet", cond);
      assert.equal(node.active, value);
    }
    const condNodes = g.nodes.filter(n => n.kind === "condition");
    assert.equal(condNodes.length, Object.keys(expected).length, "그래프의 조건 수");

    // 분류 클래스와 추론 경로
    assert.equal(g.meta.scenarioFraudClass, CLASS[name]);
    const activeClasses = g.nodes.filter(n => n.kind === "class" && n.active).map(n => n.id);
    assert.deepEqual(activeClasses, CLASS[name] ? [`class:${CLASS[name]}`] : []);
    const met = Object.entries(expected).filter(([, v]) => v).length;
    assert.equal(g.highlight.path.length, CLASS[name] ? met : 0);
    for (const p of g.highlight.path) {
      assert.equal(p.length, 3);
      assert.deepEqual(p.map(id => g.nodes.find(n => n.id === id).kind), ["evidence", "condition", "class"]);
      assert.ok(p.every(id => g.nodes.find(n => n.id === id).active));
    }
    if (!CLASS[name]) assert.equal(g.nodes.filter(n => n.kind === "class").length, 4, "비사기면 후보 4개");

    assert.equal(g.meta.mappingNote, `${MAPPING_NOTE}. ${TECHNIQUE_MAPPING_NOTE}`);
    assert.match(g.meta.mappingNote, /중첩 pipeline/);
    assert.equal(g.meta.owlNote, OWL_NOTE);
    assert.equal(g.meta.owlMismatch, null, JSON.stringify(g.meta.owlMismatch));
  });
}

test("approx 조건은 desc에 근사 사유를 적음", () => {
  const g = buildOntologyGraph(load("normal"));
  for (const id of ["MaxTxAlert", "UniqueParticipants", "AsymmetricWithdrawal", "LateParticipantLoss"]) {
    const n = g.nodes.find(x => x.id === `condition:${id}`);
    assert.equal(n.approx, true, id);
    assert.match(n.desc, /근사:/, id);
  }
  assert.match(g.nodes.find(x => x.id === "condition:MaxTxAlert").desc, /70%.*0\.9|70%.*90%/);
  for (const id of ["BalanceDrop", "FlowSpike", "SingleDrain", "InsiderPrivilege", "MidWithdrawalsExist", "NoMidWithdrawals"]) {
    assert.equal(g.nodes.find(x => x.id === `condition:${id}`).approx, false, id);
  }
});

test("근거 데이터 없음(null)은 미충족과 구분", () => {
  const report = load("ponzi");
  report.dynamic.reasoning_steps = [];
  report.dynamic.triggered_rules = undefined;
  const st = conditionStatuses(report);
  assert.equal(st.MaxTxAlert, null);
  assert.equal(st.BalanceDrop, null);
  assert.equal(st.LateParticipantLoss, null);
  const g = buildOntologyGraph(report);
  assert.equal(g.nodes.find(n => n.id === "condition:BalanceDrop").status, "no_data");
  assert.match(g.nodes.find(n => n.id === "condition:BalanceDrop").desc, /근거 데이터 없음/);
  assert.deepEqual(g.highlight.path, []);
});

test("PumpDump/PumpAndDump는 한 노드, 표시 이름 펌프앤덤프", () => {
  const g = buildOntologyGraph(load("normal"));
  const pd = g.nodes.filter(n => n.kind === "class" && /Pump/.test(n.id));
  assert.equal(pd.length, 1);
  assert.equal(pd[0].id, "class:PumpDump");
  assert.equal(pd[0].label, "펌프앤덤프");
  assert.match(pd[0].desc, /PumpAndDump/);
  const pump = buildOntologyGraph(load("pumpdump"), { owlResults });
  assert.deepEqual(pump.meta.owlInferred, ["PumpAndDump", "PumpDump_MaxTxEvasion"]);
  assert.equal(pump.meta.owlMismatch, null);
  assert.ok(pump.nodes.find(n => n.id === "evasion:PumpDump_MaxTxEvasion").active);
});

test("정의 없는 OwnerRecipientArbitrage·Depositor: 노드는 있고 desc에 표시, patch 링크 없음", () => {
  const g = buildOntologyGraph(load("laundering"));
  const ora = g.nodes.find(n => n.id === "technique:OwnerRecipientArbitrage");
  const dep = g.nodes.find(n => n.id === "role:Depositor");
  assert.match(ora.desc, /온톨로지에 정의 없음/);
  assert.match(dep.desc, /온톨로지에 정의 없음/);
  assert.ok(!g.links.some(l => l.source === ora.id && l.kind === "mitigatedBy"));
  // 정의가 있는 기법은 patch 링크가 있음
  const ponzi = buildOntologyGraph(load("ponzi"));
  assert.ok(ponzi.links.some(l => l.source === "technique:OwnerWithdrawAll" && l.kind === "mitigatedBy"));
});

// 회피 기법: 시나리오별 [그래프에 나오는 기법(= 해당 유형 usesEvasion), 활성, 근거 없음]
const EXPECTED_TECHNIQUES = {
  normal:     { shown: ["OwnerWithdrawAll", "GradualDrainObfuscation", "OwnerRecipientArbitrage"], active: [],                   noData: ["GradualDrainObfuscation", "OwnerRecipientArbitrage"] },
  ponzi:      { shown: ["OwnerWithdrawAll", "GradualDrainObfuscation"],                            active: ["OwnerWithdrawAll"], noData: ["GradualDrainObfuscation"] },
  rugpull:    { shown: ["OwnerWithdrawAll"],                                                       active: ["OwnerWithdrawAll"], noData: [] },
  laundering: { shown: ["OwnerRecipientArbitrage"],                                                active: [],                   noData: ["OwnerRecipientArbitrage"] },
  pumpdump:   { shown: ["GradualDrainObfuscation"],                                                active: [],                   noData: ["GradualDrainObfuscation"] }
};

for (const [name, exp] of Object.entries(EXPECTED_TECHNIQUES)) {
  test(`회피 기법 ${name}: usesEvasion 목록만, 활성 판정, 근거 링크, evasionPath`, () => {
    const g = buildOntologyGraph(load(name));
    const techs = g.nodes.filter(n => n.group === "evasion_technique");
    assert.deepEqual(techs.map(n => n.id.split(":")[1]).sort(), [...exp.shown].sort(), "usesEvasion 밖의 기법은 그리지 않음");
    assert.deepEqual(techs.filter(n => n.active).map(n => n.id.split(":")[1]).sort(), [...exp.active].sort());
    assert.deepEqual(techs.filter(n => n.status === "no_data").map(n => n.id.split(":")[1]).sort(), [...exp.noData].sort());
    assert.ok(!g.nodes.some(n => n.id === "technique:SmurfingDeposit"), "SmurfingDeposit은 어느 유형의 usesEvasion에도 없음");
    assert.ok(g.links.filter(l => l.kind === "exhibits" && l.target.startsWith("technique:")).every(l => l.label === "사용 기법"));
    // 활성 기법마다 증거 → 기법 supportedBy 링크와 evasionPath
    assert.equal(g.highlight.evasionPath.length, exp.active.length);
    for (const p of g.highlight.evasionPath) {
      const [ev, tech, cls] = p.map(id => g.nodes.find(n => n.id === id));
      assert.deepEqual([ev.kind, tech.group, cls.kind], ["evidence", "evasion_technique", "class"]);
      assert.ok(ev.active && tech.active && cls.active);
      assert.ok(g.links.some(l => l.source === ev.id && l.target === tech.id && l.kind === "supportedBy" && l.active));
    }
    // 분류 추론 경로(path)에는 회피 기법이 섞이지 않음
    assert.ok(g.highlight.path.every(p => !p.some(id => id.startsWith("technique:"))));
    // 활성 기법의 권고 조치는 active
    for (const t of exp.active) {
      const patch = g.nodes.find(n => n.id === `patch:${t}`);
      if (patch) assert.equal(patch.active, true, t);
    }
    assert.deepEqual(g.meta.techniques.map(t => t.technique), TECHNIQUE_EVIDENCE.map(t => t.technique));
  });
}

test("회피 기법 판정 규칙: OwnerWithdrawAll ← UNCONSTRAINED_OWNER_DRAIN, SmurfingDeposit ← distributedInflow", () => {
  assert.deepEqual(TECHNIQUE_EVIDENCE.map(t => [t.technique, t.evidenceLabelKey]),
    [["OwnerWithdrawAll", "UNCONSTRAINED_OWNER_DRAIN"], ["SmurfingDeposit", "distributedInflow"]]);
  // fixture 5개 모두 distributedInflow = true지만 SmurfingDeposit은 usesEvasion 밖이라 그래프에는 없음
  for (const name of Object.keys(EXPECTED_TECHNIQUES)) {
    assert.equal(techniqueStatuses(load(name)).SmurfingDeposit, true, name);
  }
  const r = load("ponzi");
  r.static.triggered_rules = [{ id: "RAPID_EXIT_MECHANISM" }];
  r.dynamic.triggered_rules = [{ id: "CONCENTRATION_DRAIN" }];
  r.dynamic.reasoning_steps = r.dynamic.reasoning_steps.filter(s => !s.startsWith("distributedInflow:"));
  assert.deepEqual(techniqueStatuses(r), { OwnerWithdrawAll: false, SmurfingDeposit: null },
    "RAPID_EXIT_MECHANISM·CONCENTRATION_DRAIN은 쓰지 않음, distributedInflow가 없으면 근거 없음");
  r.dynamic.reasoning_steps.push("distributedInflow: false (3 unique depositors)");
  assert.equal(techniqueStatuses(r).SmurfingDeposit, false);
  for (const t of TECHNIQUE_EVIDENCE) assert.ok(GLOSSARY[t.evidenceLabelKey] && GLOSSARY[t.technique], t.technique);
  assert.match(TECHNIQUE_MAPPING_NOTE, /SmurfingDeposit은 분산 입금 신호/);
  assert.match(TECHNIQUE_MAPPING_NOTE, /CONCENTRATION_DRAIN 규칙은 의미가 달라 따르지 않음/);
});

test("검출된 예방 체크리스트 항목은 active patch로 연결", () => {
  const g = buildOntologyGraph(load("ponzi"));
  const patches = g.links.filter(l => l.kind === "mitigatedBy" && l.source === "class:PonziScheme");
  assert.equal(patches.length, load("ponzi").prevention.checklist.filter(c => c.detected).length);
  assert.ok(patches.every(l => l.active));
  assert.equal(buildOntologyGraph(load("normal")).nodes.filter(n => n.group === "prevention").length, 0);
});
