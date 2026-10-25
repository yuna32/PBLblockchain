// 사람이 실행하는 EAS(Sepolia) 스크립트. 저장소 루트에서:
//   npm run demo:eas:check                       읽기 전용 점검 (트랜잭션 없음)
//   npm run demo:eas:register                    스키마가 없을 때만 등록 (트랜잭션 1건)
//   npm run demo:eas:record-fixtures [-- --force] demo/fixtures 5개 리포트를 기록하고 attestations.sepolia.json에 저장
// 공통 옵션: --yes (확인 프롬프트 없이 진행), --fixtures-dir <dir>, --out <file>, --poll-ms <ms>
// 설정은 .env(npm 스크립트가 --env-file-if-exists로 읽음)의 DEMO_EAS_* (demo/lib/attest/config.js).
// 키와 RPC 주소는 출력하지 않는다(모든 출력은 redact를 거친다). 종료 코드: 0 정상, 1 실패·불일치, 3 취소.
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import { formatEther } from "viem";
import { SCENARIOS, FIXTURES_DIR } from "../run.js";
import { toTimeseries } from "../lib/timeseries.js";
import { easConfigFromEnv, EAS_FIXTURES_BASENAME } from "../lib/attest/config.js";
import { createEasBackend } from "../lib/attest/eas.js";
import { reportHash } from "../lib/attest/jcs.js";
import { buildPayload, SCHEMA } from "../lib/attest/schema.js";
import { analyzerVersion } from "../lib/attest/version.js";
import { redact } from "../lib/attest/redact.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const COMMANDS = ["check", "register", "record-fixtures"];
const EXIT = { ok: 0, fail: 1, cancelled: 3 };

function parseArgs(argv) {
  const out = { command: argv[0], yes: false, force: false, fixturesDir: FIXTURES_DIR, outFile: null, pollMs: 4000 };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--force") out.force = true;
    else if (a === "--fixtures-dir") out.fixturesDir = path.resolve(argv[++i]);
    else if (a === "--out") out.outFile = path.resolve(argv[++i]);
    else if (a === "--poll-ms") out.pollMs = Number(argv[++i]);
    else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  out.outFile ??= path.join(out.fixturesDir, EAS_FIXTURES_BASENAME);
  return out;
}

const config = easConfigFromEnv(process.env);
const secrets = [config.rpcUrl, config.privateKey];
const say = (...parts) => console.log(redact(parts.join(" "), secrets));
const eth = wei => `${formatEther(wei)} ETH`;

function table(rows) {
  const width = i => Math.max(...rows.map(r => String(r[i]).length));
  const w = [0, 1].map(width);
  for (const r of rows) say(`  ${String(r[0]).padEnd(w[0])}  ${String(r[1]).padEnd(w[1])}  ${r[2] ?? ""}`.trimEnd());
}

async function confirm(args, question) {
  if (args.yes) {
    say(`${question} → --yes로 진행합니다.`);
    return true;
  }
  if (!process.stdin.isTTY) {
    say("확인 프롬프트를 띄울 수 없습니다(대화형 터미널이 아님). 진행하려면 --yes를 붙이세요.");
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(r => rl.question(`${question} [y/N] `, r));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function readFixture(dir, name) {
  const read = f => fs.readFileSync(path.join(dir, name, f), "utf8");
  return { report: JSON.parse(read("report.json")), envelope: JSON.parse(read("envelope.json")), rows: toTimeseries(read(SCENARIOS[name].csv)) };
}

function readRecords(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// 시나리오 순서로, 비밀 정보 없는 필드만 저장한다. 중간에 실패해도 그때까지의 기록이 남도록 매번 원자적으로 쓴다.
function writeRecords(file, records) {
  const ordered = Object.fromEntries(Object.keys(SCENARIOS).filter(n => records[n]).map(n => [n, records[n]]));
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(ordered, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function header(args, backend) {
  say(`EAS 스크립트: ${args.command}`);
  table([
    ["RPC", config.rpcUrl ? "설정됨" : "없음", "(주소는 표시하지 않음)"],
    ["체인 ID(설정)", config.chainId, ""],
    ["EAS", config.easAddress, ""],
    ["SchemaRegistry", config.registryAddress, ""],
    ["계정", backend.attester ?? "없음", backend.attester ? "(DEMO_EAS_PRIVATE_KEY 있음, 키는 표시하지 않음)" : "(읽기 전용)"],
    ["스키마 UID(계산)", backend.schemaUID, ""]
  ]);
}

function probeRows(p) {
  const mark = v => (v === true ? "OK" : v === false ? "실패" : "-");
  const rows = [
    ["RPC 연결", mark(p.rpc), p.error ?? ""],
    ["체인 ID 일치", mark(p.chainMatch), p.chainId === null ? "" : `RPC ${p.chainId} / 설정 ${config.chainId}`],
    ["EAS 컨트랙트 코드", mark(p.easCode), ""],
    ["SchemaRegistry 코드", mark(p.registryCode), ""],
    ["스키마 등록", p.schemaRegistered === null ? "-" : p.schemaRegistered ? "등록됨" : "미등록", p.schemaRegistered === false ? "npm run demo:eas:register" : ""]
  ];
  if (p.balance !== null) rows.push(["계정 잔액", eth(p.balance), ""]);
  return rows;
}

const chainReady = p => p.rpc && p.chainMatch && p.easCode && p.registryCode;

async function check(args, backend) {
  say("할 일: 읽기 전용 점검 (트랜잭션 없음, 필요 잔액 0 ETH)");
  if (!(await confirm(args, "점검을 시작할까요?"))) return EXIT.cancelled;
  const p = await backend.probe();
  const rows = probeRows(p);
  let failed = !chainReady(p) || p.schemaRegistered === false;
  const stale = [];

  const records = fs.existsSync(args.outFile) ? readRecords(args.outFile) : null;
  if (!records) {
    rows.push(["사전 기록 파일", "없음", `${path.basename(args.outFile)} — npm run demo:eas:record-fixtures`]);
  } else if (chainReady(p)) {
    for (const name of Object.keys(SCENARIOS)) {
      const entry = records[name];
      if (!entry) { rows.push([`기록 ${name}`, "없음", "record-fixtures로 기록"]); failed = true; continue; }
      if (entry.chainId !== config.chainId || String(entry.contract).toLowerCase() !== config.easAddress.toLowerCase()) {
        rows.push([`기록 ${name}`, "다른 체인", `chainId ${entry.chainId}, EAS ${entry.contract}`]); failed = true; continue;
      }
      let onChain;
      try {
        onChain = await backend.read(entry.uid);
      } catch (err) {
        rows.push([`기록 ${name}`, "조회 실패", redact(err.message, secrets)]); failed = true; continue;
      }
      if (!onChain) { rows.push([`기록 ${name}`, "체인에 없음", entry.uid]); failed = true; continue; }
      if (!onChain.payload) { rows.push([`기록 ${name}`, "스키마 다름", entry.uid]); failed = true; continue; }
      const current = `0x${reportHash(readFixture(args.fixturesDir, name).report)}`;
      const chainHash = onChain.payload.reportHash;
      if (chainHash !== String(entry.reportHash).toLowerCase()) {
        rows.push([`기록 ${name}`, "파일과 체인 다름", `파일 ${String(entry.reportHash).slice(0, 10)} / 체인 ${chainHash.slice(0, 10)}`]); failed = true;
      } else if (chainHash !== current) {
        rows.push([`기록 ${name}`, "불일치", `체인 ${chainHash.slice(0, 10)} / 현재 fixture ${current.slice(0, 10)}`]); failed = true; stale.push(name);
      } else {
        rows.push([`기록 ${name}`, "일치", `uid ${entry.uid.slice(0, 10)}…, reportHash ${chainHash.slice(0, 10)}`]);
      }
    }
  }
  table(rows);
  if (stale.length) {
    say("");
    say(`주의: fixture 리포트가 기록한 뒤 바뀌었습니다 (${stale.join(", ")}). 체인의 reportHash와 지금 fixture의 해시가 달라 검증이 불일치로 나옵니다.`);
    say("Sepolia 기록은 지울 수 없습니다. fixture를 확정(freeze)한 뒤 다시 기록하세요(새 UID, 수수료 발생):");
    say("  npm run demo:eas:record-fixtures -- --force");
  }
  say(failed ? "결과: 확인이 필요한 항목이 있습니다." : "결과: 모두 정상입니다.");
  return failed ? EXIT.fail : EXIT.ok;
}

async function register(args, backend) {
  if (!backend.attester) { say("DEMO_EAS_PRIVATE_KEY가 없어 등록할 수 없습니다(읽기 전용)."); return EXIT.fail; }
  const p = await backend.probe();
  table(probeRows(p));
  if (!chainReady(p)) { say("연결 점검에 실패해 등록하지 않습니다."); return EXIT.fail; }
  if (p.schemaRegistered) {
    say(`스키마가 이미 등록되어 있습니다. 보내지 않습니다. 스키마 UID: ${backend.schemaUID}`);
    return EXIT.ok;
  }
  const est = await backend.estimateRegisterCost();
  say(`할 일: SchemaRegistry.register 트랜잭션 1건 (스키마 "${SCHEMA}", resolver 없음, revocable)`);
  say(`예상 가스 ${est.gas}, 필요 잔액 약 ${eth(est.cost)} (현재 ${eth(p.balance)})`);
  if (p.balance < est.cost) { say("잔액이 부족해 등록하지 않습니다."); return EXIT.fail; }
  if (!(await confirm(args, "스키마를 등록할까요?"))) { say("취소했습니다."); return EXIT.cancelled; }
  const r = await backend.register();
  say(r.alreadyRegistered ? `이미 등록되어 있었습니다. 스키마 UID: ${r.schemaUID}` : `등록했습니다. 스키마 UID: ${r.schemaUID}, tx ${r.txHash}`);
  say(`스키마 화면: ${backend.schemaUrl().replace(config.explorerBase, "<탐색기>")}`);
  return EXIT.ok;
}

async function recordFixtures(args, backend) {
  if (!backend.attester) { say("DEMO_EAS_PRIVATE_KEY가 없어 기록할 수 없습니다(읽기 전용)."); return EXIT.fail; }
  const p = await backend.probe();
  table(probeRows(p));
  if (!chainReady(p)) { say("연결 점검에 실패해 기록하지 않습니다."); return EXIT.fail; }
  if (!p.schemaRegistered) { say("스키마가 등록되지 않았습니다. 먼저 npm run demo:eas:register를 실행하세요."); return EXIT.fail; }

  const version = analyzerVersion(PROJECT_ROOT);
  const existing = readRecords(args.outFile) ?? {};
  const plan = [];
  for (const name of Object.keys(SCENARIOS)) {
    const { report, envelope, rows } = readFixture(args.fixturesDir, name);
    const current = reportHash(report);
    if (current !== envelope.report_sha256) { say(`${name}: report.json과 envelope.json의 해시가 다릅니다. fixture를 다시 만든 뒤 실행하세요.`); return EXIT.fail; }
    const payload = buildPayload({ report, envelope, rows, analyzerVersion: version });
    const prev = existing[name];
    const sameChain = prev && prev.chainId === config.chainId && String(prev.contract).toLowerCase() === config.easAddress.toLowerCase();
    let skip = false;
    if (sameChain && prev.reportHash === payload.reportHash && !args.force) {
      skip = Boolean(await backend.read(prev.uid).catch(() => null));
    }
    plan.push({ name, payload, skip, reason: skip ? "이미 기록됨 (같은 reportHash)" : prev && sameChain ? (args.force ? "--force" : "해시가 바뀜 또는 체인에 없음") : "새로 기록" });
  }
  const todo = plan.filter(x => !x.skip);
  table(plan.map(x => [x.name, x.skip ? "건너뜀" : "기록", x.reason]));
  if (!todo.length) { say("기록할 것이 없습니다. 다시 기록하려면 --force를 붙이세요."); return EXIT.ok; }

  const est = await backend.estimateAttestCost(todo[0].payload);
  const total = est.cost * BigInt(todo.length);
  say(`할 일: EAS.attest 트랜잭션 ${todo.length}건 (영구 기록), 결과는 ${path.relative(PROJECT_ROOT, args.outFile)}에 저장`);
  say(`예상 가스 건당 ${est.gas}, 필요 잔액 약 ${eth(total)} (현재 ${eth(p.balance)})`);
  if (p.balance < total) { say("잔액이 부족해 기록하지 않습니다."); return EXIT.fail; }
  say("주의: Sepolia 기록은 지울 수 없습니다. fixture를 확정(freeze)한 뒤 기록하세요.");
  if (!(await confirm(args, `${todo.length}건을 기록할까요?`))) { say("취소했습니다."); return EXIT.cancelled; }

  const records = { ...existing };
  for (const x of todo) {
    const r = await backend.attest(x.payload);
    records[x.name] = {
      scenario: x.name, uid: r.uid, txHash: r.txHash, chainId: r.chainId, attester: r.attester, schemaUID: r.schemaUID,
      contract: r.contract, blockNumber: r.blockNumber, recordedAt: r.recordedAt, reportHash: x.payload.reportHash, payload: x.payload
    };
    writeRecords(args.outFile, records);
    say(`  ${x.name}: uid ${r.uid}, 블록 ${r.blockNumber}`);
  }
  say(`저장했습니다: ${path.relative(PROJECT_ROOT, args.outFile)} (${todo.length}건 기록, ${plan.length - todo.length}건 건너뜀)`);
  return EXIT.ok;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!COMMANDS.includes(args.command)) {
    say(`사용법: node demo/scripts/eas.js <${COMMANDS.join("|")}> [--yes] [--force] [--fixtures-dir <dir>] [--out <file>]`);
    return EXIT.fail;
  }
  if (!config.configured) { say("DEMO_EAS_RPC_URL이 없습니다. .env에 설정하세요 (.env.example 참고)."); return EXIT.fail; }
  if (config.errors.length) { say(`설정 오류: ${config.errors.join("; ")}`); return EXIT.fail; }
  const backend = createEasBackend(config, { pollingIntervalMs: args.pollMs });
  header(args, backend);
  if (args.command === "check") return check(args, backend);
  if (args.command === "register") return register(args, backend);
  return recordFixtures(args, backend);
}

main().then(code => { process.exitCode = code; }, err => {
  // 스택에는 내부 경로와 요청 정보가 들어갈 수 있어 메시지만 가려서 출력한다
  console.error(redact(`실패: ${err?.code ? `[${err.code}] ` : ""}${err?.shortMessage ?? err?.message ?? err}`, secrets));
  process.exitCode = EXIT.fail;
});
