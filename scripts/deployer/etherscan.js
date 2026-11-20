// Etherscan V2 호출 공용 모듈 (배포자 위험도 수집용).
// - 키는 환경변수 ETHERSCAN_API_KEY에서만 읽고, 로그·오류 메시지·파일에 남기지 않는다.
// - 무료 티어 속도 제한(초당 5회 이하)에 맞춰 호출 간격을 둔다.
// - "No transactions found" 같은 빈 결과는 오류가 아니라 빈 배열로 돌려준다.

const BASE_URL = "https://api.etherscan.io/v2/api";
const CHAIN_ID = "1"; // 이더리움 메인넷
const GAP_MS = 250; // 초당 4회
const MAX_RETRY = 4;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastCallAt = 0;

export function requireKey() {
  if (!process.env.ETHERSCAN_API_KEY) {
    console.error("[오류] ETHERSCAN_API_KEY가 없습니다.");
    console.error("  저장소 루트의 .env 파일에 ETHERSCAN_API_KEY=키 를 넣고,");
    console.error("  node --env-file=.env scripts/deployer/<스크립트>.js 로 실행하세요.");
    process.exit(1);
  }
}

export async function etherscan(params) {
  const key = process.env.ETHERSCAN_API_KEY;
  const qs = new URLSearchParams({ chainid: CHAIN_ID, ...params, apikey: key }).toString();
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const wait = lastCallAt + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    try {
      const res = await fetch(`${BASE_URL}?${qs}`, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.status === "1") return body.result;
      const msg = `${body.message ?? ""} ${typeof body.result === "string" ? body.result : ""}`.trim();
      if (/no (transactions|records) found/i.test(msg)) return [];
      if (/invalid api key|missing\/invalid/i.test(msg)) {
        const e = new Error("Etherscan API 키 오류(키를 확인하세요)");
        e.fatal = true;
        throw e;
      }
      if (/rate limit|max calls|max rate/i.test(msg)) throw new Error("속도 제한: " + msg);
      // 그 밖의 status 0: 결과가 배열이면 빈 결과로 본다
      if (Array.isArray(body.result)) return body.result;
      throw new Error("Etherscan 응답 오류: " + msg);
    } catch (err) {
      if (err.fatal) throw err;
      lastErr = err;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

// 컨트랙트 최대 5개의 생성 정보(배포자, 생성 트랜잭션, 블록, 시각)
export async function getContractCreation(addresses) {
  const r = await etherscan({ module: "contract", action: "getcontractcreation", contractaddresses: addresses.join(",") });
  return Array.isArray(r) ? r : [];
}

// 주소의 일반 거래(오래된 순). 한 번에 최대 10,000건까지만 가져오고, 잘렸는지 함께 돌려준다.
export async function getTxList(address, { endblock = 99999999, offset = 10000 } = {}) {
  const r = await etherscan({
    module: "account", action: "txlist", address,
    startblock: "0", endblock: String(endblock), page: "1", offset: String(offset), sort: "asc"
  });
  const list = Array.isArray(r) ? r : [];
  return { list, truncated: list.length >= offset };
}

// 주소가 받은 내부 거래(오래된 순). 첫 자금이 컨트랙트(예: 믹서)에서 내부 거래로 들어온 경우를 잡기 위해 쓴다.
export async function getInternalTxList(address, { endblock = 99999999, offset = 1000 } = {}) {
  const r = await etherscan({
    module: "account", action: "txlistinternal", address,
    startblock: "0", endblock: String(endblock), page: "1", offset: String(offset), sort: "asc"
  });
  return Array.isArray(r) ? r : [];
}
