// 개요 화면 조각. 상태(Context)를 쓰지 않는 순수 컴포넌트라 테스트에서 그대로 렌더링한다.
import { Check, CircleAlert, CircleDot, LoaderCircle, TriangleAlert } from "lucide-react";
import { CONCLUSIONS } from "../lib/conclusion.js";
import { ACTION_TITLE, CONCLUSION_GUIDE, LADDER, typeTag } from "../lib/overview.js";
import ConclusionBadge from "./ConclusionBadge.jsx";
import { Badge, EstimateTag, ICON } from "./ui.jsx";

const TONE_OF = c => CONCLUSIONS[c]?.tone ?? "neutral";

// 판정 카드: 결론 배지 · 유형 · 휴리스틱 판정 태그 / 헤드라인 / 근거 3줄 (모두 view.decision)
export function HeadlineCard({ decision }) {
  const tag = typeTag(decision);
  return (
    <section className={`card verdict verdict-${TONE_OF(decision.conclusion)}`} data-conclusion={decision.conclusion}>
      <div className="verdict-top">
        <ConclusionBadge conclusion={decision.conclusion} />
        {tag && <span className="verdict-type">{tag}</span>}
        <EstimateTag>휴리스틱 판정</EstimateTag>
      </div>
      <h1 className="verdict-headline">{decision.copy.headline}</h1>
      <ul className="verdict-reasons">
        {decision.copy.reasons.map(r => (
          <li key={r}><CircleDot {...ICON} size={16} className="verdict-reason-icon" /><span>{r}</span></li>
        ))}
      </ul>
    </section>
  );
}

// 손바닥 선 그림 (인라인 SVG, 채움 없음)
function HandIcon() {
  return (
    <svg className="hand-icon" width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M11 17V7.5a1.75 1.75 0 0 1 3.5 0V15" />
      <path d="M14.5 14V5.5a1.75 1.75 0 0 1 3.5 0V14" />
      <path d="M18 14V6.5a1.75 1.75 0 0 1 3.5 0V15" />
      <path d="M21.5 15v-5a1.75 1.75 0 0 1 3.5 0v8.5c0 5-3.6 9-8.5 9h-1.2c-2.6 0-4.5-1.2-6-3.2L6 19.5a1.8 1.8 0 0 1 2.8-2.2L11 19.5" />
    </svg>
  );
}

// 위험 단계 사다리(근거 없음/주의/위험, 현재 단계 강조, 판단 불가는 전부 회색) + 확인 권고
export function RiskActionCard({ conclusion }) {
  const undetermined = !LADDER.includes(conclusion);
  return (
    <section className={`card action-card action-${TONE_OF(conclusion)}`} data-conclusion={conclusion}>
      <div className="ladder-title">위험 단계</div>
      <ol className="ladder" aria-label="위험 단계">
        {LADDER.map(key => {
          const on = key === conclusion;
          return (
            <li key={key} className={`ladder-step ${on ? `on ladder-${TONE_OF(key)}` : ""}`} aria-current={on ? "true" : undefined}>
              <span className="ladder-dot" aria-hidden="true" />
              {CONCLUSIONS[key].label}
            </li>
          );
        })}
      </ol>
      {undetermined && <p className="ladder-none">판단 불가: 어느 단계로도 정하지 않았습니다</p>}
      <hr className="action-divider" />
      <div className="action-body">
        <HandIcon />
        <div>
          <div className="action-title">{ACTION_TITLE}</div>
          <p className="action-guide">{CONCLUSION_GUIDE[conclusion] ?? CONCLUSION_GUIDE.undetermined}</p>
        </div>
      </div>
    </section>
  );
}

function IntegrityIcon({ k }) {
  const Icon = { same: Check, different: TriangleAlert, error: CircleAlert, checking: LoaderCircle }[k];
  return Icon ? <Icon {...ICON} size={15} className={k === "checking" ? "spin" : ""} aria-hidden="true" /> : null;
}

// 요약 박스: 이상이 처음 보인 때 · 분석한 거래 · 리포트 변조 확인. integrity: lib/overview.js integrityStatus()
export function SummaryBox({ summary, integrity, reportAction = null }) {
  return (
    <section className="card summary-box">
      <dl className="summary-list">
        <div><dt>이상이 처음 보인 때</dt><dd>{summary.firstAnomaly}</dd></div>
        <div><dt>분석한 거래</dt><dd>{summary.analyzed}</dd></div>
        <div>
          <dt>리포트 변조 확인</dt>
          <dd className={`integrity integrity-${integrity.key} text-${integrity.tone === "neutral" ? "muted" : integrity.tone}`} title={integrity.detail ?? undefined}>
            <IntegrityIcon k={integrity.key} />{integrity.text}{reportAction}
          </dd>
        </div>
      </dl>
    </section>
  );
}

// "이렇게 판단했습니다" 카드 하나
export function JudgeCard({ icon: Icon, title, conclusion, badgeText, text, sub, children, action }) {
  return (
    <section className="card judge-card" data-conclusion={conclusion ?? "none"}>
      <header className="judge-head">
        <span className="judge-title"><Icon {...ICON} size={18} />{title}</span>
        {badgeText ? <Badge tone="neutral">{badgeText}</Badge> : <ConclusionBadge conclusion={conclusion} />}
      </header>
      <p className="judge-text">{text}</p>
      {sub && <p className="judge-sub">{sub}</p>}
      {children}
      {action && <div className="judge-action">{action}</div>}
    </section>
  );
}
