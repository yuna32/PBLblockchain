// "들어온 돈 어디로 갔나": 들어온 돈 → 컨트랙트 → 가져간 쪽 / 참여자 / 남은 돈. 행과 금액은 lib/flowRows.js(decision.flow).
// 화살표 굵기는 입금 총액 대비 비율, 가져간 쪽(운영자·모은 지갑·내부자)은 위험색. 좁은 폭에서는 세로로 쌓인다.
import { flowRows } from "../lib/flowRows.js";

function People({ count, max = 10 }) {
  const n = Math.min(count, max);
  return (
    <span className="flow-people" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <svg key={i} width="18" height="20" viewBox="0 0 18 20">
          <circle cx="9" cy="6" r="4" />
          <path d="M2 19c0-4 3-7 7-7s7 3 7 7" />
        </svg>
      ))}
      {count > max && <span className="flow-people-more">+{count - max}</span>}
    </span>
  );
}

function Arrow({ ratio = 0, tone = "neutral", zero = false }) {
  const w = zero ? 1.5 : 2 + Math.round(10 * Math.min(1, ratio));
  return (
    <svg className={`flow-arrow flow-arrow-${tone}`} viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="12" x2="88" y2="12" strokeWidth={w} strokeDasharray={zero ? "4 4" : undefined} />
      <path d="M86 5 L98 12 L86 19" strokeWidth={zero ? 1.5 : 2.5} fill="none" />
    </svg>
  );
}

export default function FlowDiagram({ decision }) {
  const { totalInText, sources, outs } = flowRows(decision);
  const risky = decision.conclusion === "risk";
  return (
    <div className="flow">
      <div className="flow-col flow-sources">
        {sources.map(s => (
          <div key={s.kind} className="flow-source">
            {s.kind === "participants" ? <People count={s.count} /> : null}
            <span className="flow-source-label">{s.label}</span>
            <span className="flow-eth num">{s.ethText} ETH</span>
          </div>
        ))}
      </div>
      <div className="flow-col flow-in">
        <span className="flow-eth num">{totalInText} ETH</span>
        <Arrow ratio={1} />
      </div>
      <div className="flow-col flow-hub"><span>컨트랙트</span></div>
      <ul className="flow-col flow-outs">
        {outs.map(o => {
          const tone = o.kind === "remaining" ? "muted" : o.taker && risky ? "danger" : "neutral";
          return (
            <li key={o.kind} className={`flow-out flow-out-${tone}`}>
              <span className="flow-out-amount num">{o.ethText} ETH{o.ratioText ? ` (${o.ratioText})` : ""}</span>
              <Arrow ratio={o.ratio} tone={tone} zero={o.zero} />
              <span className="flow-out-label">
                <strong>{o.label}</strong>
                {o.sub && <span className="flow-out-sub">{o.sub}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
