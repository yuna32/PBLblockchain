import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { analyzeStatic }  from "./static_analyzer.js";
import { analyzeDynamic } from "./dynamic_analyzer.js";
import { scoreTrust }     from "./trust_scorer.js";
import { runPrevention }  from "./prevention_reasoner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const CONTRACT_MAP = {
  PonziLab:        { type: "ponzi",       csv: "ponzi_log.csv"        },
  PonziLabPatched: { type: "ponzi",       csv: "ponzipatched_log.csv" },
  NormalStaking:   { type: "normal",      csv: "normal_log.csv"       },
  RugPull:         { type: "rugpull",     csv: "rugpull_log.csv"      },
  MoneyLaundering: { type: "laundering",  csv: "laundering_log.csv"   },
  PumpDump:        { type: "pumpdump",    csv: "pumpdump_log.csv"     },
  Honeypot:        { type: "honeypot",    csv: "honeypot_log.csv"     },
  FlashLoanPattern:{ type: "flashloan",   csv: "flashloan_log.csv"    }
};

// ANSI 컬러
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  blue:   "\x1b[34m",
  cyan:   "\x1b[36m",
  gray:   "\x1b[90m"
};

function riskColor(score) {
  if (score >= 65) return C.red;
  if (score >= 25) return C.yellow;
  return C.green;
}

function trustColor(score) {
  if (score >= 70) return C.green;
  if (score >= 40) return C.yellow;
  return C.red;
}

function gradeColor(grade) {
  return { A: C.green, B: C.cyan, C: C.yellow, D: "\x1b[33m", F: C.red }[grade] || C.gray;
}

function computeRawGrade(staticResult, dynamicResult, trustResult) {
  const combined = Math.round(
    staticResult.static_risk_score   * 0.30 +
    dynamicResult.dynamic_risk_score * 0.40 +
    (100 - trustResult.overall_trust_score) * 0.30
  );
  if (combined <= 19) return "A";
  if (combined <= 39) return "B";
  if (combined <= 59) return "C";
  if (combined <= 79) return "D";
  return "F";
}

function applyPreventionCap(rawGrade, preventionLevel) {
  const GRADE_ORDER = ["A", "B", "C", "D", "E", "F"];
  const CAPS = { CRITICAL: "D", HIGH: "C" };
  const cap = CAPS[preventionLevel];
  if (!cap) return rawGrade;
  const rawIdx = GRADE_ORDER.indexOf(rawGrade);
  const capIdx = GRADE_ORDER.indexOf(cap);
  return rawIdx >= capIdx ? rawGrade : cap;
}

function computeGrade(staticResult, dynamicResult, trustResult, preventionResult) {
  const rawGrade = computeRawGrade(staticResult, dynamicResult, trustResult);
  return applyPreventionCap(rawGrade, preventionResult?.risk_level);
}

function printBanner(contractName, type) {
  console.log(`\n${C.bold}${C.blue}╔══════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.blue}║  블록체인 사기 탐지 프레임워크                   ║${C.reset}`);
  console.log(`${C.bold}${C.blue}╚══════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  컨트랙트: ${C.bold}${contractName}${C.reset}  (type: ${type})\n`);
}

function printSection(title) {
  console.log(`\n${C.bold}${C.cyan}── ${title} ──${C.reset}`);
}

function printKeyVal(key, val, color = "") {
  console.log(`  ${C.gray}${key}:${C.reset} ${color}${val}${C.reset}`);
}

async function run() {
  const args = process.argv.slice(2);
  const contractIdx = args.indexOf("--contract");
  const contractName = contractIdx !== -1 ? args[contractIdx + 1] : null;

  if (!contractName || !CONTRACT_MAP[contractName]) {
    console.error(`${C.red}오류: --contract <이름> 필요${C.reset}`);
    console.error(`  가능한 값: ${Object.keys(CONTRACT_MAP).join(", ")}`);
    process.exit(1);
  }

  const { type, csv } = CONTRACT_MAP[contractName];
  const solPath = path.join(PROJECT_ROOT, "contracts", `${contractName}.sol`);
  const csvPath = path.join(PROJECT_ROOT, "analysis", "logs", csv);

  printBanner(contractName, type);

  // ── Step 0: 예방 분석 ──
  printSection("Step 0 / 4  예방 분석 (온톨로지 기반 체크리스트)");
  const preventionResult = await runPrevention(contractName);
  if (preventionResult.risk_level === "FILE_NOT_FOUND") {
    console.log(`  ${C.yellow}⚠ 소스 파일 없음: ${preventionResult.error}${C.reset}`);
  } else {
    printKeyVal("예방 위험 유형", preventionResult.fraud_type_suspected ?? "없음");
    printKeyVal("예방 위험 점수", `${preventionResult.risk_score}  [${preventionResult.risk_level}]`,
      riskColor(preventionResult.risk_score * 5));
    printKeyVal("권고", preventionResult.deployment_recommendation);
    if (preventionResult.unmet_conditions?.length) {
      console.log(`  ${C.gray}미충족 항목: ${preventionResult.unmet_conditions.join(", ")}${C.reset}`);
    }
  }

  // ── Step 1: 정적 분석 ──
  printSection("Step 1 / 4  정적 분석 (Solidity 소스 코드)");
  const staticResult = analyzeStatic(solPath);
  printKeyVal("대상 파일", staticResult.file);
  printKeyVal("정적 위험도", `${staticResult.static_risk_score}/100  [${staticResult.verdict}]`,
    riskColor(staticResult.static_risk_score));
  if (staticResult.triggered_rules.length) {
    console.log(`  ${C.gray}탐지된 규칙:${C.reset}`);
    for (const r of staticResult.triggered_rules) {
      console.log(`    ${C.red}✗${C.reset} ${r.id} (+${r.weight})  ${C.gray}${r.description}${C.reset}`);
    }
  } else {
    console.log(`    ${C.green}✓ 위험 패턴 없음${C.reset}`);
  }

  // ── Step 2: 동적 분석 ──
  printSection("Step 2 / 4  동적 분석 (시뮬레이션 로그)");
  const dynamicResult = analyzeDynamic(csvPath);
  if (dynamicResult.error) {
    console.log(`  ${C.yellow}⚠ ${dynamicResult.error}${C.reset}`);
  } else {
    printKeyVal("분석 트랜잭션", `${dynamicResult.rows_analyzed}건`);
    const m = dynamicResult.metrics;
    printKeyVal("총 입금", `${m.total_in_eth} ETH`);
    printKeyVal("총 출금", `${m.total_out_eth} ETH`);
    printKeyVal("최대 잔고", `${m.peak_balance_eth} ETH`);
    printKeyVal("최종 잔고", `${m.final_balance_eth} ETH`);
    printKeyVal("동적 위험도", `${dynamicResult.dynamic_risk_score}/100  [${dynamicResult.verdict}]`,
      riskColor(dynamicResult.dynamic_risk_score));
    printKeyVal("사기 유형 추정", dynamicResult.fraud_type_hint);
    if (dynamicResult.triggered_rules.length) {
      console.log(`  ${C.gray}탐지된 이상 신호:${C.reset}`);
      for (const r of dynamicResult.triggered_rules) {
        console.log(`    ${C.red}⚡${C.reset} ${r.id} (+${r.weight})  ${C.gray}${r.description}${C.reset}`);
      }
    }
  }

  // ── Step 3: 신뢰 점수 ──
  printSection("Step 3 / 4  지갑 신뢰 점수");
  const trustResult = scoreTrust(csvPath);
  if (trustResult.error) {
    console.log(`  ${C.yellow}⚠ ${trustResult.error}${C.reset}`);
  } else {
    printKeyVal("분석 지갑 수", `${trustResult.wallet_count}개`);
    printKeyVal("평균 신뢰 점수", `${trustResult.overall_trust_score}/100  [${trustResult.trust_grade}]`,
      trustColor(trustResult.overall_trust_score));
    console.log(`  ${C.gray}${trustResult.summary_ko}${C.reset}`);
    const sorted = [...trustResult.wallet_scores].sort((a, b) => a.trust_score - b.trust_score);
    console.log(`  ${C.gray}하위 3개 지갑:${C.reset}`);
    for (const w of sorted.slice(0, 3)) {
      const flag = w.is_drainer ? " ⚠DRAINER" : w.profit_ratio > 1.3 ? " ⚠EXTRACTOR" : "";
      console.log(`    ${w.address.slice(0, 10)}...  신뢰:${trustColor(w.trust_score)}${w.trust_score}${C.reset}  수익률:${w.profit_ratio}x${flag}`);
    }
  }

  // ── 종합 판정 ──
  const rawGrade   = computeRawGrade(staticResult, dynamicResult, trustResult);
  const grade      = applyPreventionCap(rawGrade, preventionResult.risk_level);
  const capApplied = rawGrade !== grade;
  const capReason  = capApplied
    ? `${preventionResult.risk_level} prevention score (${preventionResult.risk_score}) → grade capped at ${grade}`
    : null;

  const gc = gradeColor(grade);
  const GRADE_LABEL = { A: "SAFE", B: "LOW_RISK", C: "MODERATE", D: "HIGH_RISK", F: "CRITICAL" };
  const GRADE_MSG = {
    A: "정상 계약으로 판단됩니다.",
    B: "낮은 위험도. 소액 테스트 후 참여 권장.",
    C: "중간 위험도. 투자 전 추가 조사 필요.",
    D: "높은 위험도. 참여를 자제하세요.",
    F: "극도로 위험합니다. 절대 참여 금지."
  };

  console.log(`\n${C.bold}${"═".repeat(52)}${C.reset}`);
  console.log(`  ${C.bold}종합 판정${C.reset}`);
  console.log(`  등급: ${gc}${C.bold}${grade}  ${GRADE_LABEL[grade] ?? grade}${C.reset}`);
  if (capApplied) {
    const rc = gradeColor(rawGrade);
    console.log(`  ${C.yellow}예방 상한 적용: 원등급 ${rc}${rawGrade}${C.reset}${C.yellow} → ${grade}  (${capReason})${C.reset}`);
  }
  console.log(`  권고: ${gc}${GRADE_MSG[grade] ?? "추가 검토 필요."}${C.reset}`);
  console.log(`  정적:${riskColor(staticResult.static_risk_score)} ${staticResult.static_risk_score}${C.reset}  동적:${riskColor(dynamicResult.dynamic_risk_score)} ${dynamicResult.dynamic_risk_score}${C.reset}  신뢰:${trustColor(trustResult.overall_trust_score)} ${trustResult.overall_trust_score}${C.reset}  예방:${riskColor(preventionResult.risk_score * 5)} ${preventionResult.risk_level}${C.reset}`);
  console.log(`${"═".repeat(52)}`);

  // ── 보고서 저장 ──
  const reportsDir = path.join(PROJECT_ROOT, "analysis", "reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  const report = {
    contract:                contractName,
    type,
    timestamp:               new Date().toISOString(),
    overall_grade:           grade,
    raw_grade:               rawGrade,
    prevention_cap_applied:  capApplied,
    prevention_cap_reason:   capReason,
    prevention:              preventionResult,
    static:                  staticResult,
    dynamic:                 dynamicResult,
    trust:                   trustResult
  };

  const reportPath = path.join(reportsDir, `${contractName}_report.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n  ${C.green}✅ 보고서 저장:${C.reset} analysis/reports/${contractName}_report.json`);

  // ── reports/index.js 업데이트 (보고서 목록) ──
  const indexPath = path.join(reportsDir, "index.js");
  let existing = [];
  if (fs.existsSync(indexPath)) {
    const m = fs.readFileSync(indexPath, "utf8").match(/\[([^\]]*)\]/);
    if (m) existing = m[1].split(",").map(s => s.trim().replace(/['"]/g, "")).filter(Boolean);
  }
  if (!existing.includes(contractName)) existing.push(contractName);
  fs.writeFileSync(indexPath, `window.AVAILABLE_REPORTS = ${JSON.stringify(existing)};\n`);
  console.log(`  ${C.green}✅ 보고서 목록:${C.reset}  analysis/reports/index.js  (${existing.join(", ")})`);

  // ── 대시보드 열기 안내 ──
  console.log(`\n  ${C.bold}대시보드에서 확인:${C.reset}`);
  console.log(`  ${C.gray}1.${C.reset} WSL 터미널에서 로컬 서버 실행:`);
  console.log(`     ${C.blue}python3 -m http.server 8080 --directory ~/pbl/analysis${C.reset}`);
  console.log(`  ${C.gray}2.${C.reset} 브라우저에서 열기:`);
  console.log(`     ${C.blue}http://localhost:8080/dashboard.html${C.reset}`);
  console.log(`  ${C.gray}3.${C.reset} Report Bar 드롭다운에서 ${C.bold}${contractName}${C.reset} 선택 후 ${C.bold}불러오기${C.reset} 클릭\n`);
}

run().catch(err => { console.error(err); process.exit(1); });
