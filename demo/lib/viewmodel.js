// 화면용 뷰모델: 리포트 + envelope + 거래 행 → 화면 객체. 순수 함수이고 리포트 원본은 바꾸지 않는다.
// overall_grade·raw_grade는 넣지 않는다(D9: 종합 단일 등급 불가, 코드와 지갑 등급 독립 출력).

import { computeOnset, isFraudHint } from "./onset.js";

// analysis/trust_scorer.js:143의 과도 수익 기준(profit_ratio > 1.3)과 같은 값
export const EXTRACTOR_PROFIT_RATIO = 1.3;
export const EXTRACTOR_DEFINITION =
  `is_drainer가 아니면서 profit_ratio > ${EXTRACTOR_PROFIT_RATIO}인 지갑 (입금액 대비 ${EXTRACTOR_PROFIT_RATIO}배 초과 수령)`;

export const FRAUD_TYPE_LABELS = {
  ponzi_scheme:         "폰지 사기",
  rug_pull:             "러그풀",
  money_laundering:     "자금세탁",
  pump_and_dump:        "펌프앤덤프",
  flash_loan:           "플래시론 악용",
  normal_staking:       "정상 스테이킹",
  unclassified_warning: "유형 미확정 (출금 차단 경고)",
  unknown:              "판정 불가"
};

export const DISCLAIMER =
  "본 결과는 시뮬레이션 거래 로그와 컨트랙트 소스 코드에 대한 휴리스틱 분석 결과이며, 실제 사기 여부를 확정하지 않는다. " +
  "판정 규칙과 임계값은 연구 단계의 잠정값이라 오탐과 미탐이 있을 수 있다. " +
  "본 결과는 투자 판단의 근거가 될 수 없으며, 이를 근거로 한 결정의 책임은 이용자에게 있다.";

const MAIN_RULE_COUNT = 3;

function codeAssessment(report) {
  const p = report.prevention ?? {};
  const s = report.static ?? {};
  const rules = [...(s.triggered_rules ?? [])].sort((a, b) => b.weight - a.weight);
  return {
    preventionRiskLevel: p.risk_level ?? null,
    preventionRiskLabel: p.risk_label ?? null,
    preventionRiskScore: p.risk_score ?? null,
    fraudTypeSuspected:  p.fraud_type_suspected ?? null,
    staticVerdict:       s.verdict ?? null,
    staticRiskScore:     s.static_risk_score ?? null,
    mainRules: rules.slice(0, MAIN_RULE_COUNT).map(r => ({ id: r.id, description: r.description, weight: r.weight }))
  };
}

function walletAssessment(report) {
  const t = report.trust ?? {};
  const wallets = t.wallet_scores ?? [];
  const lowest = wallets.reduce((min, w) => (min === null || w.trust_score < min.trust_score ? w : min), null);
  return {
    trustGrade:   t.trust_grade ?? null,
    trustScore:   t.overall_trust_score ?? null,
    walletCount:  wallets.length,
    lowestWallet: lowest ? { address: lowest.address, grade: lowest.grade, trustScore: lowest.trust_score } : null,
    lowestDiffersFromOverall: lowest ? lowest.grade !== t.trust_grade : false,
    drainerCount:   wallets.filter(w => w.is_drainer).length,
    extractorCount: wallets.filter(w => !w.is_drainer && w.profit_ratio > EXTRACTOR_PROFIT_RATIO).length,
    extractorDefinition: EXTRACTOR_DEFINITION
  };
}

function warnings(report) {
  const d = report.dynamic ?? {};
  const p = report.prevention ?? {};
  const out = [];
  if (d.withdraw_block_warning) {
    out.push({ source: "dynamic.withdraw_block_warning", detected: !!d.withdraw_block_warning.detected, detail: d.withdraw_block_warning.reason ?? null });
  }
  if (p.withdraw_block_warning) {
    out.push({ source: "prevention.withdraw_block_warning", detected: !!p.withdraw_block_warning.detected, detail: p.withdraw_block_warning.matched_items ?? [] });
  }
  const codePatterns = p.code_pattern_warnings ?? [];
  if (codePatterns.length === 0) {
    out.push({ source: "prevention.code_pattern_warnings", detected: false, detail: [] });
  } else {
    for (const w of codePatterns) out.push({ source: "prevention.code_pattern_warnings", detected: true, detail: w });
  }
  if (d.fraud_type_hint === "unclassified_warning") {
    const step = [...(d.reasoning_steps ?? [])].reverse().find(s => s.includes("unclassified_warning"));
    out.push({ source: "dynamic.fraud_type_hint", detected: true, detail: step ?? "unclassified_warning" });
  }
  if (p.classification === "unclassified_warning") {
    out.push({ source: "prevention.classification", detected: true, detail: p.risk_label ?? "unclassified_warning" });
  }
  return out;
}

function patterns(report) {
  const d = report.dynamic ?? {};
  const inflow = d.anomaly_signals?.INFLOW_STOP ?? {};
  const hint = d.fraud_type_hint ?? null;
  return {
    fraudTypeHint:  hint,
    fraudTypeLabel: FRAUD_TYPE_LABELS[hint] ?? hint,
    fraudClassified: isFraudHint(hint),
    dynamicVerdict: d.verdict ?? null,
    dynamicRiskScore: d.dynamic_risk_score ?? null,
    signals: (d.triggered_rules ?? []).map(r => ({
      id: r.id, description: r.description, weight: r.weight, weightMax: r.weight_max, fraction: r.fraction
    })),
    reasoningSteps: d.reasoning_steps ?? [],
    evasion: {
      detected:   !!d.evasion_detected,
      subclass:   d.evasion_subclass ?? null,
      confidence: d.evasion_confidence ?? 0
    },
    inflowStop: {
      detected:         !!inflow.detected,
      stopRatio:        inflow.stop_ratio ?? null,
      lastDepositBlock: inflow.last_deposit_block ?? null
    }
  };
}

// rows: 거래 행(toTimeseries 또는 parseCsv 결과)
export function buildViewModel({ report, envelope, rows }) {
  const { onset, events } = computeOnset(rows, report.dynamic);
  return {
    scenario:   envelope?.scenario ?? null,
    contract:   report.contract,
    source:     envelope?.source ?? null,
    reportHash: envelope?.report_sha256 ?? null,
    codeAssessment:   codeAssessment(report),
    walletAssessment: walletAssessment(report),
    warnings:  warnings(report),
    patterns:  patterns(report),
    phase:     { onset, events },
    disclaimer: DISCLAIMER
  };
}
