/**
 * response_candidates — 원인 후보 분류 리포트 (수동 7단계 ④ 반자동화)
 *
 * response_reasoner.js의 출력(--run: changed.csv, disagreement_delta.csv, old.jsonl, new.jsonl,
 * summary.md)을 읽고, 근접도 계산을 위해 두 소스 트리(--old, --new)의 analyzeDynamic을 다시 호출해
 * 변경·불일치 주소마다 "왜 이렇게 됐을 수 있는지"의 후보와 근거 수치를 낸다.
 *
 * - 후보만 낸다. 규칙·코드·데이터 수정을 제안하거나 적용하지 않는다. 승인(⑤)·반영(⑥)은 사람이 한다.
 * - 어떤 트리에도, --run에도 쓰지 않는다. 출력은 --out 아래에만 쓴다.
 * - 후보 코드: C1-DATA, C1-CODE, C2-OSC/RUG/PONZI, C3-NEAR:<특징>, C4-REG, C4-NEG, C0-NONE.
 *   신뢰도·순위는 내지 않고 코드 순서로 나열한다. verdict(65/25)는 후보가 아니라 참고 수치다.
 * - 근접도는 로직 복사 + 자동 강등: 트리마다 자체검사를 하고, 실패한 트리 쪽은 수준 R
 *   (C2 부분, C3 생략)으로 내리고 종료 코드 3을 낸다.
 *
 * 근거 문서: ~/pbl_backup/response_candidates_design/PROPOSAL.md (0절, 3-3, 5-1, 7, 8절)
 */

import fs     from 'fs';
import path   from 'path';
import crypto from 'crypto';
import { pathToFileURL } from 'url';

const SELF = path.basename(process.argv[1] ?? 'response_candidates.js');
const USAGE = `사용법:
  node ${SELF} --run <dir> --old <tree> --new <tree> --out <dir> [옵션]

  --run   response_reasoner.js의 --out 디렉터리 (changed.csv, disagreement_delta.csv,
          old.jsonl, new.jsonl, summary.md). 읽기만 한다.
  --old, --new  그 run을 만들 때 쓴 것과 같은 소스 트리. summary.md의 모듈 sha256과 대조한다.
  --out   없거나 비어 있어야 하며, git 작업트리·입력 트리·--run 안이면 거부한다.

옵션:
  --near <폭>    C3 경계 근접 폭 (기본 0.05, 0<폭<1). 근거 없는 잠정값이다.
  --level F|R    F(기본): 트리별 analyzeDynamic 재실행 + 특징값 재계산 + 자체검사.
                 R: analyzeDynamic을 호출하지 않고 run 출력·로그 원본만 쓴다 (C2 부분, C3 없음).

종료 코드:
  0  정상. 후보 유무와 무관 (정보성). 대상 주소가 없으면 빈 리포트.
  2  실행 오류 (인자, 파일 없음, run–트리 해시 불일치, import 실패, 출력 디렉터리 문제)
  3  자체검사 실패. 출력은 쓰되 실패한 트리 쪽을 수준 R로 내리고 header.md 맨 위에 경고를 둔다.
  (1은 쓰지 않는다. response_reasoner의 1=변경 있음, regress.sh의 1=실패와 겹치지 않게 하기 위함)`;

class UsageError extends Error {}

// ── 인자 ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const known = new Set(['--run', '--old', '--new', '--out', '--near', '--level']);
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '-h' || k === '--help') { console.log(USAGE); process.exit(0); }
    if (!known.has(k)) throw new UsageError(`알 수 없는 인자: ${k}`);
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`값 없음: ${k}`);
    a[k.slice(2)] = v;
  }
  for (const r of ['run', 'old', 'new', 'out']) if (!a[r]) throw new UsageError(`--${r} 필수`);
  a.near = a.near === undefined ? 0.05 : Number(a.near);
  if (!(Number.isFinite(a.near) && a.near > 0 && a.near < 1)) throw new UsageError(`--near는 0과 1 사이 수: ${a.near}`);
  a.level ??= 'F';
  if (!['F', 'R'].includes(a.level)) throw new UsageError(`--level은 F|R: ${a.level}`);
  return a;
}

// ── [복사] response_reasoner.js:77-103 sha256NoCR, isInside, prepareOut — 원본 변경 시 동기화 필요 ──
// 변경점: prepareOut이 --run 디렉터리 안도 거부한다(입력 트리 목록에 함께 넘김).
function sha256NoCR(file) {
  if (!fs.existsSync(file)) return '(없음)';
  const buf = fs.readFileSync(file).toString('utf8').replace(/\r/g, '');
  return crypto.createHash('sha256').update(buf, 'utf8').digest('hex');
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function prepareOut(outDir, inputs) {
  const abs = path.resolve(outDir);
  for (const t of inputs) {
    if (isInside(abs, t)) throw new UsageError(`--out이 입력(트리 또는 --run) 안에 있음`);
  }
  for (let d = abs; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) throw new UsageError(`--out이 git 작업트리 안에 있음: ${d}`);
    if (path.dirname(d) === d) break;
  }
  if (fs.existsSync(abs) && fs.readdirSync(abs).length > 0) {
    throw new UsageError(`--out이 비어 있지 않음 (덮어쓰기 거부)`);
  }
  fs.mkdirSync(path.join(abs, '.tmp'), { recursive: true });
  return abs;
}

// ── [복사] evaluate_comparison.js:54-67 parseCSV (response_reasoner.js:106-119와 같음) — 원본 변경 시 동기화 필요 ──
function parseCSV(filepath) {
  if (!fs.existsSync(filepath)) return null;
  let text = fs.readFileSync(filepath, 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const hdr = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const row  = {};
    hdr.forEach((h, i) => { row[h] = vals[i]?.trim() ?? ''; });
    return row;
  });
}

// ── [복사] evaluate_comparison.js:131-175 convertToPerTx (response_reasoner.js:167-209와 같음) — 원본 변경 시 동기화 필요 ──
function convertToPerTx(rows, address) {
  if (!rows || rows.length === 0) return [];

  const addr    = address.toLowerCase();
  const peak    = rows.reduce((m, r) => Math.max(m, parseFloat(r.cumulative_balance) || 0), 0);
  const finalBal = parseFloat(rows[rows.length - 1].cumulative_balance) || 0;
  const isMajorDrain = peak > 0 && finalBal < peak * 0.1;

  const outRows    = rows.filter(r => (parseFloat(r.total_out) || 0) > 1e-12);
  const lastOutRow = outRows.length > 0 ? outRows[outRows.length - 1] : null;

  const perTx  = [];
  let   depIdx = 0;

  for (const row of rows) {
    const blk    = parseInt(row.block)       || 0;
    const tin    = parseFloat(row.total_in)  || 0;
    const tout   = parseFloat(row.total_out) || 0;
    const cumBal = parseFloat(row.cumulative_balance) || 0;

    if (tin > 1e-12) {
      depIdx++;
      const depAddr = `0x${depIdx.toString(16).padStart(40, '0')}`;
      perTx.push(
        `${blk},0,${depAddr},${addr},deposit,${tin.toFixed(8)},${(cumBal + tout).toFixed(8)},${depIdx}`
      );
    }

    if (tout > 1e-12) {
      const isOwnerDrain = isMajorDrain && row === lastOutRow;
      const recpAddr = isOwnerDrain
        ? `0x${'f'.repeat(40)}`
        : `0x${'e'.repeat(1) + (depIdx > 0 ? (depIdx - 1).toString(16).padStart(39, '0') : '0'.repeat(39))}`;

      perTx.push(
        `${blk},0,${addr},${recpAddr},${isOwnerDrain ? 'owner_withdraw_all' : 'withdraw'},` +
        `${tout.toFixed(8)},${cumBal.toFixed(8)},${depIdx}`
      );
    }
  }

  return perTx;
}

// ── [복사] evaluate_comparison.js:177-184 PER_TX_HEADER, EXACT_HINTS, SUPER_HINTS — 원본 변경 시 동기화 필요 ──
const PER_TX_HEADER =
  'block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count';
const EXACT_HINTS = new Set(['ponzi_scheme', 'ponzi_or_laundering']);
const SUPER_HINTS = new Set(['ponzi_scheme', 'ponzi_or_laundering',
                              'rug_pull', 'money_laundering', 'pump_and_dump']);

// ── [복사] analysis/dynamic_analyzer.js:8-9 DEPOSIT_ACTIONS, WITHDRAW_ACTIONS — 원본 변경 시 동기화 필요 ──
const DEPOSIT_ACTIONS  = new Set(['deposit', 'stake', 'fund_reward_pool']);
const WITHDRAW_ACTIONS = new Set(['withdraw', 'unstake', 'owner_withdraw_all']);

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));   // dynamic_analyzer.js:38-40

// ── 판정 특징값 재계산 ─────────────────────────────────────────────────────────
// per-tx 행(analyzeDynamic이 읽는 것과 같은 파일 내용)에서 N=272 예측을 정하는 특징만 계산한다.
// 각 식은 analysis/dynamic_analyzer.js의 해당 줄을 복사한 것이다 — 원본 변경 시 동기화 필요.
// 자체검사((ii) 축약 판정식, (iii) OSC/BD/FS)가 원본과의 어긋남을 잡는다.
function computeFeatures(rows) {
  // [복사] dynamic_analyzer.js:612-632 누적 (peak, totalIn, totalOut, finalBal, depositorMap)
  let totalIn = 0, totalOut = 0, peak = 0;
  const depositorMap = new Map();
  for (const row of rows) {
    const amount = parseFloat(row.amount_eth) || 0;
    const bal    = parseFloat(row.contract_balance_eth) || 0;
    if (bal > peak) peak = bal;
    if (DEPOSIT_ACTIONS.has(row.action)) {
      totalIn += amount;
      depositorMap.set(row.from, (depositorMap.get(row.from) || 0) + amount);
    }
    if (WITHDRAW_ACTIONS.has(row.action)) totalOut += amount;
  }
  const finalBal = parseFloat(rows[rows.length - 1].contract_balance_eth) || 0;

  const withdrawals = rows.filter(r => WITHDRAW_ACTIONS.has(r.action));
  const deposits    = rows.filter(r => DEPOSIT_ACTIONS.has(r.action));
  const W = withdrawals.length;

  // [복사] dynamic_analyzer.js:125-128 BALANCE_DROP (isOrganicUnstake=거짓 가정 — 구조 전제 S1, 자체검사 (iii)로 확인)
  const drop  = peak > 0 ? 1 - finalBal / peak : null;
  const bdFraction = (peak > 0 && W > 0) ? clamp((drop - 0.5) / 0.5, 0, 1) : 0;
  const bdEarned   = Math.round(40 * bdFraction);          // weight 40: :130, 반올림: :686
  // [복사] dynamic_analyzer.js:139 FLOW_SPIKE
  const flow  = totalIn > 0 ? totalOut / totalIn : null;
  const fs_   = flow !== null && flow >= 0.5;
  // [복사] dynamic_analyzer.js:99-114 checkOscillating — 변경점: 참/거짓 대신 cycles 수를 반환
  let nearZero = false, recovered = false, cycles = 0;
  for (const row of rows) {
    const bal = parseFloat(row.contract_balance_eth);
    if (bal < 0.01) {
      if (recovered) cycles++;
      nearZero = true;
      recovered = false;
    } else if (nearZero && bal > 0.5) {
      recovered = true;
    }
  }
  // [복사] dynamic_analyzer.js:234-235, 242 singleLargeOutflow의 비율 (hint 쪽 peak는 Math.max(0, …) — 위 peak와 같음)
  const maxSingleWithdraw = Math.max(0, ...withdrawals.map(r => parseFloat(r.amount_eth) || 0));
  const sp = peak > 0 ? maxSingleWithdraw / peak : null;
  // [복사] dynamic_analyzer.js:266-272 participantMidExit
  const lastBlock = parseInt(rows[rows.length - 1]?.block) || 0;
  const mid = withdrawals.filter(r =>
    r.action !== 'owner_withdraw_all' &&
    (parseFloat(r.amount_eth) || 0) > 0 &&
    parseInt(r.block) < lastBlock
  ).length;

  // 구조 전제 S1-S4 측정용 (PROPOSAL 2-4절)
  // S1: [복사] dynamic_analyzer.js:73-76 — 출금 중 원 예치자에게 간 금액 (>0이면 게이트가 열릴 수 있음)
  let toDepositors = 0;
  for (const r of withdrawals) if (depositorMap.has(r.to)) toDepositors += parseFloat(r.amount_eth) || 0;
  // S2: [복사] dynamic_analyzer.js:238, 255-258 ownerWithdrawAll
  const depositFromAddrs = new Set(deposits.map(r => r.from));
  const largestW = withdrawals.reduce((best, r) =>
    (parseFloat(r.amount_eth) || 0) > (parseFloat(best?.amount_eth) || 0) ? r : best, null);
  const ownerWithdrawAll = largestW ? !depositFromAddrs.has(largestW.to) : false;
  // S3: [복사] dynamic_analyzer.js:277 someWithdrawalsFail의 조건 (금액 0 출금)
  const zeroW = withdrawals.filter(r => (parseFloat(r.amount_eth) || 0) === 0).length;
  // S4: [복사] dynamic_analyzer.js:424 stake/unstake
  const stake = rows.some(r => r.action === 'stake' || r.action === 'unstake');

  return {
    W, drop, flow, cycles, sp, mid,
    bd: bdEarned > 0, bdFraction, fs: fs_, osc: cycles >= 2,
    s1: toDepositors > 0, s2: W > 0 && !ownerWithdrawAll, s3: zeroW > 0, s4: stake,
  };
}

// 축약 판정식 (PROPOSAL 0절). dynamic_analyzer.js 우선순위 :363(flash_loan), :396(rug_pull), :403(ponzi_scheme)을
// N=272 구조 전제(S1-S4) 아래에서 줄인 것 — 원본 변경 시 동기화 필요. 자체검사 (ii)가 전 주소 일치를 확인한다.
const P_OSC   = f => f.cycles >= 2;
const P_RUG   = f => f.sp !== null && f.sp >= 0.70 && f.W > 0 && f.mid === 0;
const P_PONZI = f => f.bd && f.fs && f.mid >= 1;
function reducedHint(f) {
  if (P_OSC(f))   return 'flash_loan';
  if (P_RUG(f))   return 'rug_pull';
  if (P_PONZI(f)) return 'ponzi_scheme';
  return 'unknown';
}

// 수준 R의 술어: run 출력의 발동 규칙 id만 쓴다. mid·s/p는 미계산(null). 3값 논리(Kleene)로 거짓이 확정되면 거짓.
function predicatesR(rec) {
  const ids = new Set((rec?.triggered_rules ?? []).map(r => r.id));
  const bd = ids.has('BALANCE_DROP'), fs_ = ids.has('FLOW_SPIKE');
  return { OSC: ids.has('OSCILLATING_BALANCE'), RUG: null, PONZI: (bd && fs_) ? null : false };
}
const predicatesF = f => ({ OSC: P_OSC(f), RUG: P_RUG(f), PONZI: P_PONZI(f) });

// BALANCE_DROP 실효 경계: round(40·clamp((drop−0.5)/0.5)) ≥ 1 ⇔ drop ≥ 0.50625 (dynamic_analyzer.js:128, :130, :646)
const DROP_EFFECTIVE = 0.50625;
const EPS = 1e-12;   // |x−θ| ≤ 폭 비교의 부동소수점 여유
const C3_FEATURES = ['cycles', 'drop', 'flow', 'sp'];
function c3Near(f, near) {
  if (!f) return null;
  const out = {};
  out.cycles = f.cycles === 1 || f.cycles === 2;
  out.drop   = f.W > 0 && f.drop !== null && Math.abs(f.drop - DROP_EFFECTIVE) <= near + EPS;
  out.flow   = f.flow !== null && Math.abs(f.flow - 0.5) <= near + EPS;
  out.sp     = f.mid === 0 && f.W > 0 && f.sp !== null && Math.abs(f.sp - 0.70) <= near + EPS;
  return out;
}
const C3_RULE = {
  cycles: '기준 ≥2, cycles ∈ {1,2} (이산값, --near 무관)',
  drop:   `기준 ${DROP_EFFECTIVE} (BALANCE_DROP 실효 시작점)`,
  flow:   '기준 0.5 (FLOW_SPIKE)',
  sp:     '기준 0.70 (singleLargeOutflow, mid=0일 때만)',
};

// ── [복사] response_reasoner.js:283-294 loadOutliers — 원본 변경 시 동기화 필요 ──
// 변경점: 상태와 함께 파일 줄 번호(헤더=1)를 보관한다.
function loadOutliers(p) {
  const m = new Map();
  if (!fs.existsSync(p)) return m;
  let text = fs.readFileSync(p, 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  text.trim().split(/\r?\n/).slice(1).forEach((line, i) => {
    const f = line.split(',');
    m.set(f[0].trim().toLowerCase(), { status: f[f.length - 1].trim(), line: i + 2 });
  });
  return m;
}

// ── [복사] response_reasoner.js:381-385 changeClass — 원본 변경 시 동기화 필요 ──
function changeClass(trueLabel, o, n) {
  if (o === n) return '-';
  if (trueLabel === 0) return n === 1 ? 'new_FP' : 'FP_resolved';
  return n === 1 ? 'new_TP' : 'new_FN';
}

// ── run 입력 ─────────────────────────────────────────────────────────────────
function readJsonl(file) {
  const m = new Map();
  const text = fs.readFileSync(file, 'utf8').replace(/\r/g, '').trim();
  if (!text) return m;
  for (const line of text.split('\n')) { const o = JSON.parse(line); m.set(o.address, o); }
  return m;
}

// summary.md 1절 "실행 조건" 표의 모듈 sha256(앞 16자)을 읽는다 (response_reasoner.js:493-495 형식)
function readRunHashes(summaryPath) {
  const text = fs.readFileSync(summaryPath, 'utf8').replace(/\r/g, '');
  const pick = (re) => {
    const line = text.split('\n').find(l => re.test(l));
    if (!line) throw new UsageError(`--run summary.md에 해시 행 없음: ${re}`);
    const v = [...line.matchAll(/`([^`]*)`/g)].map(x => x[1]);
    if (v.length < 2) throw new UsageError(`--run summary.md 해시 행 형식 오류: ${line}`);
    return v.slice(-2);
  };
  return {
    dynamic_analyzer:    pick(/^\| analysis\/dynamic_analyzer\.js sha256/),
    fraud_ontology:      pick(/^\| analysis\/analysis\/fraud_ontology\.js sha256/),
    evaluate_comparison: pick(/^\| evaluate_comparison\.js sha256 \|/),
  };
}

const MODULES = {
  dynamic_analyzer:    ['analysis', 'dynamic_analyzer.js'],
  fraud_ontology:      ['analysis', 'analysis', 'fraud_ontology.js'],
  evaluate_comparison: ['evaluation', 'ponzi_comparison', 'evaluate_comparison.js'],
};

// 옮겨진 모듈의 실제 위치 후보(앞에서부터 처음 존재하는 경로로 해시). 라벨은 MODULES의 옛 경로를 그대로 쓴다.
const MODULE_CANDIDATES = {
  fraud_ontology: [['analysis', 'fraud_ontology.js'], ['analysis', 'analysis', 'fraud_ontology.js']],
};

// ── 트리 하나 계산 ──────────────────────────────────────────────────────────────
async function loadTree(treeArg, tag) {
  const root = path.resolve(treeArg);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new UsageError(`--${tag} 트리 없음`);
  const hashes = {};
  for (const [k, parts] of Object.entries(MODULES)) {
    const found = (MODULE_CANDIDATES[k] || []).find(c => fs.existsSync(path.join(root, ...c)));
    hashes[k] = sha256NoCR(path.join(root, ...(found || parts)));
  }
  const pc = path.join(root, 'evaluation', 'ponzi_comparison');
  return {
    tag, root, hashes, pc, logsDir: path.join(pc, 'data', 'logs'),
    outliersPath: path.join(pc, 'data', 'known_outliers.csv'),
  };
}

// 로그 원본에서 읽는 값 (분석기 로직 없음): 행 수, CR 제거 sha256, cumulative_balance 최솟값
function logFacts(t, address) {
  const p = path.join(t.logsDir, `${address}.csv`);
  if (!fs.existsSync(p)) return { exists: false, sha: '(없음)', rows: null, minCum: null, rowsParsed: null };
  const rows = parseCSV(p);
  const minCum = rows && rows.length ? Math.min(...rows.map(r => parseFloat(r.cumulative_balance) || 0)) : null;
  return { exists: true, sha: sha256NoCR(p), rows: rows ? rows.length : 0, minCum, rowsParsed: rows };
}

function sameTriggered(a, b) {
  const norm = x => JSON.stringify((x ?? []).map(r => [r.id, r.weight, r.weight_max, r.fraction]));
  return norm(a) === norm(b);
}

// 수준 F: analyzeDynamic 재실행 + 특징값 + 자체검사 (PROPOSAL 8-2절 (i)(ii)(iii))
function analyzeTreeF(t, analyzeDynamic, recs, tmpDir) {
  const feats = new Map();
  const chk = { i: { checked: 0, bad: [] }, ii: { checked: 0, bad: [] }, iii: { checked: 0, bad: [] },
                pred: { checked: 0, bad: 0 } };
  for (const address of [...recs.keys()].sort()) {
    const rec = recs.get(address);
    const lf  = logFacts(t, address);
    const rows = lf.rowsParsed;
    let status = 'analyzed', res = null, f = null;
    if (!rows || rows.length === 0) status = 'no_log';
    else {
      const perTx = convertToPerTx(rows, address);
      if (perTx.length === 0) status = 'no_value_txs';
      else {
        const tmpPath = path.join(tmpDir, `${t.tag}_${address}.csv`);
        try {
          fs.writeFileSync(tmpPath, [PER_TX_HEADER, ...perTx].join('\n') + '\n', 'utf8');
          res = analyzeDynamic(tmpPath);
        } catch (e) {
          status = 'analyzer_error';
        } finally {
          try { fs.unlinkSync(tmpPath); } catch {}
        }
        if (res) {
          const txRows = perTx.map(l => {
            const v = l.split(',');
            return Object.fromEntries(PER_TX_HEADER.split(',').map((h, i) => [h, v[i]]));
          });
          f = computeFeatures(txRows);
        }
      }
    }

    // (i) run의 jsonl과 같은 입력·결과인가: 상태, 발동 규칙, hint
    chk.i.checked++;
    const recStatus = String(rec.dynamic_status ?? '').startsWith('analyzer_error') ? 'analyzer_error' : rec.dynamic_status;
    if (recStatus !== status) chk.i.bad.push(`${address} status ${rec.dynamic_status}≠${status}`);
    else if (res) {
      const tr = (res.triggered_rules ?? []).map(r => ({ id: r.id, weight: r.weight, weight_max: r.weight_max, fraction: r.fraction }));
      if (!sameTriggered(tr, rec.triggered_rules) || res.fraud_type_hint !== rec.fraud_type_hint) {
        chk.i.bad.push(`${address} triggered_rules/hint`);
      }
    }

    if (res && f) {
      // (ii) 축약 판정식 = 반환 hint, 그리고 그로부터 정한 예측 = run의 dynamic 예측
      chk.ii.checked++;
      const rh = reducedHint(f);
      if (rh !== res.fraud_type_hint) chk.ii.bad.push(`${address} ${res.fraud_type_hint}≠${rh}`);
      chk.pred.checked++;
      if ((EXACT_HINTS.has(rh) ? 1 : 0) !== rec.dynamic_exact_pred || (SUPER_HINTS.has(rh) ? 1 : 0) !== rec.dynamic_super_pred) chk.pred.bad++;
      // (iii) 재계산 OSC/BD/FS 발동 여부·fraction = 반환값
      chk.iii.checked++;
      const got = new Map((res.triggered_rules ?? []).map(r => [r.id, r]));
      const exp = [['OSCILLATING_BALANCE', f.osc, 1], ['BALANCE_DROP', f.bd, +f.bdFraction.toFixed(2)], ['FLOW_SPIKE', f.fs, 1]];
      for (const [id, on, frac] of exp) {
        const g = got.get(id);
        if (!!g !== on || (g && g.fraction !== frac)) { chk.iii.bad.push(`${address} ${id}`); break; }
      }
    }
    feats.set(address, { status, f, lf: { exists: lf.exists, sha: lf.sha, rows: lf.rows, minCum: lf.minCum } });
  }
  const pass = chk.i.bad.length === 0 && chk.ii.bad.length === 0 && chk.iii.bad.length === 0;
  return { feats, chk, pass };
}

function analyzeTreeR(t, recs) {
  const feats = new Map();
  for (const address of [...recs.keys()].sort()) {
    const lf = logFacts(t, address);
    feats.set(address, { status: recs.get(address).dynamic_status, f: null,
                         lf: { exists: lf.exists, sha: lf.sha, rows: lf.rows, minCum: lf.minCum } });
  }
  return { feats, chk: null, pass: null };
}

// ── 표기 ─────────────────────────────────────────────────────────────────────
function fmt(x) {
  if (x === null || x === undefined) return '-';
  if (typeof x === 'boolean') return x ? '참' : '거짓';
  if (Number.isInteger(x)) return String(x);
  return x.toFixed(3);
}
const TF = v => v === null ? '?' : v ? '참' : '거짓';
const pct = (n, d) => d > 0 ? `${(100 * n / d).toFixed(1)}%` : '-';

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── 후보 계산 ─────────────────────────────────────────────────────────────────
function layerOf(o, n) {
  // [복사] response_reasoner.js:414-421 changed_layer — 원본 변경 시 동기화 필요
  const staticChanged  = o.static_pred !== n.static_pred;
  const dynamicChanged = o.dynamic_exact_pred !== n.dynamic_exact_pred || o.dynamic_super_pred !== n.dynamic_super_pred;
  return staticChanged && dynamicChanged ? 'both' : staticChanged ? 'static' : dynamicChanged ? 'dynamic' : '-';
}

function candidatesFor(ctx, address) {
  const { O, N, recO, recN, codeDiffers, near, outliers } = ctx;
  const o = recO.get(address), n = recN.get(address);
  const fo = O.feats.get(address), fn = N.feats.get(address);
  const cands = [];
  const add = (code, side, feature, vo, vn, threshold, evidence) =>
    cands.push({ code, side, feature, value_old: vo, value_new: vn, threshold, evidence });

  // C1 변경 위치
  const dataDiff = fo.lf.sha !== fn.lf.sha;
  if (dataDiff) {
    add('C1-DATA', 'both', 'log_sha256', fo.lf.sha.slice(0, 12), fn.lf.sha.slice(0, 12), '',
        `로그 sha 다름 · 행 ${fmt(fo.lf.rows)}→${fmt(fn.lf.rows)} · minCum ${fmt(fo.lf.minCum)}→${fmt(fn.lf.minCum)} · ` +
        `분석기 sha ${codeDiffers ? '다름 (데이터·코드 기여 분리는 사람 판단)' : '같음'}`);
  }
  const layer = layerOf(o, n);
  if (codeDiffers && !dataDiff && (layer === 'dynamic' || layer === 'both')) {
    add('C1-CODE', 'both', 'dynamic_analyzer_sha256', '', '', '',
        `분석기 sha 다름 · 로그 sha 같음 · 변경 층 ${layer}`);
  }

  // C2 판정 경로 전환
  const po = fo.f ? predicatesF(fo.f) : predicatesR(o);
  const pn = fn.f ? predicatesF(fn.f) : predicatesR(n);
  const C2_EVID = {
    OSC:   (a, b) => `cycles ${fmt(a?.cycles)}→${fmt(b?.cycles)} (기준 ≥2)`,
    RUG:   (a, b) => `s/p ${fmt(a?.sp)}→${fmt(b?.sp)} (기준 ≥0.70) · mid ${fmt(a?.mid)}→${fmt(b?.mid)} (기준 =0)`,
    PONZI: (a, b) => `drop ${fmt(a?.drop)}→${fmt(b?.drop)} (기준 ≥${DROP_EFFECTIVE}) · flow ${fmt(a?.flow)}→${fmt(b?.flow)} (기준 ≥0.5) · mid ${fmt(a?.mid)}→${fmt(b?.mid)} (기준 ≥1)`,
  };
  for (const k of ['OSC', 'RUG', 'PONZI']) {
    if (po[k] === null || pn[k] === null || po[k] === pn[k]) continue;
    const viaIds = !fo.f || !fn.f;
    const ruleEv = viaIds
      ? ` · 발동 규칙 ${(o.triggered_rules ?? []).map(r => r.id).join(';') || '없음'} → ${(n.triggered_rules ?? []).map(r => r.id).join(';') || '없음'}`
      : '';
    add(`C2-${k}`, 'both', `P_${k.toLowerCase()}`, TF(po[k]), TF(pn[k]), '', `P_${k.toLowerCase()} ${TF(po[k])}→${TF(pn[k])} · ${C2_EVID[k](fo.f, fn.f)}${ruleEv}`);
  }

  // C3 경계 근접 (자체검사 통과 측만)
  const no = c3Near(fo.f, near), nn = c3Near(fn.f, near);
  for (const k of C3_FEATURES) {
    if (!(no?.[k] || nn?.[k])) continue;
    const vo = fo.f ? fmt(fo.f[k]) : '생략', vn = fn.f ? fmt(fn.f[k]) : '생략';
    add(`C3-NEAR:${k}`, no?.[k] && nn?.[k] ? 'both' : no?.[k] ? 'old' : 'new', k, vo, vn, C3_RULE[k],
        `o=${vo}, n=${vn}, ${C3_RULE[k]}${k === 'cycles' ? '' : `, 폭 ±${near} (근거 없는 잠정값)`}`);
  }

  // C4 데이터 품질 (동반 관찰)
  const ol = outliers.get(address.toLowerCase());
  if (ol) add('C4-REG', 'registry', 'known_outlier_status', '', ol.status, '',
              `동반 관찰 · ${ol.src} known_outliers.csv:${ol.line} ${ol.status}`);
  const negO = fo.lf.minCum !== null && fo.lf.minCum < 0, negN = fn.lf.minCum !== null && fn.lf.minCum < 0;
  if (negO || negN) {
    add('C4-NEG', negO && negN ? 'both' : negO ? 'old' : 'new', 'min_cumulative_balance', fmt(fo.lf.minCum), fmt(fn.lf.minCum), '< 0',
        `동반 관찰 · minCum ${fmt(fo.lf.minCum)}→${fmt(fn.lf.minCum)} (< 0) · drop ${fmt(fo.f?.drop)}→${fmt(fn.f?.drop)} · flow ${fmt(fo.f?.flow)}→${fmt(fn.f?.flow)}`);
  }

  if (cands.length === 0) {
    add('C0-NONE', 'both', '', '', '', '', '계산 가능한 후보 없음 — 사람 조사 필요');
  }
  return { cands, layer };
}

// ── 기저율 (new 트리 전체, 변경 여부 무관) ──────────────────────────────────────
function baseRates(ctx) {
  const { O, N, recO, recN, codeDiffers, near, outliers } = ctx;
  const shared = [...recN.keys()].filter(a => recO.has(a)).sort();
  const analyzedN = [...N.feats.values()].filter(x => x.f).length;
  const withLogN  = [...N.feats.values()].filter(x => x.lf.exists).length;
  const r = [];
  const c1data = shared.filter(a => O.feats.get(a).lf.sha !== N.feats.get(a).lf.sha).length;
  r.push(['C1-DATA', '두 트리의 로그 sha 다름', c1data, shared.length]);
  r.push(['C1-CODE', '분석기 sha 다름 (실행 단위)', codeDiffers ? shared.length - c1data : 0, shared.length]);
  const c2 = shared.filter(a => {
    const fo = O.feats.get(a), fn = N.feats.get(a);
    const po = fo.f ? predicatesF(fo.f) : predicatesR(recO.get(a));
    const pn = fn.f ? predicatesF(fn.f) : predicatesR(recN.get(a));
    return ['OSC', 'RUG', 'PONZI'].some(k => po[k] !== null && pn[k] !== null && po[k] !== pn[k]);
  }).length;
  r.push(['C2', '술어(P_osc/P_rug/P_ponzi) 중 하나가 o→n에서 바뀜 (확정된 것만)', c2, shared.length]);
  const c3 = N.pass === false || !N.chk ? null
    : [...N.feats.values()].filter(x => { const nr = c3Near(x.f, near); return nr && C3_FEATURES.some(k => nr[k]); }).length;
  r.push(['C3', `new 트리 단독, 특징 중 하나가 경계 근접 (폭 ±${near}, 근거 없는 잠정값)`, c3, analyzedN]);
  const reg = [...recN.keys()].filter(a => outliers.has(a.toLowerCase())).length;
  r.push(['C4-REG', '이상치 레지스트리 등재', reg, recN.size]);
  const neg = [...N.feats.values()].filter(x => x.lf.minCum !== null && x.lf.minCum < 0).length;
  r.push(['C4-NEG', 'new 로그 minCum < 0', neg, withLogN]);
  const perFeature = N.pass === false || !N.chk ? null : Object.fromEntries(C3_FEATURES.map(k =>
    [k, [...N.feats.values()].filter(x => c3Near(x.f, near)?.[k]).length]));
  return { rows: r, perFeature, analyzedN };
}

function structural(T) {
  if (!T.chk || T.pass === false) return null;
  const fs_ = [...T.feats.values()].filter(x => x.f).map(x => x.f);
  return {
    n: fs_.length,
    S1: fs_.filter(f => f.s1).length, S2: fs_.filter(f => f.s2).length,
    S3: fs_.filter(f => f.s3).length, S4: fs_.filter(f => f.s4).length,
  };
}

// ── 출력 ─────────────────────────────────────────────────────────────────────
const LEGEND = [
  '- 이 리포트는 수정안이 아니다. 규칙·데이터 변경은 사람 승인 후 별도 작업으로 한다.',
  '- 후보는 원인 판정이 아니다. 신뢰도·순위 없이 코드 순서(C1→C4)로 나열하고, 각 줄에 근거 수치와 기준값을 적는다.',
  '- C1 해시는 파일 단위다. 같은 파일 안 어느 줄이 바뀌었는지는 말하지 않는다.',
  '- C2는 N=272 예측을 정하는 술어의 참/거짓 전환이다: P_osc = cycles≥2 (→flash_loan), P_rug = s/p≥0.70 ∧ 출금>0 ∧ mid=0 (→rug_pull), P_ponzi = BALANCE_DROP 발동 ∧ flow≥0.5 ∧ mid≥1 (→ponzi_scheme).',
  '- C3 폭은 근거 없는 잠정값이다. cycles는 이산값이라 폭과 무관하게 {1,2}를 근접으로 본다. mid_exits는 C3에 넣지 않는다.',
  '- C4는 "동반 관찰"이다. 원인 판정이 아니다 — 정답 사례 0xbc9ccc8a·0xcafe1a77·0x20d42f2e에서 데이터 손상이 동반됐으나 사람이 내린 원인은 규칙이었다.',
  '- 참고 수치(score, raw=Σweight, verdict)는 후보가 아니다. N=272 예측은 fraud_type_hint로만 정해지고 verdict는 쓰이지 않는다 (evaluate_comparison.js:181-184, 204-205).',
  '- C0-NONE은 계산 가능한 후보가 없다는 뜻이다. 사람 조사가 필요하다.',
];

function sideStatus(T) {
  if (!T.chk) return 'R (--level R)';
  return T.pass ? 'F (자체검사 통과)' : 'R (자체검사 실패 → 강등)';
}

function buildHeader(c) {
  const { args, O, N, base, exitCode, targets } = c;
  const out = []; const p = (...l) => out.push(...l);
  const failed = [O, N].filter(T => T.chk && !T.pass);
  if (failed.length) {
    p(`> **경고: 자체검사 실패 (종료 코드 3).** ${failed.map(T => T.tag).join(', ')} 트리는 수준 R로 내렸다 — 그 쪽의 C2는 발동 규칙 id 기반 부분 판정, C3는 생략.`,
      '> 복사한 판정 로직이 그 트리의 분석기와 다를 수 있다(과거 버전 등).', '');
  }
  p('# 원인 후보 리포트 — 머리말', '');
  p(`- 종료 코드: **${exitCode}** — 0 정상(후보 유무 무관) / 2 실행 오류 / 3 자체검사 실패(해당 트리 강등)`);
  p(`- 대상 주소: **${targets.length}개** (changed.csv ∪ disagreement_delta.csv). 상세: \`candidates.md\`, \`candidates.csv\``);
  p(`- C3 폭: ±${args.near} (근거 없는 잠정값)`);
  p('', '## 1. 실행 조건', '');
  p('| 항목 | old | new |', '|---|---|---|');
  for (const k of Object.keys(MODULES)) {
    p(`| ${MODULES[k].join('/')} sha256 (CR 제거, 앞 16자) | \`${O.hashes[k].slice(0, 16)}\` | \`${N.hashes[k].slice(0, 16)}\` |`);
  }
  p(`| --run summary.md 해시와 일치 | 예 | 예 |`);
  p(`| 수준 | ${sideStatus(O)} | ${sideStatus(N)} |`);
  p(`| run 주소 수 | ${c.recO.size} | ${c.recN.size} |`);
  // node 버전은 출력 파일에 넣지 않는다 (v18/v22 결과 byte-identical 확인용). stdout에만 찍는다.

  p('', '## 2. 자체검사 (PROPOSAL 8-2절)', '');
  p('| 검사 | old | new |', '|---|---|---|');
  const cell = (T, k) => !T.chk ? '-' : `${T.chk[k].checked - T.chk[k].bad.length}/${T.chk[k].checked}`;
  p(`| (i) analyzeDynamic 재실행 = run jsonl (상태·발동 규칙·hint) | ${cell(O, 'i')} | ${cell(N, 'i')} |`);
  p(`| (ii) 축약 판정식 = 반환 hint | ${cell(O, 'ii')} | ${cell(N, 'ii')} |`);
  p(`| (ii') 축약 판정식으로 정한 dynamic 예측 = run 예측 | ${!O.chk ? '-' : `${O.chk.pred.checked - O.chk.pred.bad}/${O.chk.pred.checked}`} | ${!N.chk ? '-' : `${N.chk.pred.checked - N.chk.pred.bad}/${N.chk.pred.checked}`} |`);
  p(`| (iii) 재계산 OSC/BD/FS 발동·fraction = 반환값 | ${cell(O, 'iii')} | ${cell(N, 'iii')} |`);
  for (const T of [O, N]) {
    if (!T.chk || T.pass) continue;
    for (const k of ['i', 'ii', 'iii']) {
      if (T.chk[k].bad.length) p('', `${T.tag} (${k}) 불일치 앞 5건: ${T.chk[k].bad.slice(0, 5).map(x => `\`${x}\``).join(', ')}`);
    }
  }

  p('', '## 3. 구조 전제 (N=272 경로, PROPOSAL 2-4절)', '');
  p('0이 아니게 되면 축약 판정식의 전제가 깨진 것이다 (자체검사 (ii)도 함께 확인).', '');
  p('| # | 전제 위반 주소 수 | old | new |', '|---|---|---:|---:|');
  const so = structural(O), sn = structural(N);
  const sc = (s, k) => s ? `${s[k]}/${s.n}` : '생략';
  p(`| S1 | 출금이 원 예치자에게 간 주소 (isOrganicUnstake 게이트가 열릴 수 있음) | ${sc(so, 'S1')} | ${sc(sn, 'S1')} |`);
  p(`| S2 | 출금이 있는데 ownerWithdrawAll=거짓 (money_laundering 도달 가능) | ${sc(so, 'S2')} | ${sc(sn, 'S2')} |`);
  p(`| S3 | 금액 0 출금 존재 (unclassified_warning·pump_and_dump 도달 가능) | ${sc(so, 'S3')} | ${sc(sn, 'S3')} |`);
  p(`| S4 | stake/unstake action 존재 (normal_staking 도달 가능) | ${sc(so, 'S4')} | ${sc(sn, 'S4')} |`);
  const hintDist = rec => { const m = {}; for (const r of rec.values()) if (r.fraud_type_hint) m[r.fraud_type_hint] = (m[r.fraud_type_hint] || 0) + 1;
    return Object.keys(m).sort().map(k => `${k} ${m[k]}`).join(', '); };
  p(`| S5 | hint 분포 (run jsonl) | ${hintDist(c.recO)} | ${hintDist(c.recN)} |`);

  p('', '## 4. 후보별 기저율 (변경 여부 무관, 전체 주소 기준)', '');
  p('| 코드 | 조건 | 성립 | 분모 | 비율 |', '|---|---|---:|---:|---:|');
  for (const [code, cond, k, d] of base.rows) p(`| ${code} | ${cond} | ${k === null ? '생략' : k} | ${d} | ${k === null ? '-' : pct(k, d)} |`);
  if (base.perFeature) {
    p('', `C3 특징별 (new 트리, 폭 ±${args.near}): ` + C3_FEATURES.map(k => `${k} ${base.perFeature[k]}`).join(' · '));
  }
  if (c.staticOnly.length) {
    p('', `정적 층 변경 주소 ${c.staticOnly.length}개 — 이 도구는 정적 원인 후보를 내지 않는다 (PROPOSAL 5-2절).`);
  }

  p('', '## 5. 범례', '', ...LEGEND);
  return out.join('\n') + '\n';
}

function buildCandidatesMd(c) {
  const out = []; const p = (...l) => out.push(...l);
  p('# 원인 후보 리포트', '', '머리말(실행 조건·자체검사·구조 전제·기저율·범례)은 `header.md`에 있다. 후보는 원인 판정이 아니다.', '');
  if (c.exitCode === 3) p('> **경고: 자체검사 실패 (종료 코드 3).** header.md 맨 위 참고.', '');
  if (c.targets.length === 0) { p('(대상 주소 없음)'); return out.join('\n') + '\n'; }
  const { O, N } = c;
  const tagLine = [O, N].filter(T => !T.f_ok).map(T => `${T.tag} 측 ${T.chk ? '자체검사 실패' : '--level R'} — C2 부분, C3 생략`);
  for (const t of c.results) {
    const { address, o, n, cands, layer } = t;
    const fo = O.feats.get(address), fn = N.feats.get(address);
    const ol = c.outliers.get(address.toLowerCase());
    p(`## ${address}`);
    p(`true=${n.true_label} · exact ${o.final_exact_pred}→${n.final_exact_pred} ${changeClass(n.true_label, o.final_exact_pred, n.final_exact_pred)} · ` +
      `super ${o.final_super_pred}→${n.final_super_pred} ${changeClass(n.true_label, o.final_super_pred, n.final_super_pred)} · ` +
      `층 ${layer} · hint ${o.fraud_type_hint}→${n.fraud_type_hint} · known_outlier ${ol ? ol.status : '-'}`);
    const fv = (F, k) => F.f ? fmt(F.f[k]) : (O.f_ok && N.f_ok ? F.status : '생략');
    p(`판정 특징 (o→n): cycles ${fv(fo, 'cycles')}→${fv(fn, 'cycles')} (≥2) · s/p ${fv(fo, 'sp')}→${fv(fn, 'sp')} (≥0.70, mid=0일 때) · ` +
      `mid ${fv(fo, 'mid')}→${fv(fn, 'mid')} (≥1) · drop ${fv(fo, 'drop')}→${fv(fn, 'drop')} (≥${DROP_EFFECTIVE}) · flow ${fv(fo, 'flow')}→${fv(fn, 'flow')} (≥0.5)`);
    if (layer === 'static') p('(정적 층만 변경 — 이 도구는 정적 원인 후보를 내지 않는다)');
    if (tagLine.length) p(`(${tagLine.join(' / ')})`);
    p('후보:');
    for (const x of cands) p(`- [${x.code}] ${x.evidence}`);
    const raw = r => (r.triggered_rules ?? []).reduce((s, x) => s + x.weight, 0);
    p(`참고 수치(예측 미사용): score ${o.dynamic_risk_score ?? '-'}→${n.dynamic_risk_score ?? '-'} · raw ${raw(o)}→${raw(n)} · verdict ${o.verdict ?? '-'}→${n.verdict ?? '-'}`, '');
  }
  return out.join('\n');
}

function buildCandidatesCsv(c) {
  const lines = ['address,code,side,feature,value_old,value_new,threshold,evidence'];
  for (const t of c.results) {
    for (const x of t.cands) {
      lines.push([t.address, x.code, x.side, x.feature, x.value_old, x.value_new, x.threshold, x.evidence].map(csvCell).join(','));
    }
  }
  return lines.join('\n') + '\n';
}

// ── main ─────────────────────────────────────────────────────────────────────
let tmpToClean = null;   // 오류 종료 때 --out/.tmp를 지우기 위함

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = path.resolve(args.run);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) throw new UsageError('--run 디렉터리 없음');
  for (const f of ['changed.csv', 'disagreement_delta.csv', 'old.jsonl', 'new.jsonl', 'summary.md']) {
    if (!fs.existsSync(path.join(runDir, f))) throw new UsageError(`--run에 파일 없음: ${f}`);
  }
  const O = await loadTree(args.old, 'old');
  const N = await loadTree(args.new, 'new');

  // run–트리 대응 확인 (summary.md 1절 해시). --out을 만들기 전에 한다.
  const runHashes = readRunHashes(path.join(runDir, 'summary.md'));
  for (const [k, [ho, hn]] of Object.entries(runHashes)) {
    if (O.hashes[k].slice(0, 16) !== ho) throw new UsageError(`--old 트리의 ${MODULES[k].join('/')} sha256이 run과 다름`);
    if (N.hashes[k].slice(0, 16) !== hn) throw new UsageError(`--new 트리의 ${MODULES[k].join('/')} sha256이 run과 다름`);
  }

  const outDir = prepareOut(args.out, [O.root, N.root, runDir]);
  const tmpDir = path.join(outDir, '.tmp');
  tmpToClean = tmpDir;

  const recO = readJsonl(path.join(runDir, 'old.jsonl'));
  const recN = readJsonl(path.join(runDir, 'new.jsonl'));
  const changed = parseCSV(path.join(runDir, 'changed.csv')) ?? [];
  const delta   = parseCSV(path.join(runDir, 'disagreement_delta.csv')) ?? [];
  const targets = [...new Set([...changed.map(r => r.address), ...delta.map(r => r.address)])].sort();
  for (const a of targets) if (!recO.has(a) || !recN.has(a)) throw new UsageError(`run jsonl에 대상 주소 없음: ${a}`);

  for (const T of [O, N]) {
    const recs = T.tag === 'old' ? recO : recN;
    let r;
    if (args.level === 'R') r = analyzeTreeR(T, recs);
    else {
      let analyzeDynamic;
      try { ({ analyzeDynamic } = await import(pathToFileURL(path.join(T.root, ...MODULES.dynamic_analyzer)).href)); }
      catch (e) { throw new UsageError(`${T.tag}: analyzeDynamic import 실패: ${e.message}`); }
      if (typeof analyzeDynamic !== 'function') throw new UsageError(`${T.tag}: analyzeDynamic export 없음`);
      r = analyzeTreeF(T, analyzeDynamic, recs, tmpDir);
    }
    Object.assign(T, r);
    T.f_ok = !!(T.chk && T.pass);
    // 강등: 자체검사 실패 측은 특징값을 쓰지 않는다 (C2 부분, C3 생략)
    if (!T.f_ok) for (const v of T.feats.values()) v.f = null;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // known_outliers: new 트리 우선, 없으면 old (response_reasoner.js:603-604와 같은 규칙)
  const outliers = new Map();
  for (const [T, src] of [[O, 'old 트리'], [N, 'new 트리']]) {
    for (const [a, v] of loadOutliers(T.outliersPath)) outliers.set(a, { ...v, src });
  }

  const codeDiffers = O.hashes.dynamic_analyzer !== N.hashes.dynamic_analyzer;
  const ctx = { O, N, recO, recN, codeDiffers, near: args.near, outliers };
  const results = targets.map(a => ({ address: a, o: recO.get(a), n: recN.get(a), ...candidatesFor(ctx, a) }));
  const staticOnly = results.filter(r => r.layer === 'static').map(r => r.address);
  const base = baseRates(ctx);
  const exitCode = [O, N].some(T => T.chk && !T.pass) ? 3 : 0;

  const c = { args, O, N, recO, recN, targets, results, base, exitCode, outliers, staticOnly };
  fs.writeFileSync(path.join(outDir, 'header.md'), buildHeader(c), 'utf8');
  fs.writeFileSync(path.join(outDir, 'candidates.md'), buildCandidatesMd(c), 'utf8');
  fs.writeFileSync(path.join(outDir, 'candidates.csv'), buildCandidatesCsv(c), 'utf8');

  for (const T of [O, N]) if (T.chk && !T.pass) console.error(`[자체검사 실패] ${T.tag} 트리 → 수준 R로 강등`);
  console.log(`대상 주소 ${targets.length}개, 후보 행 ${results.reduce((s, r) => s + r.cands.length, 0)}개, ` +
              `수준 old=${O.f_ok ? 'F' : 'R'} new=${N.f_ok ? 'F' : 'R'}, node ${process.version}, 종료 코드 ${exitCode}`);
  return exitCode;
}

main().then(code => process.exit(code)).catch(e => {
  if (tmpToClean) { try { fs.rmSync(tmpToClean, { recursive: true, force: true }); } catch {} }
  if (e instanceof UsageError) { console.error(`[오류] ${e.message}\n\n${USAGE}`); }
  else { console.error(`[오류] ${e.stack ?? e}`); }
  process.exit(2);
});
