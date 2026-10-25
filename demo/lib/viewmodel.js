// 화면용 뷰모델: 리포트 + envelope + 거래 행 → 화면 객체. 순수 함수이고 리포트 원본은 바꾸지 않는다.
// overall_grade·raw_grade는 넣지 않는다(D9: 종합 단일 등급 불가, 코드와 지갑 등급 독립 출력).

import { computeOnset, isFraudHint } from "./onset.js";
import { computeCombination } from "./combination.js";
import { glossaryLabel } from "./glossary.js";

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

// ── 결론 문장 (headline) ──
// 유형별 템플릿. 단정하지 않는 표현만 쓴다.
export const HEADLINE_TEMPLATES = {
  ponzi_scheme:         "신규 입금으로 기존 참여자에게 수익을 지급하는 폰지 사기 가능성이 높습니다.",
  rug_pull:             "운영자가 모인 자금을 한 번에 빼내는 러그풀 가능성이 높습니다.",
  money_laundering:     "여러 지갑의 소액 입금을 한 지갑으로 모으는 자금세탁 패턴이 감지되었습니다.",
  pump_and_dump:        "내부자가 먼저 자금을 빼내 후발 참여자가 손실을 보는 펌프앤덤프 가능성이 높습니다.",
  flash_loan:           "같은 블록에서 대규모 입출금을 반복하는 플래시론 악용 패턴이 감지되었습니다.",
  normal_safe:          "분석한 범위에서는 사기 패턴이 감지되지 않았습니다.",
  normal_caution:       "사기 유형 패턴은 감지되지 않았지만, 일부 위험 신호가 있어 확인이 필요합니다.",
  unclassified_warning: "사기 유형은 확정되지 않았지만 출금이 막히는 패턴이 감지되어 주의가 필요합니다.",
  unknown:              "판정에 필요한 신호가 부족해 유형을 정하지 못했습니다. 추가 확인이 필요합니다."
};
export const HEADLINE_PAGES = ["overview", "trade", "trust", "ontology", "report"];
const MAX_REASONS = 4;

const WARNING_LABELS = {
  "dynamic.withdraw_block_warning":    "출금 차단 경고 (거래)",
  "prevention.withdraw_block_warning": "출금 차단 경고 (코드)",
  "prevention.code_pattern_warnings":  "코드 패턴 경고",
  "dynamic.fraud_type_hint":           "유형 미확정 경고 (거래)",
  "prevention.classification":         "유형 미확정 경고 (코드)"
};

// headline 근거 문장용 경고 설명: 원시 ID 대신 용어집 한글 라벨과 한국어 문장으로 쓴다.
// (view.warnings의 detail 원본은 그대로 둔다)
function warningReasonDetail(w, report) {
  switch (w.source) {
    case "dynamic.withdraw_block_warning":
      return typeof w.detail === "string" ? w.detail : "출금 차단 신호가 감지되었습니다.";
    case "prevention.withdraw_block_warning": {
      const items = Array.isArray(w.detail) ? w.detail.map(glossaryLabel) : [];
      return items.length ? `코드에서 ${items.join(", ")} 항목이 검출되었습니다.` : "코드에서 출금 차단 항목이 검출되었습니다.";
    }
    case "prevention.code_pattern_warnings":
      return `코드 패턴이 검출되었습니다: ${w.detail?.label ?? glossaryLabel(w.detail?.codePattern?.replace(/Pattern$/, ""))}.`;
    case "dynamic.fraud_type_hint": {
      const reason = report.dynamic?.withdraw_block_warning?.reason;
      return `사기 유형 조건에는 맞지 않지만 ${glossaryLabel("ZeroWithdrawBlock")}가 감지되었습니다` + (reason ? ` (${reason}).` : ".");
    }
    case "prevention.classification":
      return `예방 분석에서 ${glossaryLabel("unclassified_warning")}로 분류되었습니다` +
        (report.prevention?.risk_label ? ` (${report.prevention.risk_label}).` : ".");
    default:
      return typeof w.detail === "string" ? w.detail : "";
  }
}

// reasons: 경고(감지된 것) → 첫 출금 블록 → 회피 패턴 → 최저 지갑 등급·drainer/extractor → 코드 위험 수준, 최대 4개.
function buildHeadline({ report, code, wallet, warns, pats, onset, combination }) {
  const hint = pats.fraudTypeHint;
  const detectedWarnings = warns.filter(w => w.detected);

  let tone, text;
  if (isFraudHint(hint)) {
    tone = "danger";
    text = HEADLINE_TEMPLATES[hint];
  } else if (hint === "unclassified_warning") {
    tone = "caution";
    text = HEADLINE_TEMPLATES.unclassified_warning;
  } else if (hint === "normal_staking") {
    const clean = combination.quadrant === "low-low" && detectedWarnings.length === 0;
    tone = clean ? "safe" : "caution";
    text = clean ? HEADLINE_TEMPLATES.normal_safe : HEADLINE_TEMPLATES.normal_caution;
  } else {
    tone = "caution";
    text = HEADLINE_TEMPLATES.unknown;
  }

  const reasons = [];
  for (const w of detectedWarnings) {
    reasons.push({ label: WARNING_LABELS[w.source] ?? w.source, detail: warningReasonDetail(w, report), page: "report" });
  }
  if (onset) {
    reasons.push({ label: `첫 출금 블록 ${onset.block}`, detail: `블록 ${onset.block}에서 처음으로 자금이 빠져나갔습니다.`, page: "trade" });
  }
  if (pats.evasion.detected && pats.evasion.subclass) {
    const name = glossaryLabel(pats.evasion.subclass);
    reasons.push({
      label: `회피 패턴: ${name}`,
      detail: `${name} 패턴이 감지되었습니다 (회피 점수 ${pats.evasion.confidence}).`,
      page: "ontology"
    });
  }
  if (wallet.lowestWallet) {
    reasons.push({
      label: `최저 지갑 등급 ${wallet.lowestWallet.grade}`,
      detail: `평균 지갑 등급은 ${wallet.trustGrade}이고, 운영자 전액 인출 지갑(drainer) ${wallet.drainerCount}개, ` +
              `과도 수익 지갑(extractor) ${wallet.extractorCount}개가 있습니다.`,
      page: "trust"
    });
  }
  if (code.preventionRiskLevel) {
    const detected = (report.prevention?.checklist ?? []).filter(c => c.detected).length;
    reasons.push({
      label: `코드 위험 수준 ${glossaryLabel(code.preventionRiskLevel)}`,
      detail: detected > 0
        ? `배포 전 예방 분석에서 위험 항목 ${detected}개가 검출되었습니다.`
        : "배포 전 예방 분석에서 위험 항목이 검출되지 않았습니다.",
      page: "report"
    });
  }

  return { tone, text, reasons: reasons.slice(0, MAX_REASONS) };
}

// rows: 거래 행(toTimeseries 또는 parseCsv 결과)
export function buildViewModel({ report, envelope, rows }) {
  const { onset, events } = computeOnset(rows, report.dynamic);
  const code   = codeAssessment(report);
  const wallet = walletAssessment(report);
  const warns  = warnings(report);
  const pats   = patterns(report);
  const combination = computeCombination({ codeAssessment: code, walletAssessment: wallet });
  return {
    scenario:   envelope?.scenario ?? null,
    contract:   report.contract,
    source:     envelope?.source ?? null,
    reportHash: envelope?.report_sha256 ?? null,
    codeAssessment:   code,
    walletAssessment: wallet,
    warnings:  warns,
    patterns:  pats,
    phase:     { onset, events },
    disclaimer: DISCLAIMER,
    headline:  buildHeadline({ report, code, wallet, warns, pats, onset, combination }),
    combination
  };
}
