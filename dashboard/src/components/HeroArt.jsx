// 히어로 ④ 사기 네 가지 선 그림 (인라인 SVG, 1.5px 선, 채움 없음, 장식용이라 aria-hidden)
const common = { width: 150, height: 84, viewBox: "0 0 150 84", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false" };

function Ponzi() {
  // 위 한 사람에게 아래 사람들의 돈이 올라가는 피라미드
  const row2 = [52, 98], row3 = [30, 60, 90, 120];
  return (
    <svg {...common}>
      <circle cx="75" cy="12" r="7" />
      {row2.map(x => <circle key={x} cx={x} cy="40" r="7" />)}
      {row3.map(x => <circle key={x} cx={x} cy="70" r="7" />)}
      <path d="M57 34 L69 18 M93 34 L81 18" />
      <path d="M33 63 L48 46 M57 63 L52 47 M93 63 L98 47 M117 63 L102 46" />
    </svg>
  );
}

function RugPull() {
  // 모인 돈(상자 안 동전) → 화살표 → 들고 나가는 사람
  return (
    <svg {...common}>
      <rect x="10" y="26" width="52" height="34" rx="5" />
      <circle cx="28" cy="43" r="6" />
      <circle cx="45" cy="43" r="6" />
      <path d="M68 43 H100 M93 36 L100 43 L93 50" />
      <circle cx="122" cy="26" r="8" />
      <path d="M108 66 c0-10 6-18 14-18 s14 8 14 18" />
    </svg>
  );
}

function Laundering() {
  // 여러 갈래 점선이 한 점으로 모였다가 이어서 흘러간다
  return (
    <svg {...common}>
      {[12, 26, 42, 58, 72].map(y => <path key={y} d={`M8 ${y} L60 42`} strokeDasharray="4 4" />)}
      <circle cx="68" cy="42" r="8" />
      <path d="M76 42 H94" />
      <circle cx="100" cy="42" r="5" />
      <path d="M105 42 H118" />
      <circle cx="123" cy="42" r="4" />
      <path d="M127 42 H142 M136 36 L142 42 L136 48" />
    </svg>
  );
}

function PumpDump() {
  // 값이 오르다 꼭대기에서 먼저 빠져나가고, 뒤에서는 떨어진다
  return (
    <svg {...common}>
      <path d="M8 72 L34 64 L52 44 L70 14 L84 46 L104 64 L124 68" />
      <circle cx="70" cy="14" r="3" fill="currentColor" />
      <path d="M76 12 H104 M97 6 L104 12 L97 18" />
      <circle cx="114" cy="12" r="6" />
    </svg>
  );
}

const ART = { ponzi: Ponzi, rugpull: RugPull, laundering: Laundering, pumpdump: PumpDump };

// ── 파란 구간(첫 화면·CTA) 배경 모티프: 모두 장식용 선 그림 (aria-hidden), 색은 --hero-line 계열 ──

// "남은 돈" 차트 모티프: 잔고가 계단처럼 쌓이다 한순간 뚝 떨어진다. 떨어지는 지점에만 작은 빨간 점 하나.
export function BalanceMotif({ className = "" }) {
  const steps = [180, 166, 150, 136, 120, 104, 88, 72, 58];
  let d = "M0 192";
  steps.forEach((y, i) => { d += ` H${i * 92 + 40} V${y}`; });
  const dropX = 8 * 92 + 40 + 150;
  d += ` H${dropX} V194 H1200`;
  // 선은 화면 폭에 맞춰 늘이고(preserveAspectRatio none), 빨간 점은 찌그러지지 않게 SVG 밖의 원으로 같은 위치에 둔다
  return (
    <div className={`hero-motif-balance ${className}`} aria-hidden="true">
      <svg viewBox="0 0 1200 200" preserveAspectRatio="none" focusable="false">
        <path d={d} fill="none" stroke="var(--hero-line)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <path d={`M${dropX} 58 H1200`} fill="none" stroke="var(--hero-line-soft)" strokeWidth="1.5" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="hero-motif-dot" style={{ left: `${(dropX / 1200) * 100}%`, top: `${(126 / 200) * 100}%` }} />
    </div>
  );
}

// 거래 관계도 모티프: 컨트랙트 노드 하나와 둘레의 지갑 노드
export function NetworkMotif({ className = "" }) {
  const n = 9, cx = 150, cy = 130, R = 96;
  const nodes = Array.from({ length: n }, (_, i) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return { x: cx + R * Math.cos(a) * (i % 2 ? 1.08 : 0.92), y: cy + R * Math.sin(a) * (i % 2 ? 0.92 : 1.06) };
  });
  return (
    <svg className={`hero-motif-network ${className}`} viewBox="0 0 300 260" aria-hidden="true" focusable="false"
      fill="none" stroke="var(--hero-line)" strokeWidth="1.5">
      {nodes.map((p, i) => <line key={`l${i}`} x1={p.x} y1={p.y} x2={cx} y2={cy} stroke="var(--hero-line-soft)" />)}
      {nodes.map((p, i) => <circle key={`c${i}`} cx={p.x} cy={p.y} r="7" />)}
      <rect x={cx - 13} y={cy - 13} width="26" height="26" rx="5" />
    </svg>
  );
}

// 파란 구간과 라이트 배경 사이의 완만한 곡선 (딱딱한 경계선 대신). position: "bottom" | "top"
export function BandCurve({ position = "bottom" }) {
  const d = position === "bottom"
    ? "M0 0 C 360 70 1080 70 1440 18 L1440 80 L0 80 Z"
    : "M0 80 C 360 10 1080 10 1440 62 L1440 0 L0 0 Z";
  return (
    <svg className={`hero-curve hero-curve-${position}`} viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={d} fill="var(--bg)" />
    </svg>
  );
}

export default function FraudArt({ kind }) {
  const A = ART[kind];
  return A ? <A /> : null;
}
