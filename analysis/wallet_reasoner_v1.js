// 지갑 레이어 v1: 추론기 (docs/WALLET_LAYER.md 3절)
// fraud_ontology.js의 walletLayer.rules를 읽어 사실값(chain_graph_v2.js 출력)에 적용한다.
// 규칙 내용은 이 파일에 쓰지 않는다. 이 파일은 조건 형식(eq, gte, exists, contractClass, downstreamClass)만 해석한다.
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { FraudOntology } from "./fraud_ontology.js";
import { parseTransfersCsv, parseSimLogCsv, loadServices, findCollectorFromSimLog, collectorInflowFromSimLog, computeWalletFacts } from "./chain_graph_v2.js";

// 시연용 임시값. 1단계에서 config/wallet_config_v1.json으로 옮긴다.
export const WALLET_PARAMS = Object.freeze({
  minTaintRatio: 0.5,
  minForwardRatio: 0.8,
  maxHops: 2,
  taintMethod: "haircut"
});

const fmt = v => (typeof v === "number" ? v.toFixed(2) : String(v));
const paramValue = (ref, params) => (typeof ref === "number" ? ref : params[ref]);

// 조건 하나를 평가한다. result는 true / false / null(값이 없어 판정 불가).
export function evaluateCondition(cond, subject, ctx) {
  const { params } = ctx;
  const base = { id: cond.id, label: cond.label };

  if (cond.prop !== undefined) {
    const value = subject[cond.prop];
    if (value === null || value === undefined) {
      return { ...base, result: null, text: `${cond.label}: 값 없음` };
    }
    if ("eq" in cond) {
      const ok = value === cond.eq;
      return { ...base, result: ok, text: `${cond.label}: ${cond.prop} = ${value}` };
    }
    if ("gte" in cond) {
      const th = paramValue(cond.gte, params);
      if (typeof th !== "number") throw new Error(`기준값 ${cond.gte}가 없습니다`);
      const ok = value >= th;
      return { ...base, result: ok, text: `${cond.label}: ${fmt(value)} ${ok ? "≥" : "<"} ${fmt(th)}` };
    }
  }

  if (cond.relation !== undefined && "exists" in cond) {
    const items = (ctx.relations[cond.relation] ?? []).filter(r => r.wallet === subject.address);
    const ok = (items.length > 0) === cond.exists;
    return { ...base, result: ok, text: `${cond.label}: ${cond.relation} ${items.length}건` };
  }

  if (cond.contractClass !== undefined && cond.downstreamClass === undefined) {
    const ok = subject.contractClass === cond.contractClass;
    return { ...base, result: ok, text: `${cond.label}: 분류 ${subject.contractClass ?? "없음"}` };
  }

  if (cond.downstreamClass !== undefined) {
    const maxHops = paramValue(cond.maxHops, params);
    const collectors = subject[cond.via] ?? [];
    if (collectors.length === 0) {
      return { ...base, result: null, text: `${cond.label}: 수집 지갑 없음` };
    }
    const hits = ctx.verdicts.filter(v =>
      v.classes.includes(cond.downstreamClass) &&
      typeof v.hopsFromSource === "number" && v.hopsFromSource >= 1 && v.hopsFromSource <= maxHops
    );
    const ok = hits.length >= (cond.minCount ?? 1);
    return { ...base, result: ok, text: `${cond.label}: ${cond.downstreamClass} ${hits.length}개 (${maxHops}홉 이내)`, matched: hits.map(h => h.address) };
  }

  throw new Error(`해석할 수 없는 조건 형식: ${cond.id}`);
}

// all 조건: 하나라도 거짓이면 거짓, 거짓 없이 null이 있으면 null, 모두 참이면 참.
export function evaluateRule(rule, subject, ctx) {
  const conditions = rule.all.map(c => evaluateCondition(c, subject, ctx));
  const result = conditions.some(c => c.result === false) ? false
    : conditions.some(c => c.result === null) ? null
    : true;
  return { result, conditions };
}

// target이 Wallet인 모든 규칙을 각 지갑에 적용한다.
export function judgeWallets(facts, { walletLayer = FraudOntology.walletLayer, params = WALLET_PARAMS } = {}) {
  const ctx = { params, relations: { deploys: facts.deploys ?? [] } };
  const walletRules = Object.entries(walletLayer.rules).filter(([, r]) => r.target === "Wallet");

  // 사실값이 있는 지갑 + 배포 관계만 있는 지갑
  const subjects = new Map(facts.wallets.map(w => [w.address, w]));
  for (const d of facts.deploys ?? []) {
    if (!subjects.has(d.wallet)) {
      subjects.set(d.wallet, { address: d.wallet, isSeed: null, isKnownService: null, taintRatio: null, forwardRatio: null, hopsFromSource: null });
    }
  }

  return [...subjects.values()].map(w => {
    const checks = {};
    const classes = [];
    for (const [cls, rule] of walletRules) {
      checks[cls] = evaluateRule(rule, w, ctx);
      if (checks[cls].result === true) classes.push(cls);
    }
    return { address: w.address, hopsFromSource: w.hopsFromSource, classes, checks };
  });
}

// target이 Contract인 규칙(HopLaundering)을 컨트랙트에 적용한다.
export function judgeContract(contractSubject, verdicts, { walletLayer = FraudOntology.walletLayer, params = WALLET_PARAMS } = {}) {
  const ctx = { params, verdicts, relations: {} };
  const out = {};
  for (const [cls, rule] of Object.entries(walletLayer.rules)) {
    if (rule.target !== "Contract") continue;
    const r = evaluateRule(rule, contractSubject, ctx);
    out[cls] = { attached: r.result === true, result: r.result, conditions: r.conditions };
  }
  return out;
}

// 지갑 레이어 전체 실행. report.wallet_layer에 들어갈 객체를 돌려준다.
// verdicts[].reasons: 클래스별 조건 평가 [{ id, result(true/false/null), text }]
// status: evaluated | not_applicable(자금세탁 아님) | missing(하류 거래 데이터 없음, 수집 지갑 없음)
// inflows: 수집 지갑이 컨트랙트에서 받은 거래(선택). 사실값 계산에만 더한다.
export function runWalletLayer({ contractClass, contract = null, collector = null, transfers = null, inflows = [], services = new Map(), deploys = [], walletLayer = FraudOntology.walletLayer, params = WALLET_PARAMS }) {
  const head = { version: walletLayer.version, params: { ...params } };
  if (contractClass !== "MoneyLaundering") {
    return { ...head, status: "not_applicable", reason: "자금세탁으로 분류되지 않아 지갑 레이어를 실행하지 않음" };
  }
  if (!transfers) {
    return { ...head, status: "missing", reason: "하류 거래 데이터 없음" };
  }
  if (!collector) {
    return { ...head, status: "missing", reason: "수집 지갑을 찾지 못함" };
  }

  const facts = computeWalletFacts({ transfers: [...inflows, ...transfers], seeds: [collector], services, maxHops: params.maxHops, contract, deploys });
  const verdicts = judgeWallets(facts, { walletLayer, params });
  const contractVerdict = judgeContract({ contractClass, collectedBy: [collector] }, verdicts, { walletLayer, params });

  return {
    ...head,
    status: "evaluated",
    seed: collector,
    facts,
    verdicts: verdicts.map(v => ({
      address: v.address,
      hopsFromSource: v.hopsFromSource,
      classes: v.classes,
      reasons: Object.fromEntries(Object.entries(v.checks).map(([cls, c]) => [cls, c.conditions.map(x => ({ id: x.id, result: x.result, text: x.text }))]))
    })),
    hopLaundering: contractVerdict.HopLaundering ?? null
  };
}

// 확인용 CLI: 시뮬레이션 출력 폴더를 받아 결과를 출력한다.
// node analysis/wallet_reasoner_v1.js --dir /tmp/wl_pos [--deployer 0x...] [--out result.json]
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const dir = opt("--dir");
  if (!dir) {
    console.error("사용법: node analysis/wallet_reasoner_v1.js --dir <시뮬레이션 출력 폴더> [--deployer 0x...] [--out 파일]");
    process.exit(1);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const logRows = parseSimLogCsv(fs.readFileSync(path.join(dir, "laundering_log.csv"), "utf8"));
  const transfersPath = path.join(dir, "laundering_transfers.csv");
  const transfers = fs.existsSync(transfersPath) ? parseTransfersCsv(fs.readFileSync(transfersPath, "utf8")) : null;
  const contract = logRows.find(r => r.action === "deposit")?.to ?? null;
  const deployer = opt("--deployer");
  const result = runWalletLayer({
    contractClass: "MoneyLaundering",
    contract,
    collector: findCollectorFromSimLog(logRows),
    transfers,
    inflows: [collectorInflowFromSimLog(logRows)].filter(Boolean),
    services: loadServices(path.join(root, "config", "services_v1.json")),
    deploys: deployer && contract ? [{ wallet: deployer, contract }] : []
  });

  console.log(`상태: ${result.status}${result.reason ? ` (${result.reason})` : ""}`);
  if (result.status === "evaluated") {
    console.log(`시드(수집 지갑): ${result.seed}`);
    for (const w of result.facts.wallets) {
      const v = result.verdicts.find(x => x.address === w.address);
      console.log(`  ${w.address}  홉 ${w.hopsFromSource}  오염 ${fmt(w.taintRatio)}  전달 ${fmt(w.forwardRatio)}  → ${v.classes.join(", ") || "해당 없음"}`);
    }
    for (const v of result.verdicts.filter(x => !result.facts.wallets.some(w => w.address === x.address))) {
      console.log(`  ${v.address}  (배포 관계만)  → ${v.classes.join(", ") || "해당 없음"}`);
    }
    console.log(`HopLaundering: ${result.hopLaundering?.attached ? "부착" : "미부착"}`);
  }
  const out = opt("--out");
  if (out) {
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(`저장: ${out}`);
  }
}
