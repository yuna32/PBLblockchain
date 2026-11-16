// 배포자 하나의 사실값(facts) 수집. 분석 기준 시점(분석 대상 컨트랙트의 생성 블록) 이전 데이터만 쓴다.
// - 배포자의 전체 거래를 한 번 받아 cache/에 저장하고, 기준 시점으로 잘라 쓴다(같은 배포자를 여러 시점에서 볼 때 다시 호출하지 않음).
// - 분석 대상 컨트랙트와 주고받은 거래는 계산에서 뺀다(동적 분석과 같은 증거를 두 번 세지 않기 위해).
import fs from "node:fs";
import path from "node:path";
import { getTxList, getInternalTxList } from "./etherscan.js";
import { FUND_FLOW, MIXER_ADDRESSES, PAST_SCAM_MIN_GAP_SECONDS, PAST_BEHAVIOR } from "./config.js";
import { goplusAddress, parseGoplus } from "./goplus.js";

const day = ts => new Date(Number(ts) * 1000).toISOString().slice(0, 10);
const eth = wei => Number(BigInt(wei || "0")) / 1e18;
const lc = s => String(s ?? "").toLowerCase();

async function cached(cacheDir, name, fn) {
  const file = path.join(cacheDir, `${name}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const data = await fn();
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data) + "\n");
  return data;
}

// 배포자의 전체 이력(일반 거래 최대 10,000건, 내부 거래 최대 10,000건)
export async function fetchHistory(deployer, cacheDir) {
  deployer = lc(deployer);
  const normal = await cached(cacheDir, `${deployer}_txlist_full`, () => getTxList(deployer));
  const internal = await cached(cacheDir, `${deployer}_internal_full`, () => getInternalTxList(deployer, { offset: 10000 }));
  return { normal, internal };
}

// labels: Map(contract → "scam" | "normal")
// knownBad: knowledge.js loadKnownBad 결과. 첫 자금원 "악성 주소" 판단에 쓴다.
// opts.historical: 과거 시점 재현(검증)일 때 true → 시각을 모르는 지식(since 0)과 GoPlus(현재 정보)는 쓰지 않는다
// opts.goplus: true면 배포자와 첫 자금원 주소를 GoPlus로도 확인한다(실주소 분석용)
export async function collectFacts({ deployer, contract, asOfBlock, asOfTimestamp, reason }, labels, cacheDir, knownBad = new Map(), opts = {}) {
  deployer = lc(deployer); contract = lc(contract);
  const asOf = { block: Number(asOfBlock), date: day(asOfTimestamp) };
  const failures = [];
  let hist;
  try {
    hist = await fetchHistory(deployer, cacheDir);
  } catch (err) {
    if (err.fatal) throw err;
    return { deployer, contract, asOf, activity: null, failures: [`Etherscan 조회 실패: ${err.message}`], sources: [], reason };
  }
  const before = t => Number(t.blockNumber) < asOf.block;
  const lastBlock = list => (list.length ? Number(list[list.length - 1].blockNumber) : 0);
  if (hist.normal.truncated && lastBlock(hist.normal.list) < asOf.block) failures.push("기준 시점 이전 거래가 10,000건을 넘어 일부만 확인");

  const ok = t => t.isError === "0" || t.isError === undefined;
  const notTarget = t => lc(t.to) !== contract && lc(t.from) !== contract && lc(t.contractAddress) !== contract;
  const txs = hist.normal.list.filter(before).filter(ok).filter(notTarget);
  const itxs = hist.internal.filter(before).filter(ok).filter(notTarget);

  // 활동: 첫 거래(받은 것 포함)부터 기준 시점까지
  const allTs = [...txs, ...itxs].map(t => Number(t.timeStamp)).filter(Boolean);
  if (allTs.length === 0) {
    return { deployer, contract, asOf, activity: null, failures: [...failures, "기준 시점 이전 거래 없음"], sources: ["Etherscan(이더리움 메인넷)"], reason };
  }
  const firstTs = Math.min(...allTs);
  // 상호작용: 배포자가 보낸 거래의 서로 다른 상대 주소 수(컨트랙트 생성 제외)
  const counterparties = new Set(txs.filter(t => lc(t.from) === deployer && t.to).map(t => lc(t.to))).size;
  const activity = { firstTxDate: day(firstTs), days: Math.floor((Number(asOfTimestamp) - firstTs) / 86400), txCount: txs.length, counterparties };

  // 첫 자금원: 배포자가 처음 ETH를 받은 거래(일반 또는 내부). 믹서 → mixer, 기준 시점 전에 사기 컨트랙트를 배포한 지갑 → malicious
  const incoming = [
    ...txs.filter(t => lc(t.to) === deployer && eth(t.value) > 0),
    ...itxs.filter(t => lc(t.to) === deployer && eth(t.value) > 0)
  ].sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));
  const first = incoming[0];
  let firstFunding = null;
  if (first) {
    const from = lc(first.from);
    const bad = knownBad.get(from);
    const known = bad && from !== deployer && (opts.historical ? bad.since > 0 && bad.since < Number(asOfTimestamp) : bad.since < Number(asOfTimestamp) || bad.since === 0);
    const category = MIXER_ADDRESSES.has(from) ? "mixer" : known ? "malicious" : "other";
    firstFunding = { from, category, date: day(first.timeStamp), knownAs: known ? { kind: bad.kind, source: bad.source, name: bad.name } : null };
  }

  // GoPlus(현재 정보): 배포자 주소의 위험 표시, 첫 자금원 주소의 위험 표시
  let goplus = null;
  if (opts.goplus && !opts.historical) {
    goplus = { deployer: null, funder: null };
    try { goplus.deployer = parseGoplus(await goplusAddress(deployer, cacheDir)); } catch (err) { failures.push(`GoPlus(배포자) 조회 실패: ${err.message}`); }
    if (firstFunding) {
      try { goplus.funder = parseGoplus(await goplusAddress(firstFunding.from, cacheDir)); } catch (err) { failures.push(`GoPlus(첫 자금원) 조회 실패: ${err.message}`); }
      if (firstFunding.category === "other" && goplus.funder) {
        if (goplus.funder.mixer) firstFunding.category = "mixer";
        else if (goplus.funder.direct.length) {
          firstFunding.category = "malicious";
          firstFunding.knownAs = { kind: "goplus", source: goplus.funder.source, name: goplus.funder.direct.join(", ") };
        }
      }
    }
  }

  // 과거 배포: 배포자가 보낸 생성 트랜잭션(to가 비어 있음). 팩토리를 거친 생성은 잡지 못한다.
  const pastDeployments = txs
    .filter(t => lc(t.from) === deployer && !t.to && t.contractAddress)
    .map(t => ({ contract: lc(t.contractAddress), deployedAt: day(t.timeStamp), deployedTs: Number(t.timeStamp), publicLabel: labels.get(lc(t.contractAddress)) ?? null }))
    // 같은 날 재배포 표시: 기준 시점과 24시간 안쪽이면 sameDay(별개의 사기로 세지 않음)
    .map(p => ({ ...p, sameDay: Number(asOfTimestamp) - p.deployedTs < PAST_SCAM_MIN_GAP_SECONDS }));

  // 이전 컨트랙트 행동(라벨 없이): ① 넣은 돈보다 많이 돌려받았나 ② 남의 돈이 들어온 컨트랙트에서 배포자가 그 돈을 가져갔나
  const pastSet = new Set(pastDeployments.map(p => p.contract));
  const back = itxs.filter(t => lc(t.to) === deployer && pastSet.has(lc(t.from))).reduce((s, t) => s + eth(t.value), 0);
  const sent = txs.filter(t => lc(t.from) === deployer && pastSet.has(lc(t.to))).reduce((s, t) => s + eth(t.value), 0);
  const pastBehavior = { backEth: back, sentEth: sent, checked: 0, drained: [], skipped: 0 };
  if (opts.pastBehavior !== false && pastDeployments.length) {
    const recent = pastDeployments.slice(-PAST_BEHAVIOR.maxContracts);
    pastBehavior.skipped = pastDeployments.length - recent.length;
    for (const p of recent) {
      let list;
      try { list = await cached(cacheDir, `${p.contract}_txlist_full`, () => getTxList(p.contract)); }
      catch (err) { if (err.fatal) throw err; failures.push(`이전 컨트랙트 조회 실패: ${p.contract}`); continue; }
      const ins = list.list.filter(before).filter(ok).filter(t => lc(t.to) === p.contract && lc(t.from) !== deployer && eth(t.value) > 0);
      const depositors = new Set(ins.map(t => lc(t.from))).size;
      const othersIn = ins.reduce((s, t) => s + eth(t.value), 0);
      const toDeployer = itxs.filter(t => lc(t.from) === p.contract && lc(t.to) === deployer).reduce((s, t) => s + eth(t.value), 0);
      pastBehavior.checked++;
      if (depositors >= PAST_BEHAVIOR.minDepositors && othersIn >= PAST_BEHAVIOR.minInEth && toDeployer >= othersIn * PAST_BEHAVIOR.drainShare)
        pastBehavior.drained.push({ contract: p.contract, deployedAt: p.deployedAt, depositors, othersIn: +othersIn.toFixed(4), toDeployer: +toDeployer.toFixed(4) });
    }
  }

  // 자금 이동 패턴: 받은 직후 대부분을 내보낸 횟수
  const outgoing = txs.filter(t => lc(t.from) === deployer && eth(t.value) > 0);
  let passThroughEvents = 0;
  for (const t of incoming) {
    const amount = eth(t.value);
    if (amount < FUND_FLOW.minInEth) continue;
    const ts = Number(t.timeStamp);
    const out = outgoing.filter(o => Number(o.timeStamp) >= ts && Number(o.timeStamp) <= ts + FUND_FLOW.withinSeconds)
      .reduce((s, o) => s + eth(o.value), 0);
    if (out >= amount * FUND_FLOW.shareOut) passThroughEvents++;
  }

  return {
    deployer, contract, asOf, activity, firstFunding, pastDeployments, pastBehavior, passThroughEvents, goplus, failures,
    sources: ["Etherscan(이더리움 메인넷)", "XBlock 폰지 라벨"],
    reason
  };
}
