// 재사용 그래프: 거래 네트워크(거래 분석)와 온톨로지 그래프가 같은 상호작용 코드를 쓴다.
// 렌더링은 React SVG, d3는 물리 시뮬레이션(d3-force)과 확대/축소(d3-zoom), 드래그(d3-drag)에만 쓴다.
//
// props
//   nodes [{ id, ... }], links [{ id, source, target, ... }]  (source/target은 노드 id)
//   nodeStyle(node) → { shape, r, fill, stroke, strokeWidth, dash, opacity, label, labelStrong, glyph }
//   linkStyle(link) → { stroke, width, dash, opacity, arrow }
//   renderTooltip(node) → ReactNode, onNodeClick(node), selectedId, height, linkDistance, charge, collidePadding
// 레이아웃이 멈추면 전체가 보이게 자동으로 맞추고, 오른쪽 위 버튼으로 다시 맞출 수 있다.
import { useEffect, useMemo, useRef, useState } from "react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import { zoom, zoomIdentity } from "d3-zoom";
import { drag } from "d3-drag";
import { select } from "d3-selection";
import { Maximize2 } from "lucide-react";
import { NodeShape } from "./shapes.jsx";
import { ICON } from "./ui.jsx";

export default function ForceGraph({
  nodes, links, nodeStyle, linkStyle, renderTooltip, onNodeClick, selectedId,
  height = 420, linkDistance = 90, charge = -260, collidePadding = 8
}) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const simRef = useRef(null);
  const zoomRef = useRef(null);
  const rafRef = useRef(0);
  const posRef = useRef(new Map());
  const userZoomed = useRef(false);
  const [width, setWidth] = useState(800);
  const [transform, setTransform] = useState(zoomIdentity);
  const [, setFrame] = useState(0);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.floor(entry.contentRect.width))));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // 시뮬레이션 노드는 id별로 유지해 데이터가 바뀌어도(슬라이더) 위치가 이어지게 한다
  const sim = useMemo(() => {
    const prev = posRef.current;
    const byId = new Map();
    const neighbor = new Map();
    for (const l of links) {
      if (!neighbor.has(l.target)) neighbor.set(l.target, l.source);
      if (!neighbor.has(l.source)) neighbor.set(l.source, l.target);
    }
    const simNodes = nodes.map((n, i) => {
      const old = prev.get(n.id);
      if (old) {
        old.data = n;
        byId.set(n.id, old);
        return old;
      }
      const near = prev.get(neighbor.get(n.id));
      const angle = (i * 2.399) % (2 * Math.PI);
      const node = near
        ? { id: n.id, data: n, x: near.x + Math.cos(angle) * 30, y: near.y + Math.sin(angle) * 30 }
        : { id: n.id, data: n, x: Math.cos(angle) * (40 + i * 4), y: Math.sin(angle) * (40 + i * 4) };
      byId.set(n.id, node);
      return node;
    });
    posRef.current = byId;
    const pairs = new Set(links.map(l => `${l.source}->${l.target}`));
    const simLinks = links
      .filter(l => byId.has(l.source) && byId.has(l.target))
      .map(l => ({ id: l.id ?? `${l.source}->${l.target}`, source: byId.get(l.source), target: byId.get(l.target), data: l,
                   curved: pairs.has(`${l.target}->${l.source}`) }));
    return { simNodes, simLinks, byId };
  }, [nodes, links]);

  const radiusOf = n => nodeStyle(n.data).r ?? 8;

  // 레이아웃이 자리를 잡으면 전체가 보이게 맞춘다 (사용자가 직접 확대/이동한 뒤에는 건드리지 않음)
  const fitRef = useRef(() => {});
  fitRef.current = () => {
    const s = simRef.current;
    if (!s || !zoomRef.current || userZoomed.current) return;
    const ns = s.nodes();
    if (!ns.length) return;
    const xs = ns.map(n => n.x), ys = ns.map(n => n.y);
    const pad = 48;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad + 16;
    const scale = Math.min(1.6, width / (maxX - minX), height / (maxY - minY));
    const t = zoomIdentity.translate(width / 2 - scale * (minX + maxX) / 2, height / 2 - scale * (minY + maxY) / 2).scale(scale);
    select(svgRef.current).call(zoomRef.current.transform, t);
  };

  useEffect(() => {
    let s = simRef.current;
    if (!s) {
      s = forceSimulation().alphaDecay(0.05);
      s.on("tick", () => {
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; setFrame(f => f + 1); });
      });
      s.on("end", () => fitRef.current());
      simRef.current = s;
    }
    // 노드가 많으면 더 강하게 밀어 겹침을 줄인다
    const strength = charge * (sim.simNodes.length > 30 ? 1.3 : 1);
    s.nodes(sim.simNodes)
      .force("link", forceLink(sim.simLinks).distance(linkDistance).strength(0.5))
      .force("charge", forceManyBody().strength(strength))
      .force("x", forceX(0).strength(0.05))
      .force("y", forceY(0).strength(0.07))
      .force("collide", forceCollide(n => radiusOf(n) + collidePadding));
    s.alpha(Math.max(s.alpha(), 0.6)).restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, linkDistance, charge, collidePadding]);

  useEffect(() => () => {
    simRef.current?.stop();
    cancelAnimationFrame(rafRef.current);
  }, []);

  // 확대/축소와 이동
  useEffect(() => {
    const svg = select(svgRef.current);
    const z = zoom().scaleExtent([0.3, 4]).on("zoom", e => {
      if (e.sourceEvent) userZoomed.current = true;
      setTransform(e.transform);
    });
    zoomRef.current = z;
    svg.call(z).on("dblclick.zoom", null);
    svg.call(z.transform, zoomIdentity.translate(width / 2, height / 2));
    fitRef.current();
    return () => { svg.on(".zoom", null); };
  }, [width, height]);

  // 노드 드래그 (d3-drag, 좌표는 확대된 그룹 기준)
  useEffect(() => {
    const s = simRef.current;
    const behavior = drag()
      .container(() => gRef.current)
      .subject(event => {
        const id = event.sourceEvent.target.closest("[data-node]")?.getAttribute("data-node");
        return sim.byId.get(id) ?? null;
      })
      .on("start", e => {
        if (!e.active) s.alphaTarget(0.2).restart();
        e.subject.fx = e.subject.x;
        e.subject.fy = e.subject.y;
        setHover(null);
      })
      .on("drag", e => { e.subject.fx = e.x; e.subject.fy = e.y; })
      .on("end", e => {
        if (!e.active) s.alphaTarget(0);
        e.subject.fx = null;
        e.subject.fy = null;
      });
    const nodesSel = select(gRef.current).selectAll("[data-node]");
    nodesSel.call(behavior);
    return () => { nodesSel.on(".drag", null); };
  }, [sim]);

  const resetZoom = () => {
    userZoomed.current = false;
    fitRef.current();
  };

  // 축소해도 라벨이 화면에서 읽을 수 있는 크기로 남게 (확대할 때는 그대로)
  const labelScale = Math.min(1, Math.max(transform.k, 0.6));

  const showTip = (event, node) => {
    const rect = wrapRef.current.getBoundingClientRect();
    setHover({ node: node.data, x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  return (
    <div ref={wrapRef} className="fg" style={{ height }}>
      <svg ref={svgRef} width={width} height={height} className="fg-svg">
        <g ref={gRef} transform={transform.toString()}>
          <g>
            {sim.simLinks.map(l => (
              <GraphLink key={l.id} link={l} style={linkStyle(l.data)} targetRadius={radiusOf(l.target)} />
            ))}
          </g>
          <g>
            {sim.simNodes.map(n => {
              const st = nodeStyle(n.data);
              const r = st.r ?? 8;
              return (
                <g key={n.id} data-node={n.id} className="fg-node" transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                  onMouseEnter={e => showTip(e, n)} onMouseMove={e => showTip(e, n)} onMouseLeave={() => setHover(null)}
                  onClick={() => onNodeClick?.(n.data)}>
                  {selectedId === n.id && <circle r={r + 6} className="fg-selected" />}
                  <NodeShape {...st} r={r} />
                  {st.glyph && <text className="fg-glyph" dy="0.35em">{st.glyph}</text>}
                  {st.label && (
                    <text className={`fg-label ${st.labelStrong ? "strong" : ""}`} y={r + 14 / labelScale}
                      style={{ opacity: st.labelOpacity ?? 1, fontSize: (st.labelStrong ? 12 : 11) / labelScale }}>
                      {st.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      <button type="button" className="icon-btn fg-reset" onClick={resetZoom} title="화면 맞춤">
        <Maximize2 {...ICON} size={16} />
      </button>
      {hover && renderTooltip && (
        <div className="fg-tip" style={{ left: Math.min(hover.x + 14, width - 240), top: hover.y + 14 }}>
          {renderTooltip(hover.node)}
        </div>
      )}
    </div>
  );
}

// 링크: 양방향 쌍은 휘게 그리고, 끝에 방향 화살표를 직접 그린다
function GraphLink({ link, style, targetRadius }) {
  const s = link.source, t = link.target;
  if (s.x === undefined || t.x === undefined) return null;
  const dx = t.x - s.x, dy = t.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const bend = link.curved ? 18 : 0;
  const cx = (s.x + t.x) / 2 + nx * bend, cy = (s.y + t.y) / 2 + ny * bend;
  // 끝점: 대상 노드 가장자리
  const ex = t.x - cx, ey = t.y - cy, el = Math.hypot(ex, ey) || 1;
  const endX = t.x - (ex / el) * (targetRadius + 3), endY = t.y - (ey / el) * (targetRadius + 3);
  const d = `M${s.x},${s.y} Q${cx},${cy} ${endX},${endY}`;
  const lineStyle = { stroke: style.stroke, strokeWidth: style.width ?? 1.2, strokeDasharray: style.dash, opacity: style.opacity ?? 1, fill: "none" };
  let arrow = null;
  if (style.arrow !== false) {
    const ux = ex / el, uy = ey / el, size = 5 + (style.width ?? 1.2);
    const bx = endX - ux * size, by = endY - uy * size;
    arrow = (
      <polygon points={`${endX},${endY} ${bx + uy * size * 0.55},${by - ux * size * 0.55} ${bx - uy * size * 0.55},${by + ux * size * 0.55}`}
        style={{ fill: style.stroke, opacity: style.opacity ?? 1 }} />
    );
  }
  return (
    <g>
      <path d={d} style={lineStyle} />
      {arrow}
    </g>
  );
}
