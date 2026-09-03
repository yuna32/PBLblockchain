import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PARAM_RANGES, sampleUniform, sampleInt } from "./param_ranges.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TYPE_SHORTS = {
  PonziScheme:     "ponzi",
  RugPull:         "rugpull",
  MoneyLaundering: "laundering",
  PumpDump:        "pumpdump",
  Normal:          "normal"
};

const CONTRACT_MAP = {
  PonziScheme:     "PonziLab",
  RugPull:         "RugPull",
  MoneyLaundering: "MoneyLaundering",
  PumpDump:        "PumpDump",
  Normal:          "NormalStaking"
};

function computeExpectedSignals(fraudType) {
  switch (fraudType) {
    case "PonziScheme":
      return { BALANCE_DROP: true, FLOW_SPIKE: true, MAX_TX_ALERT: true };
    case "RugPull":
      return { BALANCE_DROP: true, FLOW_SPIKE: true, MAX_TX_ALERT: true };
    case "MoneyLaundering":
      return { BALANCE_DROP: true, PARTICIPANT_ASYMMETRY: true };
    case "PumpDump":
      return { BALANCE_DROP: true, FLOW_SPIKE: true, INSIDER_DRAIN: true };
    case "Normal":
      return { BALANCE_DROP: false, FLOW_SPIKE: false, MAX_TX_ALERT: false };
    default:
      return {};
  }
}

function sampleParams(fraudType) {
  const ranges = PARAM_RANGES[fraudType];
  const params = {};
  for (const [key, range] of Object.entries(ranges)) {
    if (Number.isInteger(range.min) && Number.isInteger(range.max)) {
      params[key] = sampleInt(range);
    } else {
      params[key] = parseFloat(sampleUniform(range).toFixed(3));
    }
  }
  return params;
}

function generateScenario(fraudType, index) {
  const short = TYPE_SHORTS[fraudType];
  const scenario_id = `${short}_${String(index + 1).padStart(3, "0")}`;
  const params = sampleParams(fraudType);
  const expected_signals = computeExpectedSignals(fraudType);
  const label = fraudType === "Normal" ? 0 : 1;

  return {
    scenario_id,
    fraud_type: fraudType,
    contract: CONTRACT_MAP[fraudType],
    label,
    params,
    expected_signals,
    generated_at: new Date().toISOString()
  };
}

function main() {
  const args = process.argv.slice(2);
  const countIdx = args.indexOf("--count");
  const count = countIdx !== -1 ? parseInt(args[countIdx + 1]) : 10;

  const outDir = path.join(__dirname, "generated");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const fraudTypes = Object.keys(PARAM_RANGES);
  const counts = {};

  for (const fraudType of fraudTypes) {
    counts[fraudType] = 0;
    for (let i = 0; i < count; i++) {
      const scenario = generateScenario(fraudType, i);
      const outPath = path.join(outDir, `${scenario.scenario_id}.json`);
      fs.writeFileSync(outPath, JSON.stringify(scenario, null, 2));
      counts[fraudType]++;
    }
  }

  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  console.log(`Total scenarios: ${total}`);
  const summary = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ");
  console.log(summary);
}

main();
