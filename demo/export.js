// 정적 배포용 스냅샷 내보내기: npm run demo:export
//   5개 시나리오를 서버의 fixture 경로(server/fixture_run.js runFixture)로 분석해 서버 응답과 같은 JSON을
//   dashboard/public/snapshot/에 쓴다. 새 분석 로직은 없다.
//
// 출력
//   index.json  { schemaVersion, generatedAt, sourceCommit, canonicalVersion, attestation: { chainId, explorerBase },
//                 scenarios: [{ id, label, expectedType, description, reportHash, attestStatus: "A" | "B" }], glossary }
//   <scenario>/{report, viewmodel, timeseries, ontology, canonical, envelope}.json
//   <scenario>/attestation.json  상태 A(Sepolia 기록)일 때만. 공개 값만 넣는다.
//
// 결정성 규칙 (같은 입력 → 같은 출력)
//   - 모든 JSON은 객체 키를 재귀적으로 정렬하고 2칸 들여쓰기 + 끝 줄바꿈으로 쓴다(배열 순서는 그대로).
//   - report.timestamp와 envelope.created_at(둘 다 리포트 해시에서 빠지는 값)은 실행 시각 대신 demo/fixtures의 값으로 고정한다.
//   - index.json의 generatedAt은 실행 시각이 아니라 fixture envelope.created_at 중 가장 늦은 값이다.
//   - sourceCommit은 git short HEAD(git이 없으면 --source-commit 값, 그것도 없으면 "unknown").
//   - 출력 폴더는 매번 지우고 다시 쓴다(상태가 B로 바뀐 시나리오의 옛 attestation.json이 남지 않게).
//
// 증명: demo/fixtures/attestations.sepolia.json(4c record-fixtures)에서 chainId == 11155111이고 uid·txHash 형식이 맞는
//   기록만 attestation.json으로 낸다. 그 밖(로컬 hardhat 31337 등)은 공개 사이트에서 검증할 수 없는 값이므로 빼고 로그를 남긴다.
//
// 끝에 출력물을 스스로 검사한다(있으면 실패): "alchemy", "PRIVATE_KEY", 환경 변수의 비밀 값(이름이 키·RPC 규칙에 맞는 것),
//   허용 필드(uid, txHash, schemaUID, reportHash) 밖의 0x+64자리 16진수. 위치만 출력하고 값은 출력하지 않는다.
//   .env 파일은 읽지 않는다.
//
// 사용: node demo/export.js [--out <dir>] [--attestations <file>] [--source-commit <sha>]
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { SCENARIOS, FIXTURES_DIR, SECRET_ENV_PATTERN } from "./run.js";
import { canonicalize, hashableReport, sha256Hex, CANONICAL_VERSION } from "./lib/canonical.js";
import { toTimeseries } from "./lib/timeseries.js";
import { buildViewModel } from "./lib/viewmodel.js";
import { buildOntologyGraph } from "./lib/ontologygraph.js";
import { GLOSSARY } from "./lib/glossary.js";
import { EAS_FIXTURES_BASENAME } from "./lib/attest/config.js";
import { runFixture } from "../server/fixture_run.js";
import { SCENARIO_LIST } from "../server/scenarios.js";
import { attestStatusOf, SEPOLIA_CHAIN_ID, EAS_EXPLORER_BASE } from "../dashboard/src/lib/attestStatus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
export const DEFAULT_OUT = path.join(PROJECT_ROOT, "dashboard", "public", "snapshot");
export const DEFAULT_ATTESTATIONS = path.join(FIXTURES_DIR, EAS_FIXTURES_BASENAME);
export const SNAPSHOT_SCHEMA_VERSION = 1;
const OWL_RESULTS_PATH = path.join(PROJECT_ROOT, "ontology", "owl_results.json");

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PAYLOAD_FIELDS = ["contractAddress", "reportHash", "codeRiskGrade", "trustScore", "minWalletTrustScore", "scanTimestamp", "analyzerVersion"];
// 0x+64자리 16진수가 의도된 값으로 들어갈 수 있는 필드 이름
export const HEX64_ALLOWED_KEYS = new Set(["uid", "txHash", "schemaUID", "reportHash"]);

export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeys(value[k])]));
  }
  return value;
}
const stringify = data => `${JSON.stringify(sortKeys(data), null, 2)}\n`;

function gitShortHead() {
  try {
    const top = execFileSync("git", ["-C", PROJECT_ROOT, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (fs.realpathSync(top) !== fs.realpathSync(PROJECT_ROOT)) return null;
    return execFileSync("git", ["-C", PROJECT_ROOT, "rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function loadOwlResults() {
  try {
    return JSON.parse(fs.readFileSync(OWL_RESULTS_PATH, "utf8"));
  } catch {
    return null;
  }
}

// attestations.sepolia.json의 한 시나리오 기록 → 공개 값만 담은 attestation.json, 또는 제외 사유
export function publicAttestation(name, entry, reportHashHex) {
  if (!entry || typeof entry !== "object") return { attestation: null, excluded: null };
  if (attestStatusOf(entry) !== "A") {
    const reason = entry.chainId !== SEPOLIA_CHAIN_ID ? `chainId ${entry.chainId}는 Sepolia(${SEPOLIA_CHAIN_ID})가 아님` : "uid·txHash 형식이 올바르지 않음";
    return { attestation: null, excluded: reason };
  }
  if (!HEX32.test(entry.schemaUID ?? "") || !ADDRESS.test(entry.attester ?? "") || !ADDRESS.test(entry.contract ?? "") || !entry.payload) {
    return { attestation: null, excluded: "schemaUID·attester·contract·payload 형식이 올바르지 않음" };
  }
  const payload = Object.fromEntries(PAYLOAD_FIELDS.map(f => [f, entry.payload[f]]));
  return {
    excluded: null,
    attestation: {
      scenario: name,
      uid: entry.uid,
      txHash: entry.txHash,
      chainId: entry.chainId,
      schemaUID: entry.schemaUID,
      attester: entry.attester.toLowerCase(),
      contract: entry.contract.toLowerCase(),
      blockNumber: Number.isSafeInteger(entry.blockNumber) ? entry.blockNumber : null,
      recordedAt: typeof entry.recordedAt === "string" ? entry.recordedAt : null,
      reportHash: String(entry.reportHash).toLowerCase(),
      matchesSnapshotReport: String(entry.reportHash).toLowerCase() === `0x${reportHashHex}`,
      payload,
      explorerBase: EAS_EXPLORER_BASE,
      // 탐색기의 기록 화면 경로는 문서로 확인하지 못했다 → 화면은 탐색기 주소와 UID만 보여 준다
      explorerPathVerified: false
    }
  };
}

// 출력물 자체 검사. 문제 위치 목록(값 없음)을 돌려준다.
export function scanOutput(files, env = process.env) {
  const problems = [];
  const secrets = Object.entries(env)
    .filter(([name, value]) => SECRET_ENV_PATTERN.test(name) && typeof value === "string" && value.length >= 8)
    .map(([name, value]) => ({ name, value }));
  for (const [file, text] of files) {
    if (/alchemy/i.test(text)) problems.push(`${file}: "alchemy" 문자열`);
    if (text.includes("PRIVATE_KEY")) problems.push(`${file}: "PRIVATE_KEY" 문자열`);
    for (const { name, value } of secrets) if (text.includes(value)) problems.push(`${file}: 환경 변수 ${name}의 값`);
    const walk = (v, keyPath) => {
      if (typeof v === "string") {
        if (/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/.test(v)) {
          const key = [...keyPath].reverse().find(k => typeof k === "string");
          if (!HEX64_ALLOWED_KEYS.has(key)) problems.push(`${file}: ${keyPath.join(".")} (허용 필드 밖의 0x+64자리 16진수)`);
        }
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...keyPath, i]));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...keyPath, k]);
    };
    try {
      walk(JSON.parse(text), []);
    } catch {
      problems.push(`${file}: JSON이 아님`);
    }
  }
  return problems;
}

export async function exportSnapshot({ outDir = DEFAULT_OUT, attestationsFile = DEFAULT_ATTESTATIONS, sourceCommit = null, log = console.log } = {}) {
  const commit = gitShortHead() ?? sourceCommit ?? "unknown";
  const owlResults = loadOwlResults();
  const attestations = fs.existsSync(attestationsFile) ? JSON.parse(fs.readFileSync(attestationsFile, "utf8")) : {};
  if (!fs.existsSync(attestationsFile)) log(`증명 파일 없음 (${path.relative(PROJECT_ROOT, attestationsFile)}) → 모든 시나리오 상태 B`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "pbl-export-"));
  const outputs = new Map();   // 상대 경로 → 텍스트
  const scenarios = [];
  let generatedAt = null;
  try {
    for (const meta of SCENARIO_LIST) {
      const name = meta.id;
      const fixture = n => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name, n), "utf8"));
      const fixtureReport = fixture("report.json");
      const fixtureEnvelope = fixture("envelope.json");

      await runFixture(name, path.join(work, name));
      const read = f => fs.readFileSync(path.join(work, name, f), "utf8");
      const report = JSON.parse(read("report.json"));
      const envelope = JSON.parse(read("envelope.json"));
      const csvText = read(SCENARIOS[name].csv);
      if (envelope.report_sha256 !== fixtureEnvelope.report_sha256) {
        throw new Error(`${name}: 분석 결과의 리포트 해시가 demo/fixtures와 다릅니다. 분석 코드가 바뀌었다면 fixture를 다시 만든 뒤 내보내세요.`);
      }
      // 해시에서 빠지는 실행 시각을 fixture 값으로 고정
      report.timestamp = fixtureReport.timestamp;
      envelope.created_at = fixtureEnvelope.created_at;
      if (!generatedAt || envelope.created_at > generatedAt) generatedAt = envelope.created_at;

      const rows = toTimeseries(csvText);
      const canonical = canonicalize(hashableReport(report));
      const files = {
        "report.json": report,
        "envelope.json": envelope,
        "viewmodel.json": buildViewModel({ report, envelope, rows }),
        "timeseries.json": rows,
        "ontology.json": buildOntologyGraph(report, { owlResults }),
        "canonical.json": { canonical, hash: sha256Hex(canonical) }
      };
      const { attestation, excluded } = publicAttestation(name, attestations[name], envelope.report_sha256);
      if (excluded) log(`${name}: 증명 제외 — ${excluded} (공개 사이트에서 검증할 수 없는 값이라 스냅샷에 넣지 않음)`);
      if (attestation) {
        files["attestation.json"] = attestation;
        if (!attestation.matchesSnapshotReport) log(`${name}: 경고 — Sepolia 기록의 리포트 해시가 스냅샷 리포트와 다릅니다(온체인 조회 시 불일치). fixture를 확정한 뒤 다시 기록하세요.`);
      }
      for (const [f, data] of Object.entries(files)) outputs.set(`${name}/${f}`, stringify(data));
      const status = attestation ? "A" : "B";
      scenarios.push({ ...meta, reportHash: `0x${envelope.report_sha256}`, attestStatus: status });
      log(`${name}: 상태 ${status}, 리포트 해시 ${envelope.report_sha256.slice(0, 8)}`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  outputs.set("index.json", stringify({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    sourceCommit: commit,
    canonicalVersion: CANONICAL_VERSION,
    attestation: { chainId: SEPOLIA_CHAIN_ID, explorerBase: EAS_EXPLORER_BASE },
    scenarios,
    glossary: GLOSSARY
  }));

  const problems = scanOutput(outputs);
  if (problems.length) {
    throw new Error(`출력물 자체 검사 실패 (${problems.length}건, 파일을 쓰지 않음):\n  ${problems.join("\n  ")}`);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  for (const [rel, text] of outputs) {
    const file = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  const bytes = [...outputs.values()].reduce((n, t) => n + Buffer.byteLength(t), 0);
  log(`스냅샷 ${outputs.size}개 파일, ${(bytes / 1024).toFixed(1)} KB → ${path.relative(PROJECT_ROOT, outDir) || outDir} (sourceCommit ${commit})`);
  return { files: [...outputs.keys()], bytes, scenarios, sourceCommit: commit, generatedAt };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out.outDir = path.resolve(argv[++i]);
    else if (a === "--attestations") out.attestationsFile = path.resolve(argv[++i]);
    else if (a === "--source-commit") out.sourceCommit = argv[++i];
    else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  exportSnapshot(parseArgs(process.argv.slice(2))).catch(err => {
    console.error(`내보내기 실패: ${err.message}`);
    process.exitCode = 1;
  });
}
