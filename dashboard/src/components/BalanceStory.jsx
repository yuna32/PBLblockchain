// "컨트랙트에 남은 돈은 어떻게 변했나": 잔고 계단선 + 구간 띠·라벨 + 말풍선 + 정상 스테이킹 겹친 점선.
// 구간·말풍선·핵심 시점은 view.decision(segments, copy.callouts, decisive)을 그대로 쓴다. 인라인 SVG, 애니메이션 없음.
// 좁은 폭(560px 미만)에서는 말풍선 상자 대신 번호 점 + 아래 목록으로 보여 준다.
import { useEffect, useMemo, useRef, useState } from "react";
import { balanceAt, balanceBefore, calloutLanes, normalOverlay, segmentBands, stepPath, storyDomain } from "../lib/story.js";
import { fmtEth } from "../lib/format.js";

const PAD = { left: 52, right: 16, top: 12, bottom: 8 };
const decisive0 = decision => decision.decisive ?? null;
const BOX_W = 196, LANE_H = 62;

function useWidth(minWidth) {
  const ref = useRef(null);
  const [w, setW] = useState(720);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(minWidth, Math.floor(e.contentRect.width))));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// mini: 개요 "돈의 흐름" 카드용 축약형 (말풍선·구간 라벨·축 글자·점선 없음, 선과 위험 구간만)
export default function BalanceStory({ points, decision, cursor, normalRows, mini = false }) {
  const [ref, width] = useWidth(mini ? 120 : 280);
  const compact = !mini && width < 560;
  const segments = decision.segments;
  const domain = useMemo(() => storyDomain(points, segments), [points, segments]);
  const peak = Math.max(0, ...points.map(p => p.balance));
  const showNormal = !mini && decision.hint !== "normal_staking";
  const overlay = useMemo(() => (showNormal ? normalOverlay(normalRows, points, domain) : []), [showNormal, normalRows, points, domain]);

  const P = mini ? { left: 4, right: 4, top: 6, bottom: 4 } : PAD;
  const plotH = mini ? 72 : compact ? 200 : 240;
  const innerW = width - P.left - P.right;
  const x = b => P.left + ((b - domain.min) / Math.max(1e-9, domain.end - domain.min)) * innerW;
  const xIn = b => x(b) - P.left; // 말풍선 상자 기준(플롯 왼쪽 = 0)
  const callouts = mini ? [] : calloutLanes(decision.copy.callouts, xIn, { boxWidth: BOX_W, width: innerW });
  const lanes = compact ? 0 : Math.max(0, ...callouts.map(c => c.lane + 1));
  const top = P.top + lanes * LANE_H;
  const height = top + plotH + P.bottom;
  const y = v => top + plotH - (v / Math.max(1e-9, peak * 1.04)) * plotH;
  const base = y(0);

  const decisive = decisive0(decision);
  const lastPoint = points.at(-1);
  // 재생 위치까지 보이는 선: 거래 점 + 재생 위치까지 가로로 이어 그린다
  const shownPts = points.filter(p => p.block <= cursor);
  const visible = shownPts.length && cursor > shownPts.at(-1).block ? [...shownPts, { block: cursor, balance: shownPts.at(-1).balance }] : shownPts;
  const reached = decisive && cursor >= decisive.block;
  const dropFrom = decisive ? { block: decisive.block, balance: balanceBefore(points, decisive.block) } : null;
  const pre = decisive ? [...visible.filter(p => p.block < decisive.block), ...(reached ? [dropFrom] : [])] : visible;
  const post = reached ? [dropFrom, ...visible.filter(p => p.block >= decisive.block)] : [];
  const rest = points.filter(p => p.block > cursor);
  const future = rest.length ? [{ block: cursor, balance: balanceAt(points, cursor) }, ...rest] : [];
  const bands = segmentBands(segments, domain);
  const dangerFrom = decisive?.block ?? Infinity;

  return (
    <div className={`story ${mini ? "story-mini" : ""}`} ref={ref}>
      <svg width={width} height={height} className="story-svg" role="img"
        aria-label={`컨트랙트 잔고 변화. 최고 ${fmtEth(peak, 3)}, 마지막 ${fmtEth(lastPoint?.balance ?? 0, 3)}.${decisive ? ` ${decisive.label}: 블록 ${decisive.block}.` : ""}`}>
        {bands.map((b, i) => (
          <g key={b.key}>
            {b.key === "deposit" && <rect x={x(b.x1)} y={top} width={Math.max(0, x(b.x2) - x(b.x1))} height={plotH} className="story-band" />}
            {i > 0 && <line x1={x(b.x1)} x2={x(b.x1)} y1={top} y2={base + 6} className="story-divider" />}
          </g>
        ))}
        <line x1={P.left} x2={width - P.right} y1={base} y2={base} className="story-axis" />
        {!mini && (
          <>
            <text x={P.left - 8} y={y(peak)} className="story-ylabel" dy="0.35em" textAnchor="end">최고</text>
            <text x={P.left - 8} y={base} className="story-ylabel" dy="0.35em" textAnchor="end">0</text>
            <line x1={P.left} x2={width - P.right} y1={y(peak)} y2={y(peak)} className="story-peakline" />
          </>
        )}

        {overlay.length > 1 && (
          <g className="story-normal">
            <path d={stepPath(overlay, x, y)} />
          </g>
        )}

        {/* 잔고 선: 핵심 시점 전은 진한 회색, 이후는 위험색. 재생 위치 뒤는 흐리게 */}
        <path d={stepPath(future, x, y)} className="story-line story-line-future" />
        <path d={stepPath(pre, x, y)} className="story-line" />
        {post.length > 1 && <path d={stepPath(post, x, y)} className="story-line story-line-danger" />}

        {reached && (
          <circle cx={x(decisive.block)} cy={(y(balanceBefore(points, decisive.block)) + y(balanceAt(points, decisive.block))) / 2} r={6} className="story-decisive" />
        )}

        {callouts.map(c => {
          if (cursor < c.block) return null;
          const cx = x(c.block), cy = y(balanceAt(points, c.block));
          return (
            <g key={`${c.kind}-${c.block}`}>
              {!compact && <line x1={cx} x2={cx} y1={PAD.top + c.lane * LANE_H + 50} y2={cy} className="story-leader" />}
              <circle cx={cx} cy={cy} r={compact ? 8 : 4} className={`story-anchor ${c.block >= dangerFrom ? "danger" : ""}`} />
              {compact && <text x={cx} y={cy} dy="0.35em" textAnchor="middle" className="story-anchor-no">{c.no}</text>}
            </g>
          );
        })}
        {cursor < (lastPoint?.block ?? 0) && <line x1={x(cursor)} x2={x(cursor)} y1={top} y2={base} className="story-cursor" />}
      </svg>

      {!compact && callouts.map(c => (cursor < c.block ? null : (
        <div key={`box-${c.kind}-${c.block}`} className={`story-callout ${c.block >= dangerFrom ? "danger" : ""}`}
          style={{ left: PAD.left + c.left, top: PAD.top + c.lane * LANE_H, width: BOX_W }}>
          <strong>{c.title}</strong>
          <span>{c.detail}</span>
        </div>
      )))}

      {!mini && <div className="story-segments" style={{ marginLeft: 0 }}>
        {bands.map(b => {
          const w = Math.max(0, x(b.x2) - x(b.x1));
          // 너무 좁은 띠는 글자를 숨기고 툴팁으로만 (겹침 방지)
          return (
            <span key={b.key} className={`story-seg ${b.x1 >= dangerFrom ? "danger" : ""}`} title={b.label}
              style={{ left: x(b.x1), width: w }}>
              {w >= 40 ? b.label : <span className="sr-only">{b.label}</span>}
            </span>
          );
        })}
      </div>}

      {compact && (
        <ol className="story-callout-list">
          {callouts.filter(c => cursor >= c.block).map(c => (
            <li key={`li-${c.kind}-${c.block}`} className={c.block >= dangerFrom ? "danger" : ""}>
              <span className="story-callout-no">{c.no}</span>
              <span><strong>{c.title}</strong> · {c.detail}</span>
            </li>
          ))}
        </ol>
      )}
      {overlay.length > 1 && (
        <p className="story-normal-note">
          <svg width="28" height="8" aria-hidden="true"><line x1="0" x2="28" y1="4" y2="4" /></svg>
          정상 스테이킹이라면 조금씩 돌려줍니다 <span className="muted">(정상 스테이킹 예시의 실제 잔고 변화를 이 컨트랙트의 최고 잔고에 맞춘 선)</span>
        </p>
      )}
    </div>
  );
}
