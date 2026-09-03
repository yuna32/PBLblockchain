import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FraudOntology } from "./fraud_ontology.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Thresholds sourced from FraudOntology where applicable
const _HP = FraudOntology.fraudTypes.HoneypotTrap.detectionThresholds;

const RULES = [
  {
    id: "UNCONSTRAINED_OWNER_DRAIN",
    description: "오너가 전액을 외부로 인출할 수 있는 함수 (러그풀/폰지 핵심 위험)",
    detect: (src) =>
      /function\s+\w*[Ww]ithdraw[Aa]ll\b|function\s+rugPull/.test(src) &&
      /onlyOwner/.test(src),
    weight: 50,
    fraudClasses: ["RugPull", "PonziScheme"],
    evasion: "OwnerWithdrawAll"
  },
  {
    id: "PYRAMID_STRUCTURE",
    description: "신규 입금으로 기존 수익 지급 구조 (rewardRate + 별도 보상 풀 없음)",
    detect: (src) => /rewardRate\s*=/.test(src) && !/rewardPool/.test(src),
    weight: 40,
    fraudClasses: ["PonziScheme"],
    evasion: null
  },
  {
    id: "INSIDER_PRIVILEGE",
    description: "내부자 전용 특권 인출 기능 (펌프앤덤프 위험)",
    detect: (src) => /isInsider|insiderWithdraw|addInsider/.test(src),
    weight: 35,
    fraudClasses: ["PumpAndDump"],
    evasion: null
  },
  {
    id: "RAPID_EXIT_MECHANISM",
    description: "즉시 전액 인출 함수 — 파라미터 없음 (이탈 패턴)",
    detect: (src) => /function\s+withdrawAll\s*\(\s*\)/.test(src),
    weight: 30,
    fraudClasses: ["RugPull"],
    evasion: "OwnerWithdrawAll"
  },
  {
    id: "REWARD_PROMISE",
    description: "고정 수익률 약속 변수 (과도한 수익 보장 의심)",
    detect: (src) => /rewardRate|annualRate|interestRate/.test(src),
    weight: 15,
    fraudClasses: ["PonziScheme"],
    evasion: null
  },
  {
    id: "HIDDEN_WITHDRAW_BLOCK",
    // Ontology: HoneypotTrap.usesEvasion includes HiddenRequireCondition
    description: "출금 차단 숨김 조건 존재 (허니팟 의심) — private bool이 출금 require에 사용되고 public 활성화 함수 없음",
    detect: (src) =>
      /bool\s+private\s+_\w+\s*=\s*false/.test(src) &&
      /require\s*\(\s*_\w+/.test(src) &&
      /function\s+\w*[Ww]ithdraw/.test(src),
    weight: 45,
    fraudClasses: ["HoneypotTrap"],
    evasion: "HiddenRequireCondition"
  }
];

const VERDICT_THRESHOLDS = [
  { min: 45, label: "HIGH_RISK" },
  { min: 25, label: "MEDIUM_RISK" },
  { min: 0,  label: "LOW_RISK" }
];

export function analyzeStatic(solPath) {
  if (!fs.existsSync(solPath)) {
    return {
      file: path.basename(solPath),
      error: "파일을 찾을 수 없습니다",
      triggered_rules: [],
      static_risk_score: 0,
      verdict: "UNKNOWN"
    };
  }

  const src = fs.readFileSync(solPath, "utf8");
  const triggered = [];
  let rawScore = 0;

  for (const rule of RULES) {
    if (rule.detect(src)) {
      triggered.push({ id: rule.id, description: rule.description, weight: rule.weight });
      rawScore += rule.weight;
    }
  }

  const static_risk_score = Math.min(100, rawScore);
  const verdict = VERDICT_THRESHOLDS.find(t => static_risk_score >= t.min).label;

  // Determine primary fraud class from triggered rules
  const hitClasses = [...new Set(triggered.flatMap(r => RULES.find(rl => rl.id === r.id)?.fraudClasses || []))];
  const primaryFraudClass = hitClasses[0] || null;
  const gui_emphasis = primaryFraudClass
    ? (FraudOntology.fraudTypes[primaryFraudClass]?.guiEmphasis || null)
    : null;

  return {
    file: path.basename(solPath),
    triggered_rules: triggered,
    static_risk_score,
    verdict,
    primary_fraud_class: primaryFraudClass,
    gui_emphasis
  };
}

// CLI 직접 실행
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const solArg = process.argv[2];
  if (!solArg) {
    console.error("사용법: node analysis/static_analyzer.js contracts/PonziLab.sol");
    process.exit(1);
  }
  const result = analyzeStatic(path.resolve(solArg));
  console.log(JSON.stringify(result, null, 2));
}
