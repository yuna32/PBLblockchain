// 판정 근거(decision): 거래 행 + 리포트 → 화면용 판정 사슬·수치·문구. 순수 함수이고 리포트 원본은 바꾸지 않는다.
//
// 분석기 대응 (analysis/dynamic_analyzer.js, 읽기 전용 — 이 파일은 같은 계산을 화면용으로 다시 한다):
//   8-9행      DEPOSIT_ACTIONS / WITHDRAW_ACTIONS
//   231-235행  입금·출금 행, 최고 잔고(peak), 최대 단일 출금
//   241-251행  singleLargeOutflow(최고 잔고의 70% 이상), distributedInflow(입금자 5명 이상)
//   253-263행  ownerWithdrawAll(최대 출금 수령자가 입금자가 아님)
//   265-273행  participantMidExit(마지막 블록 전, owner_withdraw_all이 아닌 성공 출금)
//   275-289행  펌프앤덤프 조건(성공·실패 출금 혼재, 내부자 수익 추출 = 한 출금이 그 주소의 입금 합계보다 큼)
//   296-335행  OWNER_ADDRESS, 비오너 출금 성공률(ε 5%), 실패 시점 잔고(최댓값), PUMPDUMP ε 0
//   358-361행  ZeroWithdrawBlock(출금 차단 경고)
//   373-443행  판정 우선순위: 플래시론 → 펌프앤덤프 → 자금세탁 → 러그풀 → 폰지 → 출금 차단 경고 → 정상 → 판정 불가
// 신호(BALANCE_DROP, FLOW_SPIKE, OSCILLATING_BALANCE)는 다시 계산하지 않고 report.dynamic.triggered_rules를 쓴다.
// 분석기 임계값은 함수 안 지역 상수라 가져올 수 없어 THRESHOLDS에 같은 값을 둔다.
// demo/test/decision.test.js가 5개 시나리오에서 재계산한 유형·수치가 report.dynamic.fraud_type_hint와
// reasoning_steps의 숫자와 같은지 고정한다(어긋나면 이 파일을 분석기에 억지로 맞추지 말고 원인을 확인한다).
//
// 플래시론은 제외된 유형이라 판정 사슬·문구에 이름을 내지 않는다(그 경우 결론은 "판단 불가").
// 화면 문구의 숫자는 모두 facts에서 formatPercent·formatEth로 만든다.

import { glossaryLabel } from "./glossary.js";
import { computeRugPullAxiom } from "../../analysis/dynamic_analyzer.js";

export const DECISION_VERSION = 1;

// 러그풀 축 적용 범위 밖 사유 (report.dynamic.rugpull_axiom.scope.reason). "정상"이 아니라
// "이 장부로는 판단할 수 없음"이다. 화면은 이 문구를 decision.rugpull.scope로 받는다.
export const RUG_SCOPE_REASONS = Object.freeze({
  eoa:              { label: "개인 지갑",       text: "입금 받은 주소가 개인 지갑이라 입금·출금의 뜻이 컨트랙트와 다릅니다" },
  no_flow:          { label: "흐름 없음",       text: "입금이나 실제로 돈이 나간 출금이 없어 비교할 흐름이 없습니다" },
  pass_through:     { label: "반복 중계",       text: "들어온 돈을 같은 금액으로 바로 내보내는 거래가 대부분이라 중계 기록으로 봅니다" },
  no_wallet_ledger: { label: "지갑별 기록 없음", text: "지갑별 거래가 아니라 블록 단위로 합친 자료라 누가 얼마를 가져갔는지 알 수 없습니다" }
});

// 러그풀 축에서 본 돈의 모양 (판정 조건 화면의 러그풀·폰지 비교에 쓴다)
export const RUG_SHAPES = Object.freeze({
  concentrated:    { label: "한쪽이 몰아 가져감",          text: "원금을 넘는 돈이 빠져나갔고, 원금 이상을 돌려받은 참여자가 기준보다 적습니다" },
  shared:          { label: "여럿이 나눠 가짐",            text: "원금을 넘는 돈이 빠져나갔지만, 원금 이상을 돌려받은 참여자가 기준 이상입니다" },
  below_threshold: { label: "원금을 넘는 유출이 기준 미만", text: "원금을 넘어 빠져나간 돈이 기준보다 적습니다" },
  out_of_scope:    { label: "이 장부로는 판단할 수 없음",   text: "러그풀 여부를 판단할 수 있는 거래 기록이 아닙니다" }
});

// 판정 설정. 운영자(배포자) 주소는 이곳 한 곳에서만 정한다.
// 기본값은 시뮬레이션의 배포자(hardhat 기본 계정 0, analysis/dynamic_analyzer.js 296행과 같은 값).
// 실제 주소 데이터가 들어오면 buildDecision({ config: { ownerAddress } })로 바꾼다. 화면(대시보드)은 decision.ownerAddress를 쓴다.
export const DEFAULT_DECISION_CONFIG = Object.freeze({
  ownerAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
});

// analysis/dynamic_analyzer.js의 값과 같아야 한다 (242, 250, 300, 309행, FLOW_SPIKE 규칙 133-140행)
// flowSpikeRatio는 신호를 다시 계산하는 데 쓰지 않고 화면 설명(조건 이름)에만 쓴다.
export const THRESHOLDS = Object.freeze({
  singleLargeOutflowRatio: 0.70,
  distributedInflowMin: 5,
  nonOwnerSuccessMax: 0.05,
  pumpBalanceAtFailureMax: 0,
  flowSpikeRatio: 0.5
});

// 조사 "(으)로": 마지막 글자에 받침이 없거나 ㄹ이면 "로", 그 밖의 받침이면 "으로". 한글이 아니면 "(으)로".
export function withRo(word) {
  const s = String(word ?? "");
  const code = s.charCodeAt(s.length - 1);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return `${s}(으)로`;
  const jong = (code - 0xac00) % 28;
  return `${s}${jong === 0 || jong === 8 ? "로" : "으로"}`;
}

const DEPOSIT_ACTIONS  = new Set(["deposit", "stake", "fund_reward_pool"]);
const WITHDRAW_ACTIONS = new Set(["withdraw", "unstake", "owner_withdraw_all"]);
const FRAUD_HINTS = new Set(["ponzi_scheme", "rug_pull", "money_laundering", "pump_and_dump"]);
// 원금 회수 비교의 부동소수점 허용치
const EPS = 1e-9;

export const TYPE_LABELS = {
  pump_and_dump:        "펌프앤덤프",
  money_laundering:     "자금세탁",
  rug_pull:             "러그풀",
  ponzi_scheme:         "폰지",
  unclassified_warning: "출금 차단 경고",
  normal_staking:       "정상 스테이킹"
};

export const CONCLUSION_LABELS = { risk: "위험", caution: "주의", no_evidence: "근거 없음", undetermined: "판단 불가" };

// ── 숫자 표시 (화면 문구의 비율·금액은 이 두 함수로만 만든다) ──
// half-up 반올림. 이진 부동소수점 오차(예: 104.45 → 104.44999…)를 12자리 유효숫자로 먼저 정리한다.
export function roundHalfUp(x, digits) {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** digits;
  const scaled = Number((Math.abs(x) * f).toPrecision(12));
  return Math.sign(x) * (Math.floor(scaled + 0.5) / f);
}

// 비율(0~1) → "37.5%" / "100%": 정수면 정수, 아니면 소수 첫째 자리
export function formatPercent(ratio) {
  const v = roundHalfUp(ratio * 100, 1);
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

// ETH 금액 → 소수 셋째 자리까지(끝의 0은 지움)
export function formatEth(x) {
  return String(roundHalfUp(x, 3));
}

// 분석기와 같은 파싱: parseFloat(...) || 0
const num = x => parseFloat(x) || 0;
const int = x => parseInt(x) || 0;
const lower = a => String(a ?? "").toLowerCase();

// ── 사실(facts): 분석기와 같은 계산 + 화면용 집계 ──
function computeFacts(rows, report, config) {
  const owner = lower(config.ownerAddress);
  const deposits    = rows.filter(r => DEPOSIT_ACTIONS.has(r.action));
  const withdrawals = rows.filter(r => WITHDRAW_ACTIONS.has(r.action));
  const ids = new Set((report.dynamic?.triggered_rules ?? []).map(r => r.id));

  const peak = Math.max(0, ...rows.map(r => num(r.contract_balance_eth)));
  const maxSingle = Math.max(0, ...withdrawals.map(r => num(r.amount_eth)));
  const depositFrom = new Set(deposits.map(r => r.from));
  const singleLargeOutflow = peak > 0 && maxSingle >= peak * THRESHOLDS.singleLargeOutflowRatio;
  const distributedInflow = depositFrom.size >= THRESHOLDS.distributedInflowMin;

  const largestW = withdrawals.reduce((best, r) => (num(r.amount_eth) > num(best?.amount_eth) ? r : best), null);
  const ownerWithdrawAll = largestW ? !depositFrom.has(largestW.to) : false;

  const lastBlock = int(rows[rows.length - 1]?.block);
  const midExits = withdrawals.filter(r => r.action !== "owner_withdraw_all" && num(r.amount_eth) > 0 && int(r.block) < lastBlock);

  const succeeded = withdrawals.filter(r => num(r.amount_eth) > 0);
  const failed    = withdrawals.filter(r => num(r.amount_eth) === 0);
  const depositorAmt = new Map();
  for (const r of deposits) depositorAmt.set(r.from, (depositorAmt.get(r.from) || 0) + num(r.amount_eth));
  const insiderRows = withdrawals.filter(r => {
    const received = num(r.amount_eth);
    return received > 0 && received > (depositorAmt.get(r.to) || 0);
  });

  const nonOwner = withdrawals.filter(r => lower(r.to) !== owner);
  const nonOwnerSucceeded = nonOwner.filter(r => num(r.amount_eth) > 0);
  const nonOwnerSuccessRate = nonOwner.length > 0 ? nonOwnerSucceeded.length / nonOwner.length : 0;
  const withdrawSuccessRate = withdrawals.length > 0 ? succeeded.length / withdrawals.length : 0;
  const failedBalances = failed.map(r => num(r.contract_balance_eth));
  const balanceAtFailure = failedBalances.length > 0 ? Math.max(...failedBalances) : 0;
  const zeroWithdrawBlock = nonOwner.length > 0 && nonOwnerSuccessRate <= THRESHOLDS.nonOwnerSuccessMax && balanceAtFailure > 0;

  const totalIn = deposits.reduce((s, r) => s + num(r.amount_eth), 0);
  const ownerDeposits = deposits.filter(r => lower(r.from) === owner);
  const participantDeposits = deposits.filter(r => lower(r.from) !== owner);

  return {
    rowCount: rows.length,
    depositCount: deposits.length,
    withdrawCount: withdrawals.length,
    withdrawSuccessCount: succeeded.length,
    withdrawFailCount: failed.length,
    withdrawSuccessRate,
    totalInEth: totalIn,
    ownerDepositEth: ownerDeposits.reduce((s, r) => s + num(r.amount_eth), 0),
    participantDepositCount: participantDeposits.length,
    peakBalanceEth: peak,
    finalBalanceEth: num(rows[rows.length - 1]?.contract_balance_eth),
    maxSingleWithdrawEth: maxSingle,
    maxSingleWithdrawRatio: peak > 0 ? maxSingle / peak : 0,
    largestWithdraw: largestW ? {
      to: lower(largestW.to), block: int(largestW.block), action: largestW.action, amountEth: num(largestW.amount_eth),
      balanceAfterEth: num(largestW.contract_balance_eth), toIsOwner: lower(largestW.to) === owner
    } : null,
    uniqueDepositorCount: depositFrom.size,
    ownerIsDepositor: ownerDeposits.length > 0,
    singleLargeOutflow,
    distributedInflow,
    ownerWithdrawAll,
    midExitCount: midExits.length,
    participantMidExit: midExits.length > 0,
    someWithdrawalsSucceed: succeeded.length > 0,
    someWithdrawalsFail: failed.length > 0,
    insiderExit: insiderRows.length > 0,
    nonOwnerWithdrawCount: nonOwner.length,
    nonOwnerSuccessCount: nonOwnerSucceeded.length,
    nonOwnerSuccessRate,
    balanceAtFailureEth: balanceAtFailure,
    zeroWithdrawBlock,
    signals: { BALANCE_DROP: ids.has("BALANCE_DROP"), FLOW_SPIKE: ids.has("FLOW_SPIKE"), OSCILLATING_BALANCE: ids.has("OSCILLATING_BALANCE") },
    hasStakePattern: rows.some(r => r.action === "stake" || r.action === "unstake"),
    lastBlock,
    firstDepositBlock: participantDeposits.length ? int(participantDeposits[0].block) : null,
    lastDepositBlock: participantDeposits.length ? int(participantDeposits[participantDeposits.length - 1].block) : null,
    firstWithdrawBlock: withdrawals.length ? Math.min(...withdrawals.map(r => int(r.block))) : null,
    // 화면용 행 목록 (집계·말풍선에만 쓴다)
    _rows: { deposits, withdrawals, midExits, failed, insiderRows, participantDeposits }
  };
}

// 러그풀 축: 분석기 결과(report.dynamic.rugpull_axiom)를 원천으로 쓴다. 예전 리포트처럼 필드가 없으면
// 분석기와 같은 함수(computeRugPullAxiom)로 같은 행에서 계산한다. 화면용 문구·표시 숫자를 덧붙인다.
function rugAxisOf(report, rows) {
  const a = report.dynamic?.rugpull_axiom ?? computeRugPullAxiom(rows);
  const th = a.thresholds;
  const shape = !a.scope.inScope ? "out_of_scope"
    : !a.netDrain.met ? "below_threshold"
    : a.sharedProfit.met ? "shared" : "concentrated";
  const reason = a.scope.reason ? RUG_SCOPE_REASONS[a.scope.reason] ?? { label: a.scope.reason, text: a.scope.reason } : null;
  return {
    ...a,
    scope: { ...a.scope, reasonLabel: reason?.label ?? null, reasonText: reason?.text ?? null },
    shape, shapeLabel: RUG_SHAPES[shape].label, shapeText: RUG_SHAPES[shape].text,
    // 화면 숫자 (모두 위 값에서 만든다)
    display: {
      netDrain: a.netDrain.value === null ? null : formatPercent(a.netDrain.value),
      netDrainThreshold: formatPercent(th.netDrain),
      profitRatio: formatPercent(th.profitRatio),
      profitSharersThreshold: `${th.profitSharers}명`,
      profitSharers: a.sharedProfit.count === null ? null : `${a.sharedProfit.count}명`,
      netOutflowEth: a.netDrain.netOutflowEth === null ? null : formatEth(a.netDrain.netOutflowEth),
      peakBalanceEth: formatEth(a.netDrain.peakBalanceEth)
    }
  };
}

// 분석기 hintFraudType()의 우선순위 그대로 (러그풀 단계는 rugpull_axiom.verdict)
function hintOf(f, rug) {
  if (f.rowCount === 0) return "unknown";
  if (f.signals.OSCILLATING_BALANCE) return "flash_loan";
  if (f.someWithdrawalsSucceed && f.someWithdrawalsFail && f.insiderExit && f.balanceAtFailureEth <= THRESHOLDS.pumpBalanceAtFailureMax) return "pump_and_dump";
  if (f.singleLargeOutflow && f.distributedInflow && !f.ownerWithdrawAll) return "money_laundering";
  if (rug.verdict) return "rug_pull";
  if (f.signals.BALANCE_DROP && f.signals.FLOW_SPIKE && f.participantMidExit) return "ponzi_scheme";
  if (f.zeroWithdrawBlock) return "unclassified_warning";
  if (f.hasStakePattern) return "normal_staking";
  return "unknown";
}

// ── 원금 회수 집계 (정의 A: 출금 합계 < 입금 합계면 "원금을 돌려받지 못함") ──
// 참여자 = 입금한 지갑 중 운영자 제외. 자금세탁은 모은 지갑(최대 출금 수령자)을, 펌프앤덤프는 내부자(받은 돈 > 넣은 돈)를 따로 센다.
function computePrincipal(f, hint, config) {
  const owner = lower(config.ownerAddress);
  const wallets = new Map();
  const get = a => { if (!wallets.has(a)) wallets.set(a, { address: a, depositEth: 0, receivedEth: 0, failedCount: 0, insider: false }); return wallets.get(a); };
  for (const r of f._rows.deposits) get(lower(r.from)).depositEth += num(r.amount_eth);
  for (const r of f._rows.withdrawals) {
    const w = get(lower(r.to));
    w.receivedEth += num(r.amount_eth);
    if (num(r.amount_eth) === 0) w.failedCount++;
  }
  for (const r of f._rows.insiderRows) get(lower(r.to)).insider = true;

  const participants = [...wallets.values()].filter(w => w.depositEth > 0 && w.address !== owner);
  const collector = hint === "money_laundering" && f.largestWithdraw && participants.some(w => w.address === f.largestWithdraw.to)
    ? f.largestWithdraw.to : null;
  const counted = participants.filter(w => w.address !== collector);
  const insiders = hint === "pump_and_dump" ? counted.filter(w => w.insider) : [];
  const classify = w => (w.receivedEth <= EPS ? "none" : w.receivedEth >= w.depositEth - EPS ? "full" : "partial");
  const tally = list => {
    const c = { full: 0, partial: 0, none: 0 };
    for (const w of list) c[classify(w)]++;
    return {
      count: list.length, fullCount: c.full, partialCount: c.partial, noneCount: c.none,
      unrecoveredCount: c.partial + c.none,
      depositEth: list.reduce((s, w) => s + w.depositEth, 0),
      receivedEth: list.reduce((s, w) => s + w.receivedEth, 0),
      receivedCount: list.filter(w => w.receivedEth > EPS).length
    };
  };
  const late = hint === "pump_and_dump" ? counted.filter(w => !w.insider) : null;
  return {
    participantWalletCount: participants.length,
    collector: collector ? { address: collector, ...tally(participants.filter(w => w.address === collector)) } : null,
    participants: tally(counted),
    insiders: hint === "pump_and_dump" ? tally(insiders) : null,
    late: late ? { ...tally(late), failedWithdrawCount: late.reduce((s, w) => s + w.failedCount, 0) } : null,
    ownerReceivedEth: wallets.get(owner)?.receivedEth ?? 0
  };
}

// "참여자 {n}명" (+ 일부만 받은 사람이 있으면 밝힌다)
function unrecoveredText(t, noun = "참여자") {
  return `${noun} ${t.unrecoveredCount}명${t.partialCount > 0 ? `(일부만 받은 ${t.partialCount}명 포함)` : ""}`;
}

// ── 판정 사슬 ──
// status: met | unmet | no_data(데이터 없음) | out_of_scope(러그풀 축 적용 범위 밖, 판단 불가)
const cond = (id, label, met, valueText, unmetText, extra = {}) => ({
  id, label, met,
  status: extra.outOfScope ? "out_of_scope" : extra.noData ? "no_data" : met ? "met" : "unmet",
  valueText, unmetText,
  ...(extra.bar ? { bar: extra.bar } : {})
});

// 러그풀 3단: ① 판단할 수 있는 기록인가 ② 원금을 넘는 돈이 빠져나갔나 ③ 한쪽이 몰아 가져갔나
function rugConditions(rug) {
  const { thresholds: th, scope: sc, netDrain: nd, sharedProfit: sp, display: d } = rug;
  const out = !sc.inScope;
  return [
    cond("rug_scope", "① 판단할 수 있는 거래 기록인가", sc.inScope,
      sc.inScope ? "판단할 수 있음" : `판단할 수 없음 · ${sc.reasonLabel}`,
      sc.inScope ? "이 기록으로는 러그풀 여부를 판단할 수 없음"
        : `이 기록으로는 러그풀 여부를 판단할 수 없음 (${sc.reasonLabel}: ${sc.reasonText})`,
      { outOfScope: out }),
    cond("net_drain", `② 원금을 넘는 돈이 빠져나갔나 (최고 잔고의 ${d.netDrainThreshold} 이상)`, nd.met,
      d.netDrain === null ? "계산할 수 없음" : `최고 잔고의 ${d.netDrain}`,
      d.netDrain === null ? "원금을 넘어 빠져나간 돈을 계산할 수 없음"
        : `원금을 넘어 빠져나간 돈이 최고 잔고의 ${d.netDrain}로 기준(${d.netDrainThreshold})에 못 미침`,
      { outOfScope: out,
        bar: nd.value === null ? null : { value: nd.value, threshold: th.netDrain, max: Math.max(1, nd.value), unit: "ratio", direction: "above" } }),
    cond("not_shared_profit", `③ 한쪽이 몰아 가져갔나 (원금의 ${d.profitRatio} 이상 돌려받은 참여자 ${d.profitSharersThreshold} 미만)`, !sp.met,
      d.profitSharers === null ? "계산할 수 없음" : d.profitSharers,
      `원금의 ${d.profitRatio} 이상 돌려받은 참여자가 ${d.profitSharers}이라 여럿이 나눠 가진 모양`,
      { outOfScope: out,
        bar: sp.count === null ? null : { value: sp.count, threshold: th.profitSharers, max: Math.max(th.profitSharers * 2, sp.count), unit: "count", direction: "below" } })
  ];
}

function buildSteps(f, rug) {
  const pct = formatPercent, eth = formatEth;
  const single = () => cond("single_large_outflow", `한 번에 빠진 돈이 최고 잔고의 ${pct(THRESHOLDS.singleLargeOutflowRatio)} 이상`,
    f.singleLargeOutflow, `최고 잔고의 ${pct(f.maxSingleWithdrawRatio)}`,
    `한 번에 빠진 돈이 최고 잔고의 ${pct(f.maxSingleWithdrawRatio)}로 기준(${pct(THRESHOLDS.singleLargeOutflowRatio)})에 못 미침`,
    { bar: { value: f.maxSingleWithdrawRatio, threshold: THRESHOLDS.singleLargeOutflowRatio, max: 1, unit: "ratio", direction: "above" }, noData: f.peakBalanceEth <= 0 });
  return [
    { type: "pump_and_dump", question: "먼저 빠져나간 사람 뒤로 출금이 막혔나?", conditions: [
      cond("mixed_withdrawals", "성공한 출금과 실패한 출금이 섞여 있음", f.someWithdrawalsSucceed && f.someWithdrawalsFail,
        `성공 ${f.withdrawSuccessCount}건 · 실패 ${f.withdrawFailCount}건`,
        f.withdrawFailCount === 0 ? "실패한 출금이 없음" : "성공한 출금이 없음", { noData: f.withdrawCount === 0 }),
      cond("insider_exit", "넣은 돈보다 더 받아 간 출금이 있음", f.insiderExit,
        f.insiderExit ? "있음" : "없음", "넣은 돈보다 더 받아 간 출금이 없음", { noData: f.withdrawCount === 0 }),
      cond("balance_at_failure_zero", "출금이 실패한 시점의 잔고가 0", f.balanceAtFailureEth <= THRESHOLDS.pumpBalanceAtFailureMax,
        f.withdrawFailCount ? `${eth(f.balanceAtFailureEth)} ETH` : "실패한 출금 없음",
        `출금이 실패한 시점에도 잔고 ${eth(f.balanceAtFailureEth)} ETH가 남아 있음`, { noData: f.withdrawFailCount === 0 })
    ] },
    { type: "money_laundering", question: "여러 지갑의 돈을 입금자 지갑 하나로 모아 뺐나?", conditions: [
      single(),
      cond("distributed_inflow", `입금한 지갑이 ${THRESHOLDS.distributedInflowMin}개 이상`, f.distributedInflow,
        f.ownerIsDepositor ? `${f.uniqueDepositorCount}개 (운영자 1개 포함)` : `${f.uniqueDepositorCount}개`,
        `입금한 지갑이 ${f.uniqueDepositorCount}개로 기준(${THRESHOLDS.distributedInflowMin}개)보다 적음`,
        { bar: { value: f.uniqueDepositorCount, threshold: THRESHOLDS.distributedInflowMin, max: Math.max(10, f.uniqueDepositorCount), unit: "count", direction: "above" } }),
      cond("recipient_is_depositor", "그 돈을 받은 주소가 입금자 중 하나", Boolean(f.largestWithdraw) && !f.ownerWithdrawAll,
        f.largestWithdraw ? (f.ownerWithdrawAll ? "아니요" : "예") : "출금 없음",
        f.largestWithdraw ? "큰 출금을 받은 주소가 입금한 적 없는 주소" : "출금이 없음", { noData: !f.largestWithdraw })
    ] },
    { type: "rug_pull", question: "넣은 돈보다 많은 돈을 한쪽이 몰아 가져갔나?", conditions: rugConditions(rug) },
    { type: "ponzi_scheme", question: "새로 들어온 돈으로 앞사람에게 돌려줬나?", conditions: [
      cond("balance_drop", `${glossaryLabel("BALANCE_DROP")} 신호`, f.signals.BALANCE_DROP, f.signals.BALANCE_DROP ? "있음" : "없음",
        `${glossaryLabel("BALANCE_DROP")} 신호가 없음`),
      cond("flow_spike", `${glossaryLabel("FLOW_SPIKE")} 신호 (누적 출금이 입금의 ${pct(THRESHOLDS.flowSpikeRatio)} 이상)`, f.signals.FLOW_SPIKE, f.signals.FLOW_SPIKE ? "있음" : "없음",
        `${glossaryLabel("FLOW_SPIKE")} 신호가 없음`),
      cond("mid_exit", "참여자 중도 출금이 있음", f.participantMidExit, `${f.midExitCount}건`, "참여자 중도 출금이 없음")
    ] },
    { type: "unclassified_warning", question: "참여자의 출금이 막혀 있나?", conditions: [
      cond("non_owner_attempts", "운영자 외 출금 시도가 있음", f.nonOwnerWithdrawCount > 0, `${f.nonOwnerWithdrawCount}건`, "운영자 외 출금 시도가 없음"),
      cond("non_owner_success_low", `운영자 외 출금 성공률 ${pct(THRESHOLDS.nonOwnerSuccessMax)} 이하`,
        f.nonOwnerWithdrawCount > 0 && f.nonOwnerSuccessRate <= THRESHOLDS.nonOwnerSuccessMax,
        f.nonOwnerWithdrawCount ? pct(f.nonOwnerSuccessRate) : "출금 시도 없음",
        `운영자 외 출금 성공률이 ${pct(f.nonOwnerSuccessRate)}로 기준(${pct(THRESHOLDS.nonOwnerSuccessMax)} 이하)보다 높음`,
        { bar: { value: f.nonOwnerSuccessRate, threshold: THRESHOLDS.nonOwnerSuccessMax, max: 1, unit: "ratio", direction: "below" }, noData: f.nonOwnerWithdrawCount === 0 }),
      cond("balance_left_at_failure", "출금이 실패한 시점에도 잔고가 남아 있음", f.balanceAtFailureEth > 0,
        f.withdrawFailCount ? `${eth(f.balanceAtFailureEth)} ETH` : "실패한 출금 없음",
        f.withdrawFailCount ? "출금이 실패한 시점의 잔고가 0 ETH" : "실패한 출금이 없음", { noData: f.withdrawFailCount === 0 })
    ] },
    { type: "normal_staking", question: "맡기고 돌려받는 스테이킹 거래인가?", conditions: [
      cond("stake_pattern", "스테이킹(stake·unstake) 거래가 있음", f.hasStakePattern, f.hasStakePattern ? "있음" : "없음",
        "스테이킹(맡기고 돌려받기) 거래가 없음")
    ] }
  ].map((s, i) => ({ ...s, no: i + 1, label: TYPE_LABELS[s.type], matched: s.conditions.every(c => c.met) }));
}

function conclusionOf(hint, normalClean) {
  if (FRAUD_HINTS.has(hint)) return "risk";
  if (hint === "unclassified_warning") return "caution";
  if (hint === "normal_staking") return normalClean ? "no_evidence" : "caution";
  return "undetermined";
}

// 번호 목록 → "1번" / "1·2번" / "1~4번"
function numbersText(nums) {
  if (nums.length === 0) return "";
  if (nums.length === 1) return `${nums[0]}번`;
  if (nums.length === 2) return `${nums[0]}·${nums[1]}번`;
  return `${nums[0]}~${nums[nums.length - 1]}번`;
}

function chainSummary(shown, matchedStep, hint, conclusion) {
  const no = shown.filter(s => !s.matched).map(s => s.no);
  const badge = CONCLUSION_LABELS[conclusion];
  if (!matchedStep) return `${numbersText(no)} 모두 아니요 → ${badge}`;
  const head = [no.length ? `${numbersText(no)} 아니요` : null, `${matchedStep.no}번 예`].filter(Boolean).join(", ");
  const type = FRAUD_HINTS.has(hint) ? `${TYPE_LABELS[hint]} 의심` : TYPE_LABELS[hint];
  return `${head} → ${type} → ${badge}`;
}

// 다른 유형이 아닌 이유: 사기 유형 4개 + 출금 차단 경고 중 판정된 유형을 뺀 것. 첫 번째 미충족 조건을 이유로 쓴다.
function whyNotOf(steps, matchedStep) {
  return steps.filter(s => s.type !== "normal_staking" && s.type !== matchedStep?.type).map(s => {
    const miss = s.conditions.find(c => !c.met);
    const checked = !matchedStep || s.no < matchedStep.no;
    return {
      type: s.type, label: s.label, checked,
      reason: miss ? miss.unmetText
        : `${s.label} 조건도 일부 맞지만, 판정 순서상 앞선 ${matchedStep.label} 조건이 먼저 충족돼 ${withRo(matchedStep.label)} 판정했습니다`
    };
  });
}

// 구간과 표시 시점 (차트용): 참여자 입금 → 대기 → 유형별 사건
function timelineOf(f, hint, principal, config) {
  const W = f._rows.withdrawals;
  const blockOf = r => (r ? int(r.block) : null);
  const ownerDrain = W.filter(r => r.to && lower(r.to) === lower(config.ownerAddress) && num(r.amount_eth) > 0);
  const firstFail = f._rows.failed[0] ?? null;
  const firstMidExit = f._rows.midExits[0] ?? null;
  const firstInsider = principal.insiders ? W.find(r => num(r.amount_eth) > 0 && f._rows.insiderRows.includes(r)) : null;
  const drain = f.largestWithdraw;
  let events = [], decisive = null;
  switch (hint) {
    case "rug_pull":
      events = [{ block: drain.block, label: "운영자 인출 이후" }];
      decisive = { block: drain.block, label: "운영자 인출 시점" };
      break;
    case "money_laundering":
      events = [{ block: drain.block, label: "한 지갑 인출 이후" }];
      decisive = { block: drain.block, label: "한 지갑이 인출한 시점" };
      break;
    case "ponzi_scheme": {
      const od = ownerDrain.length ? ownerDrain.reduce((a, b) => (num(b.amount_eth) > num(a.amount_eth) ? b : a)) : null;
      events = [firstMidExit && { block: blockOf(firstMidExit), label: "중도 출금" }, od && { block: blockOf(od), label: "운영자 인출 이후" }].filter(Boolean);
      decisive = od ? { block: blockOf(od), label: "운영자 인출 시점" } : null;
      break;
    }
    case "pump_and_dump":
      events = [firstInsider && { block: blockOf(firstInsider), label: "내부자 출금" }, firstFail && { block: blockOf(firstFail), label: "출금 실패 이후" }].filter(Boolean);
      decisive = firstFail ? { block: blockOf(firstFail), label: "후발 참여자 출금이 막힌 시점" } : null;
      break;
    case "unclassified_warning":
      events = firstFail ? [{ block: blockOf(firstFail), label: "출금 실패 이후" }] : [];
      decisive = firstFail ? { block: blockOf(firstFail), label: "출금이 막힌 시점" } : null;
      break;
    default:
      events = f.firstWithdrawBlock !== null ? [{ block: f.firstWithdrawBlock, label: hint === "normal_staking" ? "참여자 출금" : "출금 이후" }] : [];
  }
  events = events.filter(e => e.block !== null).sort((a, b) => a.block - b.block);
  const segments = [];
  if (f.firstDepositBlock !== null) {
    const depEnd = events.length ? Math.min(f.lastDepositBlock, events[0].block) : f.lastDepositBlock;
    segments.push({ key: "deposit", label: `참여자 입금 ${f.participantDepositCount}회`, from: f.firstDepositBlock, to: depEnd });
    if (events.length && events[0].block > f.lastDepositBlock) {
      segments.push({ key: "wait", label: "대기", from: f.lastDepositBlock, to: events[0].block });
    }
  }
  events.forEach((e, i) => segments.push({ key: `event${i + 1}`, label: e.label, from: e.block, to: events[i + 1]?.block ?? f.lastBlock }));
  return { segments, decisive, firstFail, firstMidExit, firstInsider, ownerDrain };
}

// ── 문구 ──
function buildCopy(f, hint, conclusion, p, tl, onset, rug, owner) {
  const pct = formatPercent, eth = formatEth;
  const th = THRESHOLDS;
  const inflowStopped = tl.segments.some(s => s.key === "wait");
  const lastDepositCallout = inflowStopped ? [{ block: f.lastDepositBlock, kind: "last_deposit", title: "마지막 입금", detail: "이후 새로 들어온 돈 없음" }] : [];
  const midExitRecipients = new Set(f._rows.midExits.map(r => lower(r.to)));
  const firstDepositors = [...new Set(f._rows.participantDeposits.map(r => lower(r.from)))].slice(0, midExitRecipients.size);
  const earliestGotPaid = midExitRecipients.size > 0 && [...midExitRecipients].every(a => firstDepositors.includes(a));
  const midExitEth = f._rows.midExits.reduce((s, r) => s + num(r.amount_eth), 0);
  // 중도 출금 받은 사람들의 입금 합계 → 원금을 넘은 몫. 운영자가 컨트랙트에 돈을 넣었다면 그 몫의 출처를
  // 참여자 입금으로 단정할 수 없으므로 "받은 돈이 입금보다 많았습니다"로만 쓴다.
  const midExitDeposits = f._rows.participantDeposits.filter(r => midExitRecipients.has(lower(r.from))).reduce((s, r) => s + num(r.amount_eth), 0);
  const midExitExcess = midExitEth - midExitDeposits;
  const midExitNote = midExitExcess <= EPS
    ? "중간에 받은 돈은 원금을 넘지 않았습니다"
    : f.ownerDepositEth > 0
      ? "받은 돈이 입금보다 많았습니다"
      : `받은 ${eth(midExitEth)} ETH 중 원금을 넘는 ${eth(midExitExcess)} ETH는 다른 참여자의 입금에서 나왔습니다`;
  const drain = f.largestWithdraw;
  const fullDrain = drain ? drain.balanceAfterEth <= EPS : false;

  let headline, reasons, chartNotes, callouts, note = null;
  switch (hint) {
    case "normal_staking":
      headline = conclusion === "no_evidence"
        ? "분석한 범위에서는 사기 패턴이 보이지 않습니다"
        : "사기 유형 패턴은 보이지 않지만 확인이 필요한 신호가 있습니다";
      reasons = [
        `한 번에 빠져나간 돈은 최고 잔고의 ${pct(f.maxSingleWithdrawRatio)}였습니다`,
        f.nonOwnerSuccessCount === f.nonOwnerWithdrawCount
          ? `참여자 출금 ${f.nonOwnerWithdrawCount}건이 모두 성공했습니다`
          : `참여자 출금 ${f.nonOwnerWithdrawCount}건 중 ${f.nonOwnerSuccessCount}건이 성공했습니다`,
        p.ownerReceivedEth <= EPS
          ? `운영자는 돈을 가져가지 않았습니다(운영자 수령 ${eth(p.ownerReceivedEth)} ETH)`
          : `운영자가 ${eth(p.ownerReceivedEth)} ETH를 받았습니다`
      ];
      chartNotes = [
        p.participants.unrecoveredCount > 0
          ? `${unrecoveredText(p.participants)}이 원금을 돌려받지 못했습니다`
          : p.participants.receivedEth > p.participants.depositEth + EPS
            ? `참여자 ${p.participants.count}명이 맡긴 ${eth(p.participants.depositEth)} ETH보다 많은 ${eth(p.participants.receivedEth)} ETH를 돌려받았습니다`
            : `참여자 ${p.participants.count}명이 맡긴 ${eth(p.participants.depositEth)} ETH를 모두 돌려받았습니다`,
        `한 번에 큰돈이 빠진 적이 없습니다 (최대 ${pct(f.maxSingleWithdrawRatio)})`,
        "신호가 없다고 안전이 보장되는 것은 아닙니다"
      ];
      callouts = f.firstWithdrawBlock !== null ? [{
        block: f.firstWithdrawBlock, kind: "first_withdraw", title: "참여자 출금 시작",
        detail: f.nonOwnerSuccessCount === f.nonOwnerWithdrawCount ? `${f.nonOwnerWithdrawCount}건 모두 돌려받음` : `${f.nonOwnerWithdrawCount}건 중 ${f.nonOwnerSuccessCount}건 성공`
      }] : [];
      note = "신호가 없다고 안전이 보장되는 것은 아닙니다";
      break;
    case "ponzi_scheme":
      headline = "새 입금으로 앞사람에게 수익을 주는 폰지 구조로 보입니다";
      reasons = [
        `${glossaryLabel("BALANCE_DROP")}과 ${glossaryLabel("FLOW_SPIKE")} 신호가 함께 나타났습니다`,
        `참여자 중도 출금이 ${f.midExitCount}건 있었습니다`,
        `참여자 ${p.participants.count}명 중 ${p.participants.fullCount}명만 원금 이상을 돌려받았습니다`
      ];
      chartNotes = [
        `${earliestGotPaid ? "먼저 들어온 " : ""}참여자 ${midExitRecipients.size}명이 중간에 ${eth(midExitEth)} ETH를 받았습니다`,
        midExitNote,
        `남은 ${eth(p.ownerReceivedEth)} ETH는 운영자가 가져갔고, ${unrecoveredText(p.participants)}은 원금을 돌려받지 못했습니다`
      ];
      callouts = [
        ...lastDepositCallout,
        tl.firstMidExit && { block: int(tl.firstMidExit.block), kind: "mid_exit", title: `${earliestGotPaid ? "앞사람이 먼저" : "참여자가 중간에"} 돈을 받음`, detail: `중도 출금 ${f.midExitCount}건, ${eth(midExitEth)} ETH` },
        tl.decisive && { block: tl.decisive.block, kind: "owner_drain", title: "운영자가 남은 잔고를 인출", detail: `${eth(p.ownerReceivedEth)} ETH` }
      ].filter(Boolean);
      break;
    case "rug_pull": {
      // 숫자는 rugpull_axiom(분석기 결과)에서: 순유출 비율, 수익자 수, 원금보다 가장 많이 더 받은 지갑
      const d = rug.display;
      const top = rug.wallets.filter(w => w.drainContributor).reduce((a, b) => (b.netGain > (a?.netGain ?? -Infinity) ? b : a), null);
      const topIsOwner = top && top.address === lower(owner);
      const who = !top ? "한 지갑이" : topIsOwner ? (top.deposited > 0 ? "운영자 지갑이" : "입금한 적이 없는 운영자 지갑이") : "한 지갑이";
      headline = "넣은 돈보다 많은 돈을 한쪽이 몰아 가져갔습니다";
      reasons = [
        `원금을 넘어 빠져나간 돈이 최고 잔고의 ${d.netDrain}입니다 (기준 ${d.netDrainThreshold} 이상)`,
        rug.sharedProfit.count === 0
          ? `원금의 ${d.profitRatio} 이상을 돌려받은 참여자가 없어, 여럿이 나눠 가진 모양이 아닙니다`
          : `원금의 ${d.profitRatio} 이상을 돌려받은 참여자는 ${d.profitSharers}뿐입니다 (기준 ${d.profitSharersThreshold} 미만)`,
        top ? `${who} 원금보다 ${eth(top.netGain)} ETH를 더 가져갔습니다` : "원금보다 더 가져간 지갑을 찾지 못했습니다"
      ];
      chartNotes = [
        `입금이 이어지는 동안 돈이 ${eth(f.peakBalanceEth)} ETH까지 쌓였습니다`,
        top ? `${who} 원금보다 ${eth(top.netGain)} ETH를 더 가져갔습니다` : `원금을 넘어 빠져나간 돈은 ${d.netOutflowEth} ETH입니다`,
        `${unrecoveredText(p.participants)}은 원금을 돌려받지 못했습니다`
      ];
      callouts = [
        ...lastDepositCallout,
        { block: drain.block, kind: "drain", title: `${drain.toIsOwner ? "운영자가" : "한 지갑이"} 잔고를 ${fullDrain ? "전부 인출" : "대부분 인출"}`, detail: `가장 큰 출금 ${eth(drain.amountEth)} ETH` }
      ];
      break;
    }
    case "money_laundering": {
      const counted = p.participants.count;
      headline = "여러 지갑의 소액 입금을 한 지갑으로 모아 내보냈습니다";
      reasons = [
        `${f.uniqueDepositorCount}개 지갑이 평균 ${eth(f.totalInEth / Math.max(1, f._rows.deposits.length))} ETH씩 나눠 입금했습니다`,
        `최고 잔고의 ${pct(f.maxSingleWithdrawRatio)}가 한 번에 빠져나갔습니다`,
        "그 돈을 받은 지갑도 입금했던 지갑 중 하나입니다"
      ];
      chartNotes = [
        `${f.uniqueDepositorCount}개 지갑의 입금이 컨트랙트 한곳에 모였습니다`,
        `모인 ${eth(drain.amountEth)} ETH가 한 지갑으로 한 번에 빠져나갔습니다`,
        `모은 지갑 1개를 뺀 ${counted}개 지갑은 원금을 돌려받지 못했습니다${p.participants.partialCount ? `(일부만 받은 ${p.participants.partialCount}개 포함)` : ""}`
      ].map((s, i) => (i === 2 && p.participants.unrecoveredCount !== counted
        ? `모은 지갑 1개를 뺀 ${counted}개 지갑 중 ${p.participants.unrecoveredCount}개는 원금을 돌려받지 못했습니다` : s));
      callouts = [
        ...lastDepositCallout,
        { block: drain.block, kind: "drain", title: `한 지갑이 모인 돈을 ${fullDrain ? "전부" : "대부분"} 인출`, detail: `한 번에 ${eth(drain.amountEth)} ETH` }
      ];
      break;
    }
    case "pump_and_dump":
      headline = "내부자가 먼저 빼가고 뒤에 들어온 사람의 출금이 막혔습니다";
      reasons = [
        `출금 ${f.withdrawCount}건 중 ${f.withdrawSuccessCount}건만 성공했습니다 (${pct(f.withdrawSuccessRate)})`,
        `출금이 실패한 시점의 잔고는 ${eth(f.balanceAtFailureEth)} ETH였습니다`,
        `넣은 돈보다 더 받아 간 내부자 지갑이 ${p.insiders.count}개 있습니다`
      ];
      chartNotes = [
        `내부자 ${p.insiders.count}개 지갑이 먼저 ${eth(p.insiders.receivedEth)} ETH를 빼 갔습니다`,
        `그 뒤 잔고가 ${eth(f.balanceAtFailureEth)} ETH가 됐습니다`,
        `후발 참여자 ${p.late.count}명의 출금 ${p.late.failedWithdrawCount}건은 ${p.late.receivedEth <= EPS ? "모두 실패했습니다" : "대부분 실패했습니다"}`
      ];
      callouts = [
        tl.firstInsider && { block: int(tl.firstInsider.block), kind: "insider_exit", title: "내부자가 먼저 빼 감", detail: `${p.insiders.count}개 지갑, ${eth(p.insiders.receivedEth)} ETH` },
        tl.firstFail && { block: int(tl.firstFail.block), kind: "failed_withdraw", title: "후발 참여자 출금 실패", detail: `${p.late.failedWithdrawCount}건 실패, 잔고 ${eth(f.balanceAtFailureEth)} ETH` }
      ].filter(Boolean);
      break;
    case "unclassified_warning":
      headline = "사기 유형은 정해지지 않았지만 참여자 출금이 막혀 있습니다";
      reasons = [
        `운영자 외 출금 ${f.nonOwnerWithdrawCount}건의 성공률이 ${pct(f.nonOwnerSuccessRate)}로 기준(${pct(th.nonOwnerSuccessMax)} 이하)에 해당합니다`,
        `출금이 실패한 시점에도 잔고 ${eth(f.balanceAtFailureEth)} ETH가 남아 있었습니다`,
        "알려진 사기 유형의 조건에는 맞지 않았습니다"
      ];
      chartNotes = [
        `참여자 출금 ${f.nonOwnerWithdrawCount}건 중 ${f.nonOwnerSuccessCount}건만 성공했습니다`,
        `실패한 시점에도 컨트랙트에 ${eth(f.balanceAtFailureEth)} ETH가 남아 있었습니다`,
        `${unrecoveredText(p.participants)}이 원금을 돌려받지 못했습니다`
      ];
      callouts = tl.firstFail ? [{ block: int(tl.firstFail.block), kind: "failed_withdraw", title: "참여자 출금 실패", detail: `실패 시점 잔고 ${eth(f.balanceAtFailureEth)} ETH` }] : [];
      break;
    default:
      headline = "판정에 필요한 신호가 부족해 결론을 내리지 못했습니다";
      reasons = [
        `입금 ${f.depositCount}건, 출금 ${f.withdrawCount}건을 분석했습니다`,
        "어느 사기 유형의 조건도 충족되지 않았습니다",
        "스테이킹(맡기고 돌려받기) 거래도 확인되지 않았습니다"
      ];
      chartNotes = [
        `컨트랙트 잔고는 최고 ${eth(f.peakBalanceEth)} ETH, 마지막 ${eth(f.finalBalanceEth)} ETH입니다`,
        `출금 ${f.withdrawCount}건 중 ${f.withdrawSuccessCount}건이 성공했습니다`,
        "판단 근거가 부족하다는 뜻이며, 안전하다는 뜻은 아닙니다"
      ];
      callouts = [];
  }

  const onsetDeposits = onset ? f._rows.participantDeposits.filter(r => int(r.block) <= onset.block).length : 0;
  return {
    headline, reasons, chartNotes, callouts, note,
    summary: {
      firstAnomaly: onset ? `${onsetDeposits}번째 입금 뒤 첫 출금 (블록 ${onset.block})` : "보이지 않음",
      // 실패한 출금이 있으면 "출금 시도 n건 (성공 k건)"
      analyzed: f.withdrawFailCount > 0
        ? `입금 ${f.depositCount}건 · 출금 시도 ${f.withdrawCount}건 (성공 ${f.withdrawSuccessCount}건)`
        : `입금 ${f.depositCount}건 · 출금 ${f.withdrawCount}건`
    }
  };
}

// 흐름도: 들어온 돈(참여자·운영자 보상 풀) → 가져간 쪽 / 참여자 / 남은 잔고. 비율은 입금 총액 기준.
function flowOf(f, hint, p) {
  const total = f.totalInEth;
  const ratio = x => (total > 0 ? x / total : 0);
  const sources = [{ kind: "participants", count: p.participantWalletCount, eth: total - f.ownerDepositEth }];
  if (f.ownerDepositEth > 0) sources.push({ kind: "owner_fund", count: 1, eth: f.ownerDepositEth });
  const outs = [];
  if (hint === "pump_and_dump") {
    outs.push({ kind: "insiders", count: p.insiders.count, eth: p.insiders.receivedEth, ratio: ratio(p.insiders.receivedEth) });
    outs.push({ kind: "late", count: p.late.count, eth: p.late.receivedEth, ratio: ratio(p.late.receivedEth) });
  } else {
    if (p.collector) outs.push({ kind: "collector", count: 1, eth: p.collector.receivedEth, ratio: ratio(p.collector.receivedEth) });
    else if (p.ownerReceivedEth > 0) outs.push({ kind: "owner", count: 1, eth: p.ownerReceivedEth, ratio: ratio(p.ownerReceivedEth) });
    outs.push({ kind: "participants", count: p.participants.count, receivedCount: p.participants.receivedCount, eth: p.participants.receivedEth, ratio: ratio(p.participants.receivedEth) });
  }
  outs.push({ kind: "remaining", count: 0, eth: f.finalBalanceEth, ratio: ratio(f.finalBalanceEth) });
  const show = o => ({ ...o, ethText: formatEth(o.eth), ratioText: o.ratio === undefined ? null : formatPercent(o.ratio) });
  // 정상 스테이킹은 입금 총액에 운영자 보상 풀이 섞여 비율이 헷갈리므로 화면은 ETH로만 쓴다(ratioText 없음)
  const noRatio = hint === "normal_staking";
  return {
    totalInEth: total, totalInText: formatEth(total),
    sources: sources.map(s => ({ ...s, ethText: formatEth(s.eth) })),
    outs: outs.map(show).map(o => (noRatio ? { ...o, ratioText: null } : o))
  };
}

// ── 진입점 ──
// onset: demo/lib/onset.js computeOnset의 결과(첫 출금 시점, 사기로 분류된 경우만). normalClean: 정상 스테이킹이면서 경고가 없을 때.
export function buildDecision({ report, rows, onset = null, normalClean = true, config = {} }) {
  const cfg = { ...DEFAULT_DECISION_CONFIG, ...config };
  const f = computeFacts(rows ?? [], report ?? {}, cfg);
  const rug = rugAxisOf(report ?? {}, rows ?? []);
  const hint = hintOf(f, rug);
  const conclusion = conclusionOf(hint, normalClean);
  const steps = buildSteps(f, rug);
  const matchedStep = steps.find(s => s.matched) ?? null;
  // 플래시론(제외된 유형)은 사슬에서 어느 단계에도 맞추지 않는다
  const effectiveMatch = hint === "flash_loan" || hint === "unknown" ? null : matchedStep;
  const shown = effectiveMatch ? steps.slice(0, effectiveMatch.no) : steps;
  const principal = computePrincipal(f, hint, cfg);
  const tl = timelineOf(f, hint, principal, cfg);
  const copy = buildCopy(f, hint, conclusion, principal, tl, onset, rug, cfg.ownerAddress);
  const { _rows, ...facts } = f;
  return {
    version: DECISION_VERSION,
    ownerAddress: lower(cfg.ownerAddress),
    hint,
    conclusion,
    conclusionLabel: CONCLUSION_LABELS[conclusion],
    typeLabel: TYPE_LABELS[hint] ?? null,
    thresholds: { ...THRESHOLDS },
    facts,
    principal,
    chain: shown.map(({ matched, ...s }) => ({ ...s, answer: matched ? "예" : "아니요", matched })),
    matchedStep: effectiveMatch ? effectiveMatch.no : null,
    chainSummary: chainSummary(shown, effectiveMatch, hint, conclusion),
    whyNot: whyNotOf(steps, effectiveMatch),
    flow: flowOf(f, hint, principal),
    // 러그풀 축 (report.dynamic.rugpull_axiom + 화면 문구). 화면의 기준값·지갑별 낸 돈/받은 돈은 여기서만 읽는다.
    rugpull: rug,
    segments: tl.segments,
    decisive: tl.decisive,
    copy
  };
}
