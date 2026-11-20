// 1단계: 라벨이 붙은 컨트랙트의 배포자를 찾고, 같은 배포자가 사기 컨트랙트를 여러 개 배포했는지 확인한다.
//
// 입력
//   - evaluation/ponzi_comparison/data/Ponzi_label.csv (XBlock): Ponzi=1 → 사기(폰지), Ponzi=0 → 정상 표본
//   - evaluation/deployer_risk/input/extra_labels.csv (선택): address,label,type,source
//       label은 scam 또는 normal, type은 rugpull 같은 유형 이름. 러그풀 라벨을 추가할 때 쓴다.
// 출력
//   - evaluation/deployer_risk/candidates.json : 컨트랙트별 배포자·생성 블록·시각
//   - evaluation/deployer_risk/candidates_summary.txt : 배포자별 집계, 사기 반복 배포자 목록
//
// 실행(저장소 루트): node --env-file=.env scripts/deployer/find_candidates.js
// 다시 실행하면 이미 찾은 컨트랙트는 건너뛴다(중간에 끊겨도 이어서 진행).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireKey, getContractCreation } from "./etherscan.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "evaluation/deployer_risk");
const PONZI_CSV = path.join(ROOT, "evaluation/ponzi_comparison/data/Ponzi_label.csv");
const EXTRA_CSV = path.join(OUT_DIR, "input/extra_labels.csv");
const OUT_JSON = path.join(OUT_DIR, "candidates.json");
const OUT_TXT = path.join(OUT_DIR, "candidates_summary.txt");
const NORMAL_SAMPLE = 300; // 정상 표본 수. 주소를 정렬해 앞에서부터 고정적으로 뽑는다(재현 가능).

const isAddr = s => /^0x[0-9a-fA-F]{40}$/.test(s);

function readCsv(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(l => l.trim());
  const head = lines.shift().split(",").map(s => s.trim());
  return lines.map(l => {
    const cells = l.split(",").map(s => s.trim());
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""]));
  });
}

function loadLabels() {
  const rows = readCsv(PONZI_CSV);
  const scam = rows.filter(r => r.Ponzi === "1" && isAddr(r.Contract))
    .map(r => ({ address: r.Contract.toLowerCase(), label: "scam", type: "ponzi", source: "XBlock Ponzi_label.csv" }));
  const normal = rows.filter(r => r.Ponzi === "0" && isAddr(r.Contract))
    .map(r => r.Contract.toLowerCase()).sort().slice(0, NORMAL_SAMPLE)
    .map(a => ({ address: a, label: "normal", type: "normal", source: "XBlock Ponzi_label.csv (Ponzi=0 표본)" }));
  const extra = fs.existsSync(EXTRA_CSV)
    ? readCsv(EXTRA_CSV).filter(r => isAddr(r.address) && ["scam", "normal"].includes(r.label))
        .map(r => ({ address: r.address.toLowerCase(), label: r.label, type: r.type || r.label, source: r.source || "extra_labels.csv" }))
    : [];
  const seen = new Map();
  for (const c of [...scam, ...extra, ...normal]) if (!seen.has(c.address)) seen.set(c.address, c);
  return [...seen.values()];
}

function loadPrevious() {
  if (!fs.existsSync(OUT_JSON)) return new Map();
  const prev = JSON.parse(fs.readFileSync(OUT_JSON, "utf8"));
  return new Map((prev.contracts ?? []).filter(c => c.deployer).map(c => [c.address, c]));
}

function save(contracts, failures) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), contracts, failures }, null, 2) + "\n");
}

function summarize(contracts, failures) {
  const byDeployer = new Map();
  for (const c of contracts.filter(c => c.deployer)) {
    const d = byDeployer.get(c.deployer) ?? { deployer: c.deployer, scam: [], normal: [] };
    d[c.label].push(c);
    byDeployer.set(c.deployer, d);
  }
  const ds = [...byDeployer.values()];
  const repeat = ds.filter(d => d.scam.length >= 2).sort((a, b) => b.scam.length - a.scam.length);
  const mixed = ds.filter(d => d.scam.length >= 1 && d.normal.length >= 1);
  const count = l => contracts.filter(c => c.label === l).length;
  const found = l => contracts.filter(c => c.label === l && c.deployer).length;
  const uniq = l => new Set(contracts.filter(c => c.label === l && c.deployer).map(c => c.deployer)).size;

  const out = [];
  out.push(`생성 시각: ${new Date().toISOString()}`);
  out.push(`사기 컨트랙트: ${count("scam")}개 중 배포자 확인 ${found("scam")}개, 서로 다른 배포자 ${uniq("scam")}명`);
  out.push(`정상 컨트랙트: ${count("normal")}개 중 배포자 확인 ${found("normal")}개, 서로 다른 배포자 ${uniq("normal")}명`);
  out.push(`조회 실패: ${failures.length}개`);
  out.push("");
  out.push(`사기 컨트랙트를 2개 이상 배포한 배포자: ${repeat.length}명`);
  for (const d of repeat.slice(0, 30)) {
    const list = [...d.scam].sort((a, b) => Number(a.blockNumber ?? 0) - Number(b.blockNumber ?? 0));
    out.push(`- ${d.deployer} : 사기 ${d.scam.length}개${d.normal.length ? `, 정상 표본 ${d.normal.length}개` : ""}`);
    for (const c of list) out.push(`    ${c.type} ${c.address} 블록 ${c.blockNumber ?? "?"} ${c.timestamp ? new Date(Number(c.timestamp) * 1000).toISOString().slice(0, 10) : ""}`);
  }
  if (mixed.length) {
    out.push("");
    out.push(`사기와 정상 표본을 모두 배포한 배포자(라벨 확인 필요): ${mixed.length}명`);
    for (const d of mixed.slice(0, 10)) out.push(`- ${d.deployer} : 사기 ${d.scam.length}, 정상 ${d.normal.length}`);
  }
  return out.join("\n");
}

async function main() {
  requireKey();
  const labels = loadLabels();
  const prev = loadPrevious();
  const todo = labels.filter(c => !prev.has(c.address));
  console.log(`대상 ${labels.length}개 (이미 확인 ${labels.length - todo.length}개, 이번에 조회 ${todo.length}개)`);

  const results = new Map(prev);
  const failures = [];
  for (let i = 0; i < todo.length; i += 5) {
    const batch = todo.slice(i, i + 5);
    try {
      const rows = await getContractCreation(batch.map(c => c.address));
      const byAddr = new Map(rows.map(r => [String(r.contractAddress).toLowerCase(), r]));
      for (const c of batch) {
        const r = byAddr.get(c.address);
        if (!r) { failures.push({ address: c.address, reason: "생성 정보 없음" }); continue; }
        results.set(c.address, {
          ...c,
          deployer: String(r.contractCreator).toLowerCase(),
          txHash: r.txHash ?? null,
          blockNumber: r.blockNumber ?? null,
          timestamp: r.timestamp ?? null,
          factory: r.contractFactory || null
        });
      }
    } catch (err) {
      if (err.fatal) throw err;
      for (const c of batch) failures.push({ address: c.address, reason: err.message });
    }
    process.stdout.write(`\r조회 ${Math.min(i + 5, todo.length)}/${todo.length}`);
    if ((i / 5) % 20 === 0) save(labels.map(c => results.get(c.address) ?? c), failures);
  }
  process.stdout.write("\n");

  const contracts = labels.map(c => results.get(c.address) ?? c);
  save(contracts, failures);
  const summary = summarize(contracts, failures);
  fs.writeFileSync(OUT_TXT, summary + "\n");
  console.log("\n" + summary);
  console.log(`\n저장: ${path.relative(ROOT, OUT_JSON)}, ${path.relative(ROOT, OUT_TXT)}`);
}

main().catch(err => { console.error("[실패]", err.message); process.exit(1); });
