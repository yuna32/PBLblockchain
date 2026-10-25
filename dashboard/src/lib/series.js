// 거래 행(/api/report/:id/timeseries) → 블록별 시계열과 슬라이더 범위. 순수 함수.
// 거래 행 열: block, timestamp, from, to, action, amount_eth, contract_balance_eth, participant_count

// analysis/dynamic_analyzer.js의 DEPOSIT_ACTIONS / WITHDRAW_ACTIONS와 같은 집합
export const DEPOSIT_ACTIONS = new Set(["deposit", "stake", "fund_reward_pool"]);
export const WITHDRAW_ACTIONS = new Set(["withdraw", "unstake", "owner_withdraw_all"]);

export function blockRange(rows) {
  const blocks = [...new Set(rows.map(r => r.block))].filter(b => Number.isFinite(b)).sort((a, b) => a - b);
  return { min: blocks[0] ?? 0, max: blocks.at(-1) ?? 0, blocks };
}

// 블록별 입금·출금 합계, 실패 출금 수, 블록 끝 잔액, 누적 입출금.
// 잔액은 contract_balance_eth가 모든 행에 숫자로 있으면 그 값(블록의 마지막 행), 아니면 누적 입금 - 누적 출금.
export function buildBlockSeries(rows) {
  const hasBalance = rows.length > 0 && rows.every(r => typeof r.contract_balance_eth === "number");
  const byBlock = new Map();
  for (const r of rows) {
    if (!byBlock.has(r.block)) byBlock.set(r.block, []);
    byBlock.get(r.block).push(r);
  }
  let cumIn = 0, cumOut = 0;
  const points = [...byBlock.keys()].sort((a, b) => a - b).map(block => {
    const sub = byBlock.get(block);
    let deposit = 0, withdraw = 0, failed = 0;
    for (const r of sub) {
      const amount = Number(r.amount_eth) || 0;
      if (DEPOSIT_ACTIONS.has(r.action)) deposit += amount;
      if (WITHDRAW_ACTIONS.has(r.action)) {
        withdraw += amount;
        if (amount === 0) failed++;
      }
    }
    cumIn += deposit;
    cumOut += withdraw;
    const balance = hasBalance ? sub.at(-1).contract_balance_eth : cumIn - cumOut;
    return { block, deposit: round(deposit), withdraw: round(withdraw), failed, balance: round(balance), cumIn: round(cumIn), cumOut: round(cumOut) };
  });
  return { points, balanceSource: hasBalance ? "contract_balance_eth" : "cumulative" };
}

function round(x) {
  return Math.round(x * 1e6) / 1e6;
}

// 시점 이벤트 → 기준선, onset → 강조 영역 (사기로 분류된 경우에만 onset이 있다)
export function chartMarkers(phase, range) {
  const events = (phase?.events ?? []).map(e => ({ block: e.block, label: e.label, type: e.type }));
  const onset = phase?.onset ? { x1: phase.onset.block, x2: Math.max(range.max, phase.onset.block), label: phase.onset.label } : null;
  return { events, onset };
}

// 같은 블록의 이벤트는 기준선 하나로 묶는다 (라벨 겹침 방지)
export function mergeEvents(events) {
  const byBlock = new Map();
  for (const e of events) {
    if (!byBlock.has(e.block)) byBlock.set(e.block, { block: e.block, labels: [], types: [] });
    byBlock.get(e.block).labels.push(e.label);
    byBlock.get(e.block).types.push(e.type);
  }
  return [...byBlock.values()].sort((a, b) => a.block - b.block).map(e => ({ ...e, label: e.labels.join(" · ") }));
}

export function clampBlock(block, range) {
  return Math.min(range.max, Math.max(range.min, block));
}

// 재생: 다음 블록(거래가 있는 블록 단위). 끝이면 null.
export function nextBlock(range, current) {
  const next = range.blocks.find(b => b > current);
  return next ?? null;
}

// 슬라이더가 onset을 지나갔는지 (prev < onset <= next)
export function crossedOnset(prev, next, onsetBlock) {
  if (onsetBlock === null || onsetBlock === undefined) return false;
  return prev < onsetBlock && next >= onsetBlock;
}
