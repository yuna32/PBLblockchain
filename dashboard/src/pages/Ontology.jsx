// 온톨로지: /api/report/:id/ontology 그래프. ForceGraph를 거래 네트워크와 같이 쓴다.
// 상태 세 가지(충족/활성, 미충족, 근거 데이터 없음)는 색뿐 아니라 채움·기호(−, ?)·점선으로도 구분한다.
// highlight.path(분류 추론)는 굵은 실선, highlight.evasionPath(회피 기법)는 점선으로 그린다.
import { useEffect, useMemo, useState } from "react";
import { Info, Pause, Play } from "lucide-react";
import { useApp } from "../state/AppContext.jsx";
import { Badge, Card, ICON, Legend, ReportGate, Term } from "../components/ui.jsx";
import ForceGraph from "../components/ForceGraph.jsx";
import { NodeShape } from "../components/shapes.jsx";
import { countGraph, edgeKey, highlightSets, KIND_LABELS, nodeState, playbackSteps, STATE_LABELS, stateGroup, visibleAtStep } from "../lib/ontology.js";
import { term } from "../lib/terms.js";

const STEP_MS = 650;

const KIND_STYLE = {
  parent:    { shape: "circle",   r: 15 },
  class:     { shape: "hexagon",  r: 17 },
  condition: { shape: "diamond",  r: 10 },
  evidence:  { shape: "square",   r: 8 },
  evasion:   { shape: "triangle", r: 9 },
  role:      { shape: "circle",   r: 7 },
  patch:     { shape: "square",   r: 6 }
};

const STATE_STYLE = {
  on:       { fill: "var(--primary)", stroke: "var(--primary-strong)", opacity: 1 },
  unmet:    { fill: "var(--surface)", stroke: "var(--text-3)", opacity: 0.95, glyph: "−" },
  no_data:  { fill: "var(--surface)", stroke: "var(--text-3)", dash: "3 2", opacity: 0.85, glyph: "?" },
  inactive: { fill: "var(--fill-2)", stroke: "var(--border-strong)", opacity: 0.55 }
};

export default function Ontology() {
  return <ReportGate>{data => <OntologyBody key={data.envelope.report_sha256 + data.view.scenario} data={data} />}</ReportGate>;
}

function OntologyBody({ data }) {
  const graph = data.ontology;
  const [selectedId, setSelectedId] = useState(null);
  const [step, setStep] = useState(null); // null = 전체 강조, 숫자 = 재생 중 단계
  const steps = useMemo(() => playbackSteps(graph.highlight), [graph]);
  const full = useMemo(() => highlightSets(graph.highlight), [graph]);
  const shown = step === null ? full : visibleAtStep(steps, step);
  const counts = countGraph(graph);

  useEffect(() => {
    if (step === null) return undefined;
    if (step >= steps.length) {
      const t = setTimeout(() => setStep(null), 1200);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep(s => s + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [step, steps.length]);

  const nodeStyle = n => {
    const kind = KIND_STYLE[n.kind] ?? KIND_STYLE.role;
    const group = stateGroup(n);
    let st = STATE_STYLE[group] ?? STATE_STYLE.inactive;
    if (group === "on" && (n.kind === "role" || n.kind === "patch")) st = { fill: "var(--primary-weak)", stroke: "var(--primary)", opacity: 1 };
    const onPrimary = shown.primaryNodes.has(n.id), onSecondary = shown.secondaryNodes.has(n.id);
    const labelled = ["parent", "class", "condition", "evidence"].includes(n.kind) || (n.kind === "evasion" && (n.active || n.group === "evasion_technique"));
    return {
      ...kind, ...st,
      stroke: onPrimary ? "var(--primary-strong)" : onSecondary ? "var(--caution)" : st.stroke,
      strokeWidth: onPrimary || onSecondary ? 2.6 : 1.4,
      label: labelled ? n.label : null,
      labelStrong: n.kind === "class" || n.kind === "parent",
      labelOpacity: group === "on" ? 1 : 0.65
    };
  };

  const linkStyle = l => {
    const key = edgeKey(l.source, l.target);
    if (shown.primary.has(key)) return { stroke: "var(--primary)", width: 3.2, opacity: 1 };
    if (shown.secondary.has(key)) return { stroke: "var(--caution)", width: 2.4, dash: "6 4", opacity: 1 };
    return l.active ? { stroke: "var(--text-3)", width: 1.3, opacity: 0.8 } : { stroke: "var(--border-strong)", width: 1, opacity: 0.55 };
  };

  const selected = graph.nodes.find(n => n.id === selectedId) ?? null;
  const playing = step !== null;

  return (
    <div className="page">
      <div className="notice">
        <Info {...ICON} />
        <MappingNote text={graph.meta.mappingNote} meta={graph.meta} />
      </div>
      <div className="grid-side">
        <Card title="온톨로지 추론 그래프" pad={false}
          aside={
            <div className="card-aside-row">
              <span className="muted small num">노드 {counts.nodes} (활성 {counts.activeNodes}) · 링크 {counts.links} · 추론 경로 {graph.highlight.path.length}</span>
              <button type="button" className="btn btn-secondary" disabled={steps.length === 0}
                onClick={() => setStep(playing ? null : 0)}>
                {playing ? <Pause {...ICON} size={16} /> : <Play {...ICON} size={16} />}
                {playing ? "멈춤" : "추론 경로 재생"}
              </button>
            </div>
          }>
          <ForceGraph nodes={graph.nodes} links={graph.links} nodeStyle={nodeStyle} linkStyle={linkStyle}
            selectedId={selectedId} onNodeClick={n => setSelectedId(n.id)} height={540} linkDistance={78} charge={-260} collidePadding={18}
            renderTooltip={n => (
              <div>
                <div className="tip-title">{n.label}</div>
                <div className="small muted">{KIND_LABELS[n.kind]} · {STATE_LABELS[nodeState(n)]}{n.approx ? " · 근사" : ""}</div>
              </div>
            )} />
          <div className="card-body card-body-tight">
            <Legend items={LEGEND} />
            {!graph.meta.scenarioFraudClass && (
              <p className="muted small">사기로 분류되지 않아 후보 사기 유형과 조건이 비활성(회색)으로 표시됩니다.</p>
            )}
          </div>
        </Card>
        <Card title="노드 설명">
          {selected ? <NodeDetail node={selected} /> : <p className="muted">그래프에서 노드를 누르면 설명이 나옵니다.</p>}
        </Card>
      </div>
    </div>
  );
}

// meta.mappingNote: 첫 문장("시연용 매핑, 온톨로지 정의 아님")을 크게, 나머지 설명은 작게
function MappingNote({ text, meta }) {
  const cut = text.indexOf(". ");
  const head = cut === -1 ? text : text.slice(0, cut);
  const rest = cut === -1 ? "" : text.slice(cut + 2);
  return (
    <div>
      <strong>{head}</strong>
      {rest && <div className="small">{rest}</div>}
      <OwlNote meta={meta} />
    </div>
  );
}

function OwlNote({ meta }) {
  const inferred = meta.owlInferred;
  return (
    <div className="small muted">
      참고: 저장소의 예전 로그 기준 OWL 추론 결과 — {inferred === null ? "항목 없음" : inferred.length ? inferred.join(", ") : "추론된 클래스 없음"}
      {" "}({meta.owlNote}){meta.owlMismatch ? " · 현재 분류와 다름" : ""}
    </div>
  );
}

function NodeDetail({ node }) {
  const { glossary } = useApp();
  const rawId = node.id.split(":").slice(1).join(":");
  const g = term(glossary, rawId);
  const state = nodeState(node);
  const group = stateGroup(node);
  return (
    <div className="node-detail">
      <div className="node-detail-kind">{KIND_LABELS[node.kind]}</div>
      <div className="node-detail-title">{node.label}</div>
      <div className="node-detail-badges">
        <Badge tone={group === "on" ? "primary" : state === "no_data" ? "caution" : "neutral"}>{STATE_LABELS[state]}</Badge>
        {node.approx && <Badge tone="caution" title="온톨로지 기준과 다른 기준으로 근사한 조건">근사</Badge>}
      </div>
      <p className="node-detail-desc">{node.desc}</p>
      {g.known && g.desc && g.desc !== node.desc && (
        <p className="muted small">용어집 · <Term id={rawId} />: {g.desc}</p>
      )}
      <code className="mono small muted">{node.id}</code>
    </div>
  );
}

const LEGEND = [
  ...Object.entries(KIND_STYLE).map(([kind, s]) => ({
    key: kind, label: KIND_LABELS[kind], swatch: <NodeShape {...s} r={Math.min(s.r, 6)} fill="var(--fill-2)" stroke="var(--text-2)" />
  })),
  { key: "on", label: "충족·활성", swatch: <NodeShape shape="circle" r={5} fill="var(--primary)" stroke="var(--primary-strong)" /> },
  { key: "unmet", label: "미충족 (−)", swatch: <><NodeShape shape="circle" r={5} fill="var(--surface)" stroke="var(--text-3)" /><text className="fg-glyph" dy="0.35em" fontSize="8">−</text></> },
  { key: "nodata", label: "근거 데이터 없음 (?)", swatch: <><NodeShape shape="circle" r={5} fill="var(--surface)" stroke="var(--text-3)" dash="2 1.5" /><text className="fg-glyph" dy="0.35em" fontSize="7">?</text></> },
  { key: "path", label: "분류 추론 경로", swatch: <line x1="-7" x2="7" y1="0" y2="0" style={{ stroke: "var(--primary)", strokeWidth: 3 }} /> },
  { key: "evpath", label: "회피 기법 경로", swatch: <line x1="-7" x2="7" y1="0" y2="0" style={{ stroke: "var(--caution)", strokeWidth: 2.4, strokeDasharray: "4 3" }} /> }
];
