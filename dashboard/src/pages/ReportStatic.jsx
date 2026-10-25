// 정적 모드의 온체인 리포트 카드 (서버 없음).
//   증명 카드: 상태 A(Sepolia 기록 있음)면 UID·txHash·EAS 탐색기와 브라우저 온체인 조회, 상태 B면 "온체인 기록 대기 중" 안내만.
//              상태 B에서는 Sepolia라는 표현이나 UID를 보여 주지 않는다.
//   무결성 검증 카드: 배포된 리포트 파일을 브라우저에서 해시해 envelope의 해시와 비교(온체인 검증이 아님). 변조 시연도 브라우저 메모리 사본으로.
import { useMemo, useState } from "react";
import { ExternalLink, Info, LoaderCircle, SearchCheck, ShieldCheck } from "lucide-react";
import { useApp } from "../state/AppContext.jsx";
import { useAttest } from "../state/AttestContext.jsx";
import { Badge, Card, ICON, StatusView } from "../components/ui.jsx";
import { CopyValue, TamperPanel, VerifyResult } from "../components/AttestParts.jsx";
import { PHASE_LABELS, tamperPresets, verifyView } from "../lib/attest.js";
import { CONFIGURED_RPC, integrityResult, onchainResult, verifyIntegrity, verifyOnchain } from "../lib/verifyBrowser.js";
import { fmtDateTime } from "../lib/format.js";

const SERVER_ONLY = "증명 기록(서버 키로 서명)과 서버 검증은 로컬 서버 모드에서 사용 가능합니다.";

export function StaticProofCard({ scenario, data, canonical }) {
  const { glossary } = useApp();
  const { phaseOf, attestationOf, setVerifyEntry } = useAttest();
  const phase = phaseOf(scenario);
  const att = attestationOf(scenario);
  const [lookup, setLookup] = useState({ status: "idle", result: null });

  const runLookup = async () => {
    if (lookup.status === "running") return;
    setLookup({ status: "running", result: null });
    let r;
    try {
      r = await verifyOnchain(att.uid, { report: data.report, envelope: data.envelope, timeseries: data.timeseries, attestation: att, canonical });
    } catch {
      r = { status: "lookup_failed", reason: "network", message: "조회 실패: 온체인 조회 모듈을 불러오지 못했습니다." };
    }
    setLookup({ status: "done", result: r });
    if (r.status === "match" || r.status === "mismatch") setVerifyEntry(scenario, { status: "done", kind: "onchain", result: onchainResult(r) });
  };

  const view = lookup.result && (lookup.result.status === "match" || lookup.result.status === "mismatch")
    ? verifyView(onchainResult(lookup.result), glossary, { kind: "onchain" }) : null;

  return (
    <Card title="온체인 증명" aside={phase ? <Badge tone={phase === "attested" ? "primary" : "neutral"}>{PHASE_LABELS[phase]}</Badge> : null}>
      {phase === "checking" && <StatusView kind="loading" title="증명 정보를 확인하는 중입니다" />}

      {phase === "pending_onchain" && (
        <div className="notice notice-sm">
          <Info {...ICON} size={16} />
          <span>
            <strong>온체인 기록 대기 중</strong> — 이 데모 리포트는 아직 온체인에 기록되지 않았습니다.
            아래 "리포트 무결성 검증"으로 배포된 리포트 파일이 변조되지 않았는지 확인할 수 있습니다.
          </span>
        </div>
      )}

      {phase === "attested" && att && (
        <>
          <ul className="rows rows-static">
            <li className="row"><span className="row-title">UID</span><span className="row-value"><CopyValue value={att.uid} /></span></li>
            <li className="row"><span className="row-title">트랜잭션 해시</span><span className="row-value"><CopyValue value={att.txHash} /></span></li>
            <li className="row"><span className="row-title">체인</span><span className="row-value num">Sepolia ({att.chainId})</span></li>
            <li className="row"><span className="row-title">기록자 주소</span><span className="row-value"><CopyValue value={att.attester} /></span></li>
            <li className="row"><span className="row-title">EAS 컨트랙트</span><span className="row-value"><CopyValue value={att.contract} /></span></li>
            {att.recordedAt && <li className="row"><span className="row-title">기록 시각</span><span className="row-value num">{fmtDateTime(att.recordedAt)}</span></li>}
            {att.blockNumber !== null && <li className="row"><span className="row-title">블록 번호</span><span className="row-value num">{att.blockNumber}</span></li>}
          </ul>
          {att.matchesSnapshotReport === false && (
            <p className="small backend-note text-caution">이 기록의 리포트 해시가 배포된 리포트와 다릅니다(기록 뒤 fixture가 바뀜). 온체인 조회는 불일치로 나옵니다.</p>
          )}
          <div className="explorer-links">
            <a className="link" href={att.explorerBase} target="_blank" rel="noreferrer">EAS Explorer 열기 <ExternalLink {...ICON} size={14} /></a>
            <span className="muted small">기록 화면 경로는 확인되지 않아 직접 링크하지 않습니다. 탐색기에서 위 UID로 검색하세요.</span>
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={!CONFIGURED_RPC || lookup.status === "running"} onClick={runLookup}>
              {lookup.status === "running" ? <LoaderCircle {...ICON} size={16} className="spin" /> : <SearchCheck {...ICON} size={16} />}
              {lookup.status === "running" ? "조회 중" : "온체인 조회"}
            </button>
          </div>
          {!CONFIGURED_RPC && <p className="muted small hint">RPC 미설정: 빌드할 때 VITE_SEPOLIA_RPC(읽기 전용 공개 RPC)를 지정하면 온체인 조회를 할 수 있습니다.</p>}
          {lookup.result?.status === "lookup_failed" && <StatusView kind="error" title="조회 불가" detail={lookup.result.message} />}
          {view && <VerifyResult view={view} />}
        </>
      )}
      <p className="muted small hint">{SERVER_ONLY}</p>
    </Card>
  );
}

export function StaticIntegrityCard({ scenario, data, canonical }) {
  const { glossary } = useApp();
  const { phaseOf, setVerifyEntry } = useAttest();
  const [state, setState] = useState({ status: "idle", result: null, tamper: null, error: null });
  const presets = useMemo(() => tamperPresets(data.report, glossary), [data.report, glossary]);
  const running = state.status === "running";
  const attested = phaseOf(scenario) === "attested";

  const run = async (tamper = null) => {
    if (running) return;
    setState(s => ({ ...s, status: "running", tamper, error: null }));
    try {
      const r = await verifyIntegrity({ report: data.report, envelope: data.envelope, canonical }, { tamper });
      const result = integrityResult(r);
      setState({ status: "done", result, tamper, error: null });
      setVerifyEntry(scenario, { status: "done", kind: "integrity", result });
    } catch (err) {
      setState({ status: "error", result: null, tamper, error: err.message });
    }
  };

  const view = state.status === "done" ? verifyView(state.result, glossary, { kind: "integrity", attested }) : null;

  return (
    <Card title="리포트 무결성 검증" aside={view ? <Badge tone={view.tone}>{view.label}</Badge> : null}>
      <p className="muted">
        온체인 검증이 아닙니다. 배포된 리포트 파일을 브라우저에서 같은 규칙으로 다시 직렬화해 SHA-256을 계산하고,
        분석 시점에 envelope에 적어 둔 해시와 비교해 파일이 바뀌지 않았는지 확인합니다.
      </p>
      <div className="btn-row">
        <button type="button" className="btn btn-primary" disabled={running} onClick={() => run(null)}>
          {running && !state.tamper ? <LoaderCircle {...ICON} size={16} className="spin" /> : <ShieldCheck {...ICON} size={16} />}
          {running && !state.tamper ? "계산 중" : "리포트 무결성 검증"}
        </button>
      </div>
      <TamperPanel presets={presets} canRun={!running} runningPath={running ? state.tamper?.path : null} onRun={p => run({ path: p.path, value: p.value })}
        note="아래 항목 하나를 바꾼 리포트 사본으로 무결성 검증을 다시 실행합니다. 사본은 브라우저 메모리에서만 쓰고 버리며, 배포된 파일과 서버는 건드리지 않습니다." />
      {state.status === "error" && <StatusView kind="error" title="무결성 검증을 실행하지 못했습니다" detail={state.error} />}
      {view && <VerifyResult view={view} tamper={state.tamper} disabled={running} onRestore={() => run(null)} />}
    </Card>
  );
}
