// 온체인 리포트 화면의 공통 조각: 검증 결과, 변조 시연 목록, 복사 가능한 값. 서버 모드와 정적 모드가 같이 쓴다.
// 문구는 lib/attest.js verifyView의 kind(server | integrity | onchain)를 따른다.
import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, FlaskConical, LoaderCircle, RotateCcw } from "lucide-react";
import { Badge, EstimateTag, ICON, StatusView } from "./ui.jsx";
import { shortMiddle } from "../lib/format.js";

export function VerifyResult({ view, tamper, disabled, onRestore }) {
  const integrity = view.kind === "integrity";
  return (
    <div className="verify">
      {view.tamperDemo && (
        <div className="notice notice-caution">
          <FlaskConical {...ICON} size={18} />
          <div className="notice-text">
            <strong>시연용 · 저장되지 않음</strong>
            {view.tamperScope}의 리포트 사본에서 <code className="mono">{tamper?.path}</code> 값만 바꿔 검증한 결과입니다.
            {integrity ? " 배포된 리포트 파일은 그대로입니다." : " 리포트 파일과 온체인 기록은 그대로입니다."}
          </div>
          <button type="button" className="btn btn-secondary" disabled={disabled} onClick={onRestore}>
            <RotateCcw {...ICON} size={14} />원래대로 다시 검증
          </button>
        </div>
      )}
      <div className={`verify-head verify-${view.tone}`}>
        <Badge tone={view.tone}>{view.label}</Badge>
        <span>{view.summary}</span>
      </div>

      <div className="hash-compare">
        <div className="hash-compare-item">
          <span className="field-label">{view.hashLabels.recorded}</span>
          <code className="mono">{view.hash.onChain}</code>
        </div>
        <div className="hash-compare-mid">
          <Badge tone={view.hash.match ? "safe" : "danger"}>{view.hash.match ? "같음" : "다름"}</Badge>
        </div>
        <div className="hash-compare-item">
          <span className="field-label">{view.hashLabels.current}</span>
          <code className="mono">{view.hash.current}</code>
        </div>
      </div>

      {view.rows.length > 0 && (
        <>
          <table className="table table-static">
            <thead>
              <tr><th>항목</th><th>온체인 기록</th><th>현재 리포트</th><th className="r">결과</th></tr>
            </thead>
            <tbody>
              {view.rows.map(r => (
                <tr key={r.name} className={!r.match && !r.informational ? "row-mismatch" : ""}>
                  <td>{r.label} {r.informational && <EstimateTag>참고용</EstimateTag>}</td>
                  <td className={r.onChain.mono ? "mono" : "num"} title={r.onChain.full ?? undefined}>{r.onChain.text}</td>
                  <td className={r.current.mono ? "mono" : "num"} title={r.current.full ?? undefined}>{r.current.text}</td>
                  <td className="r">
                    {r.match ? <Badge tone="safe">일치</Badge> : r.informational ? <Badge tone="neutral">다름 · 참고용</Badge> : <Badge tone="danger">불일치</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {view.rows.some(r => r.informational) && (
            <p className="disclaimer">
              참고용 항목(스캔 시각, 분석기 버전)은 같은 리포트라도 분석을 다시 실행하거나 서버 버전이 바뀌면 달라질 수 있어, 달라도 검증 결과에 영향을 주지 않습니다.
              {view.informationalMismatch.length > 0 && ` 이번에는 ${view.informationalMismatch.join(", ")}이(가) 다르지만 결과는 그대로입니다.`}
            </p>
          )}
        </>
      )}

      {!view.hash.match && (
        <div className="changed">
          <h3 className="sub-title">{integrity ? "원본에서 바뀐 항목" : "기록 이후 바뀐 항목"}</h3>
          {view.changedPaths.length ? (
            <ul className="rows rows-static">
              {view.changedPaths.map(c => (
                <li key={c.path} className="row">
                  <code className="mono">{c.path}</code>
                  <span className="row-value">{c.label ?? <span className="muted small">용어집에 없음</span>}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">{view.snapshotAvailable ? "바뀐 경로를 찾지 못했습니다." : "기록 당시 스냅샷이 없어 바뀐 경로는 표시할 수 없습니다."}</p>}
        </div>
      )}
      {view.uid && <p className="muted small num">검증한 기록 UID <code className="mono">{shortMiddle(view.uid)}</code></p>}
    </div>
  );
}

// 변조 시연(기본 접힘). presets: lib/attest.js tamperPresets()
export function TamperPanel({ presets, canRun, runningPath, onRun, note, error }) {
  const [open, setOpen] = useState(false);
  const ToggleIcon = open ? ChevronDown : ChevronRight;
  return (
    <div className={`tamper ${open ? "open" : ""}`}>
      <button type="button" className="tamper-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <ToggleIcon {...ICON} size={16} />
        <FlaskConical {...ICON} size={16} />
        <span className="tamper-title">리포트를 일부러 바꿔서 검증해 보기</span>
        <span className="collapsible-summary">변조 시연 · 저장되지 않음</span>
      </button>
      {open && (
        <div className="tamper-body">
          <p className="muted small">{note}</p>
          {presets.length === 0 ? <p className="muted small">이 리포트에는 바꿔 볼 수 있는 항목이 없습니다.</p> : (
            <ul className="rows rows-static">
              {presets.map(p => (
                <li key={p.id} className="row">
                  <span className="row-main">
                    <span className="row-title">{p.label}</span>
                    <span className="row-desc"><code className="mono">{p.path}</code> · <span className="num">{p.fromText} → {p.toText}</span></span>
                  </span>
                  <button type="button" className="btn btn-secondary" disabled={!canRun} onClick={() => onRun(p)}>
                    {runningPath === p.path ? <LoaderCircle {...ICON} size={14} className="spin" /> : null}
                    바꿔서 검증
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <StatusView kind="error" {...error} />}
        </div>
      )}
    </div>
  );
}

// ── 복사 ──
function useCopy(value) {
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
  return [copied, copy];
}

export function CopyValue({ value, display }) {
  const [copied, copy] = useCopy(value);
  return (
    <span className="copy-value">
      <code className="mono" title={value}>{display ?? shortMiddle(value)}</code>
      <button type="button" className="icon-btn" onClick={copy} title="복사" aria-label="복사">
        <Copy {...ICON} size={14} />
      </button>
      {copied && <span className="muted small">복사됨</span>}
    </span>
  );
}

export function HashLine({ value, large }) {
  const [copied, copy] = useCopy(value);
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
