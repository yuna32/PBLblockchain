import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { analyzeDynamic } from "./dynamic_analyzer.js";
import { scoreTrust }     from "./trust_scorer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ── ANSI colours ──────────────────────────────────────────────────────────────
const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  cyan:    "\x1b[36m",
  magenta: "\x1b[35m",
  gray:    "\x1b[90m",
  white:   "\x1b[97m",
};

// ── Log catalogue ─────────────────────────────────────────────────────────────
const ALL_LOGS = [
  { name: "PonziLab",         csv: "ponzi_log.csv",        evasive: false },
  { name: "NormalStaking",    csv: "normal_log.csv",        evasive: false },
  { name: "RugPull",          csv: "rugpull_log.csv",       evasive: false },
  { name: "MoneyLaundering",  csv: "laundering_log.csv",    evasive: false },
  { name: "PumpDump",         csv: "pumpdump_log.csv",      evasive: false },
  { name: "FlashLoan",        csv: "flashloan_log.csv",     evasive: false },
  { name: "EvasiveA",         csv: "evasive_A_log.csv",     evasive: true,  tag: "← 분산출금: 0점 (96% 탈취)" },
  { name: "EvasiveB",         csv: "evasive_B_log.csv",     evasive: true,  tag: "← 임계절벽: 89%탈취→경계선" },
  { name: "EvasiveC",         csv: "evasive_C_log.csv",     evasive: true,  tag: "← 가중치격차: 96%탈취→MEDIUM" },
];

const ALL_RULE_IDS = [
  "BALANCE_DROP",
  "FLOW_SPIKE",
  "CONCENTRATION_DRAIN",
  "PROFIT_EXTRACTION",
  "OSCILLATING_BALANCE",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function pad(s, n)  { return String(s).padEnd(n); }
function rpad(s, n) { return String(s).padStart(n); }

function riskColor(score) {
  if (score >= 65) return C.red;
  if (score >= 25) return C.yellow;
  return C.green;
}

function gradeColor(g) {
  return { A: C.green, B: C.cyan, C: C.yellow, D: C.yellow, F: C.red }[g] ?? C.gray;
}

// ── Core analysis (synchronous) ───────────────────────────────────────────────
function analyze(csvFile) {
  const csvPath     = path.join(PROJECT_ROOT, "analysis", "logs", csvFile);
  const dynResult   = analyzeDynamic(csvPath);
  const trustResult = scoreTrust(csvPath);
  return {
    dynResult,
    trustResult,
    dynamic_risk_score: dynResult.dynamic_risk_score,
    verdict:            dynResult.verdict,
    trust_grade:        trustResult.trust_grade,
    overall_trust:      trustResult.overall_trust_score,
    triggered_rules:    dynResult.triggered_rules.map(r => r.id),
    fraud_type_hint:    dynResult.fraud_type_hint ?? "unknown",
    missing_csv:        !!dynResult.error,
  };
}

// ── Table printer ─────────────────────────────────────────────────────────────
function printTable(entries) {
  const W = { name: 18, score: 5, verdict: 13, grade: 5 };
  const RULE_ABBREV = {
    BALANCE_DROP:        "BAL_DROP",
    FLOW_SPIKE:          "FLOW_SPK",
    CONCENTRATION_DRAIN: "CONC_DRN",
    PROFIT_EXTRACTION:   "PRFT_EXT",
    OSCILLATING_BALANCE: "OSCL_BAL",
  };

  const divider =
    `─${"─".repeat(W.name)}─┼─${"─".repeat(W.score)}─┼─${"─".repeat(W.verdict)}─┼─${"─".repeat(W.grade)}─┼─${"─".repeat(44)}─`;

  console.log(
    `\n ${C.bold}${pad("Contract", W.name)} │ ${rpad("Risk", W.score)} │ ` +
    `${pad("Verdict", W.verdict)} │ ${pad("Grade", W.grade)} │ Triggered Rules${C.reset}`
  );
  console.log(divider);

  for (const { entry, result } of entries) {
    if (entry.name === "EvasiveA") {
      console.log(`\n ${C.cyan}${C.bold}── EVASIVE SCENARIOS ────────────────────────────────────────────────────${C.reset}`);
    }

    if (result.missing_csv) {
      console.log(
        ` ${pad(entry.name, W.name)} │ ${rpad("N/A", W.score)} │ ` +
        `${pad("NO_CSV", W.verdict)} │ ${pad("?", W.grade)} │ ${C.gray}(run simulation first)${C.reset}`
      );
      continue;
    }

    const sc        = riskColor(result.dynamic_risk_score);
    const gc        = gradeColor(result.trust_grade);
    const scoreStr  = rpad(result.dynamic_risk_score, W.score);
    const rulesStr  = result.triggered_rules.length
      ? result.triggered_rules.map(r => RULE_ABBREV[r] ?? r).join(", ")
      : "(none)";
    const evasiveTag = entry.tag
      ? ` ${C.cyan}${entry.tag}${C.reset}`
      : "";

    console.log(
      ` ${pad(entry.name, W.name)} │ ${sc}${scoreStr}${C.reset} │ ` +
      `${sc}${pad(result.verdict, W.verdict)}${C.reset} │ ` +
      `${gc}${pad(result.trust_grade, W.grade)}${C.reset} │ ` +
      `${rulesStr}${evasiveTag}`
    );
  }

  console.log(divider + "\n");
}

// ── Blind-spot section ────────────────────────────────────────────────────────
function printBlindSpotAnalysis() {
  console.log(`${C.bold}${C.magenta}━━━  탐지 맹점 분석 (지표 설계 취약점)  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}\n`);

  console.log(`${C.bold}공통 전제: 모든 시나리오는 표준 action 문자열 사용${C.reset}`);
  console.log(`  EvasiveA/B/C 는 "deposit", "withdraw", "owner_withdraw_all" 등`);
  console.log(`  DEPOSIT_ACTIONS / WITHDRAW_ACTIONS 에 포함된 정상 action 만 사용합니다.`);
  console.log(`  whitelist 우회가 아닌 ${C.yellow}지표 수식과 임계값 설계${C.reset}의 결함을 공략합니다.\n`);

  // ── Scenario A ──────────────────────────────────────────────────────────────
  console.log(`${C.bold}[Scenario A — 분산 출금]${C.reset}  목표: FLOW_SPIKE + CONCENTRATION_DRAIN 임계값`);
  console.log(`  출금 방식  : 4 × 2.4 ETH "withdraw" → 4개 신규 주소 (총 9.6/10 ETH = 96%)`);
  console.log(`\n  FLOW_SPIKE 조건: ${C.gray}maxSingleWithdraw >= totalIn * 0.5${C.reset}`);
  console.log(`    설계 결함 : maxSingleWithdraw 는 단일 거래 최대값만 추적`);
  console.log(`    우회 결과 : 2.4 ETH < 5.0 ETH (50% 임계값) → 규칙 미발동`);
  console.log(`    실제 의미 : 누적 9.6 ETH 탈취를 4회 분할하면 완전히 보이지 않음`);
  console.log(`\n  CONCENTRATION_DRAIN 조건: ${C.gray}top3/totalOut >= 0.8${C.reset}`);
  console.log(`    설계 결함 : 4개 동등 수령자 → top-3 = 7.2/9.6 = 75% < 80% 클리프`);
  console.log(`    우회 결과 : 수령자 1명 추가(4→4)로 80% 장벽 통과 → 규칙 미발동`);
  console.log(`    실제 의미 : 집중도 임계값이 수령자 수 기준 절벽 구조임을 노출\n`);

  // ── Scenario B ──────────────────────────────────────────────────────────────
  console.log(`${C.bold}[Scenario B — 임계값 절벽]${C.reset}  목표: BALANCE_DROP 90% 하드 클리프`);
  console.log(`  출금 방식  : 1 × 8.9 ETH "owner_withdraw_all" (잔고 1.1 ETH 유지)`);
  console.log(`\n  BALANCE_DROP 조건: ${C.gray}peak > 0 && finalBal < peak * 0.1 && hasOwnerDrain${C.reset}`);
  console.log(`    설계 결함 : 90% 하드 클리프 — peak×0.1(=1.0)과 finalBal(=1.1)의 차이 0.1 ETH`);
  console.log(`    우회 결과 : 1.1 < 1.0 → false → +45점짜리 핵심 규칙 완전 침묵`);
  console.log(`    실제 의미 : 89% 탈취와 91% 탈취는 위험도가 사실상 동일하나 규칙은 전혀 다르게 취급`);
  console.log(`\n  FLOW_SPIKE + CONCENTRATION_DRAIN 은 정상 발동 → 최종 점수 65 (HIGH_RISK 경계선)`);
  console.log(`  → BALANCE_DROP 없이도 65점 도달하지만, 가장 중요한 규칙이 침묵한 채임\n`);

  // ── Scenario C ──────────────────────────────────────────────────────────────
  console.log(`${C.bold}[Scenario C — 점수 가중치 격차 + 시간 무감각]${C.reset}`);
  console.log(`  출금 방식  : 4 × 2.4 ETH "withdraw" → 오너 본인 주소 (50블록 지연 후)`);
  console.log(`  오너 사전  : deposit 1 ETH → depositorMap 등록 (PROFIT_EXTRACTION 대상화)`);
  console.log(`\n  BALANCE_DROP 조건: ${C.gray}hasOwnerDrain = rows.some(r => r.action === "owner_withdraw_all")${C.reset}`);
  console.log(`    설계 결함 : "withdraw" 는 WITHDRAW_ACTIONS 에 속하지만 hasOwnerDrain 을 세우지 않음`);
  console.log(`    우회 결과 : finalBal=0.4 < peak×0.1=1.0 이지만 hasOwnerDrain=false → 미발동`);
  console.log(`    실제 의미 : 동일 WITHDRAW_ACTIONS 내에서도 특정 리터럴에만 게이트 적용`);
  console.log(`\n  FLOW_SPIKE:  maxSingleWithdraw=2.4 < 5.0 → 미발동`);
  console.log(`  CONCENTRATION_DRAIN + PROFIT_EXTRACTION 발동 (+30 + +30 = 60점)`);
  console.log(`\n  점수 가중치 격차:`);
  console.log(`    HIGH_RISK 임계값: 65점`);
  console.log(`    발동 점수:        60점 (MEDIUM_RISK)`);
  console.log(`    부족분:           5점 — BALANCE_DROP(+45) 또는 FLOW_SPIKE(+35) 중 하나만 있으면 도달`);
  console.log(`    실제 의미 : "누가 얼마나" 규칙 2개 합산으로 HIGH_RISK 기준에 도달하지 못함`);
  console.log(`\n  시간 무감각:`);
  console.log(`    50블록 지연 (입금 완료 후 출금 전) → 어떤 규칙도 이 패턴을 감지하지 않음`);
  console.log(`    velocity, block-gap, phase-interval 을 측정하는 지표 자체가 존재하지 않음\n`);

  // ── trust_scorer ────────────────────────────────────────────────────────────
  console.log(`${C.bold}[trust_scorer.js 연관 맹점]${C.reset}`);
  console.log(`  is_drainer 플래그: row.action === "owner_withdraw_all" 일 때만 true`);
  console.log(`  → Scenario C: "withdraw" 사용 시 오너의 is_drainer=false`);
  console.log(`  → s_blacklist=100 → 9.6× 수익 수령자도 blacklist 점수 만점 유지`);
  console.log(`  → s_scam=0, s_flow=0 으로 낮아지지만 s_blacklist(×0.30) 가중치로 상쇄됨\n`);

  console.log(`${C.bold}권고 패치 (Recommended Fixes)${C.reset}`);
  const fixes = [
    "FLOW_SPIKE: maxSingleWithdraw → 누적 출금 합계(totalOut / totalIn) 비율로 교체",
    "BALANCE_DROP: hasOwnerDrain 게이트 제거 또는 WITHDRAW_ACTIONS 전체로 확장 (특정 리터럴 의존 제거)",
    "CONCENTRATION_DRAIN: 80% 클리프 → 상위-N 수령자 농도 연속 점수(gradient)로 교체",
    "점수 가중치 재조정: CONCENTRATION_DRAIN+PROFIT_EXTRACTION 합산이 HIGH_RISK 도달 가능하도록 +35씩 상향",
    "시간 지표 추가: 입금 집중 구간 ↔ 출금 집중 구간의 블록 간격 및 속도(ETH/block) 측정",
    "contract_balance_eth 시계열 직접 분석: N블록 내 X% 이상 감소 시 action 무관하게 플래그",
  ];
  fixes.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  console.log(`${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║  우회 시나리오 vs 기존 탐지 시스템 비교 분석                     ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════════╝${C.reset}`);

  // ── Collect results ──────────────────────────────────────────────────────
  const entries = ALL_LOGS.map(entry => ({ entry, result: analyze(entry.csv) }));

  // ── Print table ──────────────────────────────────────────────────────────
  printTable(entries);

  // ── Print blind-spot analysis ────────────────────────────────────────────
  printBlindSpotAnalysis();

  // ── Build JSON output ────────────────────────────────────────────────────
  const jsonOut = {
    generated_at: new Date().toISOString(),
    note: "Red-team blind-spot analysis — Hardhat simulation only, not for mainnet",
    results: entries.map(({ entry, result }) => {
      const evadedRules = entry.evasive
        ? ALL_RULE_IDS.filter(r => !result.triggered_rules.includes(r))
        : [];
      return {
        contract_name:       entry.name,
        csv_file:            entry.csv,
        is_evasive:          entry.evasive,
        dynamic_risk_score:  result.dynamic_risk_score,
        verdict:             result.verdict,
        trust_grade:         result.trust_grade,
        overall_trust_score: result.overall_trust,
        triggered_rules:     result.triggered_rules,
        evaded_rules:        evadedRules,
        fraud_type_hint:     result.fraud_type_hint,
        metrics:             result.dynResult.metrics ?? null,
        missing_csv:         result.missing_csv,
      };
    }),
    blind_spots: {
      approach:
        "All three evasive scenarios use only standard action strings (deposit/withdraw/" +
        "owner_withdraw_all). Evasion is achieved purely through indicator-design and " +
        "rule-threshold weaknesses, not action-label manipulation.",
      scenario_A: {
        name: "분산 출금 (Distributed Drain)",
        result: "0/100 LOW_RISK despite 96% extraction",
        weaknesses: [
          "FLOW_SPIKE uses maxSingleWithdraw (single-tx peak) instead of cumulative outflow: " +
          "4×2.4 ETH each stays below 50% threshold",
          "CONCENTRATION_DRAIN has a hard 80% cliff: 4 equal recipients produce 75% top-3 " +
          "concentration, just below the threshold",
        ],
      },
      scenario_B: {
        name: "임계값 절벽 (Threshold Cliff)",
        result: "65/100 HIGH_RISK (borderline) with primary rule BALANCE_DROP (+45) silent",
        weaknesses: [
          "BALANCE_DROP has a binary 90% cliff: extracting 89% (finalBal=1.1 > peak×0.1=1.0) " +
          "silences the highest-weight rule entirely despite near-total drainage",
          "A 0.1 ETH buffer is treated as categorically different from a 0.1 ETH deficit",
        ],
      },
      scenario_C: {
        name: "점수 가중치 격차 + 시간 무감각 (Score Weight Gap + Temporal Blindness)",
        result: "60/100 MEDIUM_RISK despite 96% extraction and suspicious temporal pattern",
        weaknesses: [
          "CONCENTRATION_DRAIN(+30) + PROFIT_EXTRACTION(+30) = 60, falling 5 points short " +
          "of HIGH_RISK threshold — 'who received what' rules cannot alone reach HIGH_RISK",
          "BALANCE_DROP gates on the literal string 'owner_withdraw_all' via hasOwnerDrain: " +
          "using 'withdraw' (also in WITHDRAW_ACTIONS) bypasses this gate",
          "FLOW_SPIKE single-tx metric: 4×2.4 ETH stays below 50% threshold",
          "No rule measures temporal patterns: 50-block gap between deposit and drain phases " +
          "is completely invisible to the detection system",
        ],
      },
      recommended_fixes: [
        "FLOW_SPIKE: replace maxSingleWithdraw with cumulative extraction ratio (totalOut/totalIn)",
        "BALANCE_DROP: remove or broaden hasOwnerDrain gate to all WITHDRAW_ACTIONS members",
        "CONCENTRATION_DRAIN: replace 80% cliff with continuous concentration score",
        "Score rebalancing: raise CONCENTRATION_DRAIN and PROFIT_EXTRACTION weights so their " +
        "combined score can reach HIGH_RISK threshold independently",
        "Add temporal indicators: measure block-gap between deposit phase and withdrawal phase, " +
        "flag high extraction velocity (ETH/block)",
        "Apply thresholds directly to contract_balance_eth time series regardless of action labels",
      ],
    },
  };

  const reportsDir = path.join(PROJECT_ROOT, "analysis", "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const outPath = path.join(reportsDir, "evasion_comparison.json");
  fs.writeFileSync(outPath, JSON.stringify(jsonOut, null, 2));
  console.log(`${C.green}✅ 보고서 저장: analysis/reports/evasion_comparison.json${C.reset}\n`);
}

main();
