// 오른쪽 패널: 예시 컨트랙트(시나리오) 목록·분석 실행, 이번 세션의 실행 기록.
// 결론 배지는 지금 열린(선택된) 예시에만 붙인다.
import { useLocation, useNavigate } from "react-router-dom";
import { Check, CircleDashed, LoaderCircle, Minus, Play, X } from "lucide-react";
import { useApp } from "../state/AppContext.jsx";
import { useAttest } from "../state/AttestContext.jsx";
import { STATIC_MODE } from "../mode.js";
import { stageSteps } from "../lib/flow.js";
import { OnchainMark } from "./Onchain.jsx";
import { fmtTime, shortHash } from "../lib/format.js";
import { Badge, ICON, StatusView } from "./ui.jsx";
import ConclusionBadge from "./ConclusionBadge.jsx";
import { conclusionOf } from "../lib/conclusion.js";

const STAGE_ICON = { done: Check, running: LoaderCircle, error: X, skipped: Minus };

export function SourceBadge({ source, reason }) {
  if (!source) return null;
  if (source === "live") return <Badge tone="primary" title="이번 요청에서 시뮬레이션을 실제로 실행한 결과">실시간</Badge>;
  return <Badge tone="neutral" title={reason ? `사전 생성본으로 폴백: ${reason}` : "미리 만들어 둔 사전 생성본"}>사전 생성본{reason ? " (폴백)" : ""}</Badge>;
}

export function ScenarioPanel() {
  const { scenarios, selected, selectScenario, current, useFixture, setUseFixture, analyze, job, health } = useApp();
  const openView = current.data?.view ?? null;
  const { scenarioMarks, backendId } = useAttest();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const running = job && (job.status === "queued" || job.status === "running");

  const pick = id => {
    selectScenario(id);
    navigate(`${pathname}?scenario=${id}`, { replace: true });
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">예시 컨트랙트</h2>
        <span className="panel-sub">{STATIC_MODE ? "고르면 미리 분석해 둔 결과를 보여 줍니다" : "시뮬레이션할 거래 유형을 고르세요"}</span>
      </div>
      {health.state === "down" && !scenarios.length ? (
        <StatusView kind="down" title="서버에 연결할 수 없습니다" detail="npm run demo:server" />
      ) : (
        <ul className="rows">
          {scenarios.map(s => {
            const isOpen = selected === s.id && openView?.scenario === s.id;
            return (
              <li key={s.id}>
                <button type="button" className={`row row-scenario ${selected === s.id ? "on" : ""}`} onClick={() => pick(s.id)}
                  aria-current={selected === s.id ? "true" : undefined}>
                  <span className="row-main">
                    <span className="row-title">{s.label}</span>
                    <span className="row-desc">{s.description}</span>
                    <OnchainMark mark={scenarioMarks[s.id]} backend={backendId} />
                  </span>
                  {isOpen && (
                    <span className="row-badges">
                      <ConclusionBadge conclusion={conclusionOf(openView)} title="이 예시의 결론 (휴리스틱 판정)" />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {STATIC_MODE ? (
        <div className="panel-foot">
          <p className="muted small static-note">
            시연판입니다. 실제 주소 분석은 로컬 서버 모드에서 사용할 수 있습니다.
          </p>
        </div>
      ) : (
      <div className="panel-foot">
        <label className="switch">
          <input type="checkbox" checked={useFixture} onChange={e => setUseFixture(e.target.checked)} />
          <span className="switch-track" aria-hidden="true" />
          <span>사전 생성본으로 보기</span>
        </label>
        <button type="button" className="btn btn-primary" disabled={!selected || running || health.state !== "up"}
          onClick={() => analyze(selected, useFixture ? "fixture" : "auto")}>
          <Play {...ICON} size={16} />
          {running ? "분석 중" : "분석 실행"}
        </button>
        <JobProgress job={job} />
      </div>
      )}
    </div>
  );
}

function JobProgress({ job }) {
  if (!job) return null;
  const steps = stageSteps(job);
  return (
    <div className="job">
      <ol className="job-steps">
        {steps.map(s => {
          const Icon = STAGE_ICON[s.state] ?? CircleDashed;
          return (
            <li key={s.key} className={`job-step job-${s.state}`}>
              <Icon {...ICON} size={14} className={s.state === "running" ? "spin" : ""} />
              {s.label}
            </li>
          );
        })}
      </ol>
      <div className="job-meta">
        <SourceBadge source={job.source} reason={job.fallbackReason} />
        {job.status === "error" && <span className="text-danger">실패: {job.error}</span>}
      </div>
    </div>
  );
}

export function HistoryPanel() {
  const { history, openReport, selectScenario, scenarios, current } = useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const labelOf = id => scenarios.find(s => s.id === id)?.label ?? id;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">실행 기록</h2>
        <span className="panel-sub">이번 세션에서 실행한 분석</span>
      </div>
      {history.length === 0 ? (
        <StatusView kind="empty" title="아직 실행한 분석이 없습니다" />
      ) : (
        <ul className="rows">
          {history.map(e => (
            <li key={e.jobId}>
              <button type="button" className={`row ${current.reportId === e.jobId ? "on" : ""}`} disabled={e.status !== "done"}
                onClick={() => {
                  selectScenario(e.scenario);
                  navigate(`${pathname}?scenario=${e.scenario}`, { replace: true });
                  openReport(e.jobId);
                }}>
                <span className="row-main">
                  <span className="row-title">{labelOf(e.scenario)}</span>
                  <span className="row-desc num">{fmtTime(e.startedAt)} · {e.mode === "fixture" ? "사전 생성본 모드" : "실시간 모드"}</span>
                </span>
                <span className="row-end">
                  {e.status === "done" ? <SourceBadge source={e.source} reason={e.fallbackReason} /> : <Badge tone={e.status === "error" ? "danger" : "neutral"}>{e.status === "error" ? "실패" : "진행 중"}</Badge>}
                  <code className="row-hash">{shortHash(e.hash)}</code>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
