// 원자료 화면의 거래 로그 표 행 (순수 함수). 입력: 거래 행(timeseries)과 view.decision.
// 핵심 출금 행: decision.decisive(핵심 시점)의 출금 행, 또는 최대 단일 출금 행(facts.largestWithdraw).
import { DEPOSIT_ACTIONS, WITHDRAW_ACTIONS } from "./series.js";

export const ACTION_LABELS = {
  deposit: "입금",
  stake: "스테이킹(맡기기)",
  fund_reward_pool: "보상 풀 입금(운영자)",
  withdraw: "출금",
  unstake: "언스테이킹(돌려받기)",
  owner_withdraw_all: "전액 인출"
};

export function rawRows(rows, decision) {
  const decisiveBlock = decision?.decisive?.block ?? null;
  const largest = decision?.facts?.largestWithdraw ?? null;
  return rows.map((r, i) => {
    const kind = DEPOSIT_ACTIONS.has(r.action) ? "deposit" : WITHDRAW_ACTIONS.has(r.action) ? "withdraw" : "other";
    const amount = Number(r.amount_eth) || 0;
    const failed = kind === "withdraw" && amount === 0;
    const isLargest = Boolean(largest) && kind === "withdraw" && r.block === largest.block && String(r.to).toLowerCase() === largest.to && amount === largest.amountEth;
    const key = kind === "withdraw" && (isLargest || (decisiveBlock !== null && r.block === decisiveBlock));
    return {
      i, block: r.block, action: r.action, actionLabel: ACTION_LABELS[r.action] ?? r.action, kind,
      from: r.from, to: r.to, amount, failed, key, balance: r.contract_balance_eth
    };
  });
}
