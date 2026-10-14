import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FraudOntology } from "./fraud_ontology.js";
import { analyzeStatic }  from "./static_analyzer.js";
import { detectHiddenStateUpdate, detectStrawManContract } from "./honeypot_code_patterns.js";

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);
// analysis/ → resolve(..) = pbl/ (the project root)
const PROJECT_ROOT = path.resolve(__dirname, "..");

function isAbsenceOnly(patternStr) {
  return patternStr.split("|").every(p => p.startsWith("ABSENCE:"));
}

function getLines(src) { return src.split("\n"); }

function findMatchLine(re, lines) {
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return null;
}

function evalPresenceItem(item, src, lines) {
  const parts = item.detectPattern.split("|").filter(p => !p.startsWith("ABSENCE:"));
  if (parts.length === 0) return { matched: false, evidence: "패턴 없음" };

  let foundLine = null, foundMatch = null;
  for (const part of parts) {
    const line = findMatchLine(new RegExp(part), lines);
    if (line !== null) { foundLine = line; foundMatch = part; break; }
  }

  if (!foundLine) return { matched: false, evidence: `패턴 [${parts.join("|")}] 미검출` };

  const hasTimelock = /deployBlock|timelock|delay/i.test(src);
  const hasLimit    = /maxAllowed|withdrawalLimit|maxWithdraw/i.test(src);

  if (item.id === "OWNER_WITHDRAW_ALL" && hasTimelock && hasLimit)
    return { matched: false, evidence: `${foundMatch} at line ${foundLine} — timelock+30%한도로 위험 해소` };
  if (item.id === "SINGLE_BENEFICIARY" && hasTimelock)
    return { matched: false, evidence: `${foundMatch} at line ${foundLine} — timelock으로 위험 해소` };

  return { matched: true, evidence: `${foundMatch} found at line ${foundLine}` };
}

function evalAbsenceItem(item, src) {
  const guards = item.detectPattern.split("|")
    .filter(p => p.startsWith("ABSENCE:"))
    .map(p => p.replace("ABSENCE:", ""));
  const hit = guards.find(p => new RegExp(p, "i").test(src));
  if (hit) return { matched: false, evidence: `보호 패턴 '${hit}' 검출 (위험 해소됨)` };
  return { matched: true, evidence: `보호 패턴 [${guards.join(", ")}] 미검출` };
}

function scoreChecklist(checklistItems, src) {
  let score = 0;
  for (const item of checklistItems) {
    if (isAbsenceOnly(item.detectPattern)) continue;
    const parts = item.detectPattern.split("|").filter(p => !p.startsWith("ABSENCE:"));
    if (parts.some(p => new RegExp(p).test(src))) score += item.riskWeight;
  }
  return score;
}

function scoreAllFraudTypes(src) {
  const scores = {};
  for (const [typeName, rules] of Object.entries(FraudOntology.preventionRules)) {
    scores[typeName] = scoreChecklist(rules.checklistItems, src);
  }
  return scores;
}

// 코드 패턴 경고 (HSU/SMC, boolean). 사기 유형과 무관하게 항상 검사하며 판정에는 영향 없음.
function detectCodePatternWarnings(src, lines, chain) {
  const codePatterns = FraudOntology.withdrawBlockWarning.codePatterns;
  const warnings = [];

  const hsu = detectHiddenStateUpdate(lines);
  chain.push(`[코드패턴] HiddenStateUpdate: ${hsu.evidence} → ${hsu.matched ? "매치" : "불일치"}`);
  if (hsu.matched) {
    warnings.push({
      id: codePatterns.HiddenStateUpdate.id,
      label: codePatterns.HiddenStateUpdate.label,
      codePattern: "HiddenStateUpdatePattern",
      evidence: hsu.evidence
    });
  }

  const smc = detectStrawManContract(src, lines);
  chain.push(`[코드패턴] StrawManContract: ${smc.evidence} → ${smc.matched ? "매치" : "불일치"}`);
  if (smc.matched) {
    warnings.push({
      id: codePatterns.StrawManContract.id,
      label: codePatterns.StrawManContract.label,
      codePattern: "StrawManContractPattern",
      evidence: smc.evidence
    });
  }
  return warnings;
}

// 출금 차단 경고 플래그 (b안): 유형 판정과 별개로 항상 출력하며 판정·점수에는 영향 없음.
// 평가 방식은 체크리스트와 같다(존재 패턴 → 하나라도 검출되면 부재 패턴도 검사).
function detectWithdrawBlockWarning(src, lines) {
  const items = FraudOntology.withdrawBlockWarning.checklistItems;
  const hits = new Set();
  for (const item of items) {
    if (!isAbsenceOnly(item.detectPattern) && evalPresenceItem(item, src, lines).matched) hits.add(item.id);
  }
  if (hits.size > 0) {
    for (const item of items) {
      if (isAbsenceOnly(item.detectPattern) && evalAbsenceItem(item, src).matched) hits.add(item.id);
    }
  }
  const matched_items = items.map(i => i.id).filter(id => hits.has(id));
  return { detected: matched_items.length > 0, matched_items };
}

export async function runPrevention(contractName) {
  const solPath = path.join(PROJECT_ROOT, "contracts", `${contractName}.sol`);
  const chain   = [];

  if (!fs.existsSync(solPath)) {
    console.error(`[prevention] Contract not found: ${solPath}`);
    return {
      contract: contractName,
      error: `소스 파일 없음: ${solPath}`,
      fraud_type_suspected: null,
      checklist: [],
      risk_score: 0,
      risk_level: "FILE_NOT_FOUND",
      risk_label: "파일 없음",
      unmet_conditions: [],
      deployment_recommendation: "파일을 찾을 수 없음",
      code_pattern_warnings: [],
      withdraw_block_warning: { detected: false, matched_items: [] },
      ontology_reasoning_chain: [`오류: 소스 파일 없음 → ${solPath}`]
    };
  }

  const src   = fs.readFileSync(solPath, "utf8");
  const lines = getLines(src);
  chain.push(`소스 로드: ${path.basename(solPath)} (${lines.length}줄)`);

  const typeScores = scoreAllFraudTypes(src);
  chain.push(`유형별 패턴 점수: ${JSON.stringify(typeScores)}`);

  const maxScore = Math.max(...Object.values(typeScores));

  // 출금 차단 경고 점수: 유형 점수와 같은 방식으로 매겨 최고점 경쟁에 참여시킨다.
  // 모든 유형 점수보다 높을 때만 경고 경로(유형 미확정), 동점이면 사기 유형이 우선.
  const warning      = FraudOntology.withdrawBlockWarning;
  const warningScore = scoreChecklist(warning.checklistItems, src);
  const isWarning    = warningScore > 0 && warningScore > maxScore;
  if (warningScore > 0) chain.push(`출금 차단 경고 패턴 점수: ${warningScore}`);
  const withdraw_block_warning = detectWithdrawBlockWarning(src, lines);

  if (maxScore === 0 && !isWarning) {
    chain.push("모든 사기 유형 패턴 미검출 → 정상 구조로 판단");
    const code_pattern_warnings = detectCodePatternWarnings(src, lines, chain);
    return {
      contract: contractName,
      fraud_type_suspected: null,
      checklist: [],
      risk_score: 0,
      risk_level: "LOW",
      risk_label: "정상 구조",
      unmet_conditions: [],
      deployment_recommendation: "사기 패턴 미검출. 배포 가능.",
      code_pattern_warnings,
      withdraw_block_warning,
      ontology_reasoning_chain: chain
    };
  }

  let fraudType = null;
  let rules;
  if (isWarning) {
    rules = warning;
    chain.push(`${warning.label}: 경고 점수 ${warningScore} > 사기 유형 최고점 ${maxScore} → ` +
      `유형 미확정 (${warning.classification})`);
    chain.push("출금 차단 경고 체크리스트 시작");
  } else {
    const topTypes = Object.entries(typeScores).filter(([, s]) => s === maxScore).map(([t]) => t);
    fraudType = topTypes[0];

    if (topTypes.length > 1) {
      const staticResult = analyzeStatic(solPath);
      const STATIC_MAP   = {
        PonziScheme: "PonziScheme", RugPull: "RugPull",
        MoneyLaundering: "MoneyLaundering",
        PumpAndDump: "PumpDump"
      };
      const hint = STATIC_MAP[staticResult.primary_fraud_class];
      if (hint && topTypes.includes(hint)) fraudType = hint;
      chain.push(`동점 해소: 정적 분석 힌트(${staticResult.primary_fraud_class}) → ${fraudType}`);
    } else {
      chain.push(`사기 유형 결정: ${fraudType} (점수 ${maxScore})`);
    }

    rules = FraudOntology.preventionRules[fraudType];
    chain.push(`${fraudType} 예방 체크리스트 시작`);
  }

  const checklist   = [];
  let   totalScore  = 0;
  const unmet       = [];
  let   positiveHit = false;

  for (const item of rules.checklistItems) {
    if (isAbsenceOnly(item.detectPattern)) continue;
    const { matched, evidence } = evalPresenceItem(item, src, lines);
    if (matched) { positiveHit = true; totalScore += item.riskWeight; unmet.push(item.id); }
    chain.push(`${item.id}: ${evidence} → ${matched ? `검출 (위험 +${item.riskWeight})` : "안전"}`);
    checklist.push({ id: item.id, label: item.label, detected: matched,
      riskWeight: item.riskWeight, evidence, consequence: item.ifDetected, fix: item.fixSuggestion });
  }

  for (const item of rules.checklistItems) {
    if (!isAbsenceOnly(item.detectPattern)) continue;
    let result;
    if (!positiveHit) {
      result = { matched: false, evidence: "위험 함수 미검출 — 부재 점검 불필요" };
      chain.push(`${item.id}: 위험 함수 없음으로 건너뜀 (안전)`);
    } else {
      result = evalAbsenceItem(item, src);
      if (result.matched) { totalScore += item.riskWeight; unmet.push(item.id); }
      chain.push(`${item.id}: ${result.evidence} → ${result.matched ? `검출 (위험 +${item.riskWeight})` : "안전"}`);
    }
    checklist.push({ id: item.id, label: item.label, detected: result.matched,
      riskWeight: item.riskWeight, evidence: result.evidence,
      consequence: item.ifDetected, fix: item.fixSuggestion });
  }

  const order = rules.checklistItems.map(i => i.id);
  checklist.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  chain.push(`총 위험 점수: ${totalScore}`);

  const sortedLevels = Object.entries(rules.riskLevels)
    .sort((a, b) => b[1].minScore - a[1].minScore);
  const [risk_level, { label: risk_label }] =
    sortedLevels.find(([, v]) => totalScore >= v.minScore);

  chain.push(`위험 등급: ${risk_level} — ${risk_label}`);

  const detectedCount = checklist.filter(c => c.detected).length;
  let deployment_recommendation;
  if      (risk_level === "LOW")    deployment_recommendation = "사기 패턴 미검출. 배포 가능.";
  else if (risk_level === "MEDIUM") deployment_recommendation = `${detectedCount}개 위험 항목 검출. 모니터링 권장 후 배포.`;
  else if (risk_level === "HIGH")   deployment_recommendation = `배포 전 ${detectedCount}개 항목 수정 후 재검토 필요.`;
  else {
    deployment_recommendation = `배포 전 필수 수정 항목 ${detectedCount}개 존재. 수정 없이 배포 불가.`;
    chain.push(`결론: 배포 전 ${detectedCount}개 항목 수정 필요`);
  }

  const code_pattern_warnings = detectCodePatternWarnings(src, lines, chain);

  return {
    contract: contractName,
    fraud_type_suspected:     fraudType,
    ...(isWarning ? { classification: warning.classification } : {}),
    checklist,
    risk_score:               totalScore,
    risk_level,
    risk_label,
    unmet_conditions:         unmet,
    deployment_recommendation,
    code_pattern_warnings,
    withdraw_block_warning,
    ontology_reasoning_chain: chain
  };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const name = process.argv[2];
  if (!name) { console.error("사용법: node analysis/prevention_reasoner.js <ContractName>"); process.exit(1); }
  runPrevention(name).then(r => console.log(JSON.stringify(r, null, 2)));
}
