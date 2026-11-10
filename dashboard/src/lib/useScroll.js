// 히어로 스크롤 연출용 훅. 새 라이브러리 없이 IntersectionObserver + passive scroll 리스너 + requestAnimationFrame.
// 스크롤을 가로채거나 스냅하지 않는다. 계산은 lib/hero.js(progressOf)에 있다.
import { useEffect, useState } from "react";
import { progressOf } from "./hero.js";

// 미디어 쿼리 일치 여부 (예: prefers-reduced-motion, 좁은 화면)
export function useMedia(query) {
  const get = () => { try { return window.matchMedia(query).matches; } catch { return false; } };
  const [on, setOn] = useState(get);
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia(query); } catch { return undefined; }
    const f = () => setOn(mq.matches);
    mq.addEventListener?.("change", f);
    return () => mq.removeEventListener?.("change", f);
  }, [query]);
  return on;
}

// 고정 장면의 진행도(0~1). 화면에 들어왔을 때만 스크롤마다 한 프레임에 한 번 계산한다. enabled가 false면 1(최종 상태).
export function useScrollProgress(ref, enabled) {
  const [p, setP] = useState(enabled ? 0 : 1);
  useEffect(() => {
    if (!enabled) { setP(1); return undefined; }
    const el = ref.current;
    if (!el) return undefined;
    let raf = 0, visible = false;
    const measure = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      setP(progressOf(r.top, r.height, window.innerHeight));
    };
    const onScroll = () => { if (visible && !raf) raf = requestAnimationFrame(measure); };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) onScroll(); }, { threshold: 0 });
    io.observe(el);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    measure();
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, enabled]);
  return p;
}

// 한 번이라도 화면에 들어왔는지 (페이드인용). enabled가 false면 처음부터 true.
export function useSeen(ref, enabled, rootMargin = "0px 0px -12% 0px") {
  const [seen, setSeen] = useState(!enabled);
  useEffect(() => {
    if (!enabled) { setSeen(true); return undefined; }
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, enabled, rootMargin]);
  return seen;
}
