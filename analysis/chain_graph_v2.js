// 지갑 레이어 v1: 사실값 계산 (docs/WALLET_LAYER.md 4절)
// 하류 거래 기록에서 지갑별 오염 비율, 전달 비율, 홉 수를 계산한다.
// 판정은 하지 않는다. 판정은 wallet_reasoner_v1.js가 온톨로지 규칙으로 한다.
import fs from "fs";

const round = (x, d = 4) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);
const lower = a => String(a).trim().toLowerCase();

// 하류 거래 CSV(block,timestamp,from,to,amount_eth)를 읽는다.
export function parseTransfersCsv(text) {
  const lines = String(text).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map(h => h.trim());
  const need = ["block", "timestamp", "from", "to", "amount_eth"];
  for (const k of need) {
    if (!header.includes(k)) throw new Error(`하류 거래 CSV에 ${k} 열이 없습니다`);
  }
  return lines.slice(1).map(line => {
    const cols = line.split(",");
    const row = Object.fromEntries(header.map((h, i) => [h, (cols[i] ?? "").trim()]));
    return {
      block: Number(row.block),
      timestamp: Number(row.timestamp),
      from: lower(row.from),
      to: lower(row.to),
      amount_eth: Number(row.amount_eth)
    };
  });
}

// 시뮬레이션 컨트랙트 로그 CSV(block,timestamp,from,to,action,...)를 행 객체 배열로 읽는다.
export function parseSimLogCsv(text) {
  const [header, ...rows] = String(text).trim().split(/\r?\n/);
  const keys = header.split(",").map(k => k.trim());
  return rows.filter(Boolean).map(r => Object.fromEntries(r.split(",").map((v, i) => [keys[i], v.trim()])));
}

// services_v1.json을 읽어 주소 → 서비스 정보 Map으로 만든다.
export function loadServices(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return new Map((json.services ?? []).map(s => [lower(s.address), s]));
}

// 시뮬레이션 전용: 컨트랙트 로그에서 전액 인출을 받은 지갑을 수집 지갑으로 본다.
// action 이름 기반이라 실데이터에는 쓸 수 없다.
export function findCollectorFromSimLog(logRows) {
  const rows = logRows.filter(r => r.action === "owner_withdraw_all");
  if (rows.length === 0) return null;
  return lower(rows[rows.length - 1].to);
}

// 시뮬레이션 전용: 컨트랙트 → 수집 지갑 인출을 하류 거래 형식으로 바꾼다.
// 수집 지갑의 받은 금액에 들어가 전달 비율 계산에 쓰인다. 컨트랙트는 추적 범위 밖이라 오염 계산에는 영향이 없다.
export function collectorInflowFromSimLog(logRows) {
  const rows = logRows.filter(r => r.action === "owner_withdraw_all");
  if (rows.length === 0) return null;
  const r = rows[rows.length - 1];
  return { block: Number(r.block), timestamp: Number(r.timestamp), from: lower(r.from), to: lower(r.to), amount_eth: Number(r.amount_eth) };
}

// 시드에서 너비 우선으로 maxHops까지 따라가며 지갑별 사실값을 계산한다.
// - 서비스 주소는 기록만 하고 더 따라가지 않는다.
// - maxHops 안의 지갑은 출금까지 기록해 전달 비율을 계산한다. 그 바깥 수신자는 판정하지 않는다.
// - 오염 비율(haircut): 블록 순서대로 처리하며, 보낸 지갑의 그 시점 오염 비율만큼 받은 금액을 오염으로 센다.
//   시드가 보낸 돈은 오염 1.0, 서비스와 추적 범위 밖 주소가 보낸 돈은 0으로 본다.
export function computeWalletFacts({ transfers, seeds, services = new Map(), maxHops = 2, contract = null, deploys = [] }) {
  const seedSet = new Set(seeds.map(lower));
  const isService = a => services.has(a);

  // 1) 홉 수 (최단 경로)
  const hops = new Map([...seedSet].map(s => [s, 0]));
  const outgoing = new Map();
  for (const t of transfers) {
    if (!outgoing.has(t.from)) outgoing.set(t.from, []);
    outgoing.get(t.from).push(t);
  }
  const queue = [...seedSet];
  while (queue.length > 0) {
    const a = queue.shift();
    const h = hops.get(a);
    if (isService(a) || h >= maxHops) continue;
    for (const t of outgoing.get(a) ?? []) {
      if (!hops.has(t.to)) {
        hops.set(t.to, h + 1);
        queue.push(t.to);
      }
    }
  }

  // 2) 추적 범위의 거래: 범위 안 비서비스 지갑이 보냈거나 받은 거래
  const inScope = a => hops.has(a) && hops.get(a) <= maxHops && !isService(a);
  const scoped = transfers
    .filter(t => inScope(t.from) || inScope(t.to))
    .sort((x, y) => x.block - y.block);

  // 3) 받은 금액, 보낸 금액, 오염 금액 (블록 순서 haircut)
  const recv = new Map(), sent = new Map(), tainted = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);
  const taintOf = a => {
    if (seedSet.has(a)) return 1;
    if (isService(a) || !inScope(a)) return 0;
    const r = recv.get(a) ?? 0;
    return r > 0 ? (tainted.get(a) ?? 0) / r : 0;
  };
  for (const t of scoped) {
    const senderTaint = taintOf(t.from);
    add(sent, t.from, t.amount_eth);
    add(recv, t.to, t.amount_eth);
    add(tainted, t.to, t.amount_eth * senderTaint);
  }

  // 4) 지갑별 사실값 (maxHops 안의 주소)
  const wallets = [...hops.entries()]
    .filter(([, h]) => h <= maxHops)
    .sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1))
    .map(([address, h]) => {
      const r = recv.get(address) ?? 0;
      const s = sent.get(address) ?? 0;
      const seed = seedSet.has(address);
      return {
        address,
        isSeed: seed,
        isKnownService: isService(address),
        taintRatio: seed ? 1 : (r > 0 ? round((tainted.get(address) ?? 0) / r) : null),
        forwardRatio: r > 0 ? round(s / r) : null,
        hopsFromSource: h,
        receivedEth: round(r, 6),
        sentEth: round(s, 6)
      };
    });

  // 5) 추적이 멈춘 지점 기록
  const stops = [];
  for (const t of scoped) {
    if (isService(t.to)) {
      stops.push({ address: t.to, reason: "known_service", type: services.get(t.to)?.type ?? null, hopsFromSource: (hops.get(t.from) ?? 0) + 1 });
    } else if (!hops.has(t.to) || hops.get(t.to) > maxHops) {
      stops.push({ address: t.to, reason: "max_hops", hopsFromSource: (hops.get(t.from) ?? 0) + 1 });
    }
  }

  return {
    contract: contract ? lower(contract) : null,
    seeds: [...seedSet],
    wallets,
    transfers: scoped.map(t => ({ ...t })),
    deploys: deploys.map(d => ({ wallet: lower(d.wallet), contract: lower(d.contract) })),
    stops
  };
}
