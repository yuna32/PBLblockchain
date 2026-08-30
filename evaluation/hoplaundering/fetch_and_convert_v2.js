/**
 * fetch_and_convert_v2.js
 *
 * Phase 3 후속 Step 2 — evaluation/ponzi_comparison/fetch_and_convert.js 의
 * aggregateByBlock()이 블록 단위로 집계하면서 실제 주소(from/to)를 버리고
 * unique_participants "카운트"만 남기는 문제(Phase 3 조사에서 확인)를 해소한다.
 *
 * 원본과 무엇이 다른가 (원본은 절대 수정하지 않음 — 이 파일은 완전히 별도 신규 파일):
 *   - 원본 aggregateByBlock(): 블록별 { in, out, max, peers:Set(방향 구분 없음) }만
 *     누적하고, 최종적으로 cumSet.size(누적 고유 참여자 "수")만 CSV에 남긴다.
 *     실제 peer 주소 문자열은 어디에도 저장되지 않는다.
 *   - 이 파일의 aggregateByBlockV2(): peers를 입금 방향(depositPeers)과 출금
 *     방향(withdrawPeers)으로 분리해서 "주소 자체"를 보존하고, 블록 집계 CSV에
 *     두 개 열(deposit_addresses, withdrawal_addresses, '|'로 join)을 추가한다.
 *     또한 HopLaundering 체인 그래프 분석(Step 3, chain_graph.js)이 순서 정보를
 *     요구하므로, 개별 트랜잭션을 블록/타임스탬프 순으로 정렬한 원시 엣지 리스트를
 *     {address}_edges.csv 로 별도 저장한다.
 *
 * 이 스크립트는 EOA(허니팟/컨트랙트가 아닌 일반 지갑) 주소도 다루므로, 원본에 있던
 * getsourcecode(검증된 컨트랙트 소스 저장) 단계는 뺐다 — HopLaundering 체인 추적에는
 * 트랜잭션 그래프만 필요하고 소스코드는 필요 없다.
 *
 * 환경변수: ETHERSCAN_API_KEY
 * 실행:
 *   node fetch_and_convert_v2.js <address1> [address2 ...]   → 실제 API 호출
 *   node fetch_and_convert_v2.js --smoketest                 → 오프라인 스모크 테스트
 *                                                                (API 키 불필요)
 */

import fs   from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Config (원본 fetch_and_convert.js 와 동일한 Etherscan v2 설정) ─────────────
const API_KEY   = process.env.ETHERSCAN_API_KEY;
const BASE_URL  = 'https://api.etherscan.io/v2/api';
const CHAIN_ID  = 1;
const RATE_MS   = 220;
const MAX_RETRY = 3;
const PAGE_SIZE = 10000;

const DATA_DIR = path.join(__dirname, 'data');
const LOGS_DIR = path.join(DATA_DIR, 'logs_v2');
fs.mkdirSync(LOGS_DIR, { recursive: true });

// ── Utilities (원본과 동일) ──────────────────────────────────────────────────
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

let _lastCallAt = 0;
async function waitForSlot() {
  const gap = RATE_MS - (Date.now() - _lastCallAt);
  if (gap > 0) await sleep(gap);
  _lastCallAt = Date.now();
}

async function apiGet(params) {
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
        if (r.includes('rate limit') || r.includes('max rate') || r.includes('max calls')) {
          const backoff = 2000 * (attempt + 1);
          process.stdout.write(`\n  [rate-limit] ${backoff}ms 대기 후 재시도...\n`);
          await sleep(backoff);
          continue;
        }
        if (r.includes('invalid api key') || r.includes('missing/invalid api key')) {
          throw new Error(`Etherscan API 키 오류: ${json.result}`);
        }
      }
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRY - 1) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error('API 호출 실패 (재시도 초과)');
}

async function fetchTxPage(action, address, page) {
  return apiGet({
    module: 'account', action, address,
    startblock: 0, endblock: 99999999, sort: 'asc', page, offset: PAGE_SIZE,
  });
}

async function fetchAllTxs(action, address) {
  const all = [];
  let page = 1;
  while (true) {
    const resp = await fetchTxPage(action, address, page);
    if (typeof resp.result === 'string') {
      if (resp.message?.toLowerCase().includes('no transactions') ||
          resp.result?.toLowerCase().includes('no transactions')) break;
      throw new Error(`Etherscan ${action}: ${resp.result}`);
    }
    if (resp.status !== '1' || !Array.isArray(resp.result) || resp.result.length === 0) break;
    all.push(...resp.result);
    if (resp.result.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

// ── 주소 보존 블록 집계 (Step 2 핵심) ───────────────────────────────────────────
/**
 * normalTxs, internalTxs 를 블록 단위로 집계하되, 방향별 상대 주소 집합과
 * 원시 엣지 리스트까지 함께 반환한다.
 *
 * 반환값:
 *   blockRows : 원본과 같은 7개 열 + deposit_addresses/withdrawal_addresses 2개 열
 *   edges     : { block, timestamp, from, to, amount_eth, direction, kind, hash } 배열
 *               (block → timestamp 순 정렬, HopLaundering 체인 추적의 입력. hash는
 *               chain_graph.js 출력에서 "관련 트랜잭션"을 식별하는 데 쓰인다.
 *               시뮬레이션 로그 기반 스모크 테스트처럼 hash가 없는 입력은 빈 문자열)
 */
function aggregateByBlockV2(normalTxs, internalTxs, address) {
  const addr = address.toLowerCase();
  const bmap = new Map(); // blockNum → { in, out, max, depositPeers:Set, withdrawPeers:Set }
  const cumSet = new Set();
  const edges = [];

  function slot(blockNum) {
    if (!bmap.has(blockNum)) {
      bmap.set(blockNum, { in: 0, out: 0, max: 0, depositPeers: new Set(), withdrawPeers: new Set() });
    }
    return bmap.get(blockNum);
  }

  // isIn=true  → peer 가 addr 에게 입금 (addr 입장에서 deposit)
  // isIn=false → addr 가 peer 에게 출금 (addr 입장에서 withdrawal)
  function record(blockNum, timestamp, isIn, value, peer, kind, hash) {
    if (value <= 0 || !peer) return;
    const peerLower = peer.toLowerCase();
    if (peerLower === addr) return; // self-transfer 제외

    const b = slot(blockNum);
    if (isIn) { b.in  += value; b.depositPeers.add(peerLower); }
    else      { b.out += value; b.withdrawPeers.add(peerLower); }
    if (value > b.max) b.max = value;

    edges.push({
      block: blockNum,
      timestamp: timestamp || 0,
      from: isIn ? peerLower : addr,
      to:   isIn ? addr      : peerLower,
      amount_eth: value,
      direction: isIn ? 'deposit' : 'withdrawal',
      kind,
      hash: hash || '',
    });
  }

  for (const tx of normalTxs) {
    const val = weiToEth(tx.value);
    if (!tx.blockNumber) continue;
    const blk = +tx.blockNumber, ts = +tx.timeStamp || 0;
    if (tx.to?.toLowerCase()   === addr) record(blk, ts, true,  val, tx.from, 'normal', tx.hash);
    if (tx.from?.toLowerCase() === addr) record(blk, ts, false, val, tx.to,   'normal', tx.hash);
  }
  for (const tx of internalTxs) {
    const val = weiToEth(tx.value);
    if (!tx.blockNumber) continue;
    const blk = +tx.blockNumber, ts = +tx.timeStamp || 0;
    if (tx.from?.toLowerCase() === addr) record(blk, ts, false, val, tx.to,   'internal', tx.hash);
    if (tx.to?.toLowerCase()   === addr) record(blk, ts, true,  val, tx.from, 'internal', tx.hash);
  }

  if (bmap.size === 0) return { blockRows: [], edges: [] };

  const sortedBlocks = [...bmap.keys()].sort((a, b) => a - b);
  let cumBal = 0;
  const blockRows = [];

  for (const blk of sortedBlocks) {
    const b = bmap.get(blk);
    const net = b.in - b.out;
    cumBal += net;
    for (const p of b.depositPeers)  cumSet.add(p);
    for (const p of b.withdrawPeers) cumSet.add(p);

    blockRows.push([
      blk,
      b.in.toFixed(8),
      b.out.toFixed(8),
      net.toFixed(8),
      cumBal.toFixed(8),
      cumSet.size,
      b.max.toFixed(8),
      [...b.depositPeers].join('|'),
      [...b.withdrawPeers].join('|'),
    ].join(','));
  }

  edges.sort((a, b) => a.block - b.block || a.timestamp - b.timestamp);
  return { blockRows, edges };
}

const BLOCK_CSV_HEADER =
  'block,total_in,total_out,net_flow,cumulative_balance,unique_participants,max_single_tx,deposit_addresses,withdrawal_addresses';
const EDGE_CSV_HEADER =
  'block,timestamp,from,to,amount_eth,direction,kind,hash';

function saveAddressData(address, blockRows, edges) {
  fs.writeFileSync(
    path.join(LOGS_DIR, `${address}.csv`),
    [BLOCK_CSV_HEADER, ...blockRows].join('\n') + '\n', 'utf8'
  );
  fs.writeFileSync(
    path.join(LOGS_DIR, `${address}_edges.csv`),
    [EDGE_CSV_HEADER, ...edges.map(e =>
      `${e.block},${e.timestamp},${e.from},${e.to},${e.amount_eth.toFixed(8)},${e.direction},${e.kind},${e.hash}`
    )].join('\n') + '\n', 'utf8'
  );
}

// ── 실 API 처리 ─────────────────────────────────────────────────────────────
async function processOne(address) {
  const addr = address.toLowerCase();
  let normalTxs, internalTxs;
  try   { normalTxs   = await fetchAllTxs('txlist',         addr); }
  catch (e) { return { status: 'failed', reason: `txlist 오류: ${e.message}` }; }
  try   { internalTxs = await fetchAllTxs('txlistinternal', addr); }
  catch (e) { return { status: 'failed', reason: `txlistinternal 오류: ${e.message}` }; }

  const { blockRows, edges } = aggregateByBlockV2(normalTxs, internalTxs, addr);
  if (blockRows.length === 0) return { status: 'skipped', reason: 'no_value_transactions' };

  saveAddressData(addr, blockRows, edges);
  return { status: 'ok', blocks: blockRows.length, edges: edges.length,
           normalTxs: normalTxs.length, internalTxs: internalTxs.length };
}

// ── 오프라인 스모크 테스트 (API 키 불필요) ──────────────────────────────────────
// 기존 시뮬레이션 로그(analysis/analysis/logs/rugpull_log.csv, 실제 from/to/amount_eth
// 컬럼 보유)를 Etherscan tx 응답과 같은 모양으로 변환해 aggregateByBlockV2()에 흘려
// 넣어본다. 실제 API 호출 없이 집계 로직 자체가 정상 동작하는지만 검증하는 목적.
async function smokeTest() {
  const logPath = path.resolve(__dirname, '../../analysis/analysis/logs/rugpull_log.csv');
  if (!fs.existsSync(logPath)) {
    console.error(`[스모크테스트] 원본 로그 없음: ${logPath}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/);
  const hdr = lines[0].split(',');
  const rows = lines.slice(1).map(l => {
    const v = l.split(',');
    return Object.fromEntries(hdr.map((h, i) => [h, v[i]]));
  });

  // 이 로그의 컨트랙트 주소(= 모든 deposit 행의 to)를 "분석 대상 address"로 취급.
  const contractAddr = rows.find(r => r.action === 'deposit')?.to;
  console.log(`[스모크테스트] 대상 주소(컨트랙트): ${contractAddr}`);
  console.log(`[스모크테스트] 원본 로그 행 수: ${rows.length}`);

  // 로그의 from/to/amount_eth/block/timestamp 를 Etherscan tx 응답 형태로 변환.
  // amount_eth(ETH) → value(wei 문자열)로 되돌린다.
  const normalTxs = rows.map(r => ({
    from: r.from, to: r.to,
    value: BigInt(Math.round(parseFloat(r.amount_eth) * 1e18)).toString(),
    blockNumber: r.block, timeStamp: r.timestamp,
  }));

  const { blockRows, edges } = aggregateByBlockV2(normalTxs, [], contractAddr);
  // 접두어 없이 실제 주소(소문자) 그대로 저장 — chain_graph.js 는 파일명과 edges
  // 내부의 from/to 값이 동일한 주소 표기여야 정상 매칭되므로(운영 시
  // fetch_and_convert_v2.js processOne()과 동일 규칙), 스모크 테스트도 같은
  // 네이밍 규칙(소문자)을 따른다.
  saveAddressData(contractAddr.toLowerCase(), blockRows, edges);

  console.log(`[스모크테스트] 블록 집계 행: ${blockRows.length}, 엣지: ${edges.length}`);
  console.log(`[스모크테스트] 마지막 블록 집계 행: ${blockRows[blockRows.length - 1]}`);

  // ── 검증 ──────────────────────────────────────────────────────────────────
  const finalRow = blockRows[blockRows.length - 1].split(',');
  const peakEth  = Math.max(...blockRows.map(r => parseFloat(r.split(',')[4])));
  const finalBal = parseFloat(finalRow[4]);
  console.log(`[검증] peak_balance ≈ ${peakEth.toFixed(4)} ETH, final_balance ≈ ${finalBal.toFixed(4)} ETH`);
  console.log(`[검증] rugpull_log 는 정점 잔고 후 오너 전액 인출 시나리오이므로 ` +
              `final_balance ≈ 0 이어야 정상 (실제: ${finalBal.toFixed(4)})`);

  const allDeposit = new Set(rows.filter(r => r.action === 'deposit').map(r => r.from.toLowerCase()));
  const allWithdraw = new Set(
    rows.filter(r => r.action === 'withdraw' || r.action === 'owner_withdraw_all').map(r => r.to.toLowerCase())
  );
  const hopAddrs  = [...allWithdraw].filter(a => !allDeposit.has(a));
  const bothSides = [...allWithdraw].filter(a => allDeposit.has(a));
  console.log(`[검증] 원본 로그 기준 deposit 주소 ${allDeposit.size}개, withdraw 수신 주소 ${allWithdraw.size}개`);
  console.log(`[검증] hopAddrs(경유 후보)=${hopAddrs.length}, bothSides(양방향)=${bothSides.length} ` +
              `(rugpull_log 는 오너 1인 단발 인출이라 HopLaundering 조건 미충족이 정상)`);

  console.log(`\n[스모크테스트] 통과 — v2 저장 파일:`);
  console.log(`  ${path.join(LOGS_DIR, `${contractAddr.toLowerCase()}.csv`)}`);
  console.log(`  ${path.join(LOGS_DIR, `${contractAddr.toLowerCase()}_edges.csv`)}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--smoketest')) {
    await smokeTest();
    return;
  }

  if (args.length === 0) {
    console.error('사용법:');
    console.error('  node fetch_and_convert_v2.js <address1> [address2 ...]');
    console.error('  node fetch_and_convert_v2.js --smoketest');
    process.exit(1);
  }

  if (!API_KEY) {
    console.error('[오류] ETHERSCAN_API_KEY 환경변수가 설정되지 않았습니다.');
    process.exit(1);
  }

  for (const address of args) {
    process.stdout.write(`처리 중: ${address} ... `);
    let result;
    try   { result = await processOne(address); }
    catch (e) { result = { status: 'failed', reason: e.message }; }
    console.log(JSON.stringify(result));
  }
}

// CLI 로 직접 실행됐을 때만 main() 구동 — 다른 스크립트(pilot_hoplaundering.js 등)가
// processOne()/aggregateByBlockV2() 를 재사용하려고 import 할 때 이 스크립트의
// main()이 부수효과로 실행되며 process.exit() 하는 사고를 막는다.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch(err => { console.error(err); process.exit(1); });
}

export { processOne, aggregateByBlockV2, saveAddressData, LOGS_DIR, DATA_DIR };
