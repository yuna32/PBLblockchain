// 러그풀 축 화면 계산 (순수 함수). 값·기준값·문구는 모두 view.decision.rugpull에서 온다
// (= 분석기 결과 report.dynamic.rugpull_axiom + demo/lib/decision.js가 붙인 문구). 이 파일에 기준값을 두지 않는다.

// 범위 밖 안내: "정상"이 아니라 "이 장부로는 판단할 수 없음". 결론 "판단 불가"와 같은 중립 톤으로 보인다.
export const SCOPE_NOTICE_TITLE = "이 장부로는 판단할 수 없음";
export const SCOPE_NOTICE_NOTE = "안전하다는 뜻이 아니라, 이 거래 기록으로는 러그풀 여부를 따지지 않았다는 뜻입니다.";

export function scopeNotice(rug) {
  if (!rug || rug.scope.inScope) return null;
  return { title: SCOPE_NOTICE_TITLE, reason: rug.scope.reasonLabel, text: rug.scope.reasonText, note: SCOPE_NOTICE_NOTE };
}

// 지갑별 낸 돈 vs 받은 돈 (rugpull.wallets 원천). 순유출 기여(받은 돈 > 낸 돈)·수익자 표시는 적용 범위 안일 때만.
// 정렬: 원금보다 더 받은 금액이 큰 지갑부터, 같으면 낸 돈이 큰 지갑부터.
export function walletLedgerRows(rug, ownerAddress = null) {
  if (!rug) return null;
  const owner = ownerAddress ? ownerAddress.toLowerCase() : null;
  const inScope = rug.scope.inScope;
  const rows = rug.wallets.map(w => ({
    address: w.address, deposited: w.deposited, received: w.received, netGain: w.netGain,
    isOwner: owner !== null && w.address === owner,
    contributor: inScope && w.drainContributor,
    sharer: inScope && w.profitSharer
  }));
  rows.sort((a, b) => (b.netGain - a.netGain) || (b.deposited - a.deposited) || a.address.localeCompare(b.address));
  return {
    rows,
    max: Math.max(0, ...rows.flatMap(r => [r.deposited, r.received])),
    inScope,
    contributorCount: rows.filter(r => r.contributor).length,
    sharerCount: rows.filter(r => r.sharer).length,
    profitRatioText: rug.display.profitRatio
  };
}

// 러그풀 vs 폰지: 같은 입출금 기록이 "몰아 가져감 / 나눠 가짐"으로 갈리는 지점
export function rugVsPonzi(rug) {
  if (!rug) return null;
  const d = rug.display, th = rug.thresholds;
  return {
    shape: rug.shape, label: rug.shapeLabel, text: rug.shapeText, inScope: rug.scope.inScope,
    side: rug.shape === "concentrated" ? "rug" : rug.shape === "shared" ? "ponzi" : null,
    netDrain: {
      value: rug.netDrain.value, met: rug.netDrain.met, text: d.netDrain, thresholdText: d.netDrainThreshold,
      bar: rug.netDrain.value === null ? null : { value: rug.netDrain.value, threshold: th.netDrain, max: Math.max(1, rug.netDrain.value), unit: "ratio", direction: "above" }
    },
    sharers: {
      value: rug.sharedProfit.count, met: rug.sharedProfit.met, text: d.profitSharers, thresholdText: d.profitSharersThreshold, ratioText: d.profitRatio,
      bar: rug.sharedProfit.count === null ? null : { value: rug.sharedProfit.count, threshold: th.profitSharers, max: Math.max(th.profitSharers * 2, rug.sharedProfit.count), unit: "count", direction: "below" }
    }
  };
}
