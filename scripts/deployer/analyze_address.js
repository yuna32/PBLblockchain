// 실주소 분석: 아무 이더리움 컨트랙트 주소를 넣으면 배포자를 찾아 배포자 위험 점수를 계산한다.
//
// 실행(저장소 루트):
//   node --env-file=.env scripts/deployer/analyze_address.js 0x컨트랙트주소 [0x주소 ...] [--at now|deploy] [--no-goplus]
//   --at now    (기본) 지금까지의 배포자 이력 + GoPlus 현재 정보로 분석 ("지금 이 컨트랙트에 돈을 넣어도 되나")
//   --at deploy 그 컨트랙트를 배포하기 직전까지의 이력만으로 분석 (배포 시점 재현, GoPlus는 쓰지 않음)
// 출력: 화면 요약 + evaluation/deployer_risk/analyzed/<주소>_<now|deploy>.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireKey, getContractCreation } from "./etherscan.js";
import { collectFacts } from "./collect.js";
import { scoreDeployer } from "./score.js";
import { loadKnownBad } from "./knowledge.js";
import { loadLabels } from "./build_demo.js";
import { RULES_VERSION } from "./config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "evaluation/deployer_risk");
const CACHE = path.join(DIR, "cache");
const OUT = path.join(DIR, "analyzed");
const LEVEL_KO = { strong: "강한 근거", some: "근거 있음", none: "근거 없음", nodata: "데이터 없음" };

async function main() {
  const args = process.argv.slice(2);
  const at = args.includes("--at") ? args[args.indexOf("--at") + 1] : "now";
  const useGoplus = !args.includes("--no-goplus") && at === "now";
  const addrs = args.filter(a => /^0x[0-9a-fA-F]{40}$/.test(a)).map(a => a.toLowerCase());
  if (!addrs.length || !["now", "deploy"].includes(at)) {
    console.error("사용법: node --env-file=.env scripts/deployer/analyze_address.js 0x컨트랙트주소 [--at now|deploy] [--no-goplus]");
    process.exit(1);
  }
  requireKey();
  const cand = JSON.parse(fs.readFileSync(path.join(DIR, "candidates.json"), "utf8"));
  const knownBad = loadKnownBad(ROOT, cand.contracts);
  const labels = loadLabels();
  fs.mkdirSync(OUT, { recursive: true });

  for (let i = 0; i < addrs.length; i += 5) {
    const batch = addrs.slice(i, i + 5);
    const created = await getContractCreation(batch);
    const byAddr = new Map(created.map(r => [String(r.contractAddress).toLowerCase(), r]));
    for (const contract of batch) {
      const cr = byAddr.get(contract);
      if (!cr) { console.log(`\n${contract}\n  컨트랙트 생성 정보가 없습니다 (일반 지갑이거나 잘못된 주소)`); continue; }
      const deployer = String(cr.contractCreator).toLowerCase();
      const asOfBlock = at === "deploy" ? cr.blockNumber : 999999999;
      const asOfTimestamp = at === "deploy" ? cr.timestamp : Math.floor(Date.now() / 1000);
      const reason = at === "deploy"
        ? "실제 컨트랙트의 배포자를, 그 컨트랙트를 배포하기 직전까지의 기록만으로 분석했습니다."
        : "실제 컨트랙트의 배포자를, 지금까지의 기록과 보안 서비스의 현재 정보로 분석했습니다.";
      const facts = await collectFacts({ deployer, contract, asOfBlock, asOfTimestamp, reason }, labels, CACHE, knownBad,
        { historical: at === "deploy", goplus: useGoplus });
      if (at === "now" && facts.asOf) facts.asOf.date = new Date().toISOString().slice(0, 10);
      const result = scoreDeployer(facts);
      if (at === "now" && result.scope) result.scope.as_of = `${facts.asOf.date} (지금)`;
      fs.writeFileSync(path.join(OUT, `${contract}_${at}.json`), JSON.stringify({ contract, at, rules: RULES_VERSION, facts, result }, null, 2) + "\n");
      console.log(`\n${contract}  (배포자 ${deployer}, ${at === "deploy" ? "배포 시점" : "지금"} 기준)`);
      console.log(`  ${LEVEL_KO[result.level]} · 점수 ${result.score ?? "—"}`);
      if (result.summary) console.log(`  ${result.summary}`);
      for (const e of result.evidence ?? []) console.log(`  - [${e.strength === "strong" ? "강" : "약"}] ${e.text}  (출처: ${e.source})`);
      if (facts.activity) console.log(`  활동 ${facts.activity.days}일, 거래 ${facts.activity.txCount}건, 이전 배포 ${facts.pastDeployments?.length ?? "-"}개, 첫 자금원 ${facts.firstFunding?.category ?? "-"}`);
      for (const x of facts.failures ?? []) console.log(`  ! ${x}`);
    }
  }
  console.log(`\n저장: ${path.relative(ROOT, OUT)}/`);
}

main().catch(err => { console.error("[실패]", err.message); process.exit(1); });
