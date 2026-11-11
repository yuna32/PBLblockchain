// 배포자 위험도(/trust): 이 컨트랙트를 배포한 지갑의 이력. 거래 패턴 판정과는 별개의 분석이다.
// 시연 시나리오 5개는 시뮬레이션 배포자라 이력이 없어 "데이터 없음"(lib/risk.js riskForScenario).
// 예전 신뢰 시트(지갑 신뢰 점수·A~F 등급)는 이 화면에서 뺐다.
import { useMemo } from "react";
import { useApp } from "../state/AppContext.jsx";
import { ReportGate } from "../components/ui.jsx";
import { DeployerRiskView } from "../components/RiskParts.jsx";
import { codeConclusion, codeLines } from "../lib/overview.js";
import { riskForScenario } from "../lib/risk.js";
import { term } from "../lib/terms.js";

export default function Deployer() {
  return <ReportGate>{data => <DeployerBody key={data.envelope.report_sha256 + data.view.scenario} data={data} />}</ReportGate>;
}

function DeployerBody({ data }) {
  const { view, timeseries } = data;
  const { glossary } = useApp();
  const risk = useMemo(() => riskForScenario(view, timeseries), [view, timeseries]);
  const codeC = codeConclusion(view.codeAssessment, view.warnings);
  const codeText = codeLines(view.codeAssessment, codeC, term(glossary, view.codeAssessment?.preventionRiskLevel).label);
  return (
    <div className="page deployer">
      <header className="page-head">
        <h1 className="page-title">배포자 위험도</h1>
        <p className="page-desc">이 컨트랙트를 배포한 지갑의 이력을 봅니다. 거래 패턴 판정과는 별개의 분석입니다.</p>
      </header>
      <DeployerRiskView risk={risk} code={{ conclusion: codeC, ...codeText }} />
    </div>
  );
}
