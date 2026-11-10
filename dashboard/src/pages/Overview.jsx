// 개요: 판정 카드(헤드라인·근거·결론 배지) | 위험 단계·확인 권고 + 요약 박스 → "이렇게 판단했습니다" 3카드 → 상세 분석 접이식 줄.
// 문구·숫자는 view.decision. 종합 등급(overall_grade)은 어디에도 표시하지 않는다.
// 예전 분석 수치 블록(요약 띠·매트릭스·핵심 수치·패턴·경고)은 components/AnalysisNumbers.jsx에 보존했다(S7에서 원자료로 옮김).
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ArrowLeftRight, ChevronDown, ChevronRight, FileCode, UserSearch } from "lucide-react";
import { api } from "../api/client.js";
import { useApp } from "../state/AppContext.jsx";
import { ICON, ReportGate } from "../components/ui.jsx";
import BalanceStory from "../components/BalanceStory.jsx";
import { HeadlineCard, JudgeCard, RiskActionCard, SummaryBox } from "../components/OverviewParts.jsx";
import { verifyIntegrity } from "../lib/verifyBrowser.js";
import { buildBlockSeries } from "../lib/series.js";
import { codeConclusion, codeLines, flowLine, integrityStatus, startIntegrityCheck } from "../lib/overview.js";
import { DETAIL_PAGES, pagePath, term } from "../lib/terms.js";

export default function Overview() {
  return <ReportGate>{data => <OverviewBody key={data.envelope.report_sha256 + data.view.scenario} data={data} />}</ReportGate>;
}

// 리포트 변조 확인: 배포된 리포트를 브라우저에서 다시 해시해 분석 시점 해시(envelope)와 비교 (리포트 변조 확인 화면과 같은 함수)
// 시나리오가 바뀌면(OverviewBody가 key로 새로 만들어지거나 deps가 바뀌면) 이전 검사는 취소되어 결과가 반영되지 않는다.
function useIntegrity(data, reportId) {
  const [state, setState] = useState({ status: "checking" });
  useEffect(() => startIntegrityCheck({
    snapshot: { report: data.report, envelope: data.envelope },
    loadCanonical: () => api.canonical(reportId),
    verify: verifyIntegrity,
    onState: setState
  }), [data, reportId]);
  return integrityStatus(state);
}

function OverviewBody({ data }) {
  const { view, timeseries } = data;
  const decision = view.decision;
  const { current, selected, glossary } = useApp();
  const { search } = useLocation();
  const query = selected ? `?scenario=${selected}` : search;
  const integrity = useIntegrity(data, current.reportId);
  const points = useMemo(() => buildBlockSeries(timeseries).points, [timeseries]);
  const [codeNotice, setCodeNotice] = useState(false);

  const code = view.codeAssessment;
  const codeC = codeConclusion(code, view.warnings);
  const codeText = codeLines(code, codeC, term(glossary, code.preventionRiskLevel).label);

  return (
    <div className="page overview">
      <div className="overview-top">
        <HeadlineCard decision={decision} />
        <div className="overview-side">
          <RiskActionCard conclusion={decision.conclusion} />
          <SummaryBox summary={decision.copy.summary} integrity={integrity}
            reportAction={<Link className="summary-link" to={`${pagePath("report")}${query}`} aria-label="리포트 변조 확인 화면으로"><ChevronRight {...ICON} size={15} /></Link>} />
        </div>
      </div>

      <h2 className="section-title">이렇게 판단했습니다</h2>
      <div className="judge-grid">
        <JudgeCard icon={ArrowLeftRight} title="돈의 흐름" conclusion={decision.conclusion} text={flowLine(decision)}
          action={<Link className="link" to={`${pagePath("trade")}${query}`}>거래 분석 보기 <ChevronRight {...ICON} size={15} /></Link>}>
          <BalanceStory points={points} decision={decision} cursor={points.at(-1)?.block ?? 0} mini />
        </JudgeCard>
        <JudgeCard icon={FileCode} title="코드" conclusion={codeC} text={codeText.text} sub={codeText.sub}
          action={
            <>
              <button type="button" className="link-btn" onClick={() => setCodeNotice(true)} aria-describedby="code-notice">
                코드 점검 보기 <ChevronRight {...ICON} size={15} />
              </button>
              {codeNotice && <p id="code-notice" className="judge-notice" role="status">코드 점검 화면은 준비 중입니다.</p>}
            </>
          } />
        <JudgeCard icon={UserSearch} title="만든 사람" badgeText="데이터 없음"
          text="시뮬레이션이라 배포자 이력이 없습니다"
          sub="실제 주소를 분석할 때 배포자의 이력을 보여 줄 자리입니다." />
      </div>

      <DetailLinks query={query} />
    </div>
  );
}

function DetailLinks({ query }) {
  const [open, setOpen] = useState(false);
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <section className="card collapsible detail-links">
      <button type="button" className="collapsible-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Icon {...ICON} />
        <span className="card-title">상세 분석</span>
        <span className="collapsible-summary">{DETAIL_PAGES.map(p => p.label).join(", ")}</span>
      </button>
      {open && (
        <ul className="detail-link-list">
          {DETAIL_PAGES.map(p => (
            <li key={p.key}>
              <NavLink to={`${p.path}${query}`} className="detail-link">{p.label} <ChevronRight {...ICON} size={15} /></NavLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
