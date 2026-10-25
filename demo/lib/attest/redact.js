// 로그·오류·API 응답에 키나 RPC 주소가 나가지 않게 가린다.
// secrets에 준 문자열(키, RPC URL 등)은 그대로 지우고, 남은 URL은 모두 <rpc>로 바꾼다.
export function redact(text, secrets = []) {
  let s = String(text ?? "");
  for (const secret of secrets) {
    if (secret) s = s.split(String(secret)).join("<redacted>");
  }
  return s.replace(/\b(?:https?|wss?):\/\/[^\s"'<>)]+/gi, "<rpc>");
}
