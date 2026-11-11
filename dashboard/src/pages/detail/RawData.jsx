// 상세 분석 > 원자료: 거래 로그 표(핵심 출금 행 강조, 표 안에서만 스크롤), 입력 파일 해시(envelope),
// 컨트랙트 소스(source.json / GET /api/report/:id/source, 텍스트로만 렌더), 하단 "분석 수치" 접이식(예전 개요 블록).
import { useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { api } from "../../api/client.js";
import { useApp } from "../../state/AppContext.jsx";
import { Badge, Card, Collapsible, ICON, ReportGate, StatusView } from "../../components/ui.jsx";
import { HashLine } from "../../components/AttestParts.jsx";
import { CombinationMatrix, KeyNumbers, PatternsAndWarnings, SummaryStrip } from "../../components/AnalysisNumbers.jsx";
import { rawRows } from "../../lib/rawRows.js";
import { fmtEth, shortAddr } from "../../lib/format.js";

export default function RawData() {
  return <ReportGate>{data => <RawBody key={data.envelope.report_sha256 + data.view.scenario} data={data} />}</ReportGate>;
}

function RawBody({ data }) {
  const { current } = useApp();
  const { view, envelope, timeseries } = data;
  const rows = useMemo(() => rawRows(timeseries, view.decision), [timeseries, view.decision]);
  const [source, setSource] = useState({ status: "loading", data: null, error: null });

  useEffect(() => {
    let alive = true;
    api.source(current.reportId)
      .then(d => alive && setSource({ status: "ready", data: d, error: null }))
      .catch(err => alive && setSource({ status: "error", data: null, error: err }));
    return () => { alive = false; };
  }, [current.reportId]);

  return (
    <div className="page raw">
      <header className="page-head">
        <h1 className="page-title">원자료</h1>
        <p className="page-desc">판정에 쓴 거래 기록과 입력 파일을 그대로 보여 줍니다. 시뮬레이션 데이터입니다.</p>
      </header>

      <Card title="거래 로그" aside={<span className="muted small num">{rows.length}건 · 핵심 출금 행 강조</span>}>
        <div className="raw-table-wrap" tabIndex={0} aria-label="거래 로그 표 (가로·세로로 스크롤)">
          <table className="raw-table">
            <thead>
              <tr><th>블록</th><th>동작</th><th>보낸 주소</th><th>받는 주소</th><th className="num">금액</th><th>결과</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.i} className={`${r.key ? "raw-key" : ""} ${r.failed ? "raw-failed" : ""}`}>
                  <td className="num">{r.block}</td>
                  <td>{r.actionLabel}</td>
                  <td><code className="mono" title={r.from}>{shortAddr(r.from)}</code></td>
                  <td><code className="mono" title={r.to}>{shortAddr(r.to)}</code></td>
                  <td className="num">{fmtEth(r.amount, 3)}</td>
                  <td>{r.kind === "withdraw" ? (r.failed ? <Badge tone="caution">실패</Badge> : "성공") : "—"}{r.key && <Badge tone="danger">핵심 출금</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="입력 파일 해시" aside={<span className="muted small">분석 시점 기록(envelope.input)</span>}>
        <ul className="rows rows-static">
          <li className="row row-stack">
            <span className="row-title">거래 로그 <code className="mono small muted">{envelope.input.csv.file}</code></span>
            <HashLine value={envelope.input.csv.sha256} />
            <span className="muted small">정규화: {envelope.input.csv.normalization}</span>
          </li>
          <li className="row row-stack">
            <span className="row-title">컨트랙트 소스 <code className="mono small muted">{envelope.input.sol.file}</code></span>
            <HashLine value={envelope.input.sol.sha256} />
            <span className="muted small">정규화: {envelope.input.sol.normalization}</span>
          </li>
        </ul>
      </Card>

      <Card title="컨트랙트 소스" aside={source.data ? <SourceAside source={source.data} /> : null}>
        {source.status === "loading" && <StatusView kind="loading" title="소스를 불러오는 중입니다" />}
        {source.status === "error" && <StatusView kind="error" title="소스를 불러오지 못했습니다" detail={source.error?.message} />}
        {source.data && <pre className="code-block source-block">{source.data.text}</pre>}
      </Card>

      <Collapsible title="분석 수치" summary="요약 띠 · 코드 위험 × 지갑 위험 · 핵심 수치 · 감지된 패턴과 경고">
        <div className="raw-numbers">
          <SummaryStrip view={view} envelope={envelope} />
          <div className="grid-2">
            <CombinationMatrix combination={view.combination} />
            <KeyNumbers view={view} />
          </div>
          <PatternsAndWarnings view={view} />
        </div>
      </Collapsible>
    </div>
  );
}

function SourceAside({ source }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <span className="card-aside-row">
      <code className="mono small muted">{source.file}</code>
      <Badge tone={source.matchesEnvelope ? "safe" : "danger"} title="소스 해시가 분석 시점에 기록한 해시와 같은지">
        {source.matchesEnvelope ? "분석 시점 소스와 같음" : "분석 시점 소스와 다름"}
      </Badge>
      <button type="button" className="btn btn-secondary" onClick={copy}><Copy {...ICON} size={15} />{copied ? "복사됨" : "복사"}</button>
    </span>
  );
}
