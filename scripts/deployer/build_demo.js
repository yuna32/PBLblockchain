// 2·3단계: 시연용 실제 사례 배포자를 수집·계산하고, 대시보드가 읽는 파일을 만든다.
//
// 입력  evaluation/deployer_risk/demo_cases.json, candidates.json(1단계 결과), XBlock Ponzi_label.csv
// 출력  evaluation/deployer_risk/results/<id>.json         사실값과 계산 결과(검토용)
//       dashboard/src/lib/deployerRiskData.js             scenario가 정해진 사례만(자동 생성 파일)
//
// 실행(저장소 루트): node --env-file=.env scripts/deployer/build_demo.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireKey, getContractCreation } from "./etherscan.js";
import { collectFacts } from "./collect.js";
import { loadKnownBad } from "./knowledge.js";
import { scoreDeployer } from "./score.js";
import { RULES_VERSION } from "./config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "evaluation/deployer_risk");
const CACHE = path.join(DIR, "cache");
const OUT_JS = path.join(ROOT, "dashboard/src/lib/deployerRiskData.js");

export function loadLabels() {
  const csv = fs.readFileSync(path.join(ROOT, "evaluation/ponzi_comparison/data/Ponzi_label.csv"), "utf8").split(/\r?\n/).slice(1);
  const m = new Map();
  for (const line of csv) {
    const [a, p] = line.split(",").map(s => (s ?? "").trim());
    if (!/^0x[0-9a-fA-F]{40}$/.test(a ?? "")) continue;
    if (p === "1") m.set(a.toLowerCase(), "scam");
    else if (p === "0") m.set(a.toLowerCase(), "normal");
  }
  return m;
}

async function creationOf(contract, candidates) {
  const c = candidates.get(contract);
  if (c?.deployer && c.blockNumber && c.timestamp) return c;
  const [r] = await getContractCreation([contract]);
  if (!r) throw new Error(`생성 정보 없음: ${contract}`);
  return { deployer: String(r.contractCreator).toLowerCase(), blockNumber: r.blockNumber, timestamp: r.timestamp };
}

async function main() {
  requireKey();
  const { cases } = JSON.parse(fs.readFileSync(path.join(DIR, "demo_cases.json"), "utf8"));
  const cand = JSON.parse(fs.readFileSync(path.join(DIR, "candidates.json"), "utf8"));
  // 생성 정보는 XBlock(candidates.json)과 외부 데이터(candidates_<name>.json)에서 찾는다. 근거 지식은 XBlock·해킹 주소만
  const candidates = new Map();
  for (const f of fs.readdirSync(DIR).filter(f => /^candidates(_[a-z_]+)?\.json$/.test(f)))
    for (const c of JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")).contracts ?? []) if (!candidates.has(c.address)) candidates.set(c.address, c);
  const labels = loadLabels();
  const knownBad = loadKnownBad(ROOT, cand.contracts);
  fs.mkdirSync(path.join(DIR, "results"), { recursive: true });

  const byScenario = {};
  for (const k of cases) {
    const contract = k.contract.toLowerCase();
    const cr = await creationOf(contract, candidates);
    const facts = await collectFacts({ deployer: cr.deployer, contract, asOfBlock: cr.blockNumber, asOfTimestamp: cr.timestamp, reason: k.reason }, labels, CACHE, knownBad, { historical: true });
    const result = scoreDeployer(facts);
    fs.writeFileSync(path.join(DIR, "results", `${k.id}.json`), JSON.stringify({ id: k.id, rules: RULES_VERSION, facts, result }, null, 2) + "\n");
    const ev = result.evidence?.map(e => `${e.strength === "strong" ? "강" : "약"}:${e.indicator_key}`).join(", ") || "근거 없음";
    console.log(`${k.id.padEnd(14)} ${result.level.padEnd(6)} 점수 ${String(result.score ?? "-").padStart(3)}  활동 ${facts.activity?.days ?? "-"}일, 거래 ${facts.activity?.txCount ?? "-"}건, 과거 배포 ${facts.pastDeployments?.length ?? "-"}개  [${ev}]`);
    if (k.scenario) byScenario[k.scenario] = result;
  }

  const js = [
    "// 자동 생성 파일: scripts/deployer/build_demo.js가 만든다. 직접 고치지 말고 스크립트를 다시 실행한다.",
    "// 시연 시나리오별로 보여 줄 \"같은 유형의 실제 사례\" 배포자 분석 결과(lib/risk.js normalizeRisk 입력 형식).",
    `// 기준: ${RULES_VERSION}`,
    `export const DEPLOYER_RISK_RULES = ${JSON.stringify(RULES_VERSION)};`,
    `export const DEPLOYER_RISK_BY_SCENARIO = ${JSON.stringify(byScenario, null, 2)};`,
    ""
  ].join("\n");
  fs.writeFileSync(OUT_JS, js);
  console.log(`\n대시보드 연결: ${Object.keys(byScenario).join(", ") || "없음"} → ${path.relative(ROOT, OUT_JS)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(err => { console.error("[실패]", err.message); process.exit(1); });
}
