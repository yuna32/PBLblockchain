// CSS 변수(tokens.css)를 SVG 차트 라이브러리 속성에 넘길 때 실제 색 값으로 읽는다.
const cache = new Map();

export function cssVar(name, fallback = "#888") {
  if (cache.has(name)) return cache.get(name);
  let value = "";
  try {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch {
    value = "";
  }
  const out = value || fallback;
  if (value) cache.set(name, out);
  return out;
}
