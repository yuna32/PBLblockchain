// 로그·오류·API 응답·스크립트 출력에 키나 RPC 주소가 나가지 않게 가린다.
// secrets에 준 문자열(키, RPC URL 등)은 변형(0x 유무, 대소문자, URL의 호스트·경로)까지 지우고, 남은 URL은 모두 <rpc>로 바꾼다.

// 비밀 값 하나에서 가려야 할 문자열 목록
export function secretVariants(secret) {
  if (!secret) return [];
  const s = String(secret);
  const out = new Set([s]);
  const hex = s.replace(/^0x/i, "");
  if (/^[0-9a-fA-F]{32,}$/.test(hex)) {
    for (const h of [hex, hex.toLowerCase(), hex.toUpperCase()]) {
      out.add(h);
      out.add(`0x${h}`);
    }
  }
  try {
    const u = new URL(s);
    if (u.host) out.add(u.host);
    if (u.pathname && u.pathname.length > 1) out.add(u.pathname.replace(/^\//, ""));
    if (u.search) out.add(u.search.replace(/^\?/, ""));
    if (u.username) out.add(u.username);
    if (u.password) out.add(u.password);
    out.add(s.replace(/\/$/, ""));
  } catch {
    // URL이 아님
  }
  // 긴 것부터 지워야 부분 문자열이 먼저 지워져 긴 값이 남는 일이 없다
  return [...out].filter(v => v.length >= 4).sort((a, b) => b.length - a.length);
}

export function redact(text, secrets = []) {
  let s = String(text ?? "");
  const all = secrets.flatMap(secretVariants).sort((a, b) => b.length - a.length);
  for (const v of all) s = s.split(v).join("<redacted>");
  return s.replace(/\b(?:https?|wss?):\/\/[^\s"'<>)]+/gi, "<rpc>");
}
