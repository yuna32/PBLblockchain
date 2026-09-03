import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runScenario } from "./run_scenario.js";
import { analyzeStatic }  from "../analysis/static_analyzer.js";
import { analyzeDynamic } from "../analysis/dynamic_analyzer.js";
import { scoreTrust }     from "../analysis/trust_scorer.js";

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const CONTRACT_NAME_MAP = {
  PonziScheme:     "PonziLab",
  RugPull:         "RugPull",
  MoneyLaundering: "MoneyLaundering",
  PumpDump:        "PumpDump",
  Normal:          "NormalStaking"
};

function computeRawGrade(staticResult, dynamicResult, trustResult) {
  const combined = Math.round(
    staticResult.static_risk_score   * 0.30 +
    dynamicResult.dynamic_risk_score * 0.40 +
    (100 - trustResult.overall_trust_score) * 0.30
  );
  if (combined <= 19) return "A";
  if (combined <= 39) return "B";
  if (combined <= 59) return "C";
  if (combined <= 79) return "D";
  return "F";
}

function applyPreventionCap(rawGrade, preventionLevel) {
  const GRADE_ORDER = ["A", "B", "C", "D", "E", "F"];
  const CAPS = { CRITICAL: "D", HIGH: "C" };
  const cap = CAPS[preventionLevel];
  if (!cap) return rawGrade;
  const rawIdx = GRADE_ORDER.indexOf(rawGrade);
  const capIdx = GRADE_ORDER.indexOf(cap);
  return rawIdx >= capIdx ? rawGrade : cap;
}

function predictedLabel(grade) {
  return (grade === "D" || grade === "F") ? 1 : 0;
}

// Try to load prevention_reasoner — gracefully degrades if sol path not found
async function tryRunPrevention(contractName) {
  try {
    const { runPrevention } = await import("../analysis/prevention_reasoner.js");
    return await runPrevention(contractName);
  } catch {
    return { risk_score: 0, risk_level: "UNKNOWN" };
  }
}

async function analyzeScenario(scenario, csvPath) {
  const contractName = CONTRACT_NAME_MAP[scenario.fraud_type];
  const solPath = path.join(PROJECT_ROOT, "contracts", `${contractName}.sol`);

  const staticResult     = analyzeStatic(solPath);
  const dynamicResult    = analyzeDynamic(csvPath);
  const trustResult      = scoreTrust(csvPath);
  const preventionResult = await tryRunPrevention(contractName);

  const rawGrade  = computeRawGrade(staticResult, dynamicResult, trustResult);
  const grade     = applyPreventionCap(rawGrade, preventionResult.risk_level);
  const capApplied = rawGrade !== grade;
  const predicted = predictedLabel(grade);

  return {
    scenario_id:            scenario.scenario_id,
    fraud_type:             scenario.fraud_type,
    label:                  scenario.label,
    prevention_risk_level:  preventionResult.risk_level  ?? "UNKNOWN",
    prevention_score:       preventionResult.risk_score  ?? 0,
    dynamic_fraud_detected: (dynamicResult.fraud_type_hint || "unknown").toUpperCase(),
    dynamic_risk_score:     dynamicResult.dynamic_risk_score,
    trust_score:            trustResult.overall_trust_score,
    raw_grade:              rawGrade,
    final_grade:            grade,
    cap_applied:            capApplied,
    predicted_label:        predicted,
    correct:                predicted === scenario.label
  };
}

// ── Metrics ──────────────────────────────────────────────────────────────────

function computeMetrics(results) {
  const fraudTypes = [...new Set(results.map(r => r.fraud_type))];
  const metrics = {};

  for (const ft of fraudTypes) {
    const sub = results.filter(r => r.fraud_type === ft);
    const tp = sub.filter(r => r.label === 1 && r.predicted_label === 1).length;
    const fp = sub.filter(r => r.label === 0 && r.predicted_label === 1).length;
    const fn = sub.filter(r => r.label === 1 && r.predicted_label === 0).length;
    const tn = sub.filter(r => r.label === 0 && r.predicted_label === 0).length;
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall    = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const f1        = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
    metrics[ft] = { precision, recall, f1, tp, fp, fn, tn };
  }

  const tp = results.filter(r => r.label === 1 && r.predicted_label === 1).length;
  const fp = results.filter(r => r.label === 0 && r.predicted_label === 1).length;
  const fn = results.filter(r => r.label === 1 && r.predicted_label === 0).length;
  const tn = results.filter(r => r.label === 0 && r.predicted_label === 0).length;
  const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
  const recall    = (tp + fn) > 0 ? tp / (tp + fn) : 0;
  const f1        = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
  metrics["OVERALL"] = { precision, recall, f1, tp, fp, fn, tn };

  return metrics;
}

function fmt(n) { return n.toFixed(3); }
function pad(s, w) { return String(s).padEnd(w); }
function rpad(s, w) { return String(s).padStart(w); }

function printMetricsTable(metrics) {
  const COL = 92;
  console.log("\n" + "─".repeat(COL));
  console.log(
    pad("Type", 16) + "| " +
    pad("Precision", 10) + "| " +
    pad("Recall", 7) + "| " +
    pad("F1", 6) + "| " +
    rpad("TP", 3) + " | " +
    rpad("FP", 3) + " | " +
    rpad("FN", 3) + " | " +
    rpad("TN", 3)
  );
  console.log("─".repeat(COL));

  const fraudOrder = ["PonziScheme", "RugPull", "MoneyLaundering", "PumpDump", "Normal", "OVERALL"];
  for (const ft of fraudOrder) {
    const m = metrics[ft];
    if (!m) continue;
    const isNormal   = ft === "Normal";
    const isOverall  = ft === "OVERALL";
    const showMetrics = !isNormal || isOverall;

    const prec = showMetrics ? fmt(m.precision) : "N/A  ";
    const rec  = showMetrics ? fmt(m.recall)    : "N/A  ";
    const f1   = showMetrics ? fmt(m.f1)        : "N/A  ";

    console.log(
      pad(ft, 16) + "| " +
      pad(prec, 10) + "| " +
      pad(rec, 7) + "| " +
      pad(f1, 6) + "| " +
      rpad(m.tp, 3) + " | " +
      rpad(m.fp, 3) + " | " +
      rpad(m.fn, 3) + " | " +
      rpad(m.tn, 3)
    );
  }
  console.log("─".repeat(COL));
}

function diagnoseF1(metrics) {
  const overallF1 = metrics.OVERALL?.f1 ?? 0;
  if (overallF1 >= 0.70) {
    console.log(`\n✅ Overall F1: ${fmt(overallF1)} ≥ 0.70`);
    return;
  }

  console.log(`\n⚠  Overall F1 (${fmt(overallF1)}) < 0.70. Diagnosis:`);
  const fraudTypes = ["PonziScheme", "RugPull", "MoneyLaundering", "PumpDump"];
  const sorted = fraudTypes.filter(ft => metrics[ft]).sort((a, b) => metrics[a].f1 - metrics[b].f1);
  const worst  = sorted[0];
  const wm     = metrics[worst];

  console.log(`  Lowest F1: ${worst} (F1=${fmt(wm.f1)}, TP=${wm.tp}, FP=${wm.fp}, FN=${wm.fn})`);

  if (wm.fn > wm.tp) {
    console.log(`  → High false-negative rate. Suggestion: widen predicted_label threshold`);
    console.log(`    (classify grade C as fraud too, or lower dynamic_risk_score weight)`);
  }
  if (wm.fp > 0) {
    console.log(`  → False positives detected. Check Normal scenarios scoring D/F.`);
    console.log(`    Consider raising the grade threshold or trust_score weight.`);
  }
  if (wm.tp === 0) {
    console.log(`  → Zero TP: detector never fires for ${worst}. Check dynamic analyzer rules.`);
  }

  const normalM = metrics["Normal"];
  if (normalM && normalM.fp > 0) {
    console.log(`  → ${normalM.fp} Normal scenario(s) predicted as fraud (FP). Reduce sensitivity.`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const generatedDir = path.join(__dirname, "generated");
  if (!fs.existsSync(generatedDir)) {
    console.error("No scenarios found. Run: node scenarios/generate_scenarios.js --count 10");
    process.exit(1);
  }

  const files = fs.readdirSync(generatedDir).filter(f => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.error("Generated directory is empty.");
    process.exit(1);
  }

  const results = [];
  let correct = 0;

  for (let i = 0; i < files.length; i++) {
    const scenarioPath = path.join(generatedDir, files[i]);
    const scenario     = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));

    console.log(`\n[${i + 1}/${files.length}] ${scenario.scenario_id} (${scenario.fraud_type})`);

    try {
      const csvPath = runScenario(scenario.scenario_id);
      const result  = await analyzeScenario(scenario, csvPath);
      results.push(result);
      if (result.correct) correct++;

      const acc = (correct / results.length * 100).toFixed(1);
      console.log(`[${results.length}/${files.length}] Accuracy so far: ${correct}/${results.length} (${acc}%)`);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }
  }

  if (results.length === 0) {
    console.error("No results collected.");
    process.exit(1);
  }

  // Save dataset
  fs.writeFileSync(
    path.join(__dirname, "dataset.json"),
    JSON.stringify(results, null, 2)
  );

  const csvHeaders = Object.keys(results[0]).join(",");
  const csvRows    = results.map(r => Object.values(r).join(","));
  fs.writeFileSync(
    path.join(__dirname, "dataset.csv"),
    [csvHeaders, ...csvRows].join("\n")
  );

  // Compute metrics
  const metrics = computeMetrics(results);
  printMetricsTable(metrics);
  diagnoseF1(metrics);

  fs.writeFileSync(
    path.join(__dirname, "metrics.json"),
    JSON.stringify(metrics, null, 2)
  );

  console.log(`\nDataset  → scenarios/dataset.json, scenarios/dataset.csv`);
  console.log(`Metrics  → scenarios/metrics.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
