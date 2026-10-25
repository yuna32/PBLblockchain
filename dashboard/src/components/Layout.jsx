// 화면 틀: 상단 메뉴바 + 진행 표시 + 가운데 콘텐츠 + 오른쪽 목록 패널(접기) + 아이콘 레일.
import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Check, CircleDashed, History, LayoutList, LoaderCircle, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { useApp } from "../state/AppContext.jsx";
import { flowSteps } from "../lib/flow.js";
import { PAGES } from "../lib/terms.js";
import { ScenarioPanel, HistoryPanel } from "./SidePanel.jsx";
import { Badge, ICON } from "./ui.jsx";

export default function Layout({ children }) {
  const { current } = useApp();
  const [panel, setPanel] = useState("scenarios");
  const [open, setOpen] = useState(true);
  const toggle = key => {
    if (open && panel === key) setOpen(false);
    else { setPanel(key); setOpen(true); }
  };
  return (
    <div className={`app ${open ? "" : "panel-closed"}`}>
      <TopBar />
      <FlowSteps />
      <main className="main" data-scenario={current.data?.view.scenario ?? ""} data-status={current.status}>{children}</main>
      {open && (
        <aside className="side-panel">
          {panel === "scenarios" ? <ScenarioPanel /> : <HistoryPanel />}
        </aside>
      )}
      <nav className="rail" aria-label="오른쪽 패널">
        <RailButton icon={LayoutList} label="시나리오" active={open && panel === "scenarios"} onClick={() => toggle("scenarios")} />
        <RailButton icon={History} label="실행 기록" active={open && panel === "history"} onClick={() => toggle("history")} />
        <div className="rail-spacer" />
        <RailButton icon={open ? PanelRightClose : PanelRightOpen} label={open ? "접기" : "펼치기"} onClick={() => setOpen(o => !o)} />
      </nav>
    </div>
  );
}

function RailButton({ icon: Icon, label, active, onClick }) {
  return (
    <button type="button" className={`rail-btn ${active ? "on" : ""}`} onClick={onClick} aria-pressed={!!active}>
      <Icon {...ICON} size={20} />
      <span>{label}</span>
    </button>
  );
}

function TopBar() {
  const { health, selected } = useApp();
  const { search } = useLocation();
  const query = selected ? `?scenario=${selected}` : search;
  const up = health.state === "up";
  const tip = health.state === "checking" ? "서버 확인 중"
    : up ? `시연 API 연결됨 · ${health.data.hardhatUsable ? "hardhat 사용 가능 (실시간 시뮬레이션)" : "hardhat 사용 불가 (사전 생성본으로 폴백)"}`
    : "시연 API 연결 끊김";
  return (
    <header className="topbar">
      <div className="brand">사기 탐지 시연</div>
      <nav className="topnav">
        {PAGES.map(p => (
          <NavLink key={p.key} to={`${p.path}${query}`} className={({ isActive }) => (isActive ? "on" : "")}>
            {p.label}
          </NavLink>
        ))}
      </nav>
      <div className="topbar-right">
        <Badge tone="neutral" title="실제 블록체인 데이터가 아니라 로컬 hardhat 시뮬레이션으로 만든 거래입니다">시뮬레이션 데이터</Badge>
        <span className={`conn conn-${health.state}`} title={tip} aria-label={tip}>
          <span className="conn-dot" />
          {up ? "연결됨" : health.state === "checking" ? "확인 중" : "끊김"}
        </span>
      </div>
    </header>
  );
}

const STEP_ICON = { done: Check, running: LoaderCircle, error: X };

function FlowSteps() {
  const { selected, job, current } = useApp();
  const steps = flowSteps({ scenario: selected, job, hasReport: Boolean(current.data) });
  return (
    <ol className="flow">
      {steps.map((s, i) => {
        const Icon = STEP_ICON[s.state] ?? CircleDashed;
        return (
          <li key={s.key} className={`flow-step flow-${s.state}`}>
            <span className="flow-icon"><Icon {...ICON} size={14} className={s.state === "running" ? "spin" : ""} /></span>
            <span className="flow-label">{s.label}</span>
            <span className="flow-sub">{s.sub}</span>
            {i < steps.length - 1 && <span className="flow-line" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
