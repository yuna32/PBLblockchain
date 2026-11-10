// 히어로(첫 화면, 진행 바·오른쪽 패널 없음): ① 첫 화면 → ② 세 가지 확인 → 결론은 하나로 → ③ 5단계 → ④ 사기 네 가지 → ⑤ 예방·완화·대응 + CTA.
// 스크롤 연출: ②·③은 position: sticky 장면이고 진행도(lib/useScroll.js)에 따라 transform·opacity만 바꾼다. 스크롤을 가로채지 않는다.
// prefers-reduced-motion이면 연출 없이 모든 장면을 최종 상태로 쌓고, 720px 미만이면 ②·③을 세로로 쌓아 페이드인만 한다.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftRight, Check, FileCode, Search, UserSearch } from "lucide-react";
import { api } from "../api/client.js";
import { STATIC_MODE } from "../mode.js";
import { Badge, ICON } from "../components/ui.jsx";
import ConclusionBadge from "../components/ConclusionBadge.jsx";
import FraudArt from "../components/HeroArt.jsx";
import { CONCLUSIONS, CONCLUSION_ORDER } from "../lib/conclusion.js";
import { activeStep, ADDRESS_NOTICE, CHECK_CARDS, checkScene, FRAUD_CARDS, HERO_EXAMPLE_SCENARIO, HERO_EXAMPLES, heroSteps, VALUE_LINES } from "../lib/hero.js";
import { useMedia, useScrollProgress, useSeen } from "../lib/useScroll.js";

const CHECK_ICONS = { flow: ArrowLeftRight, code: FileCode, creator: UserSearch };

// ③ 예시 숫자용 러그풀 decision. 정적 모드에서만 스냅샷을 읽는다(서버 모드는 스냅샷 파일을 서빙하지 않아 숫자 없는 문구).
function useExampleDecision() {
  const [decision, setDecision] = useState(null);
  useEffect(() => {
    if (!STATIC_MODE) return undefined;
    let alive = true;
    api.report(HERO_EXAMPLE_SCENARIO)
      .then(b => alive && setDecision(b?.view?.decision ?? null))
      .catch(() => alive && setDecision(null));
    return () => { alive = false; };
  }, []);
  return decision;
}

export default function Hero() {
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const narrow = useMedia("(max-width: 719px)");
  const pinned = !reduced && !narrow;   // 고정 장면 연출
  const fade = !reduced;                // 페이드인
  const inputRef = useRef(null);
  const decision = useExampleDecision();
  return (
    <div className={`hero ${pinned ? "hero-pinned" : "hero-flat"} ${fade ? "hero-fade" : "hero-static"}`}>
      <HeroIntro inputRef={inputRef} />
      <CheckScene pinned={pinned} fade={fade} />
      <StepsScene pinned={pinned} fade={fade} steps={heroSteps(decision)} />
      <FraudScene fade={fade} />
      <ValueScene fade={fade} reduced={reduced} inputRef={inputRef} />
      <footer className="hero-footer">결과는 휴리스틱 분석이며 사기 여부를 확정하지 않습니다. 투자 판단의 근거로 쓰지 마세요.</footer>
    </div>
  );
}

// ① 첫 화면: 주소 입력(시연판은 안내만) + 예시 버튼 5개
function HeroIntro({ inputRef }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState(false);
  const submit = e => {
    e.preventDefault();
    if (!value.trim()) { setNotice(false); inputRef.current?.focus(); return; }
    setNotice(true);
  };
  return (
    <section className="hero-intro" aria-labelledby="hero-title">
      <h1 id="hero-title" className="hero-title">이 컨트랙트에 돈을 넣어도 될까요?</h1>
      <p className="hero-sub">거래 기록으로 사기 여부를 판정하고, 왜 그렇게 판단했는지 근거까지 보여줍니다</p>
      <form className="hero-form" onSubmit={submit} role="search">
        <label className="hero-input">
          <Search {...ICON} size={20} aria-hidden="true" />
          <span className="sr-only">컨트랙트 주소</span>
          <input ref={inputRef} type="text" inputMode="text" autoComplete="off" spellCheck="false"
            placeholder="0x로 시작하는 컨트랙트 주소" value={value}
            onChange={e => { setValue(e.target.value); setNotice(false); }}
            aria-describedby={notice ? "hero-notice" : undefined} />
        </label>
        <button type="submit" className="btn btn-primary hero-submit">확인하기</button>
      </form>
      <p id="hero-notice" className={`hero-notice ${notice ? "on" : ""}`} role="status" aria-live="polite">{notice ? ADDRESS_NOTICE : ""}</p>
      <p className="hero-examples-label">시연판에서는 예시 컨트랙트로 볼 수 있습니다</p>
      <div className="hero-examples">
        {HERO_EXAMPLES.map(x => (
          <button key={x.id} type="button" className="hero-chip" onClick={() => navigate(`/overview?scenario=${x.id}`)}>{x.label}</button>
        ))}
      </div>
    </section>
  );
}

// 페이드인 조각 (fade가 꺼져 있으면 처음부터 보임)
function Reveal({ fade, delay = 0, className = "", children, as: Tag = "div" }) {
  const ref = useRef(null);
  const seen = useSeen(ref, fade);
  return <Tag ref={ref} className={`reveal ${seen ? "in" : ""} ${className}`} style={fade ? { transitionDelay: `${delay}ms` } : undefined}>{children}</Tag>;
}

// ② 세 가지를 확인합니다 → 결론은 하나로 나옵니다
function CheckScene({ pinned, fade }) {
  const ref = useRef(null);
  const p = useScrollProgress(ref, pinned);
  const { shown, gathered } = checkScene(pinned ? p : 1);
  const body = (
    <div className={`check ${gathered ? "gathered" : ""}`}>
      <div className="check-cards">
        <h2 className="hero-h2">세 가지를 확인합니다</h2>
        <div className="check-grid">
          {CHECK_CARDS.map((c, i) => {
            const Icon = CHECK_ICONS[c.key];
            const card = (
              <>
                <span className="check-icon" aria-hidden="true"><Icon {...ICON} size={20} /></span>
                <span className="check-text">
                  <strong>{c.title}</strong>
                  <span className="check-sub">{c.sub}</span>
                  <span className="check-desc">{c.desc}</span>
                </span>
              </>
            );
            return pinned
              ? <div key={c.key} className={`check-card ${shown[i] ? "in" : ""}`}>{card}</div>
              : <Reveal key={c.key} fade={fade} delay={i * 120} className="check-card">{card}</Reveal>;
          })}
        </div>
      </div>
      <ConclusionPanel visible={!pinned || gathered} fade={!pinned && fade} />
    </div>
  );
  if (!pinned) return <section className="hero-scene" aria-label="세 가지를 확인합니다">{body}</section>;
  return (
    <section ref={ref} className="hero-scene hero-track hero-track-check" aria-label="세 가지를 확인합니다" data-progress={p.toFixed(2)}>
      <div className="hero-sticky">{body}</div>
    </section>
  );
}

function ConclusionPanel({ visible, fade }) {
  const inner = (
    <>
      <h2 className="hero-h2">결론은 하나로 나옵니다</h2>
      <ul className="conclusion-list">
        {CONCLUSION_ORDER.map(k => (
          <li key={k}><ConclusionBadge conclusion={k} /><span>{CONCLUSIONS[k].desc}</span></li>
        ))}
      </ul>
    </>
  );
  if (fade) return <Reveal fade className="conclusion-panel">{inner}</Reveal>;
  return <div className={`conclusion-panel ${visible ? "in" : ""}`}>{inner}</div>;
}

// ③ 이렇게 판단합니다: 관측 → 신호 → 조건 → 유형 → 판정 (러그풀 예시)
function StepsScene({ pinned, fade, steps }) {
  const ref = useRef(null);
  const p = useScrollProgress(ref, pinned);
  const active = pinned ? activeStep(p, steps.length) : steps.length - 1;
  const body = (
    <div className="steps">
      <h2 className="hero-h2">이렇게 판단합니다 <span className="hero-h2-sub">러그풀 예시</span></h2>
      <ol className="steps-flow" aria-hidden="true">
        {steps.map((s, i) => (
          <li key={s.key} className={`steps-node ${i < active ? "done" : i === active ? "on" : ""}`}>
            <span className="steps-node-dot">{i < active ? <Check {...ICON} size={14} /> : s.no}</span>
            <span className="steps-node-label">{s.label}</span>
          </li>
        ))}
      </ol>
      <ol className="steps-list">
        {steps.map((s, i) => {
          const state = !pinned ? "done" : i < active ? "done" : i === active ? "on" : "";
          const item = (
            <>
              <span className="steps-no" aria-hidden="true">{s.no}</span>
              <span className="steps-body">
                <strong>{s.label} · {s.title}</strong>
                <span className="steps-desc">{s.desc}</span>
                <span className="steps-example">{s.example}</span>
              </span>
            </>
          );
          return pinned
            ? <li key={s.key} className={`steps-item ${state}`} aria-current={i === active ? "step" : undefined}>{item}</li>
            : <Reveal key={s.key} as="li" fade={fade} delay={i * 80} className="steps-item done">{item}</Reveal>;
        })}
      </ol>
    </div>
  );
  if (!pinned) return <section className="hero-scene" aria-label="이렇게 판단합니다">{body}</section>;
  return (
    <section ref={ref} className="hero-scene hero-track hero-track-steps" aria-label="이렇게 판단합니다" data-progress={p.toFixed(2)} data-step={active + 1}>
      <div className="hero-sticky">{body}</div>
    </section>
  );
}

// ④ 찾아내는 사기 네 가지
function FraudScene({ fade }) {
  return (
    <section className="hero-scene hero-frauds" aria-labelledby="hero-frauds-title">
      <h2 id="hero-frauds-title" className="hero-h2">찾아내는 사기 네 가지</h2>
      <div className="fraud-grid">
        {FRAUD_CARDS.map((c, i) => (
          <Reveal key={c.key} fade={fade} delay={i * 120} className="fraud-card">
            <span className="fraud-art"><FraudArt kind={c.key} /></span>
            <strong className="fraud-title">{c.title} <span className="fraud-nick">{c.nick}</span></strong>
            <span className="fraud-desc">{c.desc}</span>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ⑤ 예방·완화·대응 + CTA (맨 위로 스크롤하고 입력창에 포커스)
function ValueScene({ fade, reduced, inputRef }) {
  const toTop = () => {
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    inputRef.current?.focus({ preventScroll: true });
  };
  return (
    <section className="hero-scene hero-values" aria-labelledby="hero-values-title">
      <h2 id="hero-values-title" className="hero-h2">이렇게 쓸 수 있습니다</h2>
      <ul className="value-list">
        {VALUE_LINES.map((v, i) => (
          <Reveal key={v.key} as="li" fade={fade} delay={i * 100} className="value-line">
            <strong className="value-title">{v.title}{v.badge && <Badge tone="neutral">{v.badge}</Badge>}</strong>
            <span>{v.text}</span>
          </Reveal>
        ))}
      </ul>
      <button type="button" className="btn btn-primary hero-cta" onClick={toTop}>주소 입력하러 가기</button>
    </section>
  );
}
