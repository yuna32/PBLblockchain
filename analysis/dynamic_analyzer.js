import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEPOSIT_ACTIONS   = new Set(["deposit", "stake", "fund_reward_pool"]);
const WITHDRAW_ACTIONS  = new Set(["withdraw", "unstake", "owner_withdraw_all"]);
const HIGH_RISK_ACTIONS = new Set(["owner_withdraw_all"]);

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
    description: "오너 액션으로 잔고 90%+ 급락 (러그풀/폰지 탈출)",
    detect: ({ peak, finalBal, rows }) => {
      const hasOwnerDrain = rows.some(r => HIGH_RISK_ACTIONS.has(r.action));
      return peak > 0 && finalBal < peak * 0.1 && hasOwnerDrain;
    },
    weight: 45
  },
  {
    id: "FLOW_SPIKE",
    description: "단일 출금이 총 입금의 50% 이상 (일거에 자금 흡수)",
    detect: ({ totalIn, maxSingleWithdraw }) =>
      totalIn > 0 && maxSingleWithdraw >= totalIn * 0.5,
    weight: 35
  },
  {
    id: "CONCENTRATION_DRAIN",
    description: "상위 3개 지갑이 총 출금의 80% 이상 집중 수령",
    detect: ({ totalOut, recipientMap }) => {
      if (totalOut < 0.01) return false;
      const sorted = [...recipientMap.values()].sort((a, b) => b - a);
      const top3 = sorted.slice(0, 3).reduce((s, v) => s + v, 0);
      return top3 / totalOut >= 0.8;
    },
    weight: 30
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
    weight: 30
  },
  {
    id: "OSCILLATING_BALANCE",
    description: "잔고 0 → 복구 → 0 반복 (플래시론 순환 패턴)",
    detect: ({ rows }) => checkOscillating(rows),
    weight: 30
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

function detectInflowStop(rows) {
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

  // Guard: normal unstaking — many unique recipients, roughly equal amounts, high success rate
  // Uses r.to (recipient) because in the CSV withdraw/unstake rows have from=contract, to=user
  const withdrawals      = rows.filter(r => WITHDRAW_ACTIONS.has(r.action));
  const uniqueWithdrawers = new Set(withdrawals.map(r => r.to)).size;
  const withdrawAmounts  = withdrawals.map(r => parseFloat(r.amount_eth) || 0).filter(a => a > 0);
  const successRatio     = withdrawals.length > 0 ? withdrawAmounts.length / withdrawals.length : 0;
  const maxW = withdrawAmounts.length > 0 ? Math.max(...withdrawAmounts) : 0;
  const minW = withdrawAmounts.length > 0 ? Math.min(...withdrawAmounts) : 0;
  const isNormalUnstake  =
    uniqueWithdrawers >= 3 &&
    withdrawAmounts.length > 0 &&
    maxW < minW * 2.5 &&
    successRatio >= 0.8;

  if (isNormalUnstake) {
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
    const bothSides = withdrawAddrs.filter(a => depositAddrs.has(a));
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
  const ctx = { totalIn, totalOut, peak, finalBal, maxSingleWithdraw,
                depositorMap, recipientMap, rows };

  // Anomaly rule scoring
  const triggered = [];
  let rawScore = 0;
  for (const rule of RULES) {
    if (rule.detect(ctx)) {
      triggered.push({ id: rule.id, description: rule.description, weight: rule.weight });
      rawScore += rule.weight;
    }
  }

  const dynamic_risk_score = Math.min(100, rawScore);
  const verdict = VERDICT_THRESHOLDS.find(t => dynamic_risk_score >= t.min).label;

  // Classification with reasoning
  const hintResult      = hintFraudType(rows, triggered);
  const fraud_type_hint = hintResult.hint;
  const reasoning_steps = hintResult.reasoning_steps;

  // InflowStop signal
  const inflowStop = detectInflowStop(rows);
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
