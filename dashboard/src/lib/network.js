// 거래 행 → 거래 네트워크 노드·링크. 순수 함수.
// 노드: 컨트랙트와 지갑(from/to 주소). 링크: (보낸 주소 → 받은 주소) 쌍마다 하나, 금액은 누적.
import { DEPOSIT_ACTIONS, WITHDRAW_ACTIONS } from "./series.js";

// analysis/dynamic_analyzer.js의 OWNER_ADDRESS와 같은 값 (hardhat 기본 계정 0)
export const OWNER_ADDRESS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
// demo/lib/viewmodel.js EXTRACTOR_PROFIT_RATIO와 같은 기준
export const EXTRACTOR_PROFIT_RATIO = 1.3;

export const ROLE_LABELS = {
  contract:  "컨트랙트",
  owner:     "운영자",
  wallet:    "일반 지갑",
  drainer:   "운영자 전액 인출 지갑",
  extractor: "과도 수익 지갑"
};

// 첫 입금 계열 행의 받는 주소 (analysis/dynamic_analyzer.js detectContractAddress와 같은 규칙)
export function detectContract(rows) {
  const row = rows.find(r => DEPOSIT_ACTIONS.has(r.action));
  return row ? row.to.toLowerCase() : null;
}

// report.trust.wallet_scores → 주소별 역할 (drainer 우선, 그다음 extractor)
export function walletRoles(walletScores = []) {
  const roles = new Map();
  for (const w of walletScores) {
    const addr = w.address.toLowerCase();
    if (w.is_drainer) roles.set(addr, "drainer");
    else if (w.profit_ratio > EXTRACTOR_PROFIT_RATIO) roles.set(addr, "extractor");
  }
  return roles;
}

// upToBlock 이하 블록의 거래만 쓴다 (슬라이더 위치)
export function buildNetwork(rows, walletScores = [], upToBlock = Infinity) {
  const contract = detectContract(rows);
  const roles = walletRoles(walletScores);
  const nodes = new Map();
  const links = new Map();
  let totalDeposit = 0, totalWithdraw = 0;

  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id, role: "wallet", deposited: 0, received: 0, txCount: 0 });
    return nodes.get(id);
  };

  for (const r of rows) {
    if (r.block > upToBlock) continue;
    const kind = DEPOSIT_ACTIONS.has(r.action) ? "deposit" : WITHDRAW_ACTIONS.has(r.action) ? "withdraw" : null;
    if (!kind) continue;
    const from = r.from.toLowerCase();
    const to = r.to.toLowerCase();
    const amount = Number(r.amount_eth) || 0;
    node(from).txCount++;
    node(to).txCount++;
    if (kind === "deposit") {
      node(from).deposited += amount;
      totalDeposit += amount;
    } else {
      node(to).received += amount;
      totalWithdraw += amount;
    }
    const id = `${from}->${to}`;
    if (!links.has(id)) links.set(id, { id, source: from, target: to, kind, amount: 0, count: 0, failed: 0, lastBlock: r.block });
    const l = links.get(id);
    l.amount += amount;
    l.count++;
    if (kind === "withdraw" && amount === 0) l.failed++;
    l.lastBlock = r.block;
  }

  for (const n of nodes.values()) {
    n.role = n.id === contract ? "contract" : roles.get(n.id) ?? (n.id === OWNER_ADDRESS ? "owner" : "wallet");
    n.deposited = round(n.deposited);
    n.received = round(n.received);
  }
  for (const l of links.values()) l.amount = round(l.amount);

  return {
    contract,
    nodes: [...nodes.values()],
    links: [...links.values()],
    totals: { deposit: round(totalDeposit), withdraw: round(totalWithdraw) }
  };
}

function round(x) {
  return Math.round(x * 1e6) / 1e6;
}
