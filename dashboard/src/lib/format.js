// 표시용 포맷 함수 (순수)

export function shortAddr(addr) {
  if (!addr) return "";
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function shortHash(hash, n = 8) {
  return hash ? hash.slice(0, n) : "";
}

// 긴 16진 값(UID·해시·주소)의 앞뒤만
export function shortMiddle(value, head = 10, tail = 8) {
  if (!value) return "";
  const s = String(value);
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

export function fmtNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

export function fmtEth(value, digits = 2) {
  const s = fmtNumber(value, digits);
  return s === "-" ? s : `${s} ETH`;
}

export function fmtTime(ms) {
  if (!ms) return "-";
  const d = new Date(ms);
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 날짜와 시각 (브라우저 지역 시간). value: ms 또는 ISO 문자열
export function fmtDateTime(value) {
  if (value === null || value === undefined || value === "") return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
