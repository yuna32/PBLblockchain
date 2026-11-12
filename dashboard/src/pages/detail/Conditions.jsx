// 상세 분석 > 판정 조건 (상세 분석 기본 화면): "{유형}로 판정된 이유" 질문 사슬 | 다른 유형이 아닌 이유,
// 아래로 판정 경로만 보인 축약 그래프, 리포트 변조 확인 띠. 모두 view.decision에서 온다.
import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useApp } from "../../state/AppContext.jsx";
import { useIntegrity } from "../../state/useIntegrity.js";
import { Card, ICON, ReportGate } from "../../components/ui.jsx";
import { ChainCard, DecisionGraph, GraphLegend, IntegrityBand, WhyNotCard } from "../../components/ConditionsParts.jsx";
import { RugVsPonzi } from "../../components/RugAxisParts.jsx";
import { pagePath } from "../../lib/terms.js";

export default function Conditions() {
  return <ReportGate>{data => <ConditionsBody key={data.envelope.report_sha256 + data.view.scenario} data={data} />}</ReportGate>;
}

function ConditionsBody({ data }) {
  const decision = data.view.decision;
  const { current, selected } = useApp();
  const { search } = useLocation();
  const query = selected ? `?scenario=${selected}` : search;
  const integrity = useIntegrity(data, current.reportId);
  const nodeCount = data.ontology?.nodes?.length ?? null;
  return (
    <div className="page conditions">
      <div className="conditions-top">
        <ChainCard decision={decision} />
        <WhyNotCard decision={decision} />
      </div>
      {decision.rugpull && (
        <Card title="러그풀과 폰지가 갈리는 지점" aside={<span className="muted small">이 예시의 값</span>}>
          <RugVsPonzi decision={decision} />
        </Card>
      )}
      <section className="card">
        <header className="card-head">
          <h2 className="card-title">추론 그래프 · 판정 경로만 표시</h2>
          <Link className="link small" to={`${pagePath("ontology")}${query}`}>
            전체 그래프 보기{nodeCount !== null ? ` (노드 ${nodeCount}개)` : ""} <ChevronRight {...ICON} size={15} />
          </Link>
        </header>
        <div className="card-body">
          <DecisionGraph decision={decision} />
          <GraphLegend />
        </div>
      </section>
      <IntegrityBand integrity={integrity} link={<Link className="link-inline" to={`${pagePath("report")}${query}`}>리포트 변조 확인</Link>} />
    </div>
  );
}
