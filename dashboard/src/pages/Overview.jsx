// 개요: 판정 카드(헤드라인·근거·결론 배지) | 위험 단계·확인 권고 + 요약 박스 → "이렇게 판단했습니다" 3카드 → 상세 분석 접이식 줄.
// 문구·숫자는 view.decision. 종합 등급(overall_grade)은 어디에도 표시하지 않는다.
// 예전 분석 수치 블록(요약 띠·매트릭스·핵심 수치·패턴·경고)은 components/AnalysisNumbers.jsx에 보존했다(S7에서 원자료로 옮김).
import { useMemo, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ArrowLeftRight, ChevronDown, ChevronRight, FileCode, UserSearch } from "lucide-react";
import { useApp } from "../state/AppContext.jsx";
import { useIntegrity } from "../state/useIntegrity.js";
import { ICON, ReportGate } from "../components/ui.jsx";
import BalanceStory from "../components/BalanceStory.jsx";
import { HeadlineCard, JudgeCard, RiskActionCard, SummaryBox } from "../components/OverviewParts.jsx";
import { buildBlockSeries } from "../lib/series.js";
import { codeConclusion, codeLines, flowLine } from "../lib/overview.js";
import { DETAIL_PAGES, pagePath, term } from "../lib/terms.js";
import { deployerCard, deployerPath, riskForScenario } from "../lib/risk.js";
import { RiskBadge } from "../components/RiskParts.jsx";

export default function Overview() {
  return <ReportGate>{data => <OverviewBody key={data.envelope.report_sha256 + data.view.scenario} data={data} />}</ReportGate>;
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
  // 배포자 수준은 riskForScenario 한 곳에서만 읽는다(실제 데이터가 연결되면 그 함수만 바뀐다)
  const deployer = useMemo(() => deployerCard(riskForScenario(view, timeseries)), [view, timeseries]);

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
        <JudgeCard icon={UserSearch} title="배포자"
          badge={deployer.level ? <RiskBadge level={deployer.level} /> : null}
          text={deployer.text} sub={deployer.sub}
          action={<Link className="link" to={deployerPath(selected ?? view.scenario)}>배포자 위험도 보기 <ChevronRight {...ICON} size={15} /></Link>} />
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
