// GoPlus 악성 주소 API (무료, 키 없이 소량 사용). 주소 하나의 "현재" 위험 표시를 가져온다.
// - 응답 원문을 cache/에 저장해 다시 묻지 않는다.
// - GoPlus는 지금 시점의 정보라, 과거 시점을 재현하는 검증(evaluate.js)에서는 쓰지 않는다(시간 누수).
import fs from "node:fs";
import path from "node:path";

const BASE = "https://api.gopluslabs.io/api/v1/address_security";
const GAP_MS = 1200; // 무료 사용량에 맞춰 천천히
const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0;

// 사기·범죄에 직접 연결된 표시(강한 근거) / 의심 표시(약한 근거)
export const GOPLUS_DIRECT = {
  sanctioned: "제재 대상", stealing_attack: "자산 탈취 공격", phishing_activities: "피싱",
  cybercrime: "사이버 범죄", money_laundering: "자금세탁", financial_crime: "금융 범죄",
  blackmail_activities: "협박·갈취", darkweb_transactions: "다크웹 거래", fake_kyc: "가짜 KYC",
  honeypot_related_address: "허니팟 관련"
};
export const GOPLUS_DOUBT = { blacklist_doubt: "블랙리스트 의심" };

export async function goplusAddress(address, cacheDir) {
  address = String(address).toLowerCase();
  const file = path.join(cacheDir, `goplus_${address}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(`${BASE}/${address}?chain_id=1`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`GoPlus HTTP ${res.status}`);
  const body = await res.json();
  if (body.code !== 1 || typeof body.result !== "object" || body.result === null) throw new Error(`GoPlus 응답 오류: ${body.message ?? body.code}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body) + "\n");
  return body;
}

// 원문 → { direct: ["피싱", ...], doubt: [...], mixer: bool, maliciousContracts: number|null, source }
export function parseGoplus(body) {
  const r = body?.result ?? {};
  const on = k => String(r[k] ?? "0") === "1";
  const n = Number(r.number_of_malicious_contracts_created);
  return {
    direct: Object.entries(GOPLUS_DIRECT).filter(([k]) => on(k)).map(([, v]) => v),
    doubt: Object.entries(GOPLUS_DOUBT).filter(([k]) => on(k)).map(([, v]) => v),
    mixer: on("mixer"),
    maliciousContracts: Number.isFinite(n) ? n : null,
    source: r.data_source ? `GoPlus(${r.data_source})` : "GoPlus"
  };
}
