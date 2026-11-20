// XBlock 밖 정답 데이터를 같은 형식(candidates_<이름>.json)으로 준비한다: 라벨 컨트랙트 → 배포자·생성 블록·시각.
//
// 실행(저장소 루트):
//   node --env-file=.env scripts/deployer/prepare_external.js sok|rphunter_rug|rphunter_normal [--limit 400]
//     evaluation/rugpull_sok/rugpull_dataset.csv (SoK Rug Pull, 깃허브 Dianxiang111/Rug-Pull-Dataset)
//     이더리움만, HoneyBadger(허니팟, 팀에서 제외) 출처는 뺀다. 보안 업체 경보·Pied-Piper는 전부, 트랩도어는 무작위로 채운다.
// 출력: evaluation/deployer_risk/candidates_<이름>.json
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { requireKey, getContractCreation } from "./etherscan.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "evaluation/deployer_risk");
const isAddr = s => /^0x[0-9a-fA-F]{40}$/.test(s ?? "");
const h = s => crypto.createHash("sha1").update(s).digest("hex"); // 재현 가능한 무작위 순서

// 따옴표 안의 쉼표를 처리하는 간단한 CSV 파서
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function loadSok(limit) {
  const text = fs.readFileSync(path.join(ROOT, "evaluation/rugpull_sok/rugpull_dataset.csv"), "utf8").replace(/^﻿/, "");
  const [head, ...rest] = parseCsv(text);
  const idx = k => head.indexOf(k);
  const all = rest.map(r => ({ chain: r[idx("Chain")], address: (r[idx("address")] ?? "").trim(), type: r[idx("Type")], cause: r[idx("Root Causes")], source: r[idx("Sources")] }))
    .filter(r => r.chain === "ETH" && isAddr(r.address) && !/Art of The Scam/i.test(r.source ?? ""));
  const isTrapdoor = r => /Trapdoor/i.test(r.source ?? "");
  const keep = all.filter(r => !isTrapdoor(r));
  const trap = all.filter(isTrapdoor).sort((a, b) => h(a.address.toLowerCase()).localeCompare(h(b.address.toLowerCase())));
  const picked = [...keep, ...trap.slice(0, Math.max(0, limit - keep.length))];
  console.log(`SoK 이더리움(허니팟 제외) ${all.length}건 → 경보·Pied-Piper 등 ${keep.length}건 + 트랩도어 ${picked.length - keep.length}건 = ${picked.length}건`);
  const seen = new Set();
  return picked.map(r => ({ address: r.address.toLowerCase(), label: "scam", type: "rugpull", source: `SoK: ${r.source}`, cause: r.cause }))
    .filter(r => !seen.has(r.address) && seen.add(r.address));
}

// RPHunter(figshare 공개): 사람이 확인한 러그풀 사건(이더리움 400건)과 정상 토큰 1,675건(여러 체인 섞임)
// evaluation/rphunter/rug_eth.csv, normal_addresses.txt 는 압축 파일에서 주소만 뽑아 둔 목록
function loadRphunterRug(limit) {
  const lines = fs.readFileSync(path.join(ROOT, "evaluation/rphunter/rug_eth.csv"), "utf8").split(/\r?\n/).slice(1).filter(Boolean);
  const rows = parseCsv(lines.join("\n") + "\n").map(r => ({ address: (r[0] ?? "").toLowerCase(), project: r[1], src: r[2] })).filter(r => isAddr(r.address));
  rows.sort((a, b) => h(a.address).localeCompare(h(b.address)));
  console.log(`RPHunter 러그풀 이더리움 ${rows.length}건 중 ${Math.min(limit, rows.length)}건`);
  return rows.slice(0, limit).map(r => ({ address: r.address, label: "scam", type: "rugpull", source: "RPHunter 러그풀", project: r.project }));
}
function loadRphunterNormal() {
  const addrs = fs.readFileSync(path.join(ROOT, "evaluation/rphunter/normal_addresses.txt"), "utf8").split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(isAddr);
  console.log(`RPHunter 정상 토큰 ${addrs.length}건 (이더리움에 생성 기록이 있는 것만 남김)`);
  return addrs.map(a => ({ address: a, label: "normal", type: "normal_token", source: "RPHunter 정상 토큰" }));
}

async function main() {
  const name = process.argv[2];
  const limit = process.argv.includes("--limit") ? Number(process.argv[process.argv.indexOf("--limit") + 1]) : 400;
  const loaders = { sok: () => loadSok(limit), rphunter_rug: () => loadRphunterRug(limit), rphunter_normal: () => loadRphunterNormal() };
  if (!loaders[name]) { console.error("사용법: node --env-file=.env scripts/deployer/prepare_external.js sok|rphunter_rug|rphunter_normal [--limit 400]"); process.exit(1); }
  requireKey();
  const labels = loaders[name]();
  const out = path.join(DIR, `candidates_${name}.json`);
  const prev = fs.existsSync(out) ? new Map(JSON.parse(fs.readFileSync(out, "utf8")).contracts.filter(c => c.deployer).map(c => [c.address, c])) : new Map();
  const results = new Map(prev);
  const todo = labels.filter(c => !prev.has(c.address));
  const failures = [];
  for (let i = 0; i < todo.length; i += 5) {
    const batch = todo.slice(i, i + 5);
    try {
      const rows = await getContractCreation(batch.map(c => c.address));
      const by = new Map(rows.map(r => [String(r.contractAddress).toLowerCase(), r]));
      for (const c of batch) {
        const r = by.get(c.address);
        if (!r) { failures.push({ address: c.address, reason: "생성 정보 없음" }); continue; }
        results.set(c.address, { ...c, deployer: String(r.contractCreator).toLowerCase(), txHash: r.txHash ?? null, blockNumber: r.blockNumber ?? null, timestamp: r.timestamp ?? null, factory: r.contractFactory || null });
      }
    } catch (err) { if (err.fatal) throw err; for (const c of batch) failures.push({ address: c.address, reason: err.message }); }
    process.stdout.write(`\r배포자 조회 ${Math.min(i + 5, todo.length)}/${todo.length}`);
  }
  process.stdout.write("\n");
  let contracts = labels.map(c => results.get(c.address) ?? c);
  if (name === "rphunter_normal") {
    const onEth = contracts.filter(c => c.deployer).sort((a, b) => h(a.address).localeCompare(h(b.address)));
    console.log(`이더리움에서 찾은 정상 토큰 ${onEth.length}건 → ${Math.min(limit, onEth.length)}건 사용`);
    contracts = onEth.slice(0, limit);
  }
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), dataset: name, contracts, failures }, null, 2) + "\n");
  const ok = contracts.filter(c => c.deployer);
  const years = {}; for (const c of ok) { const y = new Date(Number(c.timestamp) * 1000).getUTCFullYear(); years[y] = (years[y] ?? 0) + 1; }
  console.log(`배포자 확인 ${ok.length}/${contracts.length}, 서로 다른 배포자 ${new Set(ok.map(c => c.deployer)).size}명, 연도별 ${JSON.stringify(years)}`);
  console.log(`저장: ${path.relative(ROOT, out)}`);
}

main().catch(err => { console.error("[실패]", err.message); process.exit(1); });
