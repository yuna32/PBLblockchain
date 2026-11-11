// "들어온 돈 어디로 갔나" 흐름도의 행 (순수 함수). 금액·비율 글자는 decision.flow의 ethText·ratioText를 그대로 쓴다.
//   폰지·러그풀: 운영자 / 참여자, 자금세탁: 한 지갑(모은 지갑) / 모은 지갑을 뺀 n개 지갑,
//   펌프앤덤프: 내부자 n개 지갑 / 후발 참여자 n명, 정상: 참여자 / 운영자(수령 0)
const TAKERS = new Set(["owner", "collector", "insiders"]);

function outLabel(o, hint) {
  switch (o.kind) {
    case "owner":     return { label: "운영자" };
    case "collector": return { label: "한 지갑(모은 지갑)" };
    case "insiders":  return { label: `내부자 ${o.count}개 지갑`, sub: "넣은 돈보다 더 받아 간 지갑" };
    case "late":      return { label: `후발 참여자 ${o.count}명` };
    case "remaining": return { label: "컨트랙트에 남은 돈" };
    case "participants":
      if (hint === "money_laundering") return { label: `모은 지갑을 뺀 ${o.count}개 지갑` };
      return {
        label: `참여자 ${o.count}명`,
        sub: o.receivedCount > 0 && o.receivedCount < o.count ? `그중 ${o.receivedCount}명이 받음` : null
      };
    default: return { label: o.kind };
  }
}

export function flowRows(decision) {
  const { flow, hint, principal } = decision;
  const sources = flow.sources.map(s => ({
    kind: s.kind,
    label: s.kind === "owner_fund" ? "운영자 보상 풀" : hint === "money_laundering" ? `입금 지갑 ${s.count}개` : `참여자 ${s.count}명`,
    count: s.count,
    ethText: s.ethText
  }));
  const outs = flow.outs.map(o => ({
    kind: o.kind, ...outLabel(o, hint), ethText: o.ethText, ratioText: o.ratioText, ratio: o.ratio ?? 0,
    taker: TAKERS.has(o.kind), zero: o.eth <= 1e-9
  }));
  // 정상: 운영자가 받은 돈이 없어도 "운영자 0 ETH"를 보여 준다 (decision.principal.ownerReceivedEth = 0)
  if (hint === "normal_staking" && !outs.some(o => o.kind === "owner") && principal.ownerReceivedEth === 0) {
    outs.splice(outs.length - 1, 0, { kind: "owner", label: "운영자", ethText: "0", ratioText: null, ratio: 0, taker: false, zero: true });
  }
  return { totalInText: flow.totalInText, sources, outs };
}
