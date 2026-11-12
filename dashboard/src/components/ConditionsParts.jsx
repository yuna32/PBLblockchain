// 상세 분석 > 판정 조건 화면 조각. 상태(Context)를 쓰지 않는 순수 컴포넌트라 테스트에서 그대로 렌더링한다.
// 내용은 모두 view.decision(chain·whyNot·principal·chainSummary·conclusion)에서 온다.
import { ArrowDown, CircleCheck, CircleDashed, CircleMinus, ShieldAlert, ShieldCheck } from "lucide-react";
import { CONCLUSIONS } from "../lib/conclusion.js";
import { buildDecisionGraph, conditionsTitle, peopleRow } from "../lib/conditions.js";
import { Badge, ICON } from "./ui.jsx";

// out_of_scope: 러그풀 축 적용 범위 밖. 결론 "판단 불가"(플래시론 등)와 같은 이름·중립 회색으로 보인다.
const STATUS_LABEL = { met: "충족", unmet: "미충족", no_data: "데이터 없음", out_of_scope: "판단 불가" };
const STATUS_ICON = { met: CircleCheck, unmet: CircleMinus, no_data: CircleDashed, out_of_scope: CircleDashed };
const toneOf = c => CONCLUSIONS[c]?.tone ?? "neutral";

// 임계값 진행 막대: bar = { value, threshold, max, unit, direction } (decision.chain 조건의 bar)
export function ConditionBar({ bar, met, tone }) {
  const pct = v => `${Math.max(0, Math.min(1, v / bar.max)) * 100}%`;
  return (
    <div className={`cond-bar ${met ? `cond-bar-met cond-bar-${tone}` : ""}`} role="presentation">
      <span className="cond-bar-fill" style={{ width: pct(bar.value) }} />
      <span className="cond-bar-threshold" style={{ left: pct(bar.threshold) }} title="기준선" />
    </div>
  );
}

// 사람 아이콘 줄 (원금 이상 돌려받은 사람은 채움, 일부만은 반 채움, 못 받은 사람은 빈 아이콘)
export function PeopleRow({ decision, max = 20 }) {
  const row = peopleRow(decision);
  if (!row) return null;
  const icons = [...Array(row.full).fill("full"), ...Array(row.partial).fill("partial"), ...Array(row.none).fill("none")];
  const shown = icons.slice(0, max);
  return (
    <div className="people-row">
      <span className="people-icons" aria-hidden="true">
        {shown.map((k, i) => (
          <svg key={i} className={`person person-${k}`} width="16" height="18" viewBox="0 0 16 18">
            <circle cx="8" cy="5" r="3.5" />
            <path d="M1.5 17c0-3.8 2.9-6.5 6.5-6.5s6.5 2.7 6.5 6.5" />
          </svg>
        ))}
        {icons.length > max && <span className="people-more">+{icons.length - max}</span>}
      </span>
      <span className="people-text">{row.text}</span>
    </div>
  );
}

// "{유형}로 판정된 이유": 판정 순서대로 질문 카드, 사람 아이콘 줄, 결론 띠(chainSummary 그대로)
export function ChainCard({ decision }) {
  const tone = toneOf(decision.conclusion);
  return (
    <section className="card chain-card" data-conclusion={decision.conclusion}>
      <header className="card-head">
        <h2 className="card-title">{conditionsTitle(decision)}</h2>
        <span className="muted small">판정 순서대로</span>
      </header>
      <div className="card-body">
        <ol className="chain">
          {decision.chain.map((s, i) => (
            <li key={s.type} className={`chain-step ${s.matched ? `chain-step-yes chain-${tone}` : ""}`} data-step={s.no}>
              <div className="chain-step-head">
                <span className="chain-no">{s.no}</span>
                <span className="chain-q">{s.question}<span className="chain-type"> · {s.label}</span></span>
                <Badge tone={s.matched ? tone : "neutral"}>{s.answer}</Badge>
              </div>
              <ul className="chain-conds">
                {s.conditions.map(c => {
                  const Icon = STATUS_ICON[c.status];
                  return (
                    <li key={c.id} className={`chain-cond cond-${c.status}`}>
                      <span className="chain-cond-line">
                        <Icon {...ICON} size={15} aria-hidden="true" />
                        <span className="chain-cond-label">{c.label}</span>
                        <span className="chain-cond-value num">{c.valueText}</span>
                        <span className="chain-cond-status">{STATUS_LABEL[c.status]}</span>
                      </span>
                      {c.bar && <ConditionBar bar={c.bar} met={c.met} tone={tone} />}
                    </li>
                  );
                })}
              </ul>
              {i < decision.chain.length - 1 && <ArrowDown {...ICON} size={16} className="chain-arrow" aria-hidden="true" />}
            </li>
          ))}
        </ol>
        <PeopleRow decision={decision} />
        <p className={`chain-band chain-band-${tone}`}>{decision.chainSummary}</p>
      </div>
    </section>
  );
}

// 다른 유형이 아닌 이유 (decision.whyNot) + 기준값 면책
export function WhyNotCard({ decision }) {
  return (
    <section className="card whynot-card">
      <header className="card-head"><h2 className="card-title">다른 유형이 아닌 이유</h2></header>
      <div className="card-body">
        <ul className="whynot">
          {decision.whyNot.map(w => (
            <li key={w.type}>
              <strong>{w.label}{!w.checked && <span className="whynot-ref" title="판정 순서상 결론이 난 뒤에 참고로 확인한 유형">참고</span>}</strong>
              <span>{w.reason}</span>
            </li>
          ))}
        </ul>
        <p className="threshold-note">기준값은 연구 단계의 잠정값입니다. 출금 비율·입금 지갑 수·출금 성공률 기준에 따라 오탐과 미탐이 있을 수 있습니다. 러그풀 기준(순유출·수익자 수)은 시뮬레이션 예시로만 확인했습니다.</p>
      </div>
    </section>
  );
}

// 축약 그래프: 관측한 사실 → 조건 → 사기 유형 → 결론 (decision.chain으로만 만든다)
const COL_X = [0, 196, 512, 716], COL_W = [176, 296, 184, 120], ROW_H = 52, TOP = 36, NODE_H = 36;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function DecisionGraph({ decision }) {
  const g = buildDecisionGraph(decision);
  const tone = toneOf(decision.conclusion);
  const pos = new Map(g.nodes.map(n => [n.id, { x: COL_X[n.col], y: TOP + n.row * ROW_H, w: COL_W[n.col] }]));
  const width = COL_X[3] + COL_W[3] + 2, height = TOP + g.rows * ROW_H + 4;
  return (
    <div className="dgraph-scroll">
      <svg className={`dgraph dgraph-${tone}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMinYMin meet" role="img"
        aria-label={`판정 경로: ${decision.chainSummary}`}>
        {["관측한 사실", "조건", "사기 유형", "결론"].map((h, i) => (
          <text key={h} x={COL_X[i] + 4} y={14} className="dgraph-head">{h}</text>
        ))}
        {g.links.map(l => {
          const a = pos.get(l.from), b = pos.get(l.to);
          const x1 = a.x + a.w, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2, mx = (x1 + x2) / 2;
          return <path key={`${l.from}-${l.to}`} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} className={`dgraph-link dgraph-link-${l.status}`} />;
        })}
        {g.nodes.map(n => {
          const p = pos.get(n.id);
          const cls = n.kind === "conclusion" ? `dgraph-node dgraph-conclusion dgraph-c-${toneOf(n.status)}` : `dgraph-node dgraph-${n.status}`;
          const maxChars = n.col === 1 ? 17 : 10;
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`} className={cls} data-status={n.status}>
              <title>{`${n.label}${n.value ? ` · ${n.value}` : ""}${STATUS_LABEL[n.status] ? ` · ${STATUS_LABEL[n.status]}` : ""}`}</title>
              <rect width={p.w} height={NODE_H} rx={n.kind === "conclusion" ? 8 : 18} />
              <text x={n.kind === "conclusion" ? p.w / 2 : 14} y={NODE_H / 2} dy="0.35em" textAnchor={n.kind === "conclusion" ? "middle" : "start"}>{clip(n.label, maxChars)}</text>
              {n.value && n.kind !== "conclusion" && <text x={p.w - 12} y={NODE_H / 2} dy="0.35em" textAnchor="end" className="dgraph-value">{clip(n.value, 8)}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function GraphLegend() {
  return (
    <ul className="dgraph-legend">
      <li><span className="sw sw-met" />충족</li>
      <li><span className="sw sw-unmet" />미충족</li>
      <li><span className="sw sw-nodata" />데이터 없음 · 판단 불가</li>
    </ul>
  );
}

// 하단 변조 확인 띠: integrity = lib/overview.js integrityStatus()
const BAND_TEXT = {
  checking: "리포트 변조 여부를 확인하는 중입니다",
  same: "이 리포트는 분석 당시와 같습니다",
  different: "이 리포트가 분석 당시와 다릅니다",
  error: "리포트 변조 여부를 확인하지 못했습니다"
};
export function IntegrityBand({ integrity, link = null }) {
  const Icon = integrity.key === "same" ? ShieldCheck : ShieldAlert;
  return (
    <section className={`card integrity-band integrity-band-${integrity.key}`}>
      <Icon {...ICON} size={20} aria-hidden="true" />
      <strong>{BAND_TEXT[integrity.key]}</strong>
      <span className="muted">· 해시 값과 검증 방법은 {link ?? "리포트 변조 확인"}에서 볼 수 있습니다</span>
    </section>
  );
}
