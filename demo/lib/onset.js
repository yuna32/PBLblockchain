// 사기 발현 시점(onset)과 시점 이벤트.
//
// 사기 분류: dynamic.fraud_type_hint가 FRAUD_HINTS 중 하나일 때만 사기다.
//   unclassified_warning, unknown, normal_staking, 값 없음은 비사기.
// onset: 사기로 분류된 경우에만 값이 있다 = 첫 출금 블록(자금 유출 시작, 금액 > 0인 출금 계열 행).
//   비사기거나 유출이 없으면 null.
// events: 분류와 관계없이 항상 계산하고, CSV 행 순서대로 정렬한다. 해당 없는 이벤트는 생략.
//   inflow_stop           마지막 입금 (입금 계열 행 중 마지막)
//   first_withdraw        첫 출금 (출금 계열, 금액 > 0)
//   owner_withdraw_all    첫 owner 전액 인출 (action 이름 기준, 수령자는 따지지 않음)
//   first_failed_withdraw 첫 실패 출금 (출금 계열, 금액 0)
// rows: CSV 행 객체(값은 문자열이든 숫자든 된다), dynamic: 리포트의 dynamic 객체.

export const FRAUD_HINTS = new Set(["ponzi_scheme", "rug_pull", "money_laundering", "pump_and_dump", "flash_loan"]);

// analysis/dynamic_analyzer.js의 DEPOSIT_ACTIONS / WITHDRAW_ACTIONS와 같은 집합
const DEPOSIT_ACTIONS  = new Set(["deposit", "stake", "fund_reward_pool"]);
const WITHDRAW_ACTIONS = new Set(["withdraw", "unstake", "owner_withdraw_all"]);

const EVENT_LABELS = {
  inflow_stop:           "마지막 입금",
  first_withdraw:        "첫 출금",
  owner_withdraw_all:    "첫 owner 전액 인출",
  first_failed_withdraw: "첫 실패 출금"
};

export function isFraudHint(hint) {
  return FRAUD_HINTS.has(hint);
}

function amountOf(row) {
  const n = parseFloat(row.amount_eth);
  return Number.isNaN(n) ? 0 : n;
}

export function computeOnset(rows, dynamic) {
  const found = {};
  rows.forEach((row, index) => {
    if (DEPOSIT_ACTIONS.has(row.action)) found.inflow_stop = index;
    if (WITHDRAW_ACTIONS.has(row.action)) {
      const amount = amountOf(row);
      if (amount > 0 && found.first_withdraw === undefined) found.first_withdraw = index;
      if (amount === 0 && found.first_failed_withdraw === undefined) found.first_failed_withdraw = index;
    }
    if (row.action === "owner_withdraw_all" && found.owner_withdraw_all === undefined) found.owner_withdraw_all = index;
  });

  // 같은 행이 여러 이벤트면(예: 첫 출금이 곧 owner 전액 인출) EVENT_LABELS 순서로 둔다
  const typeOrder = Object.keys(EVENT_LABELS);
  const events = Object.entries(found)
    .sort(([ta, ia], [tb, ib]) => ia - ib || typeOrder.indexOf(ta) - typeOrder.indexOf(tb))
    .map(([type, index]) => ({ type, block: parseInt(rows[index].block, 10), label: EVENT_LABELS[type] }));

  const firstWithdraw = events.find(e => e.type === "first_withdraw");
  const onset = isFraudHint(dynamic?.fraud_type_hint) && firstWithdraw
    ? { block: firstWithdraw.block, type: "first_withdraw", label: EVENT_LABELS.first_withdraw }
    : null;

  return { onset, events };
}
