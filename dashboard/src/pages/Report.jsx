// 온체인 리포트: 리포트 해시, 온체인 기록(방식 선택·기록·기록 카드), 검증과 변조 시연, 입력 해시, canonical.
// 정적 모드에서는 기록·서버 검증 대신 증명 카드(상태 A/B)와 브라우저 무결성 검증을 보여 준다(pages/ReportStatic.jsx).
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, FileCheck, Info, LoaderCircle, ShieldCheck } from "lucide-react";
import { api } from "../api/client.js";
import { STATIC_MODE } from "../mode.js";
import { useApp } from "../state/AppContext.jsx";
import { useAttest } from "../state/AttestContext.jsx";
import { Badge, Card, Collapsible, EstimateTag, ICON, ReportGate, Segmented, StatusView, Term } from "../components/ui.jsx";
import { SourceBadge } from "../components/SidePanel.jsx";
import { CopyValue, HashLine, TamperPanel, VerifyResult } from "../components/AttestParts.jsx";
import { StaticIntegrityCard, StaticProofCard } from "./ReportStatic.jsx";
import { attestError, BACKEND_NAMES, explorerLinks, PHASE_LABELS, payloadRows, recordRows, tamperPresets, verifyView } from "../lib/attest.js";
import { fmtDateTime } from "../lib/format.js";

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

      {STATIC_MODE ? (
        <>
          <StaticProofCard scenario={current.reportId} data={data} canonical={canon.data} />
          <StaticIntegrityCard scenario={current.reportId} data={data} canonical={canon.data} />
        </>
      ) : (
        <>
          <AttestCard reportId={current.reportId} />
          <VerifyCard reportId={current.reportId} report={data.report} />
        </>
      )}

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
    </div>
  );
}

// ── 온체인 기록 ──
function AttestCard({ reportId }) {
  const { health } = useApp();
  const { options, selected, backendId, selectBackend, entryOf, jobOf, attest, phaseOf } = useAttest();
  const phase = phaseOf(reportId);
  const entry = entryOf(reportId);
  const record = entry?.record ?? null;
  const job = jobOf(reportId);
  const running = phase === "running";
  const readonly = selected?.mode === "readonly";
  const canRecord = health.state === "up" && Boolean(selected?.available) && !readonly && !running;
  const otherNotes = options.filter(o => !o.available && o.id !== "local");

  return (
    <Card title="온체인 기록" aside={<PhaseBadge phase={phase} />} className="attest-card">
      <p className="lead">
        온체인 기록은 이 리포트의 해시와 핵심 수치 7가지를 블록체인에 남기는 것입니다.
        체인에 남은 값은 나중에 고칠 수 없어서, 이 분석 결과가 언제 어떤 내용이었는지 보여 주는 기준이 됩니다.
        검증은 체인에 기록된 값을 다시 읽어 지금 리포트에서 계산한 해시·수치와 같은지 비교합니다.
        해시가 다르면 기록한 뒤 리포트 내용이 바뀌었다는 뜻입니다.
        로컬 시연 체인은 서버를 켤 때마다 새로 만들어져 기록이 사라지지만, 공개 테스트넷(Sepolia)에 남긴 기록은 지울 수 없고 누구나 탐색기에서 볼 수 있습니다.
      </p>
      <div className="notice notice-sm">
        <Info {...ICON} size={16} />
        {backendId === "local"
          ? <span>시연 환경에서는 매번 새로 시작하는 로컬 체인에 기록하며, 모든 시나리오가 같은 컨트랙트 주소(새 체인의 첫 배포 주소)를 씁니다. 시나리오는 리포트 해시로 구분됩니다.</span>
          : <span>Sepolia 기록은 영구적입니다. fixture 리포트가 기록 뒤에 바뀌면 체인의 리포트 해시와 달라 검증이 불일치로 나옵니다(npm run demo:eas:check로 확인).</span>}
      </div>

      <div className="attest-controls">
        <div className="attest-backend">
          <span className="field-label">기록 방식</span>
          {options.length ? (
            <Segmented size="sm" value={backendId} onChange={selectBackend}
              options={options.map(o => ({ value: o.id, label: backendLabel(o), disabled: !o.available }))} />
          ) : <span className="muted small">{health.state === "up" ? "불러오는 중" : "서버 연결 필요"}</span>}
        </div>
        <button type="button" className={`btn ${record ? "btn-secondary btn-md" : "btn-primary"}`} disabled={!canRecord}
          onClick={() => attest(reportId, { backend: backendId, force: Boolean(record) })}
          title={readonly ? "읽기 전용: 기록용 키가 없습니다" : record ? "같은 리포트를 새 UID로 한 번 더 기록합니다" : undefined}>
          {running ? <LoaderCircle {...ICON} size={16} className="spin" /> : <FileCheck {...ICON} size={16} />}
          {running ? "기록 중" : record ? "다시 기록(새 UID)" : "온체인에 기록"}
        </button>
      </div>
      {readonly && <p className="muted small backend-note">기록 불가 · 조회/검증만 — 서버에 기록용 키(DEMO_EAS_PRIVATE_KEY)가 없어 읽기 전용입니다.</p>}
      {selected?.note && <p className="small backend-note text-caution">{selected.note}</p>}
      {otherNotes.map(o => (
        <p key={o.id} className="muted small backend-note">{o.label}: {o.reason}</p>
      ))}

      {phase === "offline" && <StatusView kind="down" title="시연 API 서버에 연결할 수 없습니다" detail="WSL에서 npm run demo:server를 실행한 뒤 새로고침하세요." />}
      {phase === "starting" && <StatusView kind="loading" title="로컬 시연 체인을 시작하는 중입니다" detail="hardhat node를 띄우고 사전 기록을 마치면 기록할 수 있습니다." />}
      {phase === "unavailable" && <StatusView kind="error" title={`${selected?.label ?? "이 기록 방식"}을(를) 쓸 수 없습니다`} detail={selected?.reason} />}
      {running && <AttestProgress job={job} />}
      {job?.status === "error" && job.failure && <StatusView kind="error" {...attestError(job.failure, "기록하지 못했습니다")} />}
      {entry?.status === "error" && !record && <StatusView kind="error" {...attestError(entry.error, "기록 정보를 불러오지 못했습니다")} />}
      {record && <RecordDetails record={record} reused={job?.status === "done" && job.reused} />}
    </Card>
  );
}

// 쓸 수 없으면 local은 "사용 불가", eas-sepolia는 설정이 없으면 "미설정". 읽기 전용이면 "조회/검증만".
function backendLabel(o) {
  if (o.starting) return o.label;
  if (o.available) return o.mode === "readonly" ? `${o.label} · 조회/검증만` : o.label;
  return `${o.label} · ${o.id !== "local" && String(o.reason).startsWith("미설정") ? "미설정" : "사용 불가"}`;
}

function PhaseBadge({ phase }) {
  if (!phase) return null;
  const tone = phase === "recorded" || phase === "prerecorded" ? "primary" : phase === "error" ? "danger" : "neutral";
  return <Badge tone={tone}>{phase === "prerecorded" ? "기록됨 · 사전 기록" : PHASE_LABELS[phase]}</Badge>;
}

const JOB_STEPS = [
  { key: "request", label: "요청" },
  { key: "queued", label: "대기열" },
  { key: "running", label: "체인에 기록" },
  { key: "done", label: "완료" }
];

function AttestProgress({ job }) {
  const at = !job?.id ? 0 : job.status === "queued" ? 1 : 2;
  return (
    <ol className="job-steps attest-progress" aria-label="기록 진행">
      {JOB_STEPS.map((s, i) => {
        const state = i < at ? "done" : i === at ? "running" : "pending";
        return (
          <li key={s.key} className={`job-step job-${state}`}>
            {state === "running" ? <LoaderCircle {...ICON} size={14} className="spin" /> : state === "done" ? <FileCheck {...ICON} size={14} /> : <span className="job-dot" />}
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

function RecordDetails({ record, reused }) {
  const { glossary } = useApp();
  const links = explorerLinks(record);
  return (
    <div className="record">
      <div className="record-head">
        <ShieldCheck {...ICON} size={18} />
        <strong>기록 카드</strong>
        {record.prerecorded && <Badge tone="neutral" title={record.backend === "local" ? "서버가 시작할 때 사전 생성본 리포트를 미리 기록했습니다" : "demo:eas:record-fixtures로 미리 기록한 것입니다"}>사전 기록</Badge>}
        {record.stale && <Badge tone="caution" title="이 기록 뒤에 fixture 리포트가 바뀌어 리포트 해시가 다릅니다 (npm run demo:eas:check)">fixture와 해시 다름</Badge>}
        {reused && <Badge tone="neutral" title="같은 리포트의 기존 기록을 그대로 돌려받았습니다">기존 기록</Badge>}
        <span className="record-meta muted small num">{BACKEND_NAMES[record.backend] ?? record.backend} · {fmtDateTime(record.recordedAt)}</span>
      </div>
      <div className="grid-2 grid-tight">
        <div>
          <h3 className="sub-title">기록 정보</h3>
          <ul className="rows rows-static">
            {recordRows(record).map(r => (
              <li key={r.key} className="row">
                <span className="row-title">{r.label}</span>
                <span className="row-value">{r.hex ? <CopyValue value={r.value} /> : <span className="num">{r.value}</span>}</span>
              </li>
            ))}
            <li className="row">
              <span className="row-title">기록 시각</span>
              <span className="row-value num">{fmtDateTime(record.recordedAt)}</span>
            </li>
          </ul>
        </div>
        <div>
          <h3 className="sub-title">기록한 값 (7개 필드)</h3>
          <ul className="rows rows-static">
            {payloadRows(record.payload, glossary).map(f => (
              <li key={f.name} className="row">
                <span className="row-title">{f.label}</span>
                <span className="row-value">{f.mono ? <CopyValue value={f.full ?? f.text} display={f.text} /> : <span className="num" title={f.full ?? undefined}>{f.text}</span>}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {links && (
        <div className="explorer-links">
          <a className="link" href={links.attestation} target="_blank" rel="noreferrer">
            탐색기에서 기록 보기 <ExternalLink {...ICON} size={14} />
          </a>
          {links.verified === false && (
            <span title="탐색기의 기록 화면 경로(/attestation/view/<uid>)는 문서로 확인하지 못한 추정 형식입니다. 열리지 않으면 탐색기에서 UID로 검색하세요.">
              <EstimateTag>형식 미확인</EstimateTag>
            </span>
          )}
          {links.schema && (
            <a className="link" href={links.schema} target="_blank" rel="noreferrer">
              스키마 보기 <ExternalLink {...ICON} size={14} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── 검증과 변조 시연 ──
function VerifyCard({ reportId, report }) {
  const { health, glossary } = useApp();
  const { selected, backendId, verifyOf, verify, phaseOf } = useAttest();
  const resultRef = useRef(null);
  const entry = verifyOf(reportId);
  const phase = phaseOf(reportId);
  const hasRecord = phase === "recorded" || phase === "prerecorded";
  const running = entry?.status === "running";
  const canVerify = hasRecord && !running && health.state === "up" && selected?.available === true;
  const view = entry?.status === "done" ? verifyView(entry.result, glossary) : null;
  const presets = useMemo(() => tamperPresets(report, glossary), [report, glossary]);
  const tamperFailed = entry?.status === "error" && entry.tamper;

  const runTamper = async preset => {
    await verify(reportId, { backend: backendId, tamper: { path: preset.path, value: preset.value } });
    resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Card title="검증" aside={view ? <Badge tone={view.tone}>{view.label}</Badge> : running ? <Badge tone="neutral">검증 중</Badge> : null}>
      <p className="muted">체인에 기록된 7개 필드를 다시 읽어, 지금 서버에 있는 리포트에서 계산한 값과 비교합니다.</p>
      <div className="btn-row">
        <button type="button" className="btn btn-primary" disabled={!canVerify} onClick={() => verify(reportId, { backend: backendId })}>
          {running && !entry.tamper ? <LoaderCircle {...ICON} size={16} className="spin" /> : <ShieldCheck {...ICON} size={16} />}
          {running && !entry.tamper ? "검증 중" : "검증"}
        </button>
      </div>
      {(phase === "none" || phase === "error") && <p className="muted small hint">먼저 위에서 온체인에 기록해야 검증할 수 있습니다.</p>}
      {phase === "readonly" && <p className="muted small hint">이 리포트는 {selected?.label}에 기록이 없어 검증할 수 없습니다. 읽기 전용이라 여기서 기록할 수도 없습니다.</p>}

      <TamperPanel presets={presets} canRun={canVerify} runningPath={running ? entry.tamper?.path : null} onRun={runTamper}
        note="아래 항목 하나를 바꾼 리포트 사본으로 검증합니다. 사본은 서버 메모리에서만 쓰고 버리며, 리포트 파일과 온체인 기록은 바뀌지 않습니다."
        error={tamperFailed ? attestError(entry.error, "변조 시연을 실행하지 못했습니다") : null} />

      {entry?.status === "error" && !entry.tamper && <StatusView kind="error" {...attestError(entry.error, "검증하지 못했습니다")} />}
      <div ref={resultRef}>
        {view && <VerifyResult view={view} tamper={entry.tamper} disabled={!canVerify} onRestore={() => verify(reportId, { backend: backendId })} />}
      </div>
    </Card>
  );
}
