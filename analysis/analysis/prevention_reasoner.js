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

// ── HoneyPot 코드축 서브클래스 탐지 (Torres et al. 2019 HoneyBadger 상위 2기법) ──
// evasionSubclasses(다른 4개 사기유형, 신뢰도 점수 기반 — dynamic_analyzer.js
// detectEvasionSubclass 참고)와 달리 순수 불리언 매치다. fraud_type_suspected가
// HoneypotTrap으로 확정된 컨트랙트에 한해 2차 분류로만 실행되며, risk_score/
// risk_level/checklist 등 기존 판정에는 전혀 관여하지 않는 부가 추론이다.

function findWriteLines(varName, lines, excludeLineNo) {
  const re = new RegExp(`\\b${varName}\\s*=(?!=)`);
  const hits = [];
  lines.forEach((line, i) => {
    if (i + 1 === excludeLineNo) return;
    if (re.test(line)) hits.push(i + 1);
  });
  return hits;
}

// HiddenStateUpdate: 해시/시크릿 비교(keccak256/sha3) 가드에 쓰이는 상태변수의
// write 지점이 2개 이상이면, 배포 후 owner가 정답/비밀값을 재설정할 수 있다고 판단.
export function detectHiddenStateUpdate(lines) {
  const guardRe = /\b(\w+)\s*==\s*(?:keccak256|sha3)\s*\(|(?:keccak256|sha3)\s*\([^;]*\)\s*==\s*(\w+)\b/;
  let guardLine = null, guardVar = null;
  for (let i = 0; i < lines.length; i++) {
    const m = guardRe.exec(lines[i]);
    if (m) { guardVar = m[1] || m[2]; guardLine = i + 1; break; }
  }
  if (!guardVar) return { matched: false, evidence: '해시/시크릿 비교 가드 미검출' };

  const writeLines = findWriteLines(guardVar, lines, guardLine);
  if (writeLines.length < 2) {
    return {
      matched: false,
      evidence: `가드 변수 '${guardVar}'(line ${guardLine} 비교) write 지점 ${writeLines.length}개[${writeLines.join(",")}] — 2개 미만`
    };
  }
  return {
    matched: true,
    evidence: `line ${guardLine}에서 상태변수 '${guardVar}' 해시 비교 가드 검출, ` +
      `write 지점 ${writeLines.length}개(line ${writeLines.join(", ")}) — 배포 후 재설정 가능`
  };
}

// 생성자 파라미터가 그대로 상태변수에 대입되는 지점을 찾는다 (위장 컨트랙트 주입 추적용).
// HoneyBadger 실데이터(straw_man_contract 34건)는 전부 Solidity ^0.4.18~ 시절
// 코드라 `constructor` 키워드가 하나도 없다 — 대신 컨트랙트명과 동일한 이름의
// 함수가 생성자 역할을 한다(구버전 문법). 두 경우 모두 지원해야 한다.
function extractConstructorInjectedVars(src, lines) {
  let ctorStart = lines.findIndex(l => /constructor\s*\(/.test(l));
  let ctorPattern = /constructor\s*\(([^)]*)\)/;

  if (ctorStart === -1) {
    const contractNameMatch = /\bcontract\s+(\w+)/.exec(src);
    if (contractNameMatch) {
      const name = contractNameMatch[1];
      const oldCtorRe = new RegExp(`function\\s+${name}\\s*\\(`);
      ctorStart = lines.findIndex(l => oldCtorRe.test(l));
      ctorPattern = new RegExp(`function\\s+${name}\\s*\\(([^)]*)\\)`);
    }
  }
  if (ctorStart === -1) return [];

  let sig = '', i = ctorStart;
  while (i < lines.length && !sig.includes(')')) { sig += lines[i]; i++; }
  const sigMatch = ctorPattern.exec(sig);
  if (!sigMatch || !sigMatch[1].trim()) return [];
  const paramNames = sigMatch[1].split(',').map(p => p.trim().split(/\s+/).pop()).filter(Boolean);

  let depth = 0, bodyStart = -1, bodyEnd = -1;
  for (let j = ctorStart; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (ch === '{') { if (depth === 0) bodyStart = j; depth++; }
      else if (ch === '}') { depth--; if (depth === 0) { bodyEnd = j; break; } }
    }
    if (bodyEnd !== -1) break;
  }
  if (bodyStart === -1 || bodyEnd === -1) return [];

  // RHS may be a bare param (`x = _p;`) or an interface/type cast wrapping it
  // (`x = IFoo(_p);`, `x = address(_p);`) — both are "생성자 파라미터로 주입".
  const escaped  = paramNames.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const assignRe = new RegExp(`\\b(\\w+)\\s*=\\s*(?:\\w+\\s*\\(\\s*)?(${escaped.join('|')})\\s*\\)?\\s*;`);
  const injected = [];
  for (let j = bodyStart; j <= bodyEnd; j++) {
    const m = assignRe.exec(lines[j]);
    if (m) injected.push({ stateVar: m[1], param: m[2], line: j + 1 });
  }
  return injected;
}

// varName에 대입하는 함수가 owner 전용 가드(onlyOwner 모디파이어 또는
// require(msg.sender==...owner...) 형태의 인라인 가드)를 갖는지 확인한다.
// HoneyBadger 실데이터는 대부분 onlyOwner 모디파이어 없이 인라인 require만 쓴다.
function isVarOwnerSettable(varName, src) {
  const assignRe = new RegExp(`\\b${varName}\\s*=\\s*\\w+\\s*;`);
  const funcRe = /function\s+\w+\s*\([^)]*\)[^{;]*\{/g;
  let m;
  while ((m = funcRe.exec(src)) !== null) {
    const braceIdx = src.indexOf('{', m.index);
    let depth = 0, endIdx = -1;
    for (let k = braceIdx; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (depth === 0) { endIdx = k; break; } }
    }
    if (endIdx === -1) continue;
    const sig  = src.slice(m.index, braceIdx);
    const body = src.slice(braceIdx, endIdx);
    if (assignRe.test(body) &&
        (/onlyOwner/i.test(sig) || /require\s*\(\s*msg\.sender\s*==\s*\w*[Oo]wner\w*/.test(body))) {
      return true;
    }
  }
  return false;
}

// StrawManContract: msg.sender 송금 이후 생성자 주입 컨트랙트 변수에 대한 고수준
// 외부호출이 이어지거나(일반형), owner가 세팅 가능한 주소로의 delegatecall이
// 송금문과 인접(delegatecall 변종)하면 매치.
export function detectStrawManContract(src, lines) {
  const injected = extractConstructorInjectedVars(src, lines);

  const sendRe = /(?:payable\([^)]*msg\.sender[^)]*\)|\bmsg\.sender)\s*\.\s*(?:call\s*(?:\{\s*value\s*:|\.value\s*\()|send\s*\()/;
  const sendLines = [];
  lines.forEach((line, i) => { if (sendRe.test(line)) sendLines.push(i + 1); });
  if (sendLines.length === 0) {
    return { matched: false, evidence: 'msg.sender 송금문 미검출' };
  }

  // 일반형(고수준 호출)은 생성자 주입 변수가 있을 때만 해당 — delegatecall
  // 변종은 주입 여부와 무관하게 독립적으로 판정한다(아래).
  const LOW_LEVEL = new Set(['call', 'delegatecall', 'staticcall', 'send', 'transfer']);
  for (const { stateVar, line: injLine } of injected) {
    const callRe = new RegExp(`\\b${stateVar}\\s*\\.\\s*(\\w+)\\s*\\(`);
    for (let i = 0; i < lines.length; i++) {
      const m = callRe.exec(lines[i]);
      if (!m || LOW_LEVEL.has(m[1])) continue;
      const callLine = i + 1;
      if (sendLines.some(sl => callLine > sl)) {
        return {
          matched: true,
          variant: 'general_call',
          evidence: `line ${sendLines.join(",")} 송금 이후 line ${callLine}에서 생성자 ` +
            `주입 변수 '${stateVar}'(line ${injLine} 주입)에 대한 고수준 호출 '${m[1]}()' 검출`
        };
      }
    }
  }

  // delegatecall 변종: owner 전용 세터로 변경 가능한 주소로의 delegatecall이
  // 송금문과 인접. 대상 변수별로 owner 가드를 확인(전역 블랭킷 매치보다 정밀).
  const delegateRe = /(\w+)\s*\.\s*delegatecall\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const m = delegateRe.exec(lines[i]);
    if (!m) continue;
    const delegateLine = i + 1;
    if (!sendLines.some(sl => Math.abs(sl - delegateLine) <= 1)) continue;
    if (!isVarOwnerSettable(m[1], src)) continue;
    return {
      matched: true,
      variant: 'delegatecall',
      evidence: `line ${delegateLine}의 delegatecall('${m[1]}')이 송금문(line ` +
        `${sendLines.join(",")})과 인접, '${m[1]}'는 owner 전용 세터로 변경 가능한 주소`
    };
  }

  const injectedNote = injected.length > 0
    ? `생성자 주입 변수(${injected.map(x => x.stateVar).join(",")})는 있으나`
    : '생성자 주입 변수 없음,';
  return {
    matched: false,
    evidence: `송금문(line ${sendLines.join(",")})과 ${injectedNote} 고수준 외부호출/delegatecall 변종 미검출`
  };
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

  // ── HoneyPot 코드축 서브클래스 2차 분류 (boolean, 기존 판정에 영향 없는 부가 추론) ──
  const honeypot_code_pattern_subclasses = [];
  if (fraudType === "HoneypotTrap") {
    const codePatterns = FraudOntology.fraudTypes.HoneypotTrap.codePatternSubclasses || {};

    const hsu = detectHiddenStateUpdate(lines);
    chain.push(`[코드패턴] HiddenStateUpdate: ${hsu.evidence} → ${hsu.matched ? "매치" : "불일치"}`);
    if (hsu.matched) {
      honeypot_code_pattern_subclasses.push({
        id: codePatterns.HiddenStateUpdate.id,
        label: codePatterns.HiddenStateUpdate.label,
        codePattern: "HiddenStateUpdatePattern",
        evidence: hsu.evidence
      });
    }

    const smc = detectStrawManContract(src, lines);
    chain.push(`[코드패턴] StrawManContract: ${smc.evidence} → ${smc.matched ? "매치" : "불일치"}`);
    if (smc.matched) {
      honeypot_code_pattern_subclasses.push({
        id: codePatterns.StrawManContract.id,
        label: codePatterns.StrawManContract.label,
        codePattern: "StrawManContractPattern",
        evidence: smc.evidence
      });
    }
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
    honeypot_code_pattern_subclasses,
    ontology_reasoning_chain: chain
  };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const name = process.argv[2];
  if (!name) { console.error("사용법: node analysis/prevention_reasoner.js <ContractName>"); process.exit(1); }
  runPrevention(name).then(r => console.log(JSON.stringify(r, null, 2)));
}