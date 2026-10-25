// 공통 UI 조각: 카드, 배지, 용어 팝오버, 상태 화면, 접는 영역, 세그먼트.
import { useState } from "react";
import { ChevronDown, ChevronRight, CircleAlert, LoaderCircle, Unplug } from "lucide-react";
import { useApp } from "../state/AppContext.jsx";
import { term, TONE_LABELS } from "../lib/terms.js";

export const ICON = { size: 18, strokeWidth: 1.75 };

export function Card({ title, aside, children, className = "", pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || aside) && (
        <header className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {aside && <div className="card-aside">{aside}</div>}
        </header>
      )}
      <div className={pad ? "card-body" : ""}>{children}</div>
    </section>
  );
}

// tone: danger | caution | safe | primary | neutral
export function Badge({ tone = "neutral", children, title }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

export function ToneBadge({ tone }) {
  return <Badge tone={tone}>{TONE_LABELS[tone] ?? tone}</Badge>;
}

export function EstimateTag({ children = "추정" }) {
  return <span className="estimate">{children}</span>;
}

// 용어: 화면에는 한글 라벨, 원래 이름과 설명은 팝오버로
export function Term({ id, children }) {
  const { glossary } = useApp();
  const t = term(glossary, id);
  return (
    <span className="term" tabIndex={0}>
      {children ?? t.label}
      <span className="term-pop" role="tooltip">
        <span className="term-pop-title">{t.label}</span>
        {t.id !== t.label && <code className="term-pop-id">{t.id}</code>}
        {t.desc && <span className="term-pop-desc">{t.desc}</span>}
      </span>
    </span>
  );
}

// 로딩·서버 꺼짐·분석 실패·데이터 없음을 같은 모양으로
export function StatusView({ kind, title, detail }) {
  const Icon = kind === "loading" ? LoaderCircle : kind === "down" ? Unplug : CircleAlert;
  return (
    <div className={`status-view status-${kind}`}>
      <Icon {...ICON} size={22} className={kind === "loading" ? "spin" : ""} />
      <div className="status-title">{title}</div>
      {detail && <div className="status-detail">{detail}</div>}
    </div>
  );
}

// 페이지 공통: 현재 리포트가 준비됐을 때만 children(data)를 그린다
export function ReportGate({ children }) {
  const { current, health, job } = useApp();
  if (current.data && current.status !== "error") return children(current.data);
  if (health.state === "down") {
    return <StatusView kind="down" title="시연 API 서버에 연결할 수 없습니다"
      detail="WSL에서 npm run demo:server를 실행한 뒤 새로고침하세요." />;
  }
  if (current.status === "error") {
    return <StatusView kind="error" title="리포트를 불러오지 못했습니다" detail={current.error?.message} />;
  }
  if (job?.status === "error") {
    return <StatusView kind="error" title="분석이 실패했습니다" detail={job.error} />;
  }
  return <StatusView kind="loading" title="리포트를 불러오는 중입니다" />;
}

export function Collapsible({ title, summary, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <section className="card collapsible">
      <button type="button" className="collapsible-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Icon {...ICON} />
        <span className="card-title">{title}</span>
        {summary && <span className="collapsible-summary">{summary}</span>}
      </button>
      {open && <div className="card-body">{children}</div>}
    </section>
  );
}

// 탭과 세그먼트는 이 하나의 스타일로 통일한다
export function Segmented({ options, value, onChange, size = "md" }) {
  return (
    <div className={`segmented segmented-${size}`} role="tablist">
      {options.map(o => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value}
          className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)} disabled={o.disabled}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone, emphasis }) {
  return (
    <div className={`stat ${emphasis ? "stat-emphasis" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ? `text-${tone}` : ""}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <ul className="legend">
      {items.map(i => (
        <li key={i.key}>
          <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">{i.swatch}</svg>
          <span>{i.label}</span>
        </li>
      ))}
    </ul>
  );
}
