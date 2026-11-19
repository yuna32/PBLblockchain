// 완화 레이어: 개요 "입금하기 전에 다시 확인하세요" 카드의 "확인해 볼 것" (순수 함수, docs/MITIGATION_UI.md).
// 이미 스냅샷에 있는 값(view.decision, view.codeAssessment, view.warnings, 배포자 상태)만 쓴다.
// 새 판정·새 기준값을 만들지 않고, 기존 개요 규칙(flowLine, codeConclusion, deployerCard)을 그대로 쓴다.
//
// 문구 규칙: 확인 방법만 안내한다. "안전합니다"·"입금하지 마세요" 같은 단정·지시는 쓰지 않는다.
// 코드 위험과 배포자 위험은 항목을 나눠 적고 하나의 등급·점수로 합치지 않는다.
// "이상 없음"은 "이번 분석에서는 그 신호가 없었다"는 뜻이며, 다른 위험은 위 결론을 따른다(NONE_NOTE).
import { codeConclusion, flowLine } from "./overview.js";
import { pagePath, term } from "./terms.js";
import { deployerCard } from "./risk.js";
import { fmtEth } from "./format.js";

export const CHECK_TITLE = "확인해 볼 것";
export const CHECK_DISCLAIMER = "확인할 곳을 안내할 뿐, 투자 여부를 권하지 않습니다.";
export const NONE_NOTE = "이번 분석에서는 이 신호가 없었습니다. 다른 위험은 위 결론을 참고하세요.";

// 항목 상태 세 가지. "이상 없음"은 안전색(초록)을 쓰지 않는다.
export const CHECK_STATUS = {
  detected: { label: "감지", tone: "caution" },
  none:     { label: "이상 없음", tone: "neutral" },
  nodata:   { label: "데이터 없음", tone: "neutral" }
};

// 결론별로 보여 줄 항목(2~4개, 순서대로)
export const ITEMS_BY_CONCLUSION = {
  risk:         ["flow", "code", "withdrawBlock", "deployer"],
  caution:      ["withdrawBlock", "code", "deployer"],
  no_evidence:  ["flow", "code", "withdrawBlock", "deployer"],
  undetermined: ["flow", "deployer"]
};

const statusOfConclusion = c => (c === "risk" || c === "caution" ? "detected" : c === "no_evidence" ? "none" : "nodata");
const warningOf = (warnings, source) => (warnings ?? []).find(w => w.source === source) ?? null;

function flowItem({ decision }) {
  const status = statusOfConclusion(decision.conclusion);
  return {
    key: "flow",
    question: "모인 돈이 어디로 갔나",
    status,
    value: status === "nodata" ? "판단에 필요한 거래가 부족합니다" : flowLine(decision),
    sub: null,
    link: { page: "trade", label: "거래 분석" }
  };
}

function codeItem({ view, glossary }) {
  const code = view.codeAssessment;
  const c = codeConclusion(code, view.warnings);
  const status = statusOfConclusion(c);
  const level = code?.preventionRiskLevel;
  const first = code?.mainRules?.[0]?.description ?? null;
  return {
    key: "code",
    question: "컨트랙트 코드에 위험한 기능이 있나",
    status,
    value: status === "nodata" ? "코드 점검 결과가 없습니다" : `배포 전 코드 점검 위험 수준: ${term(glossary, level).label}`,
    sub: status === "detected" && first ? first : status === "none" ? NONE_NOTE : null,
    link: { page: "raw", label: "컨트랙트 소스" }
  };
}

// 출금 차단 경고: 거래(dynamic.withdraw_block_warning), 코드(prevention.withdraw_block_warning), 유형 미확정 경고(unclassified_warning)
function withdrawBlockItem({ view, decision }) {
  const dyn = warningOf(view.warnings, "dynamic.withdraw_block_warning");
  const prev = warningOf(view.warnings, "prevention.withdraw_block_warning");
  const f = decision.facts ?? {};
  const attempts = f.nonOwnerWithdrawCount ?? 0;
  const succeeded = f.nonOwnerSuccessCount ?? 0;
  const failed = attempts - succeeded;
  const detected = Boolean(dyn?.detected || prev?.detected || decision.hint === "unclassified_warning");
  const link = { page: "raw", label: "감지된 패턴과 경고" };
  const base = { key: "withdrawBlock", question: "돈이 남아 있는데 참여자 출금이 막혔나", tag: "출금 차단 경고", link };

  if (detected) {
    const parts = [];
    if (dyn?.detected || decision.hint === "unclassified_warning") {
      parts.push(`참여자 출금 ${attempts}건 중 ${succeeded}건만 성공했고, 실패할 때 잔고가 ${fmtEth(f.balanceAtFailureEth, 3)} 남아 있었습니다`);
    }
    if (prev?.detected) parts.push("코드에 출금을 막을 수 있는 항목이 있습니다");
    return { ...base, status: "detected", value: parts.join(" · "), sub: null };
  }
  // 거래 쪽은 참여자 출금 시도가 없으면 확인할 수 없다. 코드 쪽 결과도 없으면 데이터 없음.
  if (attempts === 0 && !prev) return { ...base, status: "nodata", value: "참여자 출금 시도가 없어 확인하지 못했습니다", sub: null };
  const value = attempts === 0
    ? "거래: 참여자 출금 시도가 없어 확인하지 못함 · 코드: 출금 차단 항목 없음"
    : "거래와 코드 모두 이 경고가 나오지 않았습니다";
  // 실패한 출금이 있었지만 잔고가 바닥난 뒤였다면 이 경고에 해당하지 않는다(그 실패는 위 판정 근거에 쓰였다)
  const sub = failed > 0 && Number(f.balanceAtFailureEth) === 0
    ? `실패한 참여자 출금 ${failed}건은 잔고가 바닥난 뒤라 이 경고에 해당하지 않습니다. 이 실패는 위 결론의 근거로 쓰였습니다.`
    : NONE_NOTE;
  return { ...base, status: "none", value, sub };
}

function deployerItem({ risk }) {
  const card = deployerCard(risk);
  const status = card.level === "strong" || card.level === "some" ? "detected" : card.level === "none" ? "none" : "nodata";
  return {
    key: "deployer",
    question: "배포한 지갑의 이력은 어떤가",
    status,
    value: card.text ?? "배포자 정보를 평가하지 않았습니다",
    sub: status === "none" ? NONE_NOTE : null,
    link: { page: "trust", label: "배포자 위험도" }
  };
}

const BUILDERS = { flow: flowItem, code: codeItem, withdrawBlock: withdrawBlockItem, deployer: deployerItem };

// view: 뷰모델, risk: lib/risk.js riskForScenario 결과, glossary: 용어집
// → [{ key, question, tag?, status, statusLabel, tone, value, sub, link: { page, path, label } }]
export function checkItems({ view, risk, glossary }) {
  const decision = view?.decision;
  if (!decision) return [];
  const keys = ITEMS_BY_CONCLUSION[decision.conclusion] ?? ITEMS_BY_CONCLUSION.undetermined;
  return keys.map(k => {
    const item = BUILDERS[k]({ view, decision, risk, glossary });
    const s = CHECK_STATUS[item.status];
    return { ...item, statusLabel: s.label, tone: s.tone, link: { ...item.link, path: pagePath(item.link.page) } };
  });
}
