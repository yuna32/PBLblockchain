// node --test demo/test/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { computeCombination, COMBINATION_RULES } from "../lib/combination.js";
import { buildViewModel } from "../lib/viewmodel.js";
import { toTimeseries } from "../lib/timeseries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "fixtures");
const CSV = { normal: "normal_log.csv", ponzi: "ponzi_log.csv", rugpull: "rugpull_log.csv", laundering: "laundering_log.csv", pumpdump: "pumpdump_log.csv" };

function view(name) {
  const dir = path.join(FIXTURES, name);
  return buildViewModel({
    report:   JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")),
    envelope: JSON.parse(fs.readFileSync(path.join(dir, "envelope.json"), "utf8")),
    rows:     toTimeseries(fs.readFileSync(path.join(dir, CSV[name]), "utf8"))
  });
}

const EXPECTED = { normal: "low-low", ponzi: "high-high", rugpull: "high-high", laundering: "high-high", pumpdump: "high-high" };
for (const [name, quadrant] of Object.entries(EXPECTED)) {
  test(`fixture ${name}: ${quadrant}`, () => {
    const c = view(name).combination;
    assert.equal(c.quadrant, quadrant);
    assert.equal(c.label, COMBINATION_RULES.labels[quadrant]);
    assert.equal(c.criteriaNote, "시연용 임시 기준");
    assert.ok(c.basis.length >= 2);
    assert.ok(c.basis.every(b => /니다\.$/.test(b)), "~습니다/~합니다 체");
  });
}

test("PumpDump: 평균 A인데 지갑 위험 높음을 basis에 명시", () => {
  const c = view("pumpdump").combination;
  assert.match(c.basis.join(" "), /과도 수익 지갑\(extractor\) 3개/);
  assert.match(c.basis.join(" "), /평균 지갑 등급은 A로 안전해 보이지만/);
});

test("안전해 보이는 평균 등급 안내는 평균 A일 때만 (PumpDump만)", () => {
  assert.deepEqual(COMBINATION_RULES.safeLookingGrades, ["A"]);
  const withNote = Object.keys(EXPECTED).filter(name => view(name).combination.basis.some(b => b.includes("안전해 보이지만")));
  assert.deepEqual(withNote, ["pumpdump"]);
  assert.equal(view("laundering").walletAssessment.trustGrade, "B", "laundering은 평균 B라 안내 없음");
});

test("네 칸과 기준 경계", () => {
  const w = (o = {}) => ({ drainerCount: 0, extractorCount: 0, lowestWallet: { grade: "C" }, trustGrade: "C", ...o });
  const c = level => ({ preventionRiskLevel: level });
  assert.equal(computeCombination({ codeAssessment: c("MEDIUM"), walletAssessment: w() }).quadrant, "low-low");
  assert.equal(computeCombination({ codeAssessment: c("HIGH"), walletAssessment: w() }).label, "코드 취약 위험 (운영자 신호는 정상 범위)");
  assert.equal(computeCombination({ codeAssessment: c("LOW"), walletAssessment: w({ lowestWallet: { grade: "D" } }) }).label, "운영자 위험 (코드는 정상 범위)");
  assert.equal(computeCombination({ codeAssessment: c("CRITICAL"), walletAssessment: w({ drainerCount: 1 }) }).label, "복합 고위험");
  assert.equal(computeCombination({ codeAssessment: c(null), walletAssessment: null }).quadrant, "low-low");
});

test("임계값은 COMBINATION_RULES로 바꿀 수 있음", () => {
  const rules = { ...COMBINATION_RULES, codeHighLevels: ["CRITICAL"], walletHigh: { minDrainers: 2, minExtractors: 5, lowGrades: ["F"] } };
  const r = computeCombination({ codeAssessment: { preventionRiskLevel: "HIGH" }, walletAssessment: { drainerCount: 1, extractorCount: 3, lowestWallet: { grade: "D" } } }, rules);
  assert.equal(r.quadrant, "low-low");
});
