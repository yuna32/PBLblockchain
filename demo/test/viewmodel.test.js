// node --test demo/test/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildViewModel, EXTRACTOR_PROFIT_RATIO, DISCLAIMER, HEADLINE_TEMPLATES, HEADLINE_PAGES } from "../lib/viewmodel.js";
import { toTimeseries } from "../lib/timeseries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "fixtures");
const CSV = { normal: "normal_log.csv", ponzi: "ponzi_log.csv", rugpull: "rugpull_log.csv", laundering: "laundering_log.csv", pumpdump: "pumpdump_log.csv" };

function load(name) {
  const dir = path.join(FIXTURES, name);
  return {
    report:   JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")),
    envelope: JSON.parse(fs.readFileSync(path.join(dir, "envelope.json"), "utf8")),
    rows:     toTimeseries(fs.readFileSync(path.join(dir, CSV[name]), "utf8"))
  };
}

function allKeys(o, out = new Set()) {
  if (Array.isArray(o)) o.forEach(v => allKeys(v, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { out.add(k); allKeys(v, out); }
  return out;
}

// 시나리오별 기대값: [사기 분류, onset, trustGrade, 최저 지갑 등급, drainer, extractor, prevention 수준, static 판정]
const EXPECTED = {
  normal:     [false, null, "A", "A", 0, 0, "LOW",      "LOW_RISK"],
  ponzi:      [true,  33,   "C", "F", 1, 0, "CRITICAL", "HIGH_RISK"],
  rugpull:    [true,  35,   "C", "F", 1, 0, "CRITICAL", "HIGH_RISK"],
  laundering: [true,  43,   "B", "D", 1, 0, "CRITICAL", "HIGH_RISK"],
  pumpdump:   [true,  23,   "A", "B", 0, 3, "CRITICAL", "MEDIUM_RISK"]
};

for (const [name, [fraud, onset, trustGrade, lowestGrade, drainers, extractors, prevLevel, staticVerdict]] of Object.entries(EXPECTED)) {
  test(`fixture ${name}: 핵심 값`, () => {
    const input = load(name);
    const before = structuredClone(input.report);
    const v = buildViewModel(input);

    assert.deepEqual(input.report, before, "리포트 원본이 바뀌면 안 됨");
    const keys = allKeys(v);
    assert.ok(!keys.has("overall_grade") && !keys.has("raw_grade") && !keys.has("overallGrade"), "종합 등급이 뷰모델에 있으면 안 됨");

    assert.equal(v.scenario, name);
    assert.equal(v.reportHash, input.envelope.report_sha256);
    assert.equal(v.patterns.fraudClassified, fraud);
    assert.equal(v.phase.onset?.block ?? null, onset);
    assert.ok(v.phase.events.length > 0);

    const w = v.walletAssessment;
    assert.equal(w.trustGrade, trustGrade);
    assert.equal(w.lowestWallet.grade, lowestGrade);
    assert.equal(w.lowestDiffersFromOverall, trustGrade !== lowestGrade);
    assert.equal(w.drainerCount, drainers);
    assert.equal(w.extractorCount, extractors);
    assert.match(w.extractorDefinition, /profit_ratio > 1\.3/);

    assert.equal(v.codeAssessment.preventionRiskLevel, prevLevel);
    assert.equal(v.codeAssessment.staticVerdict, staticVerdict);
    assert.ok(v.codeAssessment.mainRules.length <= 3);

    assert.deepEqual(v.warnings.map(x => x.source), [
      "dynamic.withdraw_block_warning", "prevention.withdraw_block_warning", "prevention.code_pattern_warnings"
    ]);
    assert.ok(v.warnings.every(x => x.detected === false));
    assert.equal(v.disclaimer, DISCLAIMER);
  });
}

test("PumpDump: 평균 등급 A, 최저 지갑 등급 B로 다르게 표시", () => {
  const w = buildViewModel(load("pumpdump")).walletAssessment;
  assert.equal(w.trustGrade, "A");
  assert.equal(w.lowestWallet.grade, "B");
  assert.equal(w.lowestDiffersFromOverall, true);
});

test("evasion·INFLOW_STOP은 patterns에 있음", () => {
  const p = buildViewModel(load("pumpdump")).patterns;
  assert.deepEqual(p.evasion, { detected: true, subclass: "PumpDump_MaxTxEvasion", confidence: p.evasion.confidence });
  assert.equal(p.inflowStop.detected, true);
  assert.equal(p.fraudTypeLabel, "펌프앤덤프");
});

test("extractor 기준: drainer는 세지 않고 1.3 초과만", () => {
  assert.equal(EXTRACTOR_PROFIT_RATIO, 1.3);
  const report = load("ponzi").report;
  report.trust.wallet_scores = [
    { address: "a", trust_score: 50, grade: "C", is_drainer: true,  profit_ratio: 999 },
    { address: "b", trust_score: 60, grade: "B", is_drainer: false, profit_ratio: 1.3 },
    { address: "c", trust_score: 70, grade: "A", is_drainer: false, profit_ratio: 1.31 }
  ];
  const w = buildViewModel({ report, envelope: null, rows: [] }).walletAssessment;
  assert.equal(w.drainerCount, 1);
  assert.equal(w.extractorCount, 1);
  assert.equal(w.lowestWallet.address, "a");
});

test("unclassified_warning·코드 패턴 경고는 detected: true로 표시, onset null", () => {
  const { report, rows } = load("normal");
  report.dynamic.fraud_type_hint = "unclassified_warning";
  report.dynamic.reasoning_steps = [...report.dynamic.reasoning_steps, "→ unclassified_warning: 유형 미확정, 출금 차단 경고 (테스트)"];
  report.prevention.classification = "unclassified_warning";
  report.prevention.code_pattern_warnings = [{ id: "CodePattern_X", label: "테스트", codePattern: "HiddenStateUpdatePattern", evidence: "line 1" }];
  const v = buildViewModel({ report, envelope: null, rows });
  const detected = v.warnings.filter(x => x.detected).map(x => x.source);
  assert.deepEqual(detected, ["prevention.code_pattern_warnings", "dynamic.fraud_type_hint", "prevention.classification"]);
  assert.match(v.warnings.find(x => x.source === "dynamic.fraud_type_hint").detail, /테스트/);
  assert.equal(v.phase.onset, null);
  assert.equal(v.patterns.fraudClassified, false);
});

test("toTimeseries: CRLF 제거, 숫자 열은 숫자", () => {
  const rows = toTimeseries("block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count\r\n4,100,0xa,0xb,deposit,1.000,1,1\r\n");
  assert.deepEqual(rows, [{ block: 4, timestamp: 100, from: "0xa", to: "0xb", action: "deposit", amount_eth: 1, contract_balance_eth: 1, participant_count: 1 }]);
});

// ── headline / combination (3a) ──
const TONES = { normal: "safe", ponzi: "danger", rugpull: "danger", laundering: "danger", pumpdump: "danger" };
for (const [name, tone] of Object.entries(TONES)) {
  test(`headline ${name}: tone ${tone}, 근거는 실제 값, 단정하지 않는 표현`, () => {
    const input = load(name);
    const v = buildViewModel(input);
    const h = v.headline;
    assert.equal(h.tone, tone);
    assert.match(h.text, /(가능성이 높습니다|감지되었습니다|감지되지 않았습니다)\.$/);
    assert.ok(h.reasons.length >= 1 && h.reasons.length <= 4);
    for (const r of h.reasons) {
      assert.ok(HEADLINE_PAGES.includes(r.page), r.page);
      assert.ok(r.label && r.detail);
    }
    const labels = h.reasons.map(r => r.label);
    const onset = v.phase.onset;
    if (onset) assert.equal(labels[0], `첫 출금 블록 ${onset.block}`);
    else assert.ok(!labels.some(l => l.startsWith("첫 출금")), "onset이 없으면 첫 출금 근거 생략");
    assert.ok(labels.includes(`최저 지갑 등급 ${v.walletAssessment.lowestWallet.grade}`));
    const wallet = h.reasons.find(r => r.page === "trust");
    assert.match(wallet.detail, new RegExp(`drainer\\) ${v.walletAssessment.drainerCount}개`));
    assert.match(wallet.detail, new RegExp(`extractor\\) ${v.walletAssessment.extractorCount}개`));
    assert.ok(v.combination && v.combination.label);
  });
}

test("headline 템플릿: 모든 문장이 ~습니다 체", () => {
  for (const t of Object.values(HEADLINE_TEMPLATES)) assert.match(t, /니다\.$/);
});

test("headline: 경고가 감지되면 caution이고 경고가 첫 근거", () => {
  const { report, rows } = load("normal");
  report.dynamic.fraud_type_hint = "unclassified_warning";
  report.dynamic.withdraw_block_warning = { detected: true, reason: "비오너 출금 5건 중 성공률 0.0% <= 5%" };
  const h = buildViewModel({ report, envelope: null, rows }).headline;
  assert.equal(h.tone, "caution");
  assert.equal(h.text, HEADLINE_TEMPLATES.unclassified_warning);
  assert.equal(h.reasons[0].label, "출금 차단 경고 (거래)");
  assert.match(h.reasons[0].detail, /성공률 0\.0%/);
});

test("headline 우선순위: 첫 출금 → 회피 패턴 → 지갑 → 코드 (ponzi·pumpdump는 회피 패턴 포함)", () => {
  const EXPECTED_PAGES = {
    normal:     ["trust", "report"],
    ponzi:      ["trade", "ontology", "trust", "report"],
    rugpull:    ["trade", "trust", "report"],
    laundering: ["trade", "trust", "report"],
    pumpdump:   ["trade", "ontology", "trust", "report"]
  };
  for (const [name, pages] of Object.entries(EXPECTED_PAGES)) {
    const h = buildViewModel(load(name)).headline;
    assert.deepEqual(h.reasons.map(r => r.page), pages, name);
  }
  assert.equal(buildViewModel(load("ponzi")).headline.reasons[1].label, "회피 패턴: 최대 거래 회피형");
  assert.match(buildViewModel(load("pumpdump")).headline.reasons[1].detail, /PumpDump_MaxTxEvasion/);
});

test("headline: 최대 4개, 근거 없는 항목은 생략", () => {
  const { report, rows } = load("ponzi");
  report.dynamic.withdraw_block_warning = { detected: true, reason: "테스트 경고" };
  const full = buildViewModel({ report, envelope: null, rows }).headline;
  assert.equal(full.reasons.length, 4);
  assert.deepEqual(full.reasons.map(r => r.page), ["report", "trade", "ontology", "trust"], "경고가 먼저, 코드 위험은 잘림");
  const sparse = load("ponzi");
  sparse.report.prevention.risk_level = undefined;
  sparse.report.trust.wallet_scores = [];
  assert.deepEqual(buildViewModel({ ...sparse, envelope: null }).headline.reasons.map(r => r.page), ["trade", "ontology"]);
});
