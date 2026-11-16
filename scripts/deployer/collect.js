// 배포자 하나의 사실값(facts) 수집. 분석 기준 시점(분석 대상 컨트랙트의 생성 블록) 이전 데이터만 쓴다.
// - 분석 대상 컨트랙트와 주고받은 거래는 계산에서 뺀다(동적 분석과 같은 증거를 두 번 세지 않기 위해).
// - Etherscan 응답은 cache/에 저장해 다시 실행할 때 호출하지 않는다.
import fs from "node:fs";
import path from "node:path";
import { getTxList, getInternalTxList } from "./etherscan.js";
import { FUND_FLOW, MIXER_ADDRESSES } from "./config.js";

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

// labels: Map(contractAddress → "scam" | "normal")
export async function collectFacts({ deployer, contract, asOfBlock, asOfTimestamp, reason }, labels, cacheDir) {
  deployer = lc(deployer); contract = lc(contract);
  const endblock = Number(asOfBlock) - 1;
  const failures = [];
  const key = `${deployer}_${endblock}`;
  let normal, internal;
  try {
    normal = await cached(cacheDir, `${key}_txlist`, () => getTxList(deployer, { endblock }));
    internal = await cached(cacheDir, `${key}_internal`, () => getInternalTxList(deployer, { endblock }));
  } catch (err) {
    if (err.fatal) throw err;
    return { deployer, contract, activity: null, failures: [`Etherscan 조회 실패: ${err.message}`], sources: [], reason };
  }
  if (normal.truncated) failures.push("일반 거래가 10,000건을 넘어 앞부분만 확인");

  const ok = t => t.isError === "0" || t.isError === undefined;
  const notTarget = t => lc(t.to) !== contract && lc(t.from) !== contract && lc(t.contractAddress) !== contract;
  const txs = normal.list.filter(ok).filter(notTarget);
  const itxs = internal.filter(ok).filter(notTarget);

  // 활동: 첫 거래(받은 것 포함)부터 기준 시점까지
  const allTs = [...txs, ...itxs].map(t => Number(t.timeStamp)).filter(Boolean);
  if (allTs.length === 0) {
    return { deployer, contract, asOf: { block: Number(asOfBlock), date: day(asOfTimestamp) },
      activity: null, failures: [...failures, "기준 시점 이전 거래 없음"], sources: ["Etherscan(이더리움 메인넷)"], reason };
  }
  const firstTs = Math.min(...allTs);
  const activity = {
    firstTxDate: day(firstTs),
    days: Math.floor((Number(asOfTimestamp) - firstTs) / 86400),
    txCount: txs.length
  };

  // 첫 자금원: 배포자가 처음 ETH를 받은 거래(일반 거래 또는 내부 거래)
  const incoming = [
    ...txs.filter(t => lc(t.to) === deployer && eth(t.value) > 0),
    ...itxs.filter(t => lc(t.to) === deployer && eth(t.value) > 0)
  ].sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));
  const first = incoming[0];
  const firstFunding = first
    ? { from: lc(first.from), category: MIXER_ADDRESSES.has(lc(first.from)) ? "mixer" : "other", date: day(first.timeStamp) }
    : null;

  // 과거 배포: 배포자가 보낸 생성 트랜잭션(to가 비어 있음). 팩토리를 거친 생성은 잡지 못한다.
  const pastDeployments = txs
    .filter(t => lc(t.from) === deployer && !t.to && t.contractAddress)
    .map(t => ({ contract: lc(t.contractAddress), deployedAt: day(t.timeStamp), publicLabel: labels.get(lc(t.contractAddress)) ?? null }));

  // 자금 이동 패턴: 받은 직후 대부분을 내보낸 횟수
  const outgoing = txs.filter(t => lc(t.from) === deployer && eth(t.value) > 0);
  let passThroughEvents = 0;
  for (const t of incoming) {
    const amount = eth(t.value);
    if (amount < FUND_FLOW.minInEth) continue;
    const b = Number(t.blockNumber);
    const out = outgoing.filter(o => Number(o.blockNumber) >= b && Number(o.blockNumber) <= b + FUND_FLOW.withinBlocks)
      .reduce((s, o) => s + eth(o.value), 0);
    if (out >= amount * FUND_FLOW.shareOut) passThroughEvents++;
  }

  return {
    deployer, contract,
    asOf: { block: Number(asOfBlock), date: day(asOfTimestamp) },
    activity, firstFunding, pastDeployments, passThroughEvents,
    failures,
    sources: ["Etherscan(이더리움 메인넷)", "XBlock 폰지 라벨"],
    reason
  };
}
