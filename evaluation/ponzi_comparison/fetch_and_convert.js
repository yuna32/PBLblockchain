/**
 * fetch_and_convert.js
 * labeled_addresses.csv 의 각 주소에 대해:
 *   1. Etherscan getsourcecode → 검증 컨트랙트 여부 확인
 *   2. 소스코드 ./data/sources/{address}.sol 저장
 *   3. txlist + txlistinternal 수집 → 블록 단위 집계
 *   4. ./data/logs/{address}.csv 저장
 *      컬럼: block, total_in, total_out, net_flow,
 *             cumulative_balance, unique_participants, max_single_tx
 *
 * 포맷 참고: analysis/dynamic_analyzer.js 가 읽는 per-tx 포맷
 *   (block, action, from, to, amount_eth, contract_balance_eth) 과 달리,
 *   여기서는 Etherscan raw tx를 블록 단위로 집계한 시계열 포맷을 사용합니다.
 *   unique_participants 는 블록 누적 고유 참여 주소 수입니다.
 *
 * 환경변수: ETHERSCAN_API_KEY
 * 실행:    node fetch_and_convert.js
 */
import fs   from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Config ────────────────────────────────────────────────────────────────────
const API_KEY    = process.env.ETHERSCAN_API_KEY;
const BASE_URL   = 'https://api.etherscan.io/v2/api';  // V2 (V1 deprecated 2024)
const CHAIN_ID   = 1;   // Ethereum mainnet
const RATE_MS    = 220;   // ~4.5 req/s (무료 티어 5/s 한도 이하)
const MAX_RETRY  = 3;
const PAGE_SIZE  = 10000; // Etherscan 최대 페이지 크기

const DATA_DIR    = path.join(__dirname, 'data');
const SOURCES_DIR = path.join(DATA_DIR, 'sources');
const LOGS_DIR    = path.join(DATA_DIR, 'logs');

// ── Initialise ────────────────────────────────────────────────────────────────
if (!API_KEY) {
  console.error('[오류] ETHERSCAN_API_KEY 환경변수가 설정되지 않았습니다.');
  console.error('  export ETHERSCAN_API_KEY=<your_key>  후 재실행하세요.');
  process.exit(1);
}

fs.mkdirSync(SOURCES_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR,    { recursive: true });

// ── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('HTTP timeout')); });
  });
}

function weiToEth(weiStr) {
  if (!weiStr || weiStr === '0') return 0;
  try   { return Number(BigInt(weiStr)) / 1e18; }
  catch { return parseFloat(weiStr)    / 1e18; }
}

// ── Rate limiter ──────────────────────────────────────────────────────────────
let _lastCallAt = 0;
async function waitForSlot() {
  const gap = RATE_MS - (Date.now() - _lastCallAt);
  if (gap > 0) await sleep(gap);
  _lastCallAt = Date.now();
}

// ── API call with retry ───────────────────────────────────────────────────────
async function apiGet(params) {
  // chainid=1 은 V2 필수 파라미터 (Ethereum mainnet)
  const qs  = Object.entries({ chainid: CHAIN_ID, ...params, apikey: API_KEY })
               .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const url = `${BASE_URL}?${qs}`;

  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    await waitForSlot();
    try {
      const text = await httpGet(url);
      const json = JSON.parse(text);

      if (typeof json.result === 'string') {
        const r = json.result.toLowerCase();
        // V1 deprecated → 즉시 하드 실패 (재시도 무의미)
        if (r.includes('deprecated') || r.includes('v1 endpoint')) {
          throw new Error(
            'Etherscan V1 엔드포인트가 deprecated됨. BASE_URL을 V2로 변경 필요.\n' +
            `  원문: ${json.result}`
          );
        }
        // 레이트 리밋 → 백오프 재시도
        if (r.includes('rate limit') || r.includes('max rate') || r.includes('max calls')) {
          const backoff = 2000 * (attempt + 1);
          process.stdout.write(`\n  [rate-limit] ${backoff}ms 대기 후 재시도...\n`);
          await sleep(backoff);
          continue;
        }
        // API 키 오류 → 즉시 하드 실패
        if (r.includes('invalid api key') || r.includes('missing/invalid api key')) {
          throw new Error(`Etherscan API 키 오류: ${json.result}`);
        }
      }

      return json;
    } catch (err) {
      if (err.message.includes('deprecated') || err.message.includes('API 키 오류')) throw err;
      lastErr = err;
      if (attempt < MAX_RETRY - 1) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error('API 호출 실패 (재시도 초과)');
}

// ── Etherscan helpers ─────────────────────────────────────────────────────────
async function getSourceCode(address) {
  return apiGet({ module: 'contract', action: 'getsourcecode', address });
}

async function fetchTxPage(action, address, page) {
  return apiGet({
    module:     'account',
    action,
    address,
    startblock: 0,
    endblock:   99999999,
    sort:       'asc',
    page,
    offset:     PAGE_SIZE,
  });
}

async function fetchAllTxs(action, address) {
  const all = [];
  let page  = 1;

  while (true) {
    const resp = await fetchTxPage(action, address, page);

    // Etherscan 에러 메시지 (문자열 result)
    if (typeof resp.result === 'string') {
      // "No transactions found" 는 정상 종료
      if (
        resp.message?.toLowerCase().includes('no transactions') ||
        resp.result?.toLowerCase().includes('no transactions')
      ) break;
      throw new Error(`Etherscan ${action}: ${resp.result}`);
    }

    if (resp.status !== '1' || !Array.isArray(resp.result) || resp.result.length === 0) break;

    all.push(...resp.result);
    if (resp.result.length < PAGE_SIZE) break;  // 마지막 페이지
    page++;
  }
  return all;
}

// ── Block-level aggregation ───────────────────────────────────────────────────
/**
 * normalTxs, internalTxs 를 블록 단위로 집계한 CSV 행 배열을 반환.
 * 컬럼: block, total_in, total_out, net_flow,
 *        cumulative_balance, unique_participants, max_single_tx
 *
 * unique_participants: 해당 블록까지의 누적 고유 참여 주소 수
 *                      (컨트랙트 자신은 제외)
 */
function aggregateByBlock(normalTxs, internalTxs, address) {
  const addr   = address.toLowerCase();
  const bmap   = new Map();   // blockNum → { in, out, max, peers:Set }
  const cumSet = new Set();   // 누적 참여자

  function slot(blockNum) {
    if (!bmap.has(blockNum))
      bmap.set(blockNum, { in: 0, out: 0, max: 0, peers: new Set() });
    return bmap.get(blockNum);
  }

  function record(blockNum, isIn, value, peer) {
    if (value <= 0) return;
    const b = slot(blockNum);
    if (isIn) b.in  += value;
    else      b.out += value;
    if (value > b.max) b.max = value;
    if (peer && peer.toLowerCase() !== addr) b.peers.add(peer.toLowerCase());
  }

  // 일반 트랜잭션: 컨트랙트가 받는 ETH (to == contract)
  // isError==="1" (실패/리버트)인 트랜잭션은 제외한다 — Etherscan은 실패한
  // 트랜잭션도 목록에 포함시키며 value 필드에 "의도했던" 금액을 그대로
  // 채워두는데, 리버트된 트랜잭션은 실제로 ETH가 이동하지 않았으므로 이를
  // 그대로 합산하면 cumulative_balance가 왜곡된다(음수/비현실적 값의 한 원인
  // 으로 확인됨 — EVASION_ANALYSIS.md 참고).
  for (const tx of normalTxs) {
    if (tx.isError === '1') continue;
    const val = weiToEth(tx.value);
    if (!tx.to || !tx.blockNumber) continue;
    if (tx.to.toLowerCase()   === addr) record(+tx.blockNumber, true,  val, tx.from);
    if (tx.from?.toLowerCase() === addr) record(+tx.blockNumber, false, val, tx.to);
  }

  // 내부 트랜잭션: 컨트랙트가 보내는 ETH (from == contract) 및 받는 ETH
  // 마찬가지로 실패한 내부 호출(isError==="1")은 제외.
  for (const tx of internalTxs) {
    if (tx.isError === '1') continue;
    const val = weiToEth(tx.value);
    if (!tx.blockNumber) continue;
    if (tx.from?.toLowerCase() === addr) record(+tx.blockNumber, false, val, tx.to);
    if (tx.to?.toLowerCase()   === addr) record(+tx.blockNumber, true,  val, tx.from);
  }

  if (bmap.size === 0) return [];

  const sortedBlocks = [...bmap.keys()].sort((a, b) => a - b);
  let cumBal = 0;
  const rows = [];

  for (const blk of sortedBlocks) {
    const b   = bmap.get(blk);
    const net = b.in - b.out;
    cumBal   += net;
    for (const p of b.peers) cumSet.add(p);

    rows.push(
      `${blk},` +
      `${b.in.toFixed(8)},` +
      `${b.out.toFixed(8)},` +
      `${net.toFixed(8)},` +
      `${cumBal.toFixed(8)},` +
      `${cumSet.size},` +
      `${b.max.toFixed(8)}`
    );
  }
  return rows;
}

// ── Process a single address ──────────────────────────────────────────────────
export async function processOne(address) {
  // 1. getsourcecode → 컨트랙트 & 검증 여부 확인
  let srcResp;
  try   { srcResp = await getSourceCode(address); }
  catch (e) { return { status: 'failed', reason: `getsourcecode 오류: ${e.message}` }; }

  if (srcResp.status !== '1' || !Array.isArray(srcResp.result) || !srcResp.result[0]) {
    return { status: 'skipped', reason: 'not_a_contract' };
  }

  const srcObj = srcResp.result[0];
  const src    = (srcObj.SourceCode ?? '').trim();

  if (!src) {
    return { status: 'skipped', reason: 'source_not_verified' };
  }

  // 2. 소스코드 저장
  fs.writeFileSync(path.join(SOURCES_DIR, `${address}.sol`), src, 'utf8');

  // 3. 트랜잭션 수집
  let normalTxs, internalTxs;
  try   { normalTxs   = await fetchAllTxs('txlist',         address); }
  catch (e) { return { status: 'failed', reason: `txlist 오류: ${e.message}` }; }

  try   { internalTxs = await fetchAllTxs('txlistinternal', address); }
  catch (e) { return { status: 'failed', reason: `txlistinternal 오류: ${e.message}` }; }

  // 4. 블록 집계 & 저장
  const dataRows = aggregateByBlock(normalTxs, internalTxs, address);
  if (dataRows.length === 0) {
    // 이전 실행에서 남은 더미/오염 로그 파일이 있으면 삭제
    const staleLog = path.join(LOGS_DIR, `${address}.csv`);
    if (fs.existsSync(staleLog)) fs.unlinkSync(staleLog);
    return { status: 'skipped', reason: 'no_value_transactions' };
  }

  const csvHeader = 'block,total_in,total_out,net_flow,cumulative_balance,unique_participants,max_single_tx';
  fs.writeFileSync(
    path.join(LOGS_DIR, `${address}.csv`),
    [csvHeader, ...dataRows].join('\n') + '\n',
    'utf8'
  );

  return {
    status:     'ok',
    blocks:     dataRows.length,
    normalTxs:  normalTxs.length,
    internalTxs: internalTxs.length,
  };
}

// ── CSV writer helper ─────────────────────────────────────────────────────────
function saveCsv(filepath, header, rows) {
  if (rows.length === 0) return;
  fs.writeFileSync(
    filepath,
    [header, ...rows].join('\n') + '\n',
    'utf8'
  );
  console.log(`  → ${path.basename(filepath)} (${rows.length}건)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const labelsPath = process.env.LABELS_FILE
    ? path.resolve(__dirname, process.env.LABELS_FILE)
    : path.join(DATA_DIR, 'labeled_addresses.csv');
  if (!fs.existsSync(labelsPath)) {
    console.error(`labels 파일 없음: ${labelsPath}`);
    process.exit(1);
  }

  let content = fs.readFileSync(labelsPath, 'utf8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

  const entries = content.trim().split(/\r?\n/).slice(1)
    .map(line => {
      const [a, lbl] = line.split(',');
      return { address: a?.trim(), label: lbl?.trim() };
    })
    .filter(e => e.address);

  const total   = entries.length;
  const skipped = [];
  const failed  = [];
  let   ok      = 0;

  console.log(`\n주소 ${total}개 처리 시작 (API 요청 ~${(total * 3 * RATE_MS / 1000).toFixed(0)}초 예상)\n`);

  const startTime = Date.now();

  for (let i = 0; i < total; i++) {
    const { address, label } = entries[i];
    const pct     = (((i + 1) / total) * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

    process.stdout.write(
      `\r[${String(pct).padStart(5)}%] ${String(i + 1).padStart(4)}/${total}` +
      `  ${elapsed}s  ${address}  `
    );

    let result;
    try   { result = await processOne(address); }
    catch (e) { result = { status: 'failed', reason: e.message }; }

    if (result.status === 'ok') {
      ok++;
    } else if (result.status === 'skipped') {
      skipped.push(`${address},${label},${result.reason}`);
    } else {
      failed.push(`${address},${label},${result.reason}`);
    }
  }

  process.stdout.write('\n\n');

  saveCsv(path.join(DATA_DIR, 'skipped_addresses.csv'),
          'address,label,reason', skipped);
  saveCsv(path.join(DATA_DIR, 'failed_addresses.csv'),
          'address,label,reason', failed);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n완료 (${elapsed}s)`);
  console.log(`  성공: ${ok}   스킵: ${skipped.length}   실패: ${failed.length}`);
  console.log(`  logs    → ${LOGS_DIR}`);
  console.log(`  sources → ${SOURCES_DIR}`);
}

// CLI 직접 실행시에만 main() 구동 — 다른 스크립트가 processOne()을 import해도
// 부수효과(전체 272건 재실행) 없음. (evaluation/hoplaundering/fetch_and_convert_v2.js
// 와 동일한 관례.)
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(err => { console.error(err); process.exit(1); });
}
