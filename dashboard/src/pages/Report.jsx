// 온체인 리포트: 리포트 해시(canonical 직렬화의 SHA-256)와 입력 해시. Attestation 기록·검증은 다음 단계에서 연결한다.
import { useEffect, useState } from "react";
import { Copy, FileCheck, ShieldCheck } from "lucide-react";
import { api } from "../api/client.js";
import { useApp } from "../state/AppContext.jsx";
import { Badge, Card, Collapsible, ICON, ReportGate, StatusView, Term } from "../components/ui.jsx";
import { SourceBadge } from "../components/SidePanel.jsx";

export default function Report() {
  return <ReportGate>{data => <ReportBody key={data.envelope.report_sha256 + data.view.scenario} data={data} />}</ReportGate>;
}

function ReportBody({ data }) {
  const { current } = useApp();
  const { envelope } = data;
  const [canon, setCanon] = useState({ status: "loading", data: null, error: null });

  useEffect(() => {
    let alive = true;
    api.canonical(current.reportId)
      .then(d => alive && setCanon({ status: "ready", data: d, error: null }))
      .catch(err => alive && setCanon({ status: "error", data: null, error: err }));
    return () => { alive = false; };
  }, [current.reportId]);

  const matches = canon.data ? canon.data.hash === envelope.report_sha256 : null;

  return (
    <div className="page">
      <Card title={<Term id="report_hash">리포트 해시</Term>} aside={<SourceBadge source={envelope.source} />}>
        {canon.status === "loading" && <StatusView kind="loading" title="해시를 계산하는 중입니다" />}
        {canon.status === "error" && <StatusView kind="error" title="canonical을 불러오지 못했습니다" detail={canon.error?.message} />}
        {canon.data && (
          <>
            <HashLine value={canon.data.hash} large />
            <ul className="rows rows-static">
              <li className="row">
                <span className="row-title">분석 시점에 기록한 해시(envelope)와 비교</span>
                <span className="row-value">{matches ? <Badge tone="safe">일치</Badge> : <Badge tone="danger">불일치</Badge>}</span>
              </li>
              <li className="row">
                <span className="row-title">직렬화 규칙</span>
                <span className="row-value mono small">{envelope.canonical_version}</span>
              </li>
              <li className="row">
                <span className="row-title">해시에서 뺀 필드</span>
                <span className="row-value mono small">{envelope.report_hash_excluded.join(", ")}</span>
              </li>
            </ul>
          </>
        )}
      </Card>

      <Card title="입력 파일 해시" aside={<span className="muted small">envelope.input</span>}>
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
          {envelope.input.seed && (
            <li className="row"><span className="row-title">시뮬레이션 시드</span><span className="row-value mono small">{envelope.input.seed}</span></li>
          )}
        </ul>
      </Card>

      <Collapsible title={<Term id="canonical">canonical JSON 보기</Term>} summary={canon.data ? `${canon.data.canonical.length.toLocaleString("ko-KR")}자` : ""}>
        {canon.data && (
          <>
            <p className="muted small">아래 문자열 그대로(공백 없는 한 줄)를 SHA-256으로 해시합니다. 읽기 쉽게 줄을 나눈 사본입니다.</p>
            <pre className="code-block">{JSON.stringify(JSON.parse(canon.data.canonical), null, 2)}</pre>
          </>
        )}
      </Collapsible>

      <Card title="온체인 기록 (Attestation)" aside={<Badge tone="neutral">다음 단계에서 연결</Badge>}>
        <p className="muted">리포트 해시를 체인에 기록하고 검증하는 기능은 아직 연결되지 않았습니다.</p>
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" disabled title="다음 단계에서 연결">
            <FileCheck {...ICON} size={16} />기록하기
          </button>
          <button type="button" className="btn btn-secondary" disabled title="다음 단계에서 연결">
            <ShieldCheck {...ICON} size={16} />검증하기
          </button>
        </div>
      </Card>
    </div>
  );
}

function HashLine({ value, large }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={`hash ${large ? "hash-lg" : ""}`}>
      <code className="mono">{value}</code>
      <button type="button" className="icon-btn" onClick={copy} title="복사">
        <Copy {...ICON} size={15} />
      </button>
      {copied && <span className="muted small">복사됨</span>}
    </div>
  );
}
