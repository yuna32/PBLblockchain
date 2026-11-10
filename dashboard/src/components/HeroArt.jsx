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

export default function FraudArt({ kind }) {
  const A = ART[kind];
  return A ? <A /> : null;
}
