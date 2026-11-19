// "알려진 위험 주소" 지식. 출처마다 따로 모아 두고, 근거 문장에 출처를 밝힌다.
// - XBlock 폰지 배포자: 그 지갑이 처음 폰지 라벨 컨트랙트를 배포한 시각 이후부터 "알려진 사기 배포자"로 본다
// - EthereumHeist(해킹 주소 117개): XBlock과 별개 출처. 시각 정보가 없어 항상 알려진 것으로 본다
// - 믹서(Tornado Cash) 주소는 config.js MIXER_ADDRESSES
import fs from "node:fs";
import path from "node:path";

const isAddr = s => /^0x[0-9a-fA-F]{40}$/.test(s ?? "");

// → Map(주소 → { since: 초|0, kind: "scam_deployer" | "hack", source, name })
export function loadKnownBad(root, candidates) {
  const m = new Map();
  for (const c of candidates) {
    if (c.label !== "scam" || !c.deployer || !c.timestamp) continue;
    const ts = Number(c.timestamp);
    const prev = m.get(c.deployer);
    if (!prev || ts < prev.since) m.set(c.deployer, { since: ts, kind: "scam_deployer", source: "XBlock 연구 데이터", name: "폰지 배포자" });
  }
  const heist = path.join(root, "data/raw/ethereumheist/Heist label-etherscan.csv");
  if (fs.existsSync(heist)) {
    const lines = fs.readFileSync(heist, "utf8").replace(/^﻿/, "").split(/\r?\n/).slice(1);
    for (const line of lines) {
      const [a, ...rest] = line.split(",");
      if (!isAddr(a?.trim())) continue;
      const addr = a.trim().toLowerCase();
      if (!m.has(addr)) m.set(addr, { since: 0, kind: "hack", source: "EthereumHeist(Etherscan 해킹 태그)", name: rest.join(",").trim() || "해킹 주소" });
    }
  }
  return m;
}
