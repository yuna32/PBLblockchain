// 표시용 포맷 함수 (순수)

export function shortAddr(addr) {
  if (!addr) return "";
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function shortHash(hash, n = 8) {
  return hash ? hash.slice(0, n) : "";
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
