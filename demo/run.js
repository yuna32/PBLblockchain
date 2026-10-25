// 시연용 시나리오 실행: 시뮬레이션(hardhat 하위 프로세스) → buildReport → envelope를 outDir에 쓴다.
// 시뮬레이션이 실패하면(Node 버전 미달, 비정상 종료, 시간 초과, CSV 미생성) demo/fixtures/<scenario>/의
// CSV로 대신 분석하고 결과에 source: "fixture"를 표시한다. 요청 직렬 처리는 서버(2단계)가 맡는다.
//
// CLI: node demo/run.js <scenario> <outDir>

import fs from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { buildReport } from "../analysis/pipeline.js";
import { buildEnvelope } from "./lib/canonical.js";
import { parseCsv } from "./lib/csv.js";
import { computeOnset } from "./lib/onset.js";

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
export const FIXTURES_DIR = path.join(__dirname, "fixtures");

export const SCENARIOS = {
  normal:     { contract: "NormalStaking",   script: "scripts/simulate_normal.js",     csv: "normal_log.csv"     },
  ponzi:      { contract: "PonziLab",        script: "scripts/simulate_ponzi.js",      csv: "ponzi_log.csv"      },
  rugpull:    { contract: "RugPull",         script: "scripts/simulate_rugpull.js",    csv: "rugpull_log.csv"    },
  laundering: { contract: "MoneyLaundering", script: "scripts/simulate_laundering.js", csv: "laundering_log.csv" },
  pumpdump:   { contract: "PumpDump",        script: "scripts/simulate_pumpdump.js",   csv: "pumpdump_log.csv"   },
};

// laundering 금액을 고정하는 시드. fixtures도 같은 시드로 만들었다.
export const DEFAULT_SEED = "pbl-demo";
// hardhat 3이 요구하는 최소 Node 버전
export const MIN_NODE = [22, 10, 0];

function hardhatCli() {
  const pkgDir = path.join(PROJECT_ROOT, "node_modules", "hardhat");
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.hardhat;
  return path.join(pkgDir, bin);
}

export function checkNode(nodeBin) {
  const r = spawnSync(nodeBin, ["-v"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    return { ok: false, version: null, message: `Node 실행 실패 (${nodeBin}): ${r.error?.message ?? r.stderr}` };
  }
  const version = r.stdout.trim();
  const nums = version.replace(/^v/, "").split(".").map(Number);
  let ok = true;
  for (let i = 0; i < 3; i++) {
    if (nums[i] !== MIN_NODE[i]) { ok = nums[i] > MIN_NODE[i]; break; }
  }
  const message = ok ? null
    : `현재 Node(${version})로는 hardhat을 실행할 수 없습니다 (${MIN_NODE.join(".")} 이상 필요). ` +
      `저장소 루트에서 "nvm use"(.nvmrc: 22)로 바꾼 뒤 다시 실행하세요.`;
  return { ok, version, message };
}

// 하위 프로세스(hardhat)에 넘기지 않을 환경변수: 키, 니모닉, RPC, 온체인 기록 설정.
// 서버를 .env로 띄울 때 이 값들이 시뮬레이션 프로세스로 새지 않게 한다.
export const SECRET_ENV_PATTERN = /PRIVATE_KEY|MNEMONIC|RPC|EAS_|DEMO_ATTEST_/i;

export function sanitizeEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !SECRET_ENV_PATTERN.test(name)));
}

function runHardhat(nodeBin, script, env, timeoutMs) {
  return new Promise(resolve => {
    const child = spawn(nodeBin, [hardhatCli(), "run", script], { cwd: PROJECT_ROOT, env });
    let out = "";
    child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { out += d; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", err => { clearTimeout(timer); resolve({ code: null, timedOut, output: out + String(err) }); });
    child.on("close", code => { clearTimeout(timer); resolve({ code, timedOut, output: out }); });
  });
}

function tail(text, n = 5) {
  return text.trim().split("\n").slice(-n).join("\n");
}

// options.seed: DEMO_SEED (기본 DEFAULT_SEED), options.nodeBin: 시뮬레이션에 쓸 node (기본 현재 프로세스),
// options.timeoutMs: 시뮬레이션 제한 시간, options.allowFallback: false면 시뮬레이션 실패 시 오류를 던진다.
// options.onStage(stage, info): 단계가 바뀔 때 호출 ("simulate" → "analyze" → "hash"). analyze/hash에는 { source }.
export async function runScenario(name, outDir, options = {}) {
  const spec = SCENARIOS[name];
  if (!spec) throw new Error(`알 수 없는 시나리오: ${name} (가능한 값: ${Object.keys(SCENARIOS).join(", ")})`);
  const {
    seed = DEFAULT_SEED,
    nodeBin = process.execPath,
    timeoutMs = 60000,
    allowFallback = true,
    onStage = () => {}
  } = options;

  outDir = path.resolve(outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, spec.csv);
  fs.rmSync(csvPath, { force: true });

  // ── 1. 시뮬레이션 (live) ──
  onStage("simulate", {});
  let liveError = null;
  const node = checkNode(nodeBin);
  if (!node.ok) {
    liveError = node.message;
  } else {
    const env = { ...sanitizeEnv(process.env), DEMO_LOG_DIR: outDir, DEMO_SEED: seed };
    const r = await runHardhat(nodeBin, spec.script, env, timeoutMs);
    if (r.timedOut) liveError = `시뮬레이션 시간 초과 (${timeoutMs} ms)`;
    else if (r.code !== 0) liveError = `시뮬레이션 비정상 종료 (code ${r.code}):\n${tail(r.output)}`;
    else if (!fs.existsSync(csvPath)) liveError = `시뮬레이션이 CSV를 만들지 않음 (${spec.csv}):\n${tail(r.output)}`;
  }

  // ── 2. 실패 시 fixtures 폴백 ──
  let source = "live";
  let usedSeed = seed;
  if (liveError) {
    if (!allowFallback) throw new Error(`[${name}] ${liveError}`);
    const fixtureDir = path.join(FIXTURES_DIR, name);
    const fixtureCsv = path.join(fixtureDir, spec.csv);
    if (!fs.existsSync(fixtureCsv)) {
      throw new Error(`[${name}] ${liveError}\nfixture도 없음: ${fixtureCsv}`);
    }
    fs.copyFileSync(fixtureCsv, csvPath);
    source = "fixture";
    const fixtureEnvelope = path.join(fixtureDir, "envelope.json");
    usedSeed = fs.existsSync(fixtureEnvelope)
      ? JSON.parse(fs.readFileSync(fixtureEnvelope, "utf8")).input?.seed ?? null
      : null;
  }

  // ── 3. 분석과 envelope ──
  onStage("analyze", { source });
  const { report, solPath } = await buildReport(spec.contract, { csvPath });
  const csvText = fs.readFileSync(csvPath, "utf8");
  const solText = fs.readFileSync(solPath, "utf8");
  onStage("hash", { source });
  const envelope = buildEnvelope({
    scenario: name,
    contract: spec.contract,
    source,
    report,
    csvText,
    csvFile: spec.csv,
    solText,
    solFile: path.basename(solPath),
    seed: usedSeed
  });
  const onset = computeOnset(parseCsv(csvText), report.dynamic);

  const files = {
    csv:      csvPath,
    report:   path.join(outDir, "report.json"),
    envelope: path.join(outDir, "envelope.json")
  };
  fs.writeFileSync(files.report, JSON.stringify(report, null, 2));
  fs.writeFileSync(files.envelope, JSON.stringify(envelope, null, 2));

  return {
    scenario: name,
    contract: spec.contract,
    source,
    fallback_reason: liveError,
    node: node.version,
    outDir,
    files,
    envelope,
    report,
    onset
  };
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const [name, outDir] = process.argv.slice(2);
  if (!name || !outDir) {
    console.error(`사용법: node demo/run.js <${Object.keys(SCENARIOS).join("|")}> <outDir>`);
    process.exit(1);
  }
  runScenario(name, outDir)
    .then(r => {
      console.log(JSON.stringify({
        scenario: r.scenario, source: r.source, fallback_reason: r.fallback_reason,
        report_sha256: r.envelope.report_sha256, onset: r.onset, files: r.files
      }, null, 2));
    })
    .catch(err => { console.error(err.message); process.exit(1); });
}
