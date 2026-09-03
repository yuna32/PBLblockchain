import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FraudOntology } from "./fraud_ontology.js";
import { analyzeStatic } from "./static_analyzer.js";

const __filename  = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);
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

// Evaluate a presence-pattern checklist item with compound mitigation logic
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

// Evaluate an absence-pattern item: detected(risky) when none of the guard patterns are found
function evalAbsenceItem(item, src) {
  const guards = item.detectPattern.split("|")
    .filter(p => p.startsWith("ABSENCE:"))
    .map(p => p.replace("ABSENCE:", ""));
  const hit = guards.find(p => new RegExp(p, "i").test(src));
  if (hit) return { matched: false, evidence: `보호 패턴 '${hit}' 검출 (위험 해소됨)` };
  return { matched: true, evidence: `보호 패턴 [${guards.join(", ")}] 미검출` };
}

// triggers/implies 인과관계 예측 (설계서 4-3절, v0.2 신규)
// BehaviorPattern의 정적 프록시가 소스에서 검출되면, 아직 실제 신호가
// 관측되지 않았더라도 대응 AnomalySignal 발생을 예측해 reasoning_chain에
// 부기한다. risk_score/risk_level/checklist/fraud_type_suspected 등 기존
// 판정에는 전혀 관여하지 않는 순수 부가 추론이다 (OWL 레이어의
// triggers/implies SWRL 규칙과 1:1 대응 — add_swrl_rules.py imp9~imp13).
function predictCausalSignals(src) {
  const predictions = [];
  for (const relation of ["triggers", "implies"]) {
    for (const rule of FraudOntology.causalRelations[relation]) {
      if (new RegExp(rule.detectPattern).test(src)) {
        predictions.push({
          relation,
          pattern: rule.pattern,
          signal: rule.signal,
          rationale: rule.rationale
        });
      }
    }
  }
  return predictions;
}

// Score each fraud type by positive-pattern matches (no compound logic — for type detection only)
function scoreAllFraudTypes(src) {
  const scores = {};
  for (const [typeName, rules] of Object.entries(FraudOntology.preventionRules)) {
    let score = 0;
    for (const item of rules.checklistItems) {
      if (isAbsenceOnly(item.detectPattern)) continue;
      const parts = item.detectPattern.split("|").filter(p => !p.startsWith("ABSENCE:"));
      if (parts.some(p => new RegExp(p).test(src))) score += item.riskWeight;
    }
    scores[typeName] = score;
  }
  return scores;
}

export async function runPrevention(contractName) {
  const solPath = path.join(PROJECT_ROOT, "contracts", `${contractName}.sol`);
  const chain   = [];

  if (!fs.existsSync(solPath)) {
    return {
      contract: contractName,
      error: `소스 파일 없음: ${solPath}`,
      fraud_type_suspected: null,
      checklist: [],
      risk_score: 0,
      risk_level: "UNKNOWN",
      risk_label: "파일 없음",
      unmet_conditions: [],
      deployment_recommendation: "파일을 찾을 수 없음",
      ontology_reasoning_chain: ["오류: 소스 파일 없음"]
    };
  }

  const src   = fs.readFileSync(solPath, "utf8");
  const lines = getLines(src);
  chain.push(`소스 로드: ${path.basename(solPath)} (${lines.length}줄)`);

  // ── triggers/implies 인과관계 예측 (부가 추론, 판정에는 영향 없음) ─────────
  const predicted_anomaly_signals = predictCausalSignals(src);
  for (const p of predicted_anomaly_signals) {
    chain.push(`[${p.relation}] ${p.pattern} 감지 → ${p.signal} 발생 예상 (${p.rationale})`);
  }

  // ── Fraud type detection ──────────────────────────────────────────────────
  const typeScores = scoreAllFraudTypes(src);
  chain.push(`유형별 패턴 점수: ${JSON.stringify(typeScores)}`);

  const maxScore = Math.max(...Object.values(typeScores));

  if (maxScore === 0) {
    chain.push("모든 사기 유형 패턴 미검출 → 정상 구조로 판단");
    return {
      contract: contractName,
      fraud_type_suspected: null,
      checklist: [],
      risk_score: 0,
      risk_level: "LOW",
      risk_label: "정상 구조",
      unmet_conditions: [],
      deployment_recommendation: "사기 패턴 미검출. 배포 가능.",
      predicted_anomaly_signals,
      ontology_reasoning_chain: chain
    };
  }

  const topTypes = Object.entries(typeScores).filter(([, s]) => s === maxScore).map(([t]) => t);
  let fraudType = topTypes[0];

  if (topTypes.length > 1) {
    // Use static analyzer primary_fraud_class as tiebreaker
    const staticResult = analyzeStatic(solPath);
    const STATIC_MAP   = {
      PonziScheme: "PonziScheme", RugPull: "RugPull",
      MoneyLaundering: "MoneyLaundering", HoneypotTrap: "HoneypotTrap",
      PumpAndDump: "PumpDump"
    };
    const hint = STATIC_MAP[staticResult.primary_fraud_class];
    if (hint && topTypes.includes(hint)) fraudType = hint;
    chain.push(`동점 해소: 정적 분석 힌트(${staticResult.primary_fraud_class}) → ${fraudType}`);
  } else {
    chain.push(`사기 유형 결정: ${fraudType} (점수 ${maxScore})`);
  }

  const rules = FraudOntology.preventionRules[fraudType];
  chain.push(`${fraudType} 예방 체크리스트 시작`);

  // ── Evaluate checklist ────────────────────────────────────────────────────
  const checklist   = [];
  let   totalScore  = 0;
  const unmet       = [];
  let   positiveHit = false;

  // Pass 1 — presence items
  for (const item of rules.checklistItems) {
    if (isAbsenceOnly(item.detectPattern)) continue;
    const { matched, evidence } = evalPresenceItem(item, src, lines);
    if (matched) { positiveHit = true; totalScore += item.riskWeight; unmet.push(item.id); }
    chain.push(`${item.id}: ${evidence} → ${matched ? `검출 (위험 +${item.riskWeight})` : "안전"}`);
    checklist.push({ id: item.id, label: item.label, detected: matched,
      riskWeight: item.riskWeight, evidence, consequence: item.ifDetected, fix: item.fixSuggestion });
  }

  // Pass 2 — absence items (skipped when no positive hits, to avoid false alarms on safe contracts)
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

  // Restore original item order
  const order = rules.checklistItems.map(i => i.id);
  checklist.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  chain.push(`총 위험 점수: ${totalScore}`);

  // ── Risk level ────────────────────────────────────────────────────────────
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

  return {
    contract: contractName,
    fraud_type_suspected:     fraudType,
    checklist,
    risk_score:               totalScore,
    risk_level,
    risk_label,
    unmet_conditions:         unmet,
    deployment_recommendation,
    predicted_anomaly_signals,
    ontology_reasoning_chain: chain
  };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const name = process.argv[2];
  if (!name) { console.error("사용법: node analysis/prevention_reasoner.js <ContractName>"); process.exit(1); }
  runPrevention(name).then(r => console.log(JSON.stringify(r, null, 2)));
}