// 거래 분석: 위에서부터 쉬운 차트(남은 돈) → 재생 바 → 흐름도+이 그림에서 볼 것 → 블록별 입출금 상세 → 거래 관계도(+선택한 노드).
// 모두 하나의 블록 커서(재생 1x/2x)를 공유한다. 문구·구간·흐름은 view.decision(demo/lib/decision.js)을 그대로 쓴다.
// 주소 #/trade?scenario=ponzi&block=31 처럼 block을 주면 커서 시작 위치로 쓴다.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { Card, ICON, Legend, ReportGate, Segmented, Term } from "../components/ui.jsx";
import ForceGraph from "../components/ForceGraph.jsx";
import BalanceStory from "../components/BalanceStory.jsx";
import FlowDiagram from "../components/FlowDiagram.jsx";
import { WalletLedger } from "../components/RugAxisParts.jsx";
import { NodeShape } from "../components/shapes.jsx";
import { cssVar } from "../components/theme.js";
import { api } from "../api/client.js";
import { blockRange, buildBlockSeries, chartMarkers, clampBlock, crossedOnset, mergeEvents, nextBlock } from "../lib/series.js";
import { buildNetwork, EXTRACTOR_PROFIT_RATIO, ROLE_LABELS } from "../lib/network.js";
import { balanceAt } from "../lib/story.js";
import { fmtEth, fmtNumber, shortAddr } from "../lib/format.js";

const STEP_MS = { 1: 700, 2: 350 };
// 신뢰 점수는 신뢰 시트 개편 때 다시 정한다. 코드는 남겨 두고 화면에서만 숨긴다.
const SHOW_TRUST_SCORE = false;

// "정상이라면" 점선용 정상 스테이킹 예시 거래 행 (한 번만 읽는다). 서버 모드에서 없으면 점선을 그리지 않는다.
let normalRowsPromise = null;
function loadNormalRows() {
  normalRowsPromise ??= api.timeseries("normal").catch(() => { normalRowsPromise = null; return null; });
  return normalRowsPromise;
}

export default function Trade() {
  return <ReportGate>{data => <TradeBody key={data.envelope.report_sha256 + data.view.scenario} data={data} />}</ReportGate>;
}

function TradeBody({ data }) {
  const { timeseries: rows, view, report } = data;
  const decision = view.decision;
  const [params] = useSearchParams();
  const range = useMemo(() => blockRange(rows), [rows]);
  const series = useMemo(() => buildBlockSeries(rows), [rows]);
  const markers = useMemo(() => chartMarkers(view.phase, range), [view.phase, range]);
  const onsetBlock = view.phase.onset?.block ?? null;
  const decisive = decision?.decisive ?? null;
  const networkRef = useRef(null);

  const startBlock = Number(params.get("block"));
  const [cursor, setCursor] = useState(() => (Number.isFinite(startBlock) && startBlock > 0 ? clampBlock(startBlock, range) : range.max));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [flash, setFlash] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [normalRows, setNormalRows] = useState(null);
  const prevCursor = useRef(cursor);

  useEffect(() => {
    if (!decision || decision.hint === "normal_staking") return undefined;
    let alive = true;
    loadNormalRows().then(r => alive && setNormalRows(r));
    return () => { alive = false; };
  }, [decision]);

  // 발현 추정 시점을 지나가는 순간 강조
  useEffect(() => {
    if (crossedOnset(prevCursor.current, cursor, onsetBlock)) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 2200);
      prevCursor.current = cursor;
      return () => clearTimeout(t);
    }
    prevCursor.current = cursor;
    return undefined;
  }, [cursor, onsetBlock]);

  // 재생: 거래가 있는 블록 단위로 끝까지 이동
  const cursorRef = useRef(cursor);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => {
      const n = nextBlock(range, cursorRef.current);
      if (n === null) setPlaying(false);
      else setCursor(n);
    }, STEP_MS[speed]);
    return () => clearInterval(t);
  }, [playing, speed, range]);

  const togglePlay = () => {
    if (!playing && cursor >= range.max) setCursor(range.min);
    setPlaying(p => !p);
  };

  const ownerAddress = decision?.ownerAddress ?? null;
  const network = useMemo(() => buildNetwork(rows, report.trust.wallet_scores, cursor, { ownerAddress }), [rows, report, cursor, ownerAddress]);
  const selectedNode = network.nodes.find(n => n.id === selectedId) ?? null;
  const walletScore = selectedId ? report.trust.wallet_scores.find(w => w.address.toLowerCase() === selectedId) : null;
  const span = Math.max(1, range.max - range.min);
  const pos = b => `${((b - range.min) / span) * 100}%`;

  return (
    <div className="page">
      {decision && (
        <Card title="컨트랙트에 남은 돈은 어떻게 변했나" aside={<span className="muted small">시뮬레이션 예시 값</span>}>
          <BalanceStory points={series.points} decision={decision} cursor={cursor} normalRows={normalRows} />
        </Card>
      )}

      <div className={`player ${flash ? "player-flash" : ""}`}>
        <button type="button" className="btn btn-icon" onClick={togglePlay} aria-label={playing ? "일시정지" : "끝까지 재생"}>
          {playing ? <Pause {...ICON} /> : <Play {...ICON} />}
        </button>
        <button type="button" className="btn btn-icon" onClick={() => { setPlaying(false); setCursor(range.min); }} aria-label="처음으로">
          <RotateCcw {...ICON} />
        </button>
        <Segmented size="sm" value={speed} onChange={setSpeed} options={[{ value: 1, label: "1x" }, { value: 2, label: "2x" }]} />
        <div className="player-track">
          <input type="range" min={range.min} max={range.max} step={1} value={cursor}
            onChange={e => { setPlaying(false); setCursor(Number(e.target.value)); }} aria-label="블록 위치" />
          {onsetBlock !== null && (
            <span className="player-onset" style={{ left: pos(onsetBlock) }} title={`사기 발현 추정 시점(첫 출금) · 블록 ${onsetBlock}`} />
          )}
          {decisive && (
            <span className="player-decisive" style={{ left: pos(decisive.block) }} title={`${decisive.label} · 블록 ${decisive.block}`} />
          )}
        </div>
        <div className="player-block num">블록 {cursor}<span className="muted"> / {range.max}</span></div>
        <div className="player-note">
          {flash ? <span className="text-danger">사기 발현 추정 시점 통과 · 블록 {onsetBlock}</span>
            : <span><strong>끝까지 재생</strong>{decisive ? <span className="muted"> · 빨간 점이 {decisive.label}</span> : null}</span>}
        </div>
      </div>

      {decision && (
        <div className="grid-flow">
          <Card title="들어온 돈 어디로 갔나">
            <FlowDiagram decision={decision} />
          </Card>
          <Card title="이 그림에서 볼 것">
            <ol className="notes">
              {decision.copy.chartNotes.map((t, i) => (
                <li key={t}><span className="notes-no">{i + 1}</span><span>{t}</span></li>
              ))}
            </ol>
            <button type="button" className="link-btn" onClick={() => networkRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              거래 관계도 전체 보기 <ChevronRight {...ICON} size={15} />
            </button>
          </Card>
        </div>
      )}

      {decision?.rugpull && (
        <Card title="지갑별 낸 돈과 받은 돈" aside={<span className="muted small">전체 기간 · 러그풀 판정에 쓴 값</span>}>
          <WalletLedger decision={decision} />
        </Card>
      )}

      <Card title="블록별 입출금 상세"
        aside={<span className="muted small">잔액: {series.balanceSource === "contract_balance_eth" ? "거래 행의 컨트랙트 잔액" : "누적 입금 − 누적 출금"}</span>}>
        <p className="row-help row-help-block">블록: 블록체인에 거래가 묶여 기록되는 단위예요. 번호가 클수록 나중에 일어난 거래입니다.</p>
        <TradeChart points={series.points} range={range} markers={markers} cursor={cursor} flash={flash} />
        <Legend items={[
          { key: "dep", label: "입금", swatch: <rect x="-6" y="-6" width="12" height="12" rx="2" style={{ fill: "var(--deposit)" }} /> },
          { key: "wd", label: "출금", swatch: <rect x="-6" y="-6" width="12" height="12" rx="2" style={{ fill: "var(--withdraw)" }} /> },
          { key: "bal", label: "컨트랙트 잔액", swatch: <line x1="-7" x2="7" y1="0" y2="0" style={{ stroke: "var(--text-2)", strokeWidth: 2 }} /> },
          { key: "evt", label: "시점 이벤트", swatch: <line x1="0" x2="0" y1="-7" y2="7" style={{ stroke: "var(--text-3)", strokeDasharray: "2 2" }} /> },
          ...(markers.onset ? [{ key: "onset", label: "사기 발현 추정 구간", swatch: <rect x="-7" y="-6" width="14" height="12" style={{ fill: "var(--danger-weak)", stroke: "var(--danger)" }} /> }] : [])
        ]} />
      </Card>

      <div ref={networkRef} className="scroll-target">
        <Card title="거래 관계도 (거래 네트워크)" aside={<span className="muted small num">블록 {cursor}까지 · 노드 {network.nodes.length} · 링크 {network.links.length}</span>} pad={false}>
          <p className="row-help row-help-block card-help">지갑과 컨트랙트 사이에 돈이 오간 관계를 선으로 이은 그림이에요. 노드를 누르면 아래에 요약이 나옵니다.</p>
          <div className="network-layout">
            <aside className="network-legend" aria-label="노드 범례">
              <h3 className="legend-group">노드</h3>
              <Legend items={NETWORK_LEGEND_NODES} vertical />
              <h3 className="legend-group">선</h3>
              <Legend items={NETWORK_LEGEND_LINKS} vertical />
            </aside>
            <div className="network-graph">
              <TradeNetwork network={network} cursor={cursor} selectedId={selectedId} onSelect={n => setSelectedId(n.id)} />
            </div>
          </div>
        </Card>
      </div>

      <Card title="선택한 노드">
        {selectedNode
          ? <NodeSummary node={selectedNode} wallet={walletScore} contractBalance={balanceAt(series.points, cursor)} />
          : <p className="muted">거래 관계도에서 노드를 누르면 요약이 나옵니다.</p>}
      </Card>
    </div>
  );
}

function TradeChart({ points, range, markers, cursor, flash }) {
  const c = {
    deposit: cssVar("--deposit", "#3182f6"), withdraw: cssVar("--withdraw", "#f04452"), text2: cssVar("--text-2"),
    text3: cssVar("--text-3"), grid: cssVar("--border"), danger: cssVar("--danger"), primary: cssVar("--primary")
  };
  const events = mergeEvents(markers.events);
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={points} margin={{ top: 24, right: 16, bottom: 4, left: 0 }} barGap={1}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="block" type="number" domain={[range.min - 1, range.max + 1]} allowDecimals={false}
            tick={{ fontSize: 11, fill: c.text3 }} tickLine={false} axisLine={{ stroke: c.grid }} />
          <YAxis tick={{ fontSize: 11, fill: c.text3 }} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={<ChartTip />} />
          {markers.onset && (
            <ReferenceArea x1={markers.onset.x1} x2={markers.onset.x2} fill={c.danger} fillOpacity={flash ? 0.14 : 0.06} ifOverflow="extendDomain"
              label={{ value: "사기 발현 추정 구간", position: "insideTopRight", fontSize: 11, fill: c.danger, offset: 24 }} />
          )}
          {events.map((e, i) => (
            <ReferenceLine key={e.block} x={e.block} stroke={c.text3} strokeDasharray="3 3"
              label={{ value: String(i + 1), position: "top", fontSize: 11, fontWeight: 600, fill: c.text2 }} />
          ))}
          {markers.onset && <ReferenceLine x={markers.onset.x1} stroke={c.danger} strokeWidth={1.5} />}
          <Bar dataKey="deposit" name="입금" fill={c.deposit} barSize={7} isAnimationActive={false} />
          <Bar dataKey="withdraw" name="출금" fill={c.withdraw} barSize={7} isAnimationActive={false} />
          <Line dataKey="balance" name="잔액" type="stepAfter" stroke={c.text2} strokeWidth={2} dot={false} isAnimationActive={false} />
          <ReferenceLine x={cursor} stroke={c.primary} strokeWidth={2} />
        </ComposedChart>
      </ResponsiveContainer>
      <ol className="event-list">
        {events.map((e, i) => (
          <li key={e.block}>
            <span className="event-no">{i + 1}</span>
            <span className="num">블록 {e.block}</span>
            <span>{e.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="chart-tip-title num">블록 {label}</div>
      <div className="chart-tip-row"><span>입금</span><span className="num">{fmtEth(p.deposit, 3)}</span></div>
      <div className="chart-tip-row"><span>출금</span><span className="num">{fmtEth(p.withdraw, 3)}</span></div>
      {p.failed > 0 && <div className="chart-tip-row"><span>실패 출금</span><span className="num">{p.failed}건</span></div>}
      <div className="chart-tip-row"><span>잔액</span><span className="num">{fmtEth(p.balance, 3)}</span></div>
    </div>
  );
}

const ROLE_STYLE = {
  contract:  { shape: "square",  r: 13, fill: "var(--text-2)", stroke: "var(--text-1)" },
  owner:     { shape: "diamond", r: 9,  fill: "var(--text-3)", stroke: "var(--text-2)" },
  wallet:    { shape: "circle",  r: 7,  fill: "var(--surface)", stroke: "var(--text-3)" },
  drainer:   { shape: "circle",  r: 10, fill: "var(--danger)", stroke: "var(--danger)" },
  extractor: { shape: "triangle", r: 9, fill: "var(--caution)", stroke: "var(--caution)" }
};

// 역할 한 줄 설명 (선택한 노드 카드)
const ROLE_DESC = {
  contract:  "참여자의 돈이 모이는 스마트 컨트랙트예요.",
  owner:     "컨트랙트를 배포한 운영자 지갑이에요.",
  wallet:    "입금하거나 출금한 참여자 지갑이에요.",
  drainer:   "컨트랙트 잔고를 한 번에 전부 빼 간 지갑이에요.",
  extractor: `넣은 돈의 ${EXTRACTOR_PROFIT_RATIO}배보다 많이 받아 간 지갑이에요.`
};

const NETWORK_LEGEND_NODES = Object.entries(ROLE_STYLE).map(([role, s]) => ({ key: role, label: ROLE_LABELS[role], swatch: <NodeShape {...s} r={5} /> }));
const NETWORK_LEGEND_LINKS = [
  { key: "dep", label: "입금 (두께 = 누적 금액)", swatch: <line x1="-7" x2="7" y1="0" y2="0" style={{ stroke: "var(--deposit)", strokeWidth: 2.5 }} /> },
  { key: "wd", label: "출금", swatch: <line x1="-7" x2="7" y1="0" y2="0" style={{ stroke: "var(--withdraw)", strokeWidth: 2.5 }} /> },
  { key: "fail", label: "실패 출금 (0 ETH)", swatch: <line x1="-7" x2="7" y1="0" y2="0" style={{ stroke: "var(--withdraw)", strokeDasharray: "2 2" }} /> }
];

function TradeNetwork({ network, cursor, selectedId, onSelect }) {
  const maxAmount = Math.max(1e-9, ...network.links.map(l => l.amount));
  const nodeStyle = n => {
    const base = ROLE_STYLE[n.role];
    const volume = n.deposited + n.received;
    const label = n.role === "contract" ? "컨트랙트" : n.role === "wallet" ? null : ROLE_LABELS[n.role];
    return { ...base, r: base.r + Math.min(5, Math.sqrt(volume)), label, labelStrong: n.role !== "wallet" };
  };
  const linkStyle = l => {
    const failedOnly = l.amount === 0;
    return {
      stroke: l.kind === "deposit" ? "var(--deposit)" : "var(--withdraw)",
      width: failedOnly ? 1 : 1 + 4 * Math.sqrt(l.amount / maxAmount),
      dash: failedOnly ? "3 3" : undefined,
      opacity: l.lastBlock === cursor ? 1 : 0.55
    };
  };
  return (
    <ForceGraph nodes={network.nodes} links={network.links} nodeStyle={nodeStyle} linkStyle={linkStyle}
      selectedId={selectedId} onNodeClick={onSelect} height={420} linkDistance={80} charge={-220} collidePadding={10}
      renderTooltip={n => (
        <div>
          <div className="tip-title">{ROLE_LABELS[n.role]}</div>
          <div className="mono small">{n.id}</div>
          <div className="tip-row"><span>넣은 돈</span><span className="num">{fmtEth(n.deposited, 3)}</span></div>
          <div className="tip-row"><span>받은 돈</span><span className="num">{fmtEth(n.received, 3)}</span></div>
        </div>
      )} />
  );
}

// 선택한 노드: 넣은 돈 / 받은 돈 / 차액 / 거래 횟수 / 역할 설명. 컨트랙트는 남은 잔고. (현재 커서 블록까지 기준)
function NodeSummary({ node, wallet, contractBalance }) {
  const diff = node.received - node.deposited;
  const signed = v => (Math.abs(v) < 1e-9 ? fmtEth(0, 3) : `${v > 0 ? "+" : "−"}${fmtEth(Math.abs(v), 3)}`);
  return (
    <div className="node-summary">
      <div className="node-summary-head">
        <span className="node-summary-role">{ROLE_LABELS[node.role]}</span>
        <code className="mono small" title={node.id}>{shortAddr(node.id)}</code>
      </div>
      <p className="node-summary-desc">{ROLE_DESC[node.role]}</p>
      <div className="node-stats">
        {node.role === "contract" ? (
          <>
            <NodeStat label="남은 잔고" value={fmtEth(contractBalance, 3)} />
            <NodeStat label="거래 횟수" value={`${fmtNumber(node.txCount, 0)}건`} />
          </>
        ) : (
          <>
            <NodeStat label="넣은 돈" sub="누적 입금" value={fmtEth(node.deposited, 3)} />
            <NodeStat label="받은 돈" sub="누적 수령" value={fmtEth(node.received, 3)} />
            <NodeStat label="차액" sub="받은 돈 − 넣은 돈" value={signed(diff)} tone={diff > 1e-9 ? "caution" : undefined} />
            <NodeStat label="거래 횟수" value={`${fmtNumber(node.txCount, 0)}건`} />
          </>
        )}
        {SHOW_TRUST_SCORE && wallet && (
          <>
            <NodeStat label={<Term id="trust_score">신뢰 점수</Term>} value={`${wallet.trust_score} (${wallet.grade})`} />
            <NodeStat label="수익 비율" value={`${fmtNumber(wallet.profit_ratio, 3)}배`} />
          </>
        )}
      </div>
      <p className="muted small">재생 바의 현재 블록까지의 거래로 계산합니다.</p>
    </div>
  );
}

function NodeStat({ label, sub, value, tone }) {
  return (
    <div className="node-stat">
      <div className="node-stat-label">{label}{sub && <span className="node-stat-sub"> · {sub}</span>}</div>
      <div className={`node-stat-value num ${tone ? `text-${tone}` : ""}`}>{value}</div>
    </div>
  );
}
