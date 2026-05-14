import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RULES = [
  {
    id: "UNCONSTRAINED_OWNER_DRAIN",
    description: "오너가 전액을 외부로 인출할 수 있는 함수 (러그풀/폰지 핵심 위험)",
    detect: (src) =>
      /function\s+\w*[Ww]ithdraw[Aa]ll\b|function\s+rugPull/.test(src) &&
      /onlyOwner/.test(src),
    weight: 50
  },
  {
    id: "PYRAMID_STRUCTURE",
    description: "신규 입금으로 기존 수익 지급 구조 (rewardRate + 별도 보상 풀 없음)",
    detect: (src) => /rewardRate\s*=/.test(src) && !/rewardPool/.test(src),
    weight: 40
  },
  {
    id: "INSIDER_PRIVILEGE",
    description: "내부자 전용 특권 인출 기능 (펌프앤덤프 위험)",
    detect: (src) => /isInsider|insiderWithdraw|addInsider/.test(src),
    weight: 35
  },
  {
    id: "RAPID_EXIT_MECHANISM",
    description: "즉시 전액 인출 함수 — 파라미터 없음 (플래시론/이탈 패턴)",
    detect: (src) => /function\s+withdrawAll\s*\(\s*\)/.test(src),
    weight: 30
  },
  {
    id: "REWARD_PROMISE",
    description: "고정 수익률 약속 변수 (과도한 수익 보장 의심)",
    detect: (src) => /rewardRate|annualRate|interestRate/.test(src),
    weight: 15
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

  return {
    file: path.basename(solPath),
    triggered_rules: triggered,
    static_risk_score,
    verdict
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
