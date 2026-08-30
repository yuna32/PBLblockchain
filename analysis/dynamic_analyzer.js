import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEPOSIT_ACTIONS   = new Set(["deposit", "stake", "fund_reward_pool"]);
const WITHDRAW_ACTIONS  = new Set(["withdraw", "unstake", "owner_withdraw_all"]);
const HIGH_RISK_ACTIONS = new Set(["owner_withdraw_all"]);

// HopLaundering bothSides 판정에서 제외할 범용 DEX 라우터/애그리게이터.
// EthereumHeist 파일럿(n=8, evaluation/hoplaundering/)에서 BELLE Honeypot Rug Pull
// 케이스의 bothSides 3개 중 2개가 아래 주소로 확인됨 — 활성 지갑이면 거의 누구나
// 상호작용하는 범용 인프라라 "양방향 주소"로 잡히는 게 세탁 의도가 아니라 정상
// 스왑의 부산물일 가능성이 큼. 범위는 이번에 실증된 주소로 한정(과확장 방지) —
// 새 주소 추가 시 실제로 bothSides에 걸린 사례를 근거로만 추가할 것.
const DEX_WHITELIST = new Set([
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", // Uniswap V2: Router 2
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff", // 0x: Exchange Proxy
]);

function parseCSV(csvPath) {
  if (!fs.existsSync(csvPath)) return [];
  const lines = fs.readFileSync(csvPath, "utf8").trim().split("\n");
  const headers = lines[0].split(",");
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, vals[i]]));
  });
}

function detectContractAddress(rows) {
  const depositRow = rows.find(r => DEPOSIT_ACTIONS.has(r.action));
  return depositRow ? depositRow.to : null;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// EVASION_ANALYSIS.md 권고 2/6/7 적용 후 신설/변경되는 "얼마나/언제" 계열 규칙
// (BALANCE_DROP, FLOW_SPIKE, TEMPORAL_PATTERN, BALANCE_TIMESERIES_DRAIN)의 공용
// 억제 게이트. 기존에는 detectInflowStop() 내부에만 지역적으로 존재하던
// isNormalUnstake 판정을 이 함수로 추출·확장했다 — 단일 로직으로 통합해
// 두 군데서 조건이 미묘하게 갈리는 것을 방지한다.
//
// 확장한 조건 (기존: uniqueWithdrawers>=3, 금액 균등, 성공률>=80%):
//   - HIGH_RISK_ACTIONS(owner_withdraw_all)가 전혀 없을 것
//   - 출금액의 90% 이상이 원래 예치자 본인에게 돌아갈 것 (자금이 시스템 밖으로
//     나가지 않고 예치자에게 환급되는 패턴인지 확인)
//   - 금액 균등 조건의 경계값을 매우 근소한 차이로 비켜가는 것을 막기 위해
//     strict(<) 대신 <=로 완화 (flashloan_log에서 maxW(20)가 minW(8)*2.5와
//     정확히 같아 strict 비교로는 조직적 패턴이 누락되는 경계 버그 발견·수정)
function computeIsOrganicUnstake(rows, depositorMap, totalOut) {
  const withdrawals = rows.filter(r => WITHDRAW_ACTIONS.has(r.action));
  if (withdrawals.length === 0) return false;
  if (rows.some(r => HIGH_RISK_ACTIONS.has(r.action))) return false;

  const uniqueWithdrawers = new Set(withdrawals.map(r => r.to)).size;
  if (uniqueWithdrawers < 3) return false;

  const withdrawAmounts = withdrawals.map(r => parseFloat(r.amount_eth) || 0).filter(a => a > 0);
  if (withdrawAmounts.length === 0) return false;
  const successRatio = withdrawAmounts.length / withdrawals.length;
  if (successRatio < 0.8) return false;

  const maxW = Math.max(...withdrawAmounts);
  const minW = Math.min(...withdrawAmounts);
  if (maxW > minW * 2.5) return false;

  if (totalOut < 0.01) return false;
  let toDepositors = 0;
  for (const r of withdrawals) {
    if (depositorMap.has(r.to)) toDepositors += parseFloat(r.amount_eth) || 0;
  }
  return (toDepositors / totalOut) >= 0.9;
}

// 권고 7: action 문자열과 무관하게 잔고 시계열만으로 급락 구간을 탐지.
// maxBlockSpan 블록 이내에서 발생한 최대 상대 하락폭을 반환.
function maxWindowedDrawdown(rows, maxBlockSpan) {
  let maxDrop = 0;
  for (let i = 0; i < rows.length; i++) {
    const blockI = parseInt(rows[i].block);
    const balI = parseFloat(rows[i].contract_balance_eth) || 0;
    if (balI <= 0) continue;
    for (let j = i + 1; j < rows.length; j++) {
      const blockJ = parseInt(rows[j].block);
      if (blockJ - blockI > maxBlockSpan) break;
      const balJ = parseFloat(rows[j].contract_balance_eth) || 0;
      const drop = (balI - balJ) / balI;
      if (drop > maxDrop) maxDrop = drop;
    }
  }
  return maxDrop;
}

function checkOscillating(rows) {
  let nearZero = false;
  let recovered = false;
  let cycles = 0;
  for (const row of rows) {
    const bal = parseFloat(row.contract_balance_eth);
    if (bal < 0.01) {
      if (recovered) cycles++;
      nearZero = true;
      recovered = false;
    } else if (nearZero && bal > 0.5) {
      recovered = true;
    }
  }
  return cycles >= 2;
}

const RULES = [
  {
    id: "BALANCE_DROP",
    // EVASION_ANALYSIS.md 권고 2/3: hasOwnerDrain 게이트를 WITHDRAW_ACTIONS 전체로
    // 확장하고, peak*0.1(90%) 바이너리 클리프 대신 (1 - finalBal/peak) 기반 연속
    // 가중치로 전환. 50% 미만 하락은 0점, 100% 하락(완전 탈취)에서 만점.
    description: "출금 발생 후 잔고 급락 — 하락폭에 비례한 연속 점수 (러그풀/폰지 탈출)",
    detect: (ctx) => {
      if (ctx.isOrganicUnstake) return 0;
      const hasWithdrawal = ctx.rows.some(r => WITHDRAW_ACTIONS.has(r.action));
      if (!(ctx.peak > 0 && hasWithdrawal)) return 0;
      const drop = 1 - ctx.finalBal / ctx.peak;
      return clamp((drop - 0.5) / 0.5, 0, 1);
    },
    weight: 40
  },
  {
    id: "FLOW_SPIKE",
    // 권고 1: 단일-최대 출금(maxSingleWithdraw) 대신 누적 유출 비율(totalOut/totalIn)로
    // 교체 — 동일 금액을 여러 건으로 분산 인출해도 정확히 포착됨.
    description: "누적 출금이 총 입금의 50% 이상 (분산 인출 포함, 일거에 자금 흡수)",
    detect: (ctx) => {
      if (ctx.isOrganicUnstake) return false;
      return ctx.totalIn > 0 && (ctx.totalOut / ctx.totalIn) >= 0.5;
    },
    weight: 30
  },
  {
    id: "CONCENTRATION_DRAIN",
    // 권고 4: top3/totalOut >= 0.8 클리프 대신 허핀달-허쉬만 지수(HHI) 기반 연속 점수.
    description: "출금 수령 집중도(HHI) — 소수 지갑에 집중될수록 높은 연속 점수",
    detect: ({ totalOut, recipientMap }) => {
      if (totalOut < 0.01) return 0;
      const hhi = [...recipientMap.values()]
        .map(v => v / totalOut)
        .reduce((s, share) => s + share * share, 0);
      return clamp((hhi - 0.2) / 0.6, 0, 1);
    },
    weight: 35
  },
  {
    id: "PROFIT_EXTRACTION",
    description: "입금 대비 130% 이상 수령한 지갑 존재 (부당 수익 탈취)",
    detect: ({ depositorMap, recipientMap }) => {
      for (const [addr, deposited] of depositorMap.entries()) {
        if (deposited <= 0) continue;
        const received = recipientMap.get(addr) || 0;
        if (received / deposited > 1.3) return true;
      }
      return false;
    },
    weight: 35
  },
  {
    id: "OSCILLATING_BALANCE",
    description: "잔고 0 → 복구 → 0 반복 (플래시론 순환 패턴)",
    detect: ({ rows }) => checkOscillating(rows),
    weight: 30
  },
  {
    id: "TEMPORAL_PATTERN",
    // 권고 6: 시간 지표 신설. (a) 입금 종료 후 출금 시작까지의 대기(dormancy)
    // 구간이 전체 수명의 20%+인 경우, 또는 (b) 출금 구간의 ETH/block 속도가
    // peak 대비 15%+로 급격한 경우 중 더 높은 쪽을 채택.
    description: "입금 종료 후 장기 대기 뒤 인출 또는 급격한 인출 속도 (시간 패턴 이상)",
    detect: (ctx) => {
      if (ctx.isOrganicUnstake) return 0;
      const withdrawals = ctx.rows.filter(r => WITHDRAW_ACTIONS.has(r.action));
      const deposits = ctx.rows.filter(r => DEPOSIT_ACTIONS.has(r.action));
      if (withdrawals.length === 0 || deposits.length === 0) return 0;

      const lastDepositBlock = Math.max(...deposits.map(r => parseInt(r.block)));
      const wBlocks = withdrawals.map(r => parseInt(r.block));
      const firstWithdrawBlock = Math.min(...wBlocks);
      const lastWithdrawBlock = Math.max(...wBlocks);
      const firstBlock = parseInt(ctx.rows[0].block);
      const lastBlock = parseInt(ctx.rows[ctx.rows.length - 1].block);
      const totalBlocks = Math.max(1, lastBlock - firstBlock);

      const gapRatio = Math.max(0, firstWithdrawBlock - lastDepositBlock) / totalBlocks;
      const withdrawSpan = Math.max(1, lastWithdrawBlock - firstWithdrawBlock);
      const velocityRatio = ctx.peak > 0 ? (ctx.totalOut / withdrawSpan) / ctx.peak : 0;

      const fractionDormancy = clamp((gapRatio - 0.2) / 0.3, 0, 1);
      const fractionVelocity = clamp((velocityRatio - 0.15) / 0.35, 0, 1);
      return Math.max(fractionDormancy, fractionVelocity);
    },
    weight: 20
  },
  {
    id: "BALANCE_TIMESERIES_DRAIN",
    // 권고 7: action 문자열과 무관하게 잔고 시계열만으로 급락 탐지 (안전망 규칙).
    // 15블록 이내 구간에서 50% 이상 상대 하락이 있으면 연속 점수 부여.
    description: "action 종류와 무관하게 15블록 이내 잔고 50%+ 급락 탐지",
    detect: (ctx) => {
      if (ctx.isOrganicUnstake) return 0;
      const maxDrop = maxWindowedDrawdown(ctx.rows, 15);
      return clamp((maxDrop - 0.5) / 0.4, 0, 1);
    },
    weight: 20
  }
];

const VERDICT_THRESHOLDS = [
  { min: 65, label: "HIGH_RISK" },
  { min: 25, label: "MEDIUM_RISK" },
  { min: 0,  label: "LOW_RISK" }
];

// ── Cross-type disambiguation ─────────────────────────────────────────────────

function hintFraudType(rows, triggered) {
  const ids = new Set(triggered.map(r => r.id));
  const steps = [];

  const deposits    = rows.filter(r => DEPOSIT_ACTIONS.has(r.action));
  const withdrawals = rows.filter(r => WITHDRAW_ACTIONS.has(r.action));

  const peak = Math.max(0, ...rows.map(r => parseFloat(r.contract_balance_eth) || 0));
  const maxSingleWithdraw = Math.max(0, ...withdrawals.map(r => parseFloat(r.amount_eth) || 0));

  // Shared pre-computed conditions
  const depositFromAddrs    = new Set(deposits.map(r => r.from));
  const uniqueDepositorCount = depositFromAddrs.size;

  // singleLargeOutflow: largest withdrawal >= 70% of peak balance
  const singleLargeOutflow = peak > 0 && maxSingleWithdraw >= peak * 0.70;
  steps.push(
    `singleLargeOutflow: ${singleLargeOutflow}` +
    ` (${maxSingleWithdraw.toFixed(3)} / peak ${peak.toFixed(3)} = ` +
    `${peak > 0 ? (maxSingleWithdraw / peak * 100).toFixed(0) : 0}%)`
  );

  // distributedInflow: >= 5 unique depositor addresses
  const distributedInflow = uniqueDepositorCount >= 5;
  steps.push(`distributedInflow: ${distributedInflow} (${uniqueDepositorCount} unique depositors)`);

  // ownerWithdrawAll: recipient of the largest withdrawal is NOT a known depositor
  // (the deployer/owner never participated as a depositor)
  const largestW = withdrawals.reduce((best, r) => {
    return (parseFloat(r.amount_eth) || 0) > (parseFloat(best?.amount_eth) || 0) ? r : best;
  }, null);
  const ownerWithdrawAll = largestW ? !depositFromAddrs.has(largestW.to) : false;
  steps.push(
    `ownerWithdrawAll: ${ownerWithdrawAll}` +
    ` (recipient ${largestW?.to?.slice(0, 10) ?? "n/a"}... ` +
    `${ownerWithdrawAll ? "not in" : "found in"} depositor list)`
  );

  // participantMidExit: non-owner-withdraw withdrawals with amount > 0 before last block
  const lastBlock = parseInt(rows[rows.length - 1]?.block) || 0;
  const midExits  = withdrawals.filter(r =>
    r.action !== "owner_withdraw_all" &&
    (parseFloat(r.amount_eth) || 0) > 0 &&
    parseInt(r.block) < lastBlock
  );
  const participantMidExit = midExits.length > 0;
  steps.push(`participantMidExit: ${participantMidExit} (${midExits.length} mid-exit withdrawals)`);

  // honeypot conditions
  const allWithdrawalsBlocked =
    withdrawals.length > 0 &&
    withdrawals.every(r => (parseFloat(r.amount_eth) || 0) === 0);
  const inflowContinues = withdrawals.length > 0 && (() => {
    const firstWBlock = Math.min(...withdrawals.map(r => parseInt(r.block) || 0));
    return deposits.some(r => parseInt(r.block) > firstWBlock);
  })();

  // pump-and-dump conditions
  const someWithdrawalsSucceed = withdrawals.some(r => (parseFloat(r.amount_eth) || 0) > 0);
  const someWithdrawalsFail    = withdrawals.some(r => (parseFloat(r.amount_eth) || 0) === 0);

  // depositor amount map for insider-exit check
  const depositorAmtMap = new Map();
  for (const r of deposits) {
    depositorAmtMap.set(r.from, (depositorAmtMap.get(r.from) || 0) + (parseFloat(r.amount_eth) || 0));
  }
  const insiderExitDetected = withdrawals.some(r => {
    const received = parseFloat(r.amount_eth) || 0;
    if (received === 0) return false;
    const deposited = depositorAmtMap.get(r.to) || 0;
    return received > deposited;
  });

  // ── Priority 1: Flash Loan ──
  if (ids.has("OSCILLATING_BALANCE")) {
    steps.push("→ flash_loan (OSCILLATING_BALANCE signal)");
    return { hint: "flash_loan", reasoning_steps: steps };
  }

  // ── Priority 2: Honeypot ──
  if (allWithdrawalsBlocked && inflowContinues) {
    steps.push(`→ honeypot (all ${withdrawals.length} withdrawals blocked, inflow continues)`);
    return { hint: "honeypot", reasoning_steps: steps };
  }

  // ── Priority 3: PumpAndDump ──
  if (someWithdrawalsSucceed && someWithdrawalsFail && insiderExitDetected) {
    steps.push("→ pump_and_dump (mixed withdrawal outcomes + insider profit extraction)");
    return { hint: "pump_and_dump", reasoning_steps: steps };
  }

  // ── Priority 4: MoneyLaundering ──
  // Single large outflow + distributed inflow + recipient IS a known depositor
  if (singleLargeOutflow && distributedInflow && !ownerWithdrawAll) {
    steps.push(
      `→ money_laundering (large outflow + ${uniqueDepositorCount} distributed depositors` +
      ` + collector is a known depositor)`
    );
    return { hint: "money_laundering", reasoning_steps: steps };
  }

  // ── Priority 5: RugPull ──
  if (singleLargeOutflow && ownerWithdrawAll && !participantMidExit) {
    steps.push("→ rug_pull (large outflow to non-depositor address, no participant mid-exits)");
    return { hint: "rug_pull", reasoning_steps: steps };
  }

  // ── Priority 6: PonziScheme ──
  if (ids.has("BALANCE_DROP") && ids.has("FLOW_SPIKE") && participantMidExit) {
    steps.push(
      `→ ponzi_scheme (balance drop + flow spike + ${midExits.length} participant mid-exits)`
    );
    return { hint: "ponzi_scheme", reasoning_steps: steps };
  }

  // ── Priority 7: Normal ──
  if (rows.some(r => r.action === "stake" || r.action === "unstake")) {
    steps.push("→ normal_staking (stake/unstake pattern, no fraud signals)");
    return { hint: "normal_staking", reasoning_steps: steps };
  }

  steps.push("→ unknown (no rules matched)");
  return { hint: "unknown", reasoning_steps: steps };
}

// ── InflowStop signal ─────────────────────────────────────────────────────────

function detectInflowStop(rows, isOrganicUnstake) {
  const deposits = rows.filter(r => DEPOSIT_ACTIONS.has(r.action));
  if (deposits.length === 0) {
    return { detected: false, stop_ratio: 0, last_deposit_block: null, last_block: null };
  }

  const lastDepositBlock = Math.max(...deposits.map(r => parseInt(r.block) || 0));
  const firstBlock  = parseInt(rows[0]?.block) || 0;
  const lastBlock   = parseInt(rows[rows.length - 1]?.block) || 0;
  const totalBlocks = lastBlock - firstBlock || 1;

  const stopRatio = (lastBlock - lastDepositBlock) / totalBlocks;
  const balanceAfterStop = rows
    .filter(r => parseInt(r.block) > lastDepositBlock)
    .some(r => parseFloat(r.contract_balance_eth) > 0);

  // Guard: normal unstaking (many unique recipients, roughly equal amounts, high success
  // rate, funds returning to depositors). Uses the shared computeIsOrganicUnstake() —
  // previously this guard was computed locally here only; it is now a single shared
  // gate also used by the RULES (BALANCE_DROP/FLOW_SPIKE/TEMPORAL_PATTERN/
  // BALANCE_TIMESERIES_DRAIN) so the two never drift apart.
  if (isOrganicUnstake) {
    return {
      detected: false,
      stop_ratio: +stopRatio.toFixed(3),
      suppressed_reason: "normal_unstake_pattern",
      last_deposit_block: lastDepositBlock,
      last_block: lastBlock
    };
  }

  return {
    detected: stopRatio >= 0.30 && balanceAfterStop,
    stop_ratio: +stopRatio.toFixed(3),
    last_deposit_block: lastDepositBlock,
    last_block: lastBlock
  };
}

// ── Evasion subclass scoring ──────────────────────────────────────────────────

function detectEvasionSubclass(rows, baseFraudType) {
  const THRESHOLD = 30;

  // Skip evasion check for non-fraud types and honeypot
  // (honeypot's zero-withdrawals are the attack mechanism, not an evasion technique)
  if (baseFraudType === "Normal" || baseFraudType === "Unknown" ||
      baseFraudType === "Honeypot") return null;

  const withdrawals = rows.filter(r => WITHDRAW_ACTIONS.has(r.action));
  if (withdrawals.length === 0) return null;

  const peakBalance = Math.max(0, ...rows.map(r => parseFloat(r.contract_balance_eth) || 0));
  const maxSingleW  = Math.max(0, ...withdrawals.map(r => parseFloat(r.amount_eth) || 0));
  const maxRatio    = peakBalance > 0 ? maxSingleW / peakBalance : 0;

  const wBlocks    = withdrawals.map(r => parseInt(r.block) || 0);
  const firstBlock = parseInt(rows[0]?.block) || 0;
  const lastBlock  = parseInt(rows[rows.length - 1]?.block) || 0;
  const totalBlocks = lastBlock - firstBlock || 1;
  const wSpan      = wBlocks.length > 0
    ? Math.max(...wBlocks) - Math.min(...wBlocks)
    : 0;
  const spanRatio  = wSpan / totalBlocks;

  const scores = {
    BalanceDropEvasion: 0,
    MaxTxEvasion:       0,
    SlowDrain:          0,
    HopLaundering:      0,
    DistributedDump:    0
  };

  // BalanceDropEvasion: single withdrawal < 80% of peak
  if (maxRatio < 0.80) {
    scores.BalanceDropEvasion = Math.round((0.80 - maxRatio) / 0.80 * 100);
  }

  // MaxTxEvasion: repeated withdrawals, each < 90% of peak
  if (withdrawals.length >= 3 && maxRatio < 0.90) {
    scores.MaxTxEvasion = Math.min(100,
      Math.round(withdrawals.length / 3 * 50 + (0.90 - maxRatio) * 50)
    );
  }

  // SlowDrain: withdrawal span covers > 30% of contract lifespan
  if (spanRatio > 0.30) {
    scores.SlowDrain = Math.round((spanRatio - 0.30) / 0.70 * 100);
  }

  // HopLaundering (MoneyLaundering only): some withdrawal-side addresses never deposited
  if (baseFraudType === "MoneyLaundering") {
    const depositAddrs = new Set(
      rows.filter(r => DEPOSIT_ACTIONS.has(r.action)).map(r => r.from)
    );
    const withdrawAddrs = [...new Set(withdrawals.map(r => r.from))];
    const hopAddrs  = withdrawAddrs.filter(a => !depositAddrs.has(a));
    const bothSides = withdrawAddrs.filter(a => depositAddrs.has(a) && !DEX_WHITELIST.has(a));
    const whitelistedHits = withdrawAddrs.filter(a => depositAddrs.has(a) && DEX_WHITELIST.has(a));
    if (whitelistedHits.length > 0) {
      console.log(`[DEX_WHITELIST] MoneyLaundering 판정에서 제외된 주소: ${whitelistedHits.join(', ')}`);
    }
    if (hopAddrs.length >= 1 && bothSides.length >= 2) {
      scores.HopLaundering = Math.min(100, hopAddrs.length * 30 + bothSides.length * 20);
    }
  }

  // DistributedDump (PumpDump only): withdrawal-side addresses that never deposited
  if (baseFraudType === "PumpDump") {
    const depositAddrs = new Set(
      rows.filter(r => DEPOSIT_ACTIONS.has(r.action)).map(r => r.from)
    );
    const withdrawOnlyAddrs = [...new Set(withdrawals.map(r => r.from))]
      .filter(a => !depositAddrs.has(a));
    if (withdrawOnlyAddrs.length >= 2) {
      scores.DistributedDump = Math.min(100, withdrawOnlyAddrs.length * 25);
    }
  }

  // Select candidates relevant to the fraud type
  const relevant = ["BalanceDropEvasion", "MaxTxEvasion", "SlowDrain"];
  if (baseFraudType === "MoneyLaundering") relevant.push("HopLaundering");
  if (baseFraudType === "PumpDump")        relevant.push("DistributedDump");

  const candidates = relevant
    .filter(k => scores[k] >= THRESHOLD)
    .sort((a, b) => scores[b] - scores[a]);

  if (candidates.length === 0) return null;

  return {
    subclass:   `${baseFraudType}_${candidates[0]}`,
    confidence: scores[candidates[0]],
    all_scores: Object.fromEntries(
      relevant.map(k => [`${baseFraudType}_${k}`, scores[k]])
    )
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

const FRAUD_TYPE_MAP = {
  "money_laundering":    "MoneyLaundering",
  "pump_and_dump":       "PumpDump",
  "rug_pull":            "RugPull",
  "ponzi_scheme":        "PonziScheme",
  "ponzi_or_laundering": "PonziScheme",
  "flash_loan":          "FlashLoan",
  "honeypot":            "Honeypot",
  "normal_staking":      "Normal"
};

export function analyzeDynamic(csvPath) {
  const rows = parseCSV(csvPath);

  if (rows.length === 0) {
    return {
      csv:               path.basename(csvPath),
      error:             "CSV 없음 — 시뮬레이션을 먼저 실행하세요",
      triggered_rules:   [],
      dynamic_risk_score: 0,
      verdict:           "UNKNOWN",
      fraud_type_hint:   "unknown",
      reasoning_steps:   [],
      anomaly_signals:   {},
      evasion_detected:  false,
      evasion_subclass:  null,
      evasion_confidence: 0,
      evasion_consequence: null,
      evasion_all_scores: {},
      counter_detection: null
    };
  }

  const contractAddr = detectContractAddress(rows);  // eslint-disable-line no-unused-vars
  let totalIn = 0, totalOut = 0, peak = 0, maxSingleWithdraw = 0;
  const depositorMap = new Map();
  const recipientMap = new Map();

  for (const row of rows) {
    const amount = parseFloat(row.amount_eth) || 0;
    const bal    = parseFloat(row.contract_balance_eth) || 0;
    if (bal > peak) peak = bal;

    if (DEPOSIT_ACTIONS.has(row.action)) {
      totalIn += amount;
      depositorMap.set(row.from, (depositorMap.get(row.from) || 0) + amount);
    }
    if (WITHDRAW_ACTIONS.has(row.action)) {
      totalOut += amount;
      if (amount > maxSingleWithdraw) maxSingleWithdraw = amount;
      recipientMap.set(row.to, (recipientMap.get(row.to) || 0) + amount);
    }
  }

  const finalBal = parseFloat(rows[rows.length - 1].contract_balance_eth) || 0;
  const isOrganicUnstake = computeIsOrganicUnstake(rows, depositorMap, totalOut);
  const ctx = { totalIn, totalOut, peak, finalBal, maxSingleWithdraw,
                depositorMap, recipientMap, rows, isOrganicUnstake };

  // Anomaly rule scoring. rule.detect()는 boolean(기존 규칙, true=1/false=0) 또는
  // 0~1 사이의 연속 fraction(BALANCE_DROP/CONCENTRATION_DRAIN 등)을 반환할 수 있다.
  // 획득 점수 = weight * fraction (반올림), fraction<=0이면 트리거되지 않은 것으로 간주.
  const triggered = [];
  let rawScore = 0;
  for (const rule of RULES) {
    const result = rule.detect(ctx);
    const fraction = typeof result === "boolean" ? (result ? 1 : 0) : clamp(result, 0, 1);
    if (fraction > 0) {
      const earned = Math.round(rule.weight * fraction);
      if (earned > 0) {
        triggered.push({
          id: rule.id,
          description: rule.description,
          weight: earned,
          weight_max: rule.weight,
          fraction: +fraction.toFixed(2)
        });
        rawScore += earned;
      }
    }
  }

  const dynamic_risk_score = Math.min(100, rawScore);
  const verdict = VERDICT_THRESHOLDS.find(t => dynamic_risk_score >= t.min).label;

  // Classification with reasoning
  const hintResult      = hintFraudType(rows, triggered);
  const fraud_type_hint = hintResult.hint;
  const reasoning_steps = hintResult.reasoning_steps;

  // InflowStop signal
  const inflowStop = detectInflowStop(rows, isOrganicUnstake);
  if (fraud_type_hint === "ponzi_scheme" && inflowStop.detected) {
    reasoning_steps.push(
      `PONZI_COLLAPSE_CONFIRMED: inflow stopped at block ${inflowStop.last_deposit_block}` +
      ` (${(inflowStop.stop_ratio * 100).toFixed(0)}% of lifespan without new deposits)`
    );
  }

  // Evasion subclass scoring
  const baseFraudType  = FRAUD_TYPE_MAP[fraud_type_hint] ?? "Unknown";
  const evasionResult  = detectEvasionSubclass(rows, baseFraudType);

  return {
    csv:              path.basename(csvPath),
    rows_analyzed:    rows.length,
    metrics: {
      total_in_eth:            +totalIn.toFixed(4),
      total_out_eth:           +totalOut.toFixed(4),
      net_flow_eth:            +(totalIn - totalOut).toFixed(4),
      peak_balance_eth:        +peak.toFixed(4),
      final_balance_eth:       +finalBal.toFixed(4),
      max_single_withdraw_eth: +maxSingleWithdraw.toFixed(4)
    },
    triggered_rules:   triggered,
    dynamic_risk_score,
    verdict,
    fraud_type_hint,
    reasoning_steps,
    anomaly_signals: {
      INFLOW_STOP: inflowStop
    },
    evasion_detected:    evasionResult !== null,
    evasion_subclass:    evasionResult?.subclass    ?? null,
    evasion_confidence:  evasionResult?.confidence  ?? 0,
    evasion_consequence: evasionResult
      ? `Detected evasion pattern: ${evasionResult.subclass} (confidence ${evasionResult.confidence})`
      : null,
    evasion_all_scores:  evasionResult?.all_scores  ?? {},
    counter_detection:   null
  };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const csvArg = process.argv[2];
  if (!csvArg) {
    console.error("사용법: node analysis/dynamic_analyzer.js analysis/logs/ponzi_log.csv");
    process.exit(1);
  }
  const result = analyzeDynamic(path.resolve(csvArg));
  console.log(JSON.stringify(result, null, 2));
}
