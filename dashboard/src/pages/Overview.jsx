// 개요: 결론 먼저. 종합 등급(overall_grade)은 어디에도 표시하지 않는다.
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useApp } from "../state/AppContext.jsx";
import { Badge, Card, Collapsible, EstimateTag, ICON, ReportGate, Stat, Term, ToneBadge } from "../components/ui.jsx";
import { SourceBadge } from "../components/SidePanel.jsx";
import { OnchainBadge } from "../components/Onchain.jsx";
import { CHAIN_SHORT_NAMES } from "../lib/attest.js";
import { useAttest } from "../state/AttestContext.jsx";
import { matrixCells, RISK_LABELS } from "../lib/combination.js";
import { pagePath, term } from "../lib/terms.js";
import { shortHash } from "../lib/format.js";

export default function Overview() {
  return <ReportGate>{data => <OverviewBody data={data} />}</ReportGate>;
}

function OverviewBody({ data }) {
  const { view, envelope } = data;
  return (
    <div className="page">
      <SummaryStrip view={view} envelope={envelope} />
      <Headline view={view} />
      <div className="grid-2">
        <CombinationMatrix combination={view.combination} />
        <KeyNumbers view={view} />
      </div>
      <PatternsAndWarnings view={view} />
    </div>
  );
}

function SummaryStrip({ view, envelope }) {
  const { scenarios, current } = useApp();
  const { currentPhase, verifyOf, backendId } = useAttest();
  const navigate = useNavigate();
  const { search } = useLocation();
  const scenario = scenarios.find(s => s.id === view.scenario);
  const onset = view.phase.onset;
  return (
    <div className="strip">
      <div className="strip-item"><span className="strip-label">시나리오</span><span className="strip-value">{scenario?.label ?? view.scenario}</span></div>
      <div className="strip-item">
        <span className="strip-label">감지된 유형</span>
        <span className="strip-value"><Term id={view.patterns.fraudTypeHint}>{view.patterns.fraudTypeLabel}</Term> <EstimateTag /></span>
      </div>
      <div className="strip-item">
        <span className="strip-label">발현 추정 시점</span>
        <span className="strip-value num">{onset ? <>블록 {onset.block} <EstimateTag /></> : "해당 없음"}</span>
      </div>
      <div className="strip-item"><span className="strip-label">데이터</span><span className="strip-value"><SourceBadge source={envelope.source} /></span></div>
      <button type="button" className="strip-item strip-link" onClick={() => navigate(`${pagePath("report")}${search}`)}
        title="온체인 리포트에서 기록·검증 보기">
        <span className="strip-label">온체인{CHAIN_SHORT_NAMES[backendId] && backendId !== "local" ? ` (${CHAIN_SHORT_NAMES[backendId]})` : ""} <ChevronRight {...ICON} size={13} /></span>
        <span className="strip-value"><OnchainBadge phase={currentPhase} verifyEntry={verifyOf(current.reportId)} backend={backendId} /></span>
      </button>
      <div className="strip-item">
        <span className="strip-label">리포트 해시</span>
        <code className="strip-value mono" title={envelope.report_sha256}>{shortHash(envelope.report_sha256)}</code>
      </div>
    </div>
  );
}

function Headline({ view }) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const h = view.headline;
  return (
    <Card className={`headline headline-${h.tone}`}>
      <div className="headline-top">
        <ToneBadge tone={h.tone} />
        <EstimateTag>휴리스틱 판정</EstimateTag>
      </div>
      <p className="headline-text">{h.text}</p>
      <ul className="rows reasons">
        {h.reasons.map((r, i) => (
          <li key={`${r.label}-${i}`}>
            <button type="button" className="row" onClick={() => navigate(`${pagePath(r.page)}${search}`)}>
              <span className="row-title">{r.label}</span>
              <span className="row-desc row-desc-inline">{r.detail}</span>
              <ChevronRight {...ICON} size={16} className="row-chevron" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CombinationMatrix({ combination }) {
  const cells = matrixCells(combination);
  return (
    <Card title="코드 위험 × 지갑 위험" aside={<Badge tone="neutral">{combination.criteriaNote}</Badge>}>
      <div className="matrix">
        <div className="matrix-y">
          <span>지갑 위험 높음</span>
          <span>지갑 위험 낮음</span>
        </div>
        <div className="matrix-grid">
          {cells.flat().map(c => (
            <div key={c.key} className={`matrix-cell ${c.active ? "on" : ""}`}>
              <span className="matrix-cell-label">{c.label}</span>
              {c.active && <span className="matrix-dot" title="선택한 컨트랙트"><span />선택한 컨트랙트</span>}
            </div>
          ))}
        </div>
        <div className="matrix-x">
          <span>코드 위험 낮음</span>
          <span>코드 위험 높음</span>
        </div>
      </div>
      <div className="matrix-result">
        <span className="matrix-result-label">
          코드 {RISK_LABELS[combination.codeRisk]} · 지갑 {RISK_LABELS[combination.walletRisk]}
        </span>
        <strong>{combination.label}</strong>
      </div>
      <ul className="basis">
        {combination.basis.map(b => <li key={b}>{b}</li>)}
      </ul>
    </Card>
  );
}

function KeyNumbers({ view }) {
  const { glossary } = useApp();
  const code = view.codeAssessment, w = view.walletAssessment;
  const differs = w.lowestDiffersFromOverall;
  return (
    <Card title="핵심 수치">
      <div className="stats-2x2">
        <Stat label={<Term id="prevention_risk_level">코드 위험 수준</Term>}
          value={<Term id={code.preventionRiskLevel}>{term(glossary, code.preventionRiskLevel).label}</Term>}
          sub={`예방 분석 점수 ${code.preventionRiskScore ?? "-"}`} />
        <Stat label={<Term id="trust_grade">지갑 평균 등급</Term>} value={w.trustGrade} sub={`신뢰 점수 ${w.trustScore}`} />
        <Stat label={<Term id="lowest_wallet_grade">최저 지갑 등급</Term>} value={w.lowestWallet?.grade ?? "-"}
          tone={differs ? "danger" : undefined} emphasis={differs}
          sub={differs ? <span className="text-danger">평균({w.trustGrade})과 다름 · {w.lowestWallet.trustScore}점</span> : `${w.lowestWallet?.trustScore ?? "-"}점`} />
        <Stat label={<><Term id="drainer">전액 인출 지갑</Term> / <Term id="extractor">과도 수익 지갑</Term></>}
          value={<span className="num">{w.drainerCount} / {w.extractorCount}</span>}
          sub={`지갑 ${w.walletCount}개 중`} />
      </div>
    </Card>
  );
}

function PatternsAndWarnings({ view }) {
  const p = view.patterns;
  const detectedWarnings = view.warnings.filter(w => w.detected);
  return (
    <Collapsible title="감지된 패턴과 경고"
      summary={`신호 ${p.signals.length}개 · 경고 ${detectedWarnings.length ? `${detectedWarnings.length}건` : "이상 없음"}`}>
      <div className="grid-2 grid-tight">
        <div>
          <h3 className="sub-title">이상 신호 <EstimateTag>휴리스틱</EstimateTag></h3>
          {p.signals.length === 0 ? <p className="muted">감지된 신호 없음</p> : (
            <ul className="rows rows-static">
              {p.signals.map(s => (
                <li key={s.id} className="row">
                  <span className="row-title"><Term id={s.id} /></span>
                  <span className="row-value num">{s.weight} / {s.weightMax}</span>
                </li>
              ))}
            </ul>
          )}
          <ul className="rows rows-static">
            <li className="row">
              <span className="row-title"><Term id="evasion_subclass">회피 패턴</Term></span>
              <span className="row-value">{p.evasion.detected ? <Term id={p.evasion.subclass} /> : "이상 없음"}</span>
            </li>
            <li className="row">
              <span className="row-title"><Term id="INFLOW_STOP" /></span>
              <span className="row-value">{p.inflowStop.detected ? `감지 (블록 ${p.inflowStop.lastDepositBlock} 이후)` : "이상 없음"}</span>
            </li>
          </ul>
        </div>
        <div>
          <h3 className="sub-title">경고</h3>
          <ul className="rows rows-static">
            {view.warnings.map((w, i) => (
              <li key={`${w.source}-${i}`} className={`row ${w.detected ? "row-alert" : ""}`}>
                <span className="row-title">{WARNING_LABELS[w.source] ?? w.source}</span>
                <span className="row-value">{w.detected ? <Badge tone="caution">감지</Badge> : "이상 없음"}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Collapsible>
  );
}

const WARNING_LABELS = {
  "dynamic.withdraw_block_warning":    "출금 차단 경고 (거래)",
  "prevention.withdraw_block_warning": "출금 차단 경고 (코드)",
  "prevention.code_pattern_warnings":  "코드 패턴 경고",
  "dynamic.fraud_type_hint":           "유형 미확정 경고 (거래)",
  "prevention.classification":         "유형 미확정 경고 (코드)"
};
