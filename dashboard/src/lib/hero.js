// 히어로(첫 화면) 문구와 스크롤 연출 계산 (순수 함수). 문구는 승인된 초안 그대로.
// ③ 5단계의 예시 숫자는 러그풀 스냅샷의 view.decision에서만 가져오고, 못 읽으면 숫자 없는 문구를 쓴다.

export const HERO_EXAMPLES = [
  { id: "normal", label: "정상 스테이킹" },
  { id: "ponzi", label: "폰지" },
  { id: "rugpull", label: "러그풀" },
  { id: "laundering", label: "자금세탁" },
  { id: "pumpdump", label: "펌프앤덤프" }
];
export const HERO_EXAMPLE_SCENARIO = "rugpull";
export const ADDRESS_NOTICE = "시연판에서는 예시 컨트랙트만 확인할 수 있습니다. 아래 버튼으로 골라 주세요";

export const CHECK_CARDS = [
  { key: "flow", title: "돈의 흐름", sub: "누가 넣고 누가 가져갔나", desc: "입금과 출금 기록을 따라가 모인 돈이 어디로 갔는지 봅니다." },
  { key: "code", title: "코드", sub: "출금이 막혀 있지 않나", desc: "컨트랙트 코드에 출금을 막거나 운영자만 돈을 뺄 수 있는 기능이 있는지 점검합니다." },
  { key: "creator", title: "배포자", sub: "배포자의 돈은 어디서 왔나", desc: "배포자의 이력을 확인하는 자리입니다. 시연판에는 아직 데이터가 없습니다." }
];

export const FRAUD_CARDS = [
  { key: "ponzi", title: "폰지", nick: "돌려막기", desc: "뒤에 들어온 사람의 돈으로 앞사람에게 수익을 줍니다" },
  { key: "rugpull", title: "러그풀", nick: "들고 나가기", desc: "모인 돈을 운영자가 한 번에 가져갑니다" },
  { key: "laundering", title: "자금세탁", nick: "모아서 흘려보내기", desc: "잘게 나눈 돈을 한곳에 모아 출처를 흐립니다" },
  { key: "pumpdump", title: "펌프앤덤프", nick: "띄우고 먼저 팔기", desc: "내부자가 먼저 빠져나가고, 뒤에 온 사람의 출금이 막힙니다" }
];

// 예방·완화·대응 (온톨로지 설계서 v0.2 2-1절 정의). 대응은 시연판에 연결되지 않아 "개발 중" 배지.
export const VALUE_LINES = [
  { key: "prevent", title: "예방", text: "입금하기 전에 코드와 거래 기록에서 위험 신호를 먼저 살펴볼 수 있습니다" },
  { key: "mitigate", title: "완화", text: "판단 근거와 이상이 처음 보인 시점을 보여 줘, 피해가 커지기 전에 경고 신호를 알아볼 수 있게 돕습니다" },
  { key: "respond", title: "대응", text: "새로 발견된 사기 패턴을 판단 기준에 추가해 다음 탐지에 반영하는 단계입니다. 시연판에는 아직 연결되어 있지 않습니다", badge: "개발 중" }
];

const STEP_BASE = [
  { key: "observe", title: "거래 기록을 읽습니다", desc: "입금과 출금을 블록 순서대로 모읍니다", label: "관측",
    fallback: "입금과 출금 기록을 블록 순서대로 읽습니다" },
  { key: "signal", title: "눈에 띄는 움직임을 찾습니다", desc: "입금이 멈추거나 잔고가 갑자기 줄어든 순간을 찾습니다", label: "신호",
    fallback: "잔고가 갑자기 줄어든 순간 같은 신호를 찾습니다" },
  { key: "condition", title: "판정 기준과 맞춰 봅니다", desc: "신호를 정해진 기준값과 비교합니다", label: "조건",
    fallback: "한 번에 빠진 돈의 비율 같은 조건을 기준과 비교합니다" },
  { key: "type", title: "어떤 사기와 비슷한지 봅니다", desc: "사기 유형을 정해진 순서대로 하나씩 확인합니다", label: "유형",
    fallback: "사기 유형 네 가지를 정해진 순서대로 확인합니다" },
  { key: "verdict", title: "결론을 하나로 냅니다", desc: "위험·주의·근거 없음·판단 불가 중 하나로 정리합니다", label: "판정",
    fallback: "네 가지 결론 중 하나로 정리합니다" }
];

// decision(러그풀 스냅샷의 view.decision) → 단계별 예시 한 줄. 값이 없거나 모양이 다르면 그 단계는 fallback 문구.
export function heroSteps(decision) {
  const d = decision && typeof decision === "object" ? decision : null;
  const examples = {
    observe: () => d.copy.summary.analyzed ? `${d.copy.summary.analyzed}을 읽었습니다` : null,
    signal: () => {
      const wait = d.segments.find(s => s.key === "wait");
      const block = d.decisive?.block;
      if (!Number.isFinite(block)) return null;
      return wait ? `블록 ${wait.from}의 마지막 입금 뒤, 블록 ${block}에서 잔고가 한 번에 빠졌습니다` : `블록 ${block}에서 잔고가 한 번에 빠졌습니다`;
    },
    condition: () => {
      const step = d.chain.find(s => s.no === d.matchedStep);
      const c = step?.conditions?.[0];
      const th = c?.label?.match(/(\d+(?:\.\d+)?%) 이상/)?.[1];
      if (!c?.valueText || !th) return null;
      return `한 번에 빠진 돈이 ${c.valueText} (기준 ${th} 이상)`;
    },
    type: () => (Number.isFinite(d.matchedStep) && d.typeLabel ? `${d.matchedStep}번째 질문(${d.typeLabel})에서 조건이 모두 맞았습니다` : null),
    verdict: () => {
      const parts = String(d.chainSummary ?? "").split(" → ");
      return parts.length >= 3 ? parts.slice(1).join(" → ") : null;
    }
  };
  return STEP_BASE.map((s, i) => {
    let example = null;
    try { example = d ? examples[s.key]() : null; } catch { example = null; }
    return { ...s, no: i + 1, example: example ?? s.fallback, fromData: Boolean(example) };
  });
}

// ── 스크롤 연출 계산 ──
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 고정(sticky) 장면의 진행도: 장면 맨 위가 화면 위에 닿을 때 0, 장면이 끝까지 지나갈 때 1
export function progressOf(top, height, viewport) {
  const range = height - viewport;
  return range > 0 ? clamp(-top / range, 0, 1) : 0;
}

// ② 카드 3장이 차례로 나타나는 진행도와 "결론은 하나로"로 모이는 진행도
export const CARD_AT = [0.1, 0.28, 0.46];
export const GATHER_AT = 0.62;
export function checkScene(p) {
  return { shown: CARD_AT.map(t => p >= t), gathered: p >= GATHER_AT };
}

// ③ 진행도 → 켜진 단계(0~4). 0.05부터 0.18 간격으로 한 단계씩
export function activeStep(p, n = 5) {
  return clamp(Math.floor((p - 0.05) / 0.18), 0, n - 1);
}
