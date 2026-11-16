// 검증·기준 조정 공용: 라벨 컨트랙트마다(배포 직전 시점) 배포자 사실값을 모으고 지표 후보(features)를 계산한다.
// 배포자 기준으로 조정용(tune)/평가용(test)을 나눈다. 같은 배포자가 양쪽에 들어가지 않게 하기 위해서다.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { collectFacts, knownBadFromCandidates } from "./collect.js";
import { loadLabels } from "./build_demo.js";
import { MIN_HISTORY_TXS } from "./config.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DIR = path.join(ROOT, "evaluation/deployer_risk");
export const CACHE = path.join(DIR, "cache");

// 배포자 주소의 해시로 고정 분할(재현 가능)
export const splitOf = deployer => (parseInt(crypto.createHash("sha1").update(deployer).digest("hex").slice(0, 2), 16) % 2 === 0 ? "tune" : "test");

export function featuresOf(facts) {
  if (!facts.activity) return null;
  const past = facts.pastDeployments ?? [];
  return {
    past_scam_any: past.some(p => p.publicLabel === "scam"),
    past_scam_24h: past.some(p => p.publicLabel === "scam" && !p.sameDay),
    funder_malicious: facts.firstFunding?.category === "malicious",
    funder_mixer: facts.firstFunding?.category === "mixer",
    new_wallet: facts.activity.days < 7,
    low_interaction: facts.activity.counterparties < 3,
    new_and_low: facts.activity.days < 7 && facts.activity.counterparties < 3,
    pass_through: (facts.passThroughEvents ?? 0) >= 2,
    history_short: facts.activity.txCount < MIN_HISTORY_TXS
  };
}

export async function loadAll() {
  const cand = JSON.parse(fs.readFileSync(path.join(DIR, "candidates.json"), "utf8"));
  const targets = cand.contracts.filter(c => c.deployer && c.blockNumber && c.timestamp);
  const labels = loadLabels();
  const knownBad = knownBadFromCandidates(cand.contracts);
  const rows = [];
  for (const c of targets) {
    const facts = await collectFacts({ deployer: c.deployer, contract: c.address, asOfBlock: c.blockNumber, asOfTimestamp: c.timestamp }, labels, CACHE, knownBad);
    rows.push({ contract: c.address, deployer: c.deployer, label: c.label, split: splitOf(c.deployer), facts, f: featuresOf(facts) });
  }
  return rows;
}

// 정상 대비 사기에서 몇 배 더 자주 나오나(0건 보정: 각 칸에 0.5를 더함)
export function ratio(rows, key) {
  const s = rows.filter(r => r.label === "scam" && r.f), n = rows.filter(r => r.label === "normal" && r.f);
  const a = s.filter(r => r.f[key]).length, b = n.filter(r => r.f[key]).length;
  const ps = (a + 0.5) / (s.length + 1), pn = (b + 0.5) / (n.length + 1);
  return { scam: a, scamN: s.length, normal: b, normalN: n.length, lr: ps / pn };
}
