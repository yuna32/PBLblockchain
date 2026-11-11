// 배포자 위험도(/trust): 이 컨트랙트를 배포한 지갑의 이력. 거래 패턴 판정과는 별개의 분석이다.
// 시연 시나리오 5개는 시뮬레이션 배포자라 이력이 없어 "데이터 없음"(lib/risk.js riskForScenario).
// 예전 신뢰 시트(지갑 신뢰 점수·A~F 등급)는 이 화면에서 뺐다.
// #/trust?preview=strong|some|none|nodata|partial(+loading|error-missing|error-format)은 화면 틀 확인용 예시(lib/riskFixtures.js).
// 미리보기는 어떤 화면·링크에서도 연결하지 않으며, 실제 코드 점검 결과와 섞지 않는다.
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useApp } from "../state/AppContext.jsx";
import { ReportGate } from "../components/ui.jsx";
import { DeployerRiskView } from "../components/RiskParts.jsx";
import { codeConclusion, codeLines } from "../lib/overview.js";
import { riskForScenario } from "../lib/risk.js";
import { PREVIEW_KEYS, previewRisk } from "../lib/riskFixtures.js";
import { term } from "../lib/terms.js";

function PageHead() {
  return (
    <header className="page-head">
      <h1 className="page-title">배포자 위험도</h1>
      <p className="page-desc">이 컨트랙트를 배포한 지갑의 이력을 봅니다. 거래 패턴 판정과는 별개의 분석입니다.</p>
    </header>
  );
}

export default function Deployer() {
  const { search } = useLocation();
  const preview = new URLSearchParams(search).get("preview");
  if (PREVIEW_KEYS.includes(preview)) {
    return (
      <div className="page deployer" data-preview={preview}>
        <PageHead />
        <DeployerRiskView risk={previewRisk(preview)} code={null} preview />
      </div>
    );
  }
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
      <PageHead />
      <DeployerRiskView risk={risk} code={{ conclusion: codeC, ...codeText }} />
    </div>
  );
}
