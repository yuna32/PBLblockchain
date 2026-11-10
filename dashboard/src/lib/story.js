// 거래 분석 위쪽 "컨트랙트에 남은 돈은 어떻게 변했나" 차트의 배치 계산 (순수 함수).
// 구간·말풍선은 view.decision.segments / decision.copy.callouts를 그대로 쓴다.
import { buildBlockSeries } from "./series.js";

// 마지막 구간 폭이 0에 가까우면(예: 마지막 거래가 운영자 인출) 그 뒤로 빈 여백을 붙여 라벨 자리를 만든다.
// 축 값(블록 번호)은 바꾸지 않는다: 여백에는 데이터가 없고, 잔고 선도 마지막 거래에서 끝난다.
export const TAIL_MIN_RATIO = 0.16;

export function storyDomain(points, segments = [], ratio = TAIL_MIN_RATIO) {
  const min = points[0]?.block ?? 0;
  const max = points.at(-1)?.block ?? 0;
  const minWidth = Math.max(1, max - min) * ratio;
  const last = segments.at(-1);
  const tail = Boolean(last) && last.to - last.from < minWidth;
  return { min, max, end: tail ? Math.max(max, last.from + minWidth) : max, tail };
}

// 구간 띠: 마지막 구간만 여백 끝까지 그린다 (가운데 구간은 실제 블록 범위 그대로)
export function segmentBands(segments = [], domain) {
  return segments.map((s, i) => ({ ...s, x1: s.from, x2: i === segments.length - 1 && domain.tail ? domain.end : s.to }));
}

// block 시점(그 블록의 거래 후)의 잔고. 첫 거래 전이면 0.
export function balanceAt(points, block) {
  let b = 0;
  for (const p of points) {
    if (p.block > block) break;
    b = p.balance;
  }
  return b;
}

// 직전 거래 블록의 잔고 (그 블록 거래 전)
export function balanceBefore(points, block) {
  let b = 0;
  for (const p of points) {
    if (p.block >= block) break;
    b = p.balance;
  }
  return b;
}

// 계단형 잔고 선 경로 (거래가 있는 블록마다 꺾인다). x, y는 값 → 픽셀 함수.
export function stepPath(points, x, y) {
  if (!points.length) return "";
  let d = `M${x(points[0].block)},${y(points[0].balance)}`;
  for (let i = 1; i < points.length; i++) d += `H${x(points[i].block)}V${y(points[i].balance)}`;
  return d;
}

// 정상 스테이킹 예시의 실제 잔고 곡선(최고점 이후)을 이 컨트랙트에 겹친다.
//   세로: 정상 예시 잔고 ÷ 정상 예시 최고 잔고 × 이 컨트랙트 최고 잔고
//   가로: 정상 예시의 [최고점 블록, 마지막 블록]을 이 컨트랙트의 [최고점 블록, 차트 끝]에 맞춘다
// 실제 값이 아니라 모양 비교용 선이라 화면에 "정상 스테이킹이라면"으로 밝힌다.
export function normalOverlay(normalRows, points, domain) {
  const normal = buildBlockSeries(normalRows ?? []).points;
  if (normal.length < 2 || !points.length) return [];
  const nPeak = Math.max(...normal.map(p => p.balance));
  const sPeak = Math.max(...points.map(p => p.balance));
  if (!(nPeak > 0 && sPeak > 0)) return [];
  const nStart = normal.findIndex(p => p.balance === nPeak);
  const sPeakBlock = points.find(p => p.balance === sPeak).block;
  const tail = normal.slice(nStart);
  const n0 = tail[0].block, n1 = tail.at(-1).block;
  if (n1 <= n0 || domain.end <= sPeakBlock) return [];
  return tail.map(p => ({
    block: sPeakBlock + ((p.block - n0) / (n1 - n0)) * (domain.end - sPeakBlock),
    balance: (p.balance / nPeak) * sPeak
  }));
}

// 말풍선 줄 배치: 왼쪽부터 놓되 앞 상자와 겹치면 다음 줄로. 반환: [{...callout, lane, left}]
export function calloutLanes(callouts, xOf, { boxWidth = 190, gap = 10, width = Infinity } = {}) {
  const laneEnds = [];
  return [...callouts].sort((a, b) => a.block - b.block).map((c, i) => {
    const center = xOf(c.block);
    const left = Math.max(0, Math.min(width - boxWidth, center - boxWidth / 2));
    let lane = laneEnds.findIndex(end => left >= end + gap);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = left + boxWidth;
    return { ...c, no: i + 1, lane, left };
  });
}
