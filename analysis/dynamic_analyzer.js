import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEPOSIT_ACTIONS  = new Set(["deposit", "stake", "fund_reward_pool"]);
const WITHDRAW_ACTIONS = new Set(["withdraw", "unstake", "owner_withdraw_all"]);
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

function checkOscillating(rows, contractAddr) {
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

function hintFraudType(rows, triggered) {
  const ids = new Set(triggered.map(r => r.id));
  const actions = rows.map(r => r.action);

  if (ids.has("OSCILLATING_BALANCE")) return "flash_loan";
  if (ids.has("PROFIT_EXTRACTION") && !ids.has("BALANCE_DROP")) return "pump_dump";
  if (ids.has("BALANCE_DROP") && ids.has("FLOW_SPIKE")) {
    const hasUserWithdraws = actions.some(a => a === "withdraw" || a === "unstake");
    return hasUserWithdraws ? "ponzi_or_laundering" : "rug_pull";
  }
  if (actions.includes("stake") || actions.includes("unstake")) return "normal_staking";
  return "unknown";
}

export function analyzeDynamic(csvPath) {
  const rows = parseCSV(csvPath);

  if (rows.length === 0) {
    return {
      csv: path.basename(csvPath),
      error: "CSV 없음 — 시뮬레이션을 먼저 실행하세요",
      triggered_rules: [],
      dynamic_risk_score: 0,
      verdict: "UNKNOWN",
      fraud_type_hint: "unknown"
    };
  }

  const contractAddr = detectContractAddress(rows);
  let totalIn = 0, totalOut = 0, peak = 0, maxSingleWithdraw = 0;
  const depositorMap = new Map();
  const recipientMap  = new Map();

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
      const recipient = row.to;
      recipientMap.set(recipient, (recipientMap.get(recipient) || 0) + amount);
    }
  }

  const finalBal = parseFloat(rows[rows.length - 1].contract_balance_eth) || 0;
  const ctx = { totalIn, totalOut, peak, finalBal, maxSingleWithdraw,
                depositorMap, recipientMap, rows };

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
  const fraud_type_hint = hintFraudType(rows, triggered);

  return {
    csv: path.basename(csvPath),
    rows_analyzed: rows.length,
    metrics: {
      total_in_eth:          +totalIn.toFixed(4),
      total_out_eth:         +totalOut.toFixed(4),
      net_flow_eth:          +(totalIn - totalOut).toFixed(4),
      peak_balance_eth:      +peak.toFixed(4),
      final_balance_eth:     +finalBal.toFixed(4),
      max_single_withdraw_eth: +maxSingleWithdraw.toFixed(4)
    },
    triggered_rules: triggered,
    dynamic_risk_score,
    verdict,
    fraud_type_hint
  };
}

// CLI 직접 실행
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const csvArg = process.argv[2];
  if (!csvArg) {
    console.error("사용법: node analysis/dynamic_analyzer.js analysis/logs/ponzi_log.csv");
    process.exit(1);
  }
  const result = analyzeDynamic(path.resolve(csvArg));
  console.log(JSON.stringify(result, null, 2));
}
