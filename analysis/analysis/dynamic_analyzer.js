import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FraudOntology } from "./fraud_ontology.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEPOSIT_ACTIONS  = new Set(["deposit", "stake", "fund_reward_pool"]);
const WITHDRAW_ACTIONS = new Set(["withdraw", "unstake", "owner_withdraw_all", "owner_collect"]);
const HIGH_RISK_ACTIONS = new Set(["owner_withdraw_all", "owner_collect"]);

// Thresholds from ontology (PonziScheme / RugPull used as reference)
const _ONT_PONZI = FraudOntology.fraudTypes.PonziScheme.detectionThresholds;
const _ONT_RUGPULL = FraudOntology.fraudTypes.RugPull.detectionThresholds;
const _ONT_PUMP = (FraudOntology.fraudTypes.PumpAndDump || FraudOntology.fraudTypes.PumpDump)?.detectionThresholds || {};

// Fraud type hint → ontology class name mapping
const HINT_TO_CLASS = {
  honeypot:            "HoneypotTrap",
  rug_pull:            "RugPull",
  ponzi_or_laundering: "PonziScheme",
  pump_dump:           "PumpAndDump",
  normal_staking:      null,
  unknown:             null
};

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

// EVASION_ANALYSIS.md 권고 2/6/7: "얼마나/언제" 계열 규칙(BALANCE_DROP, FLOW_SPIKE,
// TEMPORAL_PATTERN, BALANCE_TIMESERIES_DRAIN)은 정상적인 대규모 동시 언스테이킹에서도
// 잔고가 크게 줄어들 수 있어 오탐 위험이 있다. 출금 수령자 대부분이 원래 예치자 본인이고
// (자기 자금 회수), 금액이 고르며, 실패율이 낮고, 오너 전용 액션이 없는 경우에만
// "조직적 정상 환급"으로 보고 위 네 규칙을 억제한다. CONCENTRATION_DRAIN/PROFIT_EXTRACTION은
// 이 패턴에서 자연히 낮은 값을 내므로 억제하지 않는다.
function computeIsOrganicUnstake(rows, depositorMap, totalOut) {
  const withdrawals = rows.filter(r => WITHDRAW_ACTIONS.has(r.action));
  if (withdrawals.length < 3) return false;
  if (rows.some(r => HIGH_RISK_ACTIONS.has(r.action))) return false;

  const uniqueWithdrawers = new Set(withdrawals.map(r => r.to));
  if (uniqueWithdrawers.size < 3) return false;

  const amounts = withdrawals.map(r => parseFloat(r.amount_eth) || 0);
  const nonzero = amounts.filter(a => a > 0);
  const successRatio = nonzero.length / withdrawals.length;
  if (successRatio < 0.8) return false;

  const maxW = Math.max(...nonzero);
  const minW = Math.min(...nonzero);
  if (maxW >= minW * 2.5) return false;

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
      return ctx.totalIn > 0 && (ctx.totalOut / ctx.totalIn) >= _ONT_PONZI.FLOW_SPIKE;
    },
    weight: 30
  },
  {
    id: "CONCENTRATION_DRAIN",
    // 권고 4: top3/totalOut >= 0.8 클리프 대신 허핀달-허쉬만 지수(HHI) 기반 연속 점수.
    // HHI = Σ(수령 비중)^2. 수령자를 늘려 지분을 잘게 쪼개도 HHI는 완만하게만 낮아져
    // 절벽 회피(시나리오 A의 "3→4개 수령자로 분산")가 통하지 않는다.
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
    description: "잔고 0 → 복구 → 0 반복 (순환 패턴)",
    detect: ({ rows }) => checkOscillating(rows),
    weight: 30
  },
  {
    id: "TEMPORAL_PATTERN",
    // 권고 6: 시간 지표 신설. (a) 입금 종료 후 출금 시작까지의 "대기(dormancy)" 구간이
    // 전체 수명의 20%+를 넘는 경우(시나리오 C의 "50블록 대기 후 인출" 패턴), 또는
    // (b) 출금 구간의 ETH/block 속도가 peak 대비 15%+로 급격한 경우 중 더 높은 쪽을 채택.
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
  },
  {
    id: "ZERO_WITHDRAW_PATTERN",
    // Ontology: HoneypotTrap.necessaryConditions includes ZeroWithdrawBlock
    // WITHDRAW_SUCCESS_RATE threshold = 0.0
    description: "출금 시도가 모두 실패(amount=0)하고 오너만 최종 수령 (허니팟 의심)",
    detect: ({ totalIn, rows }) => {
      const hasWithdrawAttempts = rows.some(r => r.action === "withdraw_attempt");
      const hasMidRealWithdraw = rows.some(r =>
        (r.action === "withdraw" || r.action === "unstake") &&
        parseFloat(r.amount_eth) > 0
      );
      return totalIn > 0 && hasWithdrawAttempts && !hasMidRealWithdraw;
    },
    weight: 40
  }
];

const VERDICT_THRESHOLDS = [
  { min: 65, label: "HIGH_RISK" },
  { min: 25, label: "MEDIUM_RISK" },
  { min: 0,  label: "LOW_RISK" }
];

function detectEvasionSubclass(rows, baseFraudType) {
  if (!baseFraudType) return null;

  const withdrawals = rows.filter(r =>
    r.action.includes("withdraw") || r.action.includes("owner")
  );
  if (withdrawals.length === 0) return null;

  const peakBalance = Math.max(...rows.map(r => parseFloat(r.contract_balance_eth)));
  const totalBlocks = parseInt(rows[rows.length-1].block) - parseInt(rows[0].block);
  const maxSingleWithdrawal = Math.max(...withdrawals.map(r => parseFloat(r.amount_eth)));

  const maxSingleRatio = peakBalance > 0 ? maxSingleWithdrawal / peakBalance : 0;
  const isSplitWithdrawal = maxSingleRatio < 0.80;
  const isRepeatedSmall   = withdrawals.length >= 3 && maxSingleRatio < 0.90;

  const withdrawalBlocks = withdrawals.map(r => parseInt(r.block));
  const withdrawSpan = Math.max(...withdrawalBlocks) - Math.min(...withdrawalBlocks);
  const isLongPeriod = totalBlocks > 0 && (withdrawSpan / totalBlocks) > 0.30;

  if (baseFraudType === "MoneyLaundering") {
    const depositAddresses = new Set(
      rows.filter(r => DEPOSIT_ACTIONS.has(r.action)).map(r => r.from)
    );
    const withdrawAddresses = new Set(withdrawals.map(r => r.from));
    const hopAddresses = [...withdrawAddresses].filter(a => !depositAddresses.has(a));
    const bothSides    = [...withdrawAddresses].filter(a =>  depositAddresses.has(a));
    if (hopAddresses.length >= 1 && bothSides.length >= 2) {
      return "MoneyLaundering_HopLaundering";
    }
  }

  if (baseFraudType === "PumpDump") {
    const depositAddresses = new Set(
      rows.filter(r => DEPOSIT_ACTIONS.has(r.action)).map(r => r.from)
    );
    const withdrawAddresses = [...new Set(withdrawals.map(r => r.from))];
    const withdrawOnlyAddresses = withdrawAddresses.filter(a => !depositAddresses.has(a));
    if (withdrawOnlyAddresses.length >= 2) {
      return "PumpDump_DistributedDump";
    }
  }

  if (isLongPeriod && isSplitWithdrawal) return `${baseFraudType}_SlowDrain`;
  if (isRepeatedSmall)                   return `${baseFraudType}_MaxTxEvasion`;
  if (isSplitWithdrawal)                 return `${baseFraudType}_BalanceDropEvasion`;
  return null;
}
function hintFraudType(rows, triggered) {
  const ids = new Set(triggered.map(r => r.id));
  const actions = rows.map(r => r.action);

  if (ids.has("ZERO_WITHDRAW_PATTERN")) return "honeypot";
  if (ids.has("OSCILLATING_BALANCE")) return "oscillating";

  // pump_dump 판별: 일부 출금은 성공(amount>0)하고 일부는 실패(amount=0)하는
  // 혼재 패턴이 pump&dump의 특징. 권고 2번(BALANCE_DROP 게이트 확장)으로 이제
  // pump_dump 케이스도 BALANCE_DROP이 함께 발동하므로, "!ids.has(BALANCE_DROP)"
  // 조건에 더 이상 의존하지 않고 출금 성공/실패 혼재 여부로 직접 판별한다.
  const hasFailedWithdrawal = rows.some(r =>
    WITHDRAW_ACTIONS.has(r.action) && (parseFloat(r.amount_eth) || 0) === 0);
  const hasSucceededWithdrawal = rows.some(r =>
    WITHDRAW_ACTIONS.has(r.action) && (parseFloat(r.amount_eth) || 0) > 0);
  if (ids.has("PROFIT_EXTRACTION") && hasFailedWithdrawal && hasSucceededWithdrawal) return "pump_dump";

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
  const isOrganicUnstake = computeIsOrganicUnstake(rows, depositorMap, totalOut);
  const ctx = { totalIn, totalOut, peak, finalBal, maxSingleWithdraw,
                depositorMap, recipientMap, rows, isOrganicUnstake };

  // 연속 점수 규칙 지원: rule.detect()는 boolean(기존 규칙, true=1/false=0) 또는
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
  const fraud_type_hint = hintFraudType(rows, triggered);

  const fraudClass = HINT_TO_CLASS[fraud_type_hint] || null;
  const gui_emphasis = fraudClass
    ? (FraudOntology.fraudTypes[fraudClass]?.guiEmphasis || null)
    : null;

  let evasionBaseFraudType = null;
  if (fraud_type_hint === "ponzi_or_laundering") {
    // PonziScheme: user withdraw/unstake actions return funds to depositors before owner drain
    // MoneyLaundering: only owner drain, no user-initiated withdrawals to depositors
    const depositAddrs = new Set([...depositorMap.keys()]);
    const userWithdrawToDepositor = rows
      .filter(r => (r.action === "withdraw" || r.action === "unstake") && parseFloat(r.amount_eth) > 0)
      .some(r => depositAddrs.has(r.to));
    evasionBaseFraudType = userWithdrawToDepositor ? "PonziScheme" : "MoneyLaundering";
  } else if (fraud_type_hint === "rug_pull") {
    // If many unique depositors drain to a single non-depositor → MoneyLaundering pattern
    const depositAddrs2 = new Set([...depositorMap.keys()]);
    const withdrawRecips = [...new Set(
      rows.filter(r => WITHDRAW_ACTIONS.has(r.action) && parseFloat(r.amount_eth) > 0).map(r => r.to)
    )];
    const nonDepositorRecips = withdrawRecips.filter(a => !depositAddrs2.has(a));
    evasionBaseFraudType =
      (depositAddrs2.size >= 3 && withdrawRecips.length === 1 && nonDepositorRecips.length === 1)
        ? "MoneyLaundering"
        : "RugPull";
  } else if (fraud_type_hint === "pump_dump") {
    evasionBaseFraudType = "PumpDump";
  }

  const evasion_subclass = detectEvasionSubclass(rows, evasionBaseFraudType);
  const evasion_detected = evasion_subclass !== null;

  let evasion_consequence = null;
  let counter_detection = null;
  if (evasion_subclass && evasionBaseFraudType) {
    const ftEntry = FraudOntology.fraudTypes[evasionBaseFraudType];
    if (ftEntry?.evasionSubclasses) {
      const subKey = Object.keys(ftEntry.evasionSubclasses)
        .find(k => ftEntry.evasionSubclasses[k].id === evasion_subclass);
      if (subKey) {
        evasion_consequence = ftEntry.evasionSubclasses[subKey].consequence;
        counter_detection   = ftEntry.evasionSubclasses[subKey].counter_detection;
      }
    }
  }

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
    fraud_type_hint,
    gui_emphasis,
    evasion_subclass,
    evasion_detected,
    evasion_consequence,
    counter_detection
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
