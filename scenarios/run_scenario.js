import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const TYPE_SCRIPT_MAP = {
  PonziScheme:     "scripts/simulate_ponzi.js",
  RugPull:         "scripts/simulate_rugpull.js",
  MoneyLaundering: "scripts/simulate_laundering.js",
  PumpDump:        "scripts/simulate_pumpdump.js",
  Normal:          "scripts/simulate_normal.js"
};

const TYPE_CSV_MAP = {
  PonziScheme:     "ponzi_log.csv",
  RugPull:         "rugpull_log.csv",
  MoneyLaundering: "laundering_log.csv",
  PumpDump:        "pumpdump_log.csv",
  Normal:          "normal_log.csv"
};

function buildEnv(fraudType, params) {
  const env = { ...process.env };
  const set = (k, v) => { if (v !== undefined && v !== null) env[k] = String(v); };

  set("SCENARIO_PARTICIPANTS",          params.participant_count ?? params.depositor_count);
  set("SCENARIO_DEPOSIT_MIN",           params.deposit_eth_min   ?? params.stake_eth_min);
  set("SCENARIO_DEPOSIT_MAX",           params.deposit_eth_max   ?? params.stake_eth_max);
  set("SCENARIO_REWARD_RATE",           params.reward_rate);
  set("SCENARIO_EARLY_EXIT_RATIO",      params.early_exit_ratio);
  set("SCENARIO_OWNER_WITHDRAW_RATIO",  params.owner_withdraw_at_ratio);
  set("SCENARIO_DUMP_DELAY_BLOCKS",     params.dump_delay_blocks);
  set("SCENARIO_INSIDER_COUNT",         params.insider_count);
  set("SCENARIO_LATECOMER_COUNT",       params.latecomer_count);
  set("SCENARIO_INSIDER_DEPOSIT_RATIO", params.insider_deposit_ratio);
  set("SCENARIO_STAKE_DURATION",        params.stake_duration_blocks);
  set("SCENARIO_COLLECTOR_COUNT",       params.collector_count);
  set("SCENARIO_COLLECT_AFTER_RATIO",   params.collect_after_ratio);

  return env;
}

export function runScenario(scenarioId) {
  const scenarioPath = path.join(__dirname, "generated", `${scenarioId}.json`);
  const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));

  const script = TYPE_SCRIPT_MAP[scenario.fraud_type];
  if (!script) throw new Error(`Unknown fraud_type: ${scenario.fraud_type}`);

  const env = buildEnv(scenario.fraud_type, scenario.params);
  const hardhat = path.join(PROJECT_ROOT, "node_modules", ".bin", "hardhat");

  execSync(`"${hardhat}" run ${script}`, {
    cwd: PROJECT_ROOT,
    env,
    stdio: "pipe"
  });

  // Copy CSV to scenarios/logs/
  const csvName = TYPE_CSV_MAP[scenario.fraud_type];
  const srcCsv  = path.join(PROJECT_ROOT, "analysis", "logs", csvName);
  const logsDir = path.join(__dirname, "logs");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const dstCsv = path.join(logsDir, `${scenarioId}.csv`);
  if (fs.existsSync(srcCsv)) {
    fs.copyFileSync(srcCsv, dstCsv);
  }

  console.log(`Scenario ${scenarioId} complete → scenarios/logs/${scenarioId}.csv`);
  return dstCsv;
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const idx  = args.indexOf("--scenario");
  if (idx === -1 || !args[idx + 1]) {
    console.error("Usage: node scenarios/run_scenario.js --scenario <scenario_id>");
    process.exit(1);
  }
  try {
    runScenario(args[idx + 1]);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
