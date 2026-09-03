import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEPOSIT_ACTIONS  = new Set(["deposit", "stake", "fund_reward_pool"]);
const WITHDRAW_ACTIONS = new Set(["withdraw", "unstake", "owner_withdraw_all", "owner_collect"]);

// Axis metadata — names match dashboard.html's AX_LABELS / computeWalletVectors
// Weights adjusted to sum to 100% with new TX_INPUT_TRANSPARENCY axis
const AXES = [
  { key: "blacklist_assoc",      weight: 0.27 },
  { key: "flow_pattern",         weight: 0.23 },
  { key: "scam_history",         weight: 0.13 },
  { key: "activity_age",         weight: 0.13 },
  { key: "tx_diversity",         weight: 0.14 },
  { key: "tx_input_transparency",weight: 0.10 }, // NEW: 입력 데이터 투명성
];

const GRADE_LABEL = { A: "SAFE", B: "LOW_RISK", C: "MODERATE", D: "HIGH_RISK", F: "CRITICAL" };

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
  const d = rows.find(r => DEPOSIT_ACTIONS.has(r.action));
  return d ? d.to.toLowerCase() : null;
}

function letterGrade(score) {
  if (score >= 70) return "A";
  if (score >= 55) return "B";
  if (score >= 40) return "C";
  if (score >= 25) return "D";
  return "F";
}

function computeTransparencyScore(rows) {
  const actions = new Set(rows.map(r => r.action));
  // Ordered by severity (most opaque first)
  if (actions.has("owner_collect") || actions.has("owner_withdraw_all")) {
    return { score: 10, detail: "오너 전용 인출 백도어 탐지 — 불투명 관리자 액션" };
  }
  if (actions.has("withdraw_attempt")) {
    return { score: 20, detail: "출금 시도 실패 액션 다수 — 숨겨진 출금 차단 의심" };
  }
  if (actions.has("deposit_blocked") || actions.has("deposit_blocked_below_minimum") ||
      actions.has("owner_withdraw_blocked_timelock") || actions.has("owner_withdraw_blocked_limit")) {
    return { score: 60, detail: "일부 액션 차단됨 — 부분 투명성 (패치 또는 필터링 존재)" };
  }
  return { score: 100, detail: "모든 액션이 표준 입금/출금 — 완전 투명" };
}

function scoreWallet(addr, rows, contractAddr, transparencyScore) {
  const laddr = addr.toLowerCase();
  const walletRows = rows.filter(r =>
    r.from.toLowerCase() === laddr || r.to.toLowerCase() === laddr
  );

  let deposited = 0, received = 0, isDrainer = false;
  let minBlock = Infinity, maxBlock = -Infinity;
  const actionTypes = new Set();

  for (const row of walletRows) {
    const amount = parseFloat(row.amount_eth) || 0;
    const block  = parseInt(row.block);
    if (block < minBlock) minBlock = block;
    if (block > maxBlock) maxBlock = block;

    if (row.from.toLowerCase() === laddr && DEPOSIT_ACTIONS.has(row.action)) {
      deposited += amount;
      actionTypes.add(row.action);
    }
    if (row.to.toLowerCase() === laddr && WITHDRAW_ACTIONS.has(row.action)) {
      received += amount;
      actionTypes.add(row.action);
      if (row.action === "owner_withdraw_all" || row.action === "owner_collect") isDrainer = true;
    }
  }

  const blocksActive = maxBlock > minBlock ? maxBlock - minBlock : 1;
  const profitRatio  = deposited > 0 ? received / deposited : (received > 0 ? 999 : 0);

  // 6-axis raw scores (0–100 each)
  const s_blacklist    = isDrainer ? 0 : 100;
  const s_flow         = profitRatio <= 1.0 ? 100
                       : profitRatio <= 1.2 ? 70
                       : profitRatio <= 1.5 ? 40 : 0;
  const s_scam         = (profitRatio > 1.3 || isDrainer) ? 0 : 100;
  const s_activity     = Math.min(100, blocksActive * 5);
  const s_diversity    = Math.min(100, (actionTypes.size / 2) * 100);
  const s_transparency = transparencyScore;

  const scores = [s_blacklist, s_flow, s_scam, s_activity, s_diversity, s_transparency];
  const trust_score = Math.round(
    scores.reduce((sum, s, i) => sum + s * AXES[i].weight, 0)
  );

  const breakdown = Object.fromEntries(
    AXES.map((ax, i) => [ax.key, { score: scores[i], weight: ax.weight }])
  );

  return {
    address:       addr,
    deposited_eth: +deposited.toFixed(4),
    received_eth:  +received.toFixed(4),
    profit_ratio:  +profitRatio.toFixed(3),
    is_drainer:    isDrainer,
    blocks_active: blocksActive,
    trust_score,
    grade:         letterGrade(trust_score),
    breakdown,
  };
}

export function scoreTrust(csvPath) {
  const rows = parseCSV(csvPath);

  if (rows.length === 0) {
    return {
      csv:                 path.basename(csvPath),
      error:               "CSV 없음 — 시뮬레이션을 먼저 실행하세요",
      wallet_count:        0,
      wallet_scores:       [],
      overall_trust_score: 50,
      trust_grade:         "C",
      summary_ko:          "데이터 없음 — 시뮬레이션을 먼저 실행하세요.",
    };
  }

  const contractAddr = detectContractAddress(rows);
  const transparencyData = computeTransparencyScore(rows);
  const transparencyScore = transparencyData.score;

  const allAddrs = new Set();
  for (const row of rows) {
    if (row.from.toLowerCase() !== contractAddr) allAddrs.add(row.from.toLowerCase());
    if (row.to.toLowerCase()   !== contractAddr) allAddrs.add(row.to.toLowerCase());
  }

  const wallet_scores = [...allAddrs].map(addr =>
    scoreWallet(addr, rows, contractAddr, transparencyScore)
  );

  const avgScore = wallet_scores.length
    ? wallet_scores.reduce((s, w) => s + w.trust_score, 0) / wallet_scores.length
    : 50;
  const minScore = wallet_scores.length
    ? Math.min(...wallet_scores.map(w => w.trust_score))
    : 50;

  // Blend: 60% average + 40% minimum — prevents drainers from being averaged away
  const overall_trust_score = Math.round(0.6 * avgScore + 0.4 * minScore);
  const trust_grade          = letterGrade(overall_trust_score);

  const drainers   = wallet_scores.filter(w => w.is_drainer).length;
  const suspicious = wallet_scores.filter(w => w.profit_ratio > 1.3).length;

  const summary_ko = [
    `총 ${wallet_scores.length}개 지갑 분석.`,
    `평균 신뢰 점수 ${overall_trust_score}/100 (평균: ${Math.round(avgScore)}, 최저: ${minScore}).`,
    drainers   > 0 ? `오너 드레인 지갑 ${drainers}개 탐지.`           : null,
    suspicious > 0 ? `과도한 수익 추출 지갑 ${suspicious}개 탐지.` : null,
    `등급: ${trust_grade} (${GRADE_LABEL[trust_grade]}).`,
  ].filter(Boolean).join(" ");

  return {
    csv:                 path.basename(csvPath),
    wallet_count:        wallet_scores.length,
    wallet_scores,
    overall_trust_score,
    trust_grade,
    summary_ko,
    tx_input_transparency: {
      score:  transparencyScore,
      weight: 0.10,
      detail: transparencyData.detail
    }
  };
}

// CLI 직접 실행
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const csvArg = process.argv[2];
  if (!csvArg) {
    console.error("사용법: node analysis/trust_scorer.js analysis/logs/ponzi_log.csv");
    process.exit(1);
  }
  const result = scoreTrust(path.resolve(csvArg));
  console.log(JSON.stringify(result, null, 2));
}
