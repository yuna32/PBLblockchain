// 배포자 위험도 화면 조각. 상태(Context)를 쓰지 않는 순수 컴포넌트라 테스트에서 그대로 렌더링한다.
// risk는 lib/risk.js의 정규화된 모양. 수준·점수·근거는 risk에 있는 값만 쓰고 화면에서 계산하지 않는다.
import { useState } from "react";
import { Check, CircleAlert, Copy, Info, LoaderCircle } from "lucide-react";
import { CONCLUSIONS } from "../lib/conclusion.js";
import {
  FUNDING_CATEGORIES, INDICATOR_STATUS, PREVIEW_BANNER, PUBLIC_LABELS, RISK_COPY, RISK_ERROR_COPY, RISK_LEVELS,
  RISK_LOADING_COPY, STRENGTH_LABELS, indicatorRatio, levelBasis, partialScore, riskSummary, scoreText, scoreValue
} from "../lib/risk.js";
import { shortAddr } from "../lib/format.js";
import ConclusionBadge from "./ConclusionBadge.jsx";
import { Badge, Card, EstimateTag, ICON } from "./ui.jsx";

const levelOf = risk => RISK_LEVELS[risk?.level] ?? RISK_LEVELS.nodata;

export function RiskBadge({ level }) {
  const l = RISK_LEVELS[level] ?? RISK_LEVELS.nodata;
  return <Badge tone={l.tone}>{l.label}</Badge>;
}

function AddressCopy({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="muted">—</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const Icon = copied ? Check : Copy;
  return (
    <span className="risk-addr">
      <code className="mono">{value}</code>
      <button type="button" className="icon-btn risk-copy" onClick={copy} aria-label={copied ? "복사됨" : "주소 복사"} title={copied ? "복사됨" : "주소 복사"}>
        <Icon {...ICON} size={15} />
      </button>
    </span>
  );
}

// 미리보기 배너 (미리보기 주소로 열었을 때만, pages/Deployer.jsx)
export function PreviewBanner() {
  return (
    <p className="risk-preview-banner" role="note">
      <Info {...ICON} size={16} aria-hidden="true" />{PREVIEW_BANNER}
    </p>
  );
}

// 로딩·오류일 때의 판정 카드
function RiskStatusCard({ risk }) {
  const loading = risk.status === "loading";
  const Icon = loading ? LoaderCircle : CircleAlert;
  return (
    <section className="card verdict risk-verdict" data-state={loading ? "loading" : `error-${risk.error?.kind}`}>
      <div className="risk-status">
        <Icon {...ICON} size={22} className={loading ? "spin" : ""} aria-hidden="true" />
        <div>
          <p className="risk-status-title">{loading ? RISK_LOADING_COPY : RISK_ERROR_COPY[risk.error?.kind] ?? RISK_ERROR_COPY.format}</p>
          {!loading && risk.error?.detail && <p className="risk-status-detail">사유: {risk.error.detail}</p>}
        </div>
      </div>
    </section>
  );
}

// 판정 카드: 수준 배지 · 한 줄 요약 · 수준을 정한 근거 · 대상 주소 · 점수(부분 합계 표시)
export function RiskVerdictCard({ risk }) {
  if (risk.status !== "ready") return <RiskStatusCard risk={risk} />;
  const l = levelOf(risk);
  const basis = levelBasis(risk);
  const partial = partialScore(risk);
  return (
    <section className={`card verdict risk-verdict verdict-${l.tone}`} data-level={risk.level}>
      <div className="verdict-top">
        <RiskBadge level={risk.level} />
        <EstimateTag>휴리스틱</EstimateTag>
      </div>
      <p className="risk-summary">{riskSummary(risk)}</p>
      {basis && (
        <p className="risk-basis">
          <span className="risk-basis-label">수준을 정한 근거</span>
          <Badge tone={basis.strength === "strong" ? "danger" : "caution"}>{STRENGTH_LABELS[basis.strength] ?? "근거"}</Badge>
          <span>{basis.text}</span>
        </p>
      )}
      <dl className="risk-target">
        <div>
          <dt>{risk.target?.simulated ? RISK_COPY.simulatedDeployer : "배포자"}</dt>
          <dd><AddressCopy value={risk.target?.deployer} /></dd>
        </div>
        <div>
          <dt>컨트랙트</dt>
          <dd><AddressCopy value={risk.target?.contract} /></dd>
        </div>
      </dl>
      <div className="risk-score">
        <span className="risk-score-label">점수</span>
        <span className="risk-score-text" aria-label={scoreText(risk)}>
          <strong className="risk-score-value num">{scoreValue(risk)}</strong>
          <span className="risk-score-unit"> · {RISK_COPY.scoreUnit}</span>
        </span>
        {partial && <Badge tone="neutral">부분 합계</Badge>}
      </div>
      {partial && <p className="risk-score-note risk-partial-note">{partial.note}</p>}
      <p className="risk-score-note">{RISK_COPY.scoreNote}</p>
    </section>
  );
}

const pointsText = ind => (ind.status === "nodata" || typeof ind.points !== "number"
  ? "—"
  : typeof ind.cap === "number" ? `${ind.points} / ${ind.cap}` : `${ind.points}`);

// 근거 목록: 지표 5개(상태 · 점수/상한 막대) 아래에 그 지표의 근거 문장
export function EvidenceList({ risk }) {
  const evidence = risk.evidence ?? [];
  return (
    <Card title="근거" aside={<span className="muted small">지표 {risk.indicators.length}개</span>}>
      <ul className="risk-inds">
        {risk.indicators.map(ind => {
          const st = INDICATOR_STATUS[ind.status] ?? INDICATOR_STATUS.nodata;
          const ratio = indicatorRatio(ind);
          const items = evidence.filter(e => e.indicatorKey === ind.key);
          return (
            <li key={ind.key} className={`risk-ind risk-ind-${ind.status}`} data-indicator={ind.key} data-status={ind.status}>
              <div className="risk-ind-head">
                <span className="risk-ind-name">
                  {ind.extension && <span className="risk-ext">확장</span>}
                  {ind.label}
                </span>
                <Badge tone={st.tone}>{st.label}</Badge>
                <span className="risk-ind-points num">{pointsText(ind)}</span>
              </div>
              {ratio !== null && (
                <div className={`risk-cap risk-cap-${st.tone}`} role="presentation"><span style={{ width: `${ratio * 100}%` }} /></div>
              )}
              {items.length > 0 && (
                <ul className="risk-evs">
                  {items.map((e, i) => (
                    <li key={i} className="risk-ev">
                      <Badge tone={e.strength === "strong" ? "danger" : "caution"}>{STRENGTH_LABELS[e.strength] ?? "근거"}</Badge>
                      <span className="risk-ev-text">{e.text}</span>
                      {typeof e.points === "number" && <span className="risk-ev-points num">+{e.points}</span>}
                      {e.source && <span className="risk-ev-source">출처: {e.source}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function FundArrow({ empty }) {
  return (
    <svg className={`flow-arrow risk-fund-arrow ${empty ? "flow-arrow-muted" : ""}`} viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="12" x2="88" y2="12" strokeWidth={2} strokeDasharray={empty ? "4 4" : undefined} />
      <path d="M86 5 L98 12 L86 19" strokeWidth={2} fill="none" />
    </svg>
  );
}

// 첫 자금 흐름: 자금원(분류) → (중간 지갑) → 배포자. 데이터가 없으면 점선 틀과 안내 한 줄.
export function FundingDiagram({ risk }) {
  const f = risk.firstFunding ?? {};
  const empty = !f.category;
  const hops = f.hops === 2 ? 2 : 1;
  const danger = f.category === "malicious" || f.category === "mixer";
  const nodes = [
    { key: "src", label: empty ? "자금원" : FUNDING_CATEGORIES[f.category] ?? "기타", sub: empty ? "분류 —" : "첫 자금원", kind: danger ? "danger" : "source" },
    ...(hops === 2 ? [{ key: "mid", label: "중간 지갑", sub: null, kind: "mid" }] : []),
    { key: "dep", label: "배포자", sub: risk.target?.simulated ? "시뮬레이션(추정)" : null, kind: "deployer" }
  ];
  return (
    <Card title="첫 자금 흐름" aside={!empty ? <span className="muted small num">{hops}홉</span> : null}>
      <div className={`risk-fund ${empty ? "risk-fund-empty" : ""}`} data-category={f.category ?? "none"}
        role="img" aria-label={empty ? RISK_COPY.noFunding : `첫 자금: ${nodes.map(n => n.label).join(" → ")}`}>
        {nodes.map((n, i) => (
          <div key={n.key} className="risk-fund-step">
            {i > 0 && <FundArrow empty={empty} />}
            <span className={`risk-fund-node risk-fund-${n.kind}`}>
              <strong>{n.label}</strong>
              {n.sub && <span>{n.sub}</span>}
            </span>
          </div>
        ))}
      </div>
      {empty && <p className="risk-empty">{RISK_COPY.noFunding}</p>}
    </Card>
  );
}

const verdictLabel = v => (CONCLUSIONS[v]?.label ?? "미분석");

// 과거 배포 목록: 공개 라벨과 그 컨트랙트의 거래 판정(기존 결론 배지)을 다른 열로. null(가져오지 않음)과 0건을 구분한다.
export function PastDeployments({ risk }) {
  const rows = risk.pastDeployments;
  return (
    <Card title="과거 배포" aside={Array.isArray(rows) ? <span className="muted small num">{rows.length}건</span> : null} pad={Array.isArray(rows) && rows.length > 0 ? false : true}>
      {!Array.isArray(rows) && <p className="risk-empty">{RISK_COPY.noPast}</p>}
      {Array.isArray(rows) && rows.length === 0 && <p className="risk-empty">{RISK_COPY.zeroPast}</p>}
      {Array.isArray(rows) && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table risk-table">
            <thead>
              <tr><th>컨트랙트</th><th>배포일</th><th>공개 라벨</th><th>이 컨트랙트의 거래 판정</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.contract}-${i}`}>
                  <td><code className="mono" title={r.contract ?? ""}>{r.contract ? shortAddr(r.contract) : "—"}</code></td>
                  <td className="num">{r.deployedAt ?? "—"}</td>
                  <td>{PUBLIC_LABELS[r.publicLabel] ?? "없음"}</td>
                  <td>{r.ourVerdict && CONCLUSIONS[r.ourVerdict] ? <ConclusionBadge conclusion={r.ourVerdict} /> : verdictLabel(r.ourVerdict)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const dash = v => (v === null || v === undefined || v === "" ? "—" : v);

// 확인 범위: 활동 일수 · 거래 수 · 기준 시점 · 수집 실패 · 출처, 평가하지 않은 이유와 배포자 가정
export function ScopeCard({ risk }) {
  const s = risk.scope ?? {};
  const failures = s.failures ?? [], sources = s.sources ?? [];
  return (
    <Card title="확인 범위" className="risk-scope">
      <dl className="risk-scope-list">
        <div><dt>활동 일수</dt><dd className="num">{typeof s.activityDays === "number" ? `${s.activityDays}일` : "—"}</dd></div>
        <div><dt>거래 수</dt><dd className="num">{typeof s.txCount === "number" ? `${s.txCount}건` : "—"}</dd></div>
        <div><dt>분석 기준 시점</dt><dd className="num">{dash(s.asOf)}</dd></div>
        <div><dt>수집 실패 항목</dt><dd>{failures.length ? failures.join(", ") : "—"}</dd></div>
        <div><dt>출처</dt><dd>{sources.length ? sources.join(", ") : "—"}</dd></div>
      </dl>
      {s.reason && <p className="risk-reason">{s.reason}</p>}
      {s.assumption && <p className="risk-assume">{s.assumption}</p>}
    </Card>
  );
}

// 코드 위험과 배포자 위험을 나란히(평균 내거나 합치지 않음) + 결합 결과 자리
//   code = { conclusion, text, sub } (lib/overview.js codeConclusion·codeLines). 미리보기에서는 null(실제 결과와 섞지 않는다).
const PREVIEW_CODE_TEXT = "미리보기에서는 코드 점검 결과를 함께 보여 주지 않습니다";
function deployerSide(risk) {
  if (risk.status === "loading") return { badge: <Badge tone="neutral">불러오는 중</Badge>, text: RISK_LOADING_COPY };
  if (risk.status === "error") return { badge: <RiskBadge level="nodata" />, text: RISK_ERROR_COPY[risk.error?.kind] ?? RISK_ERROR_COPY.format };
  return { badge: <RiskBadge level={risk.level} />, text: riskSummary(risk) };
}

export function CodeVsDeployer({ risk, code }) {
  const dep = deployerSide(risk);
  return (
    <Card title="코드와 배포자는 따로 봅니다">
      <div className="risk-pair">
        <div className="risk-pair-item" data-side="code">
          <div className="risk-pair-head"><span className="risk-pair-title">코드</span>{code && <ConclusionBadge conclusion={code.conclusion} title="배포 전 코드 점검 결과" />}</div>
          <p className={`risk-pair-text ${code ? "" : "muted"}`}>{code ? code.text : PREVIEW_CODE_TEXT}</p>
          {code?.sub && <p className="risk-pair-sub">{code.sub}</p>}
        </div>
        <div className="risk-pair-item" data-side="deployer">
          <div className="risk-pair-head"><span className="risk-pair-title">배포자 위험도</span>{dep.badge}</div>
          <p className="risk-pair-text">{dep.text}</p>
        </div>
      </div>
      <div className="risk-combo">
        <span className="risk-combo-label">결합 결과</span>
        <strong>{RISK_COPY.combinationTitle}</strong>
        <p>{RISK_COPY.combinationText}</p>
      </div>
    </Card>
  );
}

// 거래 패턴 판정과의 구분 + 면책 (항상 표시)
export function RiskNotes() {
  return (
    <section className="risk-notes">
      <p className="threshold-note">{RISK_COPY.distinction}</p>
      <p className="disclaimer">{RISK_COPY.disclaimer}</p>
    </section>
  );
}

// 화면 본문 전체 (페이지와 테스트가 같이 쓴다). preview면 맨 위에 예시 배너.
// 로딩·오류면 판정 카드(상태 안내), 코드·배포자 나란히, 면책만 보여 준다.
export function DeployerRiskView({ risk, code, preview = false }) {
  if (risk.status !== "ready") {
    return (
      <>
        {preview && <PreviewBanner />}
        <RiskVerdictCard risk={risk} />
        <CodeVsDeployer risk={risk} code={code} />
        <RiskNotes />
      </>
    );
  }
  return (
    <>
      {preview && <PreviewBanner />}
      <div className="risk-top">
        <RiskVerdictCard risk={risk} />
        <ScopeCard risk={risk} />
      </div>
      <div className="risk-mid">
        <EvidenceList risk={risk} />
        <FundingDiagram risk={risk} />
      </div>
      <PastDeployments risk={risk} />
      <CodeVsDeployer risk={risk} code={code} />
      <RiskNotes />
    </>
  );
}
