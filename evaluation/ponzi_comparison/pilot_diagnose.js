/**
 * pilot_diagnose.js
 *
 * 파일럿 30개 주소에 대해:
 *   1. 잔고 진단 (peak / final / ratio / isMajorDrain)
 *   2. 정적 분석 (fraud_ontology.js 패턴 매칭)
 *   3. 동적 분석 (dynamic_analyzer.js, 포맷 변환 포함)
 *   4. 베이스라인(RF) 결과 읽기
 *   5. P/R/F1 비교 + comparison_report_pilot.md 저장
 *
 * 전제: fetch_and_convert.js + baseline_classifier.js 가 pilot 파일로 먼저 실행됨
 *   LABELS_FILE=data/pilot_addresses.csv ETHERSCAN_API_KEY=... node fetch_and_convert.js
 *   LABELS_FILE=data/pilot_addresses.csv PREDICTIONS_FILE=results/baseline_predictions_pilot.csv node baseline_classifier.js
 *
 * 실행: node pilot_diagnose.js
 */

import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DATA_DIR    = path.join(__dirname, 'data');
const SOURCES_DIR = path.join(DATA_DIR, 'sources');
const LOGS_DIR    = path.join(DATA_DIR, 'logs');
const RESULTS_DIR = path.join(__dirname, 'results');

const PILOT_FILE  = path.join(DATA_DIR, 'pilot_addresses.csv');
const BASE_PRED_FILE = path.join(RESULTS_DIR, 'baseline_predictions_pilot.csv');
const REPORT_OUT  = path.join(RESULTS_DIR, 'comparison_report_pilot.md');

// ── Module load ───────────────────────────────────────────────────────────────
let analyzeDynamic = null;
let FraudOntology  = null;

try {
  const m = await import('../../analysis/dynamic_analyzer.js');
  analyzeDynamic = m.analyzeDynamic;
  console.log('[OK] dynamic_analyzer.js');
} catch (e) {
  console.warn(`[경고] dynamic_analyzer.js 로드 실패: ${e.message}`);
}

try {
  const m = await import('../../analysis/analysis/fraud_ontology.js');
  FraudOntology = m.FraudOntology;
  console.log('[OK] fraud_ontology.js');
} catch (e) {
  console.warn(`[경고] fraud_ontology.js 로드 실패: ${e.message}`);
}

// ── CSV ───────────────────────────────────────────────────────────────────────
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

// ── Static analysis (same logic as evaluate_comparison.js) ───────────────────
function scoreAllFraudTypes(src) {
  if (!FraudOntology?.preventionRules) return {};
  const scores = {};
  for (const [typeName, rules] of Object.entries(FraudOntology.preventionRules)) {
    let score = 0;
    for (const item of rules.checklistItems) {
      const parts = item.detectPattern.split('|').filter(p => !p.startsWith('ABSENCE:'));
      if (parts.length === 0) continue;
      const matched = parts.some(p => { try { return new RegExp(p).test(src); } catch { return false; } });
      if (matched) score += (item.riskWeight ?? 0);
    }
    scores[typeName] = score;
  }
  return scores;
}

function staticPredict(address) {
  const solPath = path.join(SOURCES_DIR, `${address}.sol`);
  if (!fs.existsSync(solPath)) return { pred: -1, reason: 'no_source' };
  const src    = fs.readFileSync(solPath, 'utf8');
  const scores = scoreAllFraudTypes(src);
  if (Object.keys(scores).length === 0) return { pred: 0, reason: 'no_ontology' };
  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return { pred: 0, reason: 'no_pattern_hit' };
  const topType = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  return { pred: topType === 'PonziScheme' ? 1 : 0, fraudType: topType, score: maxScore };
}

// ── Dynamic analysis (same format adapter as evaluate_comparison.js) ──────────
function convertToPerTx(rows, address) {
  if (!rows || rows.length === 0) return [];
  const addr     = address.toLowerCase();
  const peak     = rows.reduce((m, r) => Math.max(m, parseFloat(r.cumulative_balance) || 0), 0);
  const finalBal = parseFloat(rows[rows.length - 1].cumulative_balance) || 0;
  const isMajorDrain = peak > 0 && finalBal < peak * 0.1;
  const outRows  = rows.filter(r => (parseFloat(r.total_out) || 0) > 1e-12);
  const lastOutRow = outRows.length > 0 ? outRows[outRows.length - 1] : null;
  const perTx = [];
  let depIdx  = 0;
  for (const row of rows) {
    const blk    = parseInt(row.block)       || 0;
    const tin    = parseFloat(row.total_in)  || 0;
    const tout   = parseFloat(row.total_out) || 0;
    const cumBal = parseFloat(row.cumulative_balance) || 0;
    if (tin > 1e-12) {
      depIdx++;
      const depAddr = `0x${depIdx.toString(16).padStart(40, '0')}`;
      perTx.push(`${blk},0,${depAddr},${addr},deposit,${tin.toFixed(8)},${(cumBal + tout).toFixed(8)},${depIdx}`);
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

const PER_TX_HEADER = 'block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count';

// exact_match: Ponzi Scheme 유형으로 정확히 분류된 경우만 positive
const EXACT_HINTS = new Set(['ponzi_scheme', 'ponzi_or_laundering']);
// superclass:  사기 컨트랙트(FraudContract 하위 유형) 여부만 판별
const SUPER_HINTS = new Set(['ponzi_scheme', 'ponzi_or_laundering',
                              'rug_pull', 'money_laundering', 'pump_and_dump']);

function dynamicPredict(address) {
  if (!analyzeDynamic) return { exactPred: -1, superPred: -1, reason: 'no_analyzer', hint: null };
  const logPath = path.join(LOGS_DIR, `${address}.csv`);
  const rows    = parseCSV(logPath);
  if (!rows || rows.length === 0) return { exactPred: -1, superPred: -1, reason: 'no_log', hint: null };
  const perTx   = convertToPerTx(rows, address);
  if (perTx.length === 0) return { exactPred: 0, superPred: 0, reason: 'no_value_txs', hint: null };
  const tmpPath = path.join(os.tmpdir(), `pilot_diag_${Date.now()}_${Math.random().toString(36).slice(2)}.csv`);
  try {
    fs.writeFileSync(tmpPath, [PER_TX_HEADER, ...perTx].join('\n') + '\n', 'utf8');
    const result = analyzeDynamic(tmpPath);
    const hint   = result.fraud_type_hint ?? 'unknown';
    return {
      exactPred: EXACT_HINTS.has(hint) ? 1 : 0,
      superPred: SUPER_HINTS.has(hint) ? 1 : 0,
      hint, score: result.dynamic_risk_score, verdict: result.verdict,
      triggered: result.triggered_rules?.map(r => r.id) ?? [],
    };
  } catch (e) {
    return { exactPred: -1, superPred: -1, reason: `error: ${e.message}`, hint: null };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

// ── Balance diagnostics ───────────────────────────────────────────────────────
function balanceDiag(address) {
  const logPath = path.join(LOGS_DIR, `${address}.csv`);
  const rows    = parseCSV(logPath);
  if (!rows || rows.length === 0) return null;
  const bals = rows.map(r => parseFloat(r.cumulative_balance) || 0);
  const peak = Math.max(...bals);
  const finalBal = bals[bals.length - 1];
  const ratio = peak > 0 ? finalBal / peak : 0;
  return { peak, finalBal, ratio, isMajorDrain: ratio < 0.1, nBlocks: rows.length };
}

// ── Metrics ───────────────────────────────────────────────────────────────────
function computeMetrics(yTrue, yPred) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const [t, p] = [yTrue[i], yPred[i]];
    if      (t === 1 && p === 1) tp++;
    else if (t === 0 && p === 1) fp++;
    else if (t === 1 && p === 0) fn++;
    else                          tn++;
  }
  const prec = tp + fp > 0 ? tp / (tp + fp) : 0;
  const rec  = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1   = prec + rec > 0 ? 2 * prec * rec / (prec + rec) : 0;
  return { prec, rec, f1, tp, fp, fn, tn };
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (!fs.existsSync(PILOT_FILE)) {
  console.error(`[오류] ${PILOT_FILE} 없음`);
  process.exit(1);
}

const pilotRaw   = fs.readFileSync(PILOT_FILE, 'utf8');
const pilotEntries = pilotRaw.trim().split(/\r?\n/).slice(1)
  .map(l => { const [a, lbl] = l.split(','); return { address: a.trim(), label: parseInt(lbl.trim()) }; });

const ponziEntries  = pilotEntries.filter(e => e.label === 1);
const normalEntries = pilotEntries.filter(e => e.label === 0);

console.log(`\n파일럿 ${pilotEntries.length}개 (ponzi=${ponziEntries.length}, normal=${normalEntries.length})\n`);

// ── Baseline predictions ──────────────────────────────────────────────────────
const baseRows = parseCSV(BASE_PRED_FILE);
if (!baseRows) {
  console.warn(`[경고] ${BASE_PRED_FILE} 없음 — baseline 비교 생략\n` +
    `  먼저 실행: LABELS_FILE=data/pilot_addresses.csv PREDICTIONS_FILE=results/baseline_predictions_pilot.csv node baseline_classifier.js`);
}
const baseMap = new Map(
  (baseRows ?? []).map(r => [r.address, { pred: parseInt(r.predicted_label), score: parseFloat(r.predicted_score) }])
);

// ── Per-address analysis ──────────────────────────────────────────────────────
const results = [];

for (const { address, label } of pilotEntries) {
  const diag = balanceDiag(address);
  const sp   = staticPredict(address);
  const dp   = dynamicPredict(address);
  const sPred      = sp.pred      === -1 ? 0 : sp.pred;
  const dExact     = dp.exactPred === -1 ? 0 : dp.exactPred;
  const dSuper     = dp.superPred === -1 ? 0 : dp.superPred;
  const finalExact = (sPred === 1 || dExact === 1) ? 1 : 0;
  const finalSuper = (sPred === 1 || dSuper === 1) ? 1 : 0;
  const basePred   = baseMap.get(address)?.pred ?? -1;

  results.push({ address, label, diag, sp, dp, sPred, dExact, dSuper, finalExact, finalSuper, basePred });
}

// ── Console output ─────────────────────────────────────────────────────────────

// 1. Ponzi 주소 잔고 진단
console.log('━━ PONZI 주소 잔고 진단 (' + ponziEntries.length + '개) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  ${'address'.padEnd(44)} ${'peak(Ξ)'.padStart(10)} ${'final(Ξ)'.padStart(10)} ${'ratio'.padStart(7)} ${'drain'.padStart(6)} ${'blocks'.padStart(7)}`);
console.log(`  ${'-'.repeat(90)}`);

let majorDrainCount = 0;
for (const r of results.filter(r => r.label === 1)) {
  if (!r.diag) {
    console.log(`  ${r.address}  (로그 없음)`);
    continue;
  }
  const { peak, finalBal, ratio, isMajorDrain, nBlocks } = r.diag;
  if (isMajorDrain) majorDrainCount++;
  const flag = isMajorDrain ? '✓' : ' ';
  console.log(
    `  ${r.address}  ${peak.toFixed(4).padStart(10)} ${finalBal.toFixed(4).padStart(10)} ` +
    `${(ratio * 100).toFixed(1).padStart(6)}% ${flag.padStart(5)}  ${String(nBlocks).padStart(6)}`
  );
}

const withLog = results.filter(r => r.label === 1 && r.diag !== null).length;
const noLog   = results.filter(r => r.label === 1 && r.diag === null).length;
console.log(`\n  → 로그 있음: ${withLog}개 / 로그 없음(스킵): ${noLog}개`);
console.log(`  → isMajorDrain(ratio < 10%): ${majorDrainCount}/${withLog}개\n`);

// 2. Dynamic analysis results
console.log('━━ 동적 분석 결과 (ponzi 주소, 로그 있는 것만) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
let dynamicExactHit = 0;
let dynamicSuperHit = 0;
for (const r of results.filter(r => r.label === 1 && r.diag)) {
  const hint = r.dp.hint ?? r.dp.reason ?? '-';
  if (EXACT_HINTS.has(hint)) dynamicExactHit++;
  if (SUPER_HINTS.has(hint)) dynamicSuperHit++;
  const trigg = r.dp.triggered?.join('+') ?? '-';
  console.log(
    `  ${r.address.slice(0, 12)}...  ` +
    `hint=${hint.padEnd(22)} score=${String(r.dp.score ?? '-').padStart(3)} ` +
    `rules=[${trigg}]`
  );
}
console.log(`\n  → exact match(ponzi_scheme): ${dynamicExactHit}/${withLog}개`);
console.log(`  → superclass(사기 전반):      ${dynamicSuperHit}/${withLog}개\n`);

// 3. Static analysis results
console.log('━━ 정적 분석 결과 (ponzi 주소) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
let staticPonziHit = 0;
let staticNoSrc    = 0;
for (const r of results.filter(r => r.label === 1)) {
  if (r.sp.pred === -1) { staticNoSrc++; continue; }
  if (r.sp.pred === 1)  staticPonziHit++;
  console.log(
    `  ${r.address.slice(0, 12)}...  ` +
    `pred=${r.sp.pred}  type=${(r.sp.fraudType ?? r.sp.reason ?? '-').padEnd(16)} score=${r.sp.score ?? '-'}`
  );
}
console.log(`\n  → PonziScheme 탐지: ${staticPonziHit}개 / 소스 없음: ${staticNoSrc}개\n`);

// 4. Metrics summary
console.log('━━ 시스템별 성능 (파일럿 30개 기준) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const validForMetrics = results.filter(r => r.basePred !== -1);
const yTrue     = validForMetrics.map(r => r.label);
const yBase     = validForMetrics.map(r => r.basePred);
const yStatic   = validForMetrics.map(r => r.sPred);
const yDynExact = validForMetrics.map(r => r.dExact);
const yDynSuper = validForMetrics.map(r => r.dSuper);
const yOntExact = validForMetrics.map(r => r.finalExact);
const yOntSuper = validForMetrics.map(r => r.finalSuper);

const mBase     = computeMetrics(yTrue, yBase);
const mStatic   = computeMetrics(yTrue, yStatic);
const mDynExact = computeMetrics(yTrue, yDynExact);
const mDynSuper = computeMetrics(yTrue, yDynSuper);
const mOntExact = computeMetrics(yTrue, yOntExact);
const mOntSuper = computeMetrics(yTrue, yOntSuper);

const p2 = (n) => (n * 100).toFixed(2) + '%';
const metricsLabel = baseRows ? `(baseline 공통: ${validForMetrics.length}개)` : '(baseline 없음)';
console.log(`\n  [Exact Match] ${metricsLabel}`);
console.log(`  ${'시스템'.padEnd(30)} ${'P'.padStart(8)} ${'R'.padStart(8)} ${'F1'.padStart(8)} ${'TP'.padStart(4)} ${'FP'.padStart(4)} ${'FN'.padStart(4)} ${'TN'.padStart(4)}`);
console.log(`  ${'-'.repeat(80)}`);
for (const [lbl, m] of [
  ['Baseline (RF)',             mBase    ],
  ['정적 분석',                  mStatic  ],
  ['동적 분석 (exact)',         mDynExact],
  ['온톨로지 (exact, OR 결합)', mOntExact],
]) {
  console.log(
    `  ${lbl.padEnd(30)} ${p2(m.prec).padStart(8)} ${p2(m.rec).padStart(8)} ${p2(m.f1).padStart(8)} ` +
    `${String(m.tp).padStart(4)} ${String(m.fp).padStart(4)} ${String(m.fn).padStart(4)} ${String(m.tn).padStart(4)}`
  );
}

console.log(`\n  [Superclass] ${metricsLabel}`);
console.log(`  ${'시스템'.padEnd(30)} ${'P'.padStart(8)} ${'R'.padStart(8)} ${'F1'.padStart(8)} ${'TP'.padStart(4)} ${'FP'.padStart(4)} ${'FN'.padStart(4)} ${'TN'.padStart(4)}`);
console.log(`  ${'-'.repeat(80)}`);
for (const [lbl, m] of [
  ['Baseline (RF)',             mBase    ],
  ['정적 분석',                  mStatic  ],
  ['동적 분석 (superclass)',    mDynSuper],
  ['온톨로지 (super, OR 결합)', mOntSuper],
]) {
  console.log(
    `  ${lbl.padEnd(30)} ${p2(m.prec).padStart(8)} ${p2(m.rec).padStart(8)} ${p2(m.f1).padStart(8)} ` +
    `${String(m.tp).padStart(4)} ${String(m.fp).padStart(4)} ${String(m.fn).padStart(4)} ${String(m.tn).padStart(4)}`
  );
}

// ── comparison_report_pilot.md ────────────────────────────────────────────────
const now = new Date().toLocaleString('ko-KR');
const p2r = (n) => (n * 100).toFixed(2) + '%';
const fmtRow = (lbl, m) =>
  `| ${lbl.padEnd(36)} | ${p2r(m.prec).padStart(9)} | ${p2r(m.rec).padStart(7)} | ${p2r(m.f1).padStart(8)} | ${String(m.tp).padStart(4)} | ${String(m.fp).padStart(4)} | ${String(m.fn).padStart(4)} | ${String(m.tn).padStart(4)} |`;

const diagRows = results.filter(r => r.label === 1).map(r => {
  if (!r.diag) return `| \`${r.address}\` | (로그 없음) | - | - | - | - |`;
  const { peak, finalBal, ratio, isMajorDrain } = r.diag;
  const dynHint = r.dp.hint ?? r.dp.reason ?? '-';
  const trigg   = r.dp.triggered?.join('+') ?? '-';
  return `| \`${r.address}\` | ${peak.toFixed(4)} | ${finalBal.toFixed(4)} | ${(ratio * 100).toFixed(1)}% | ${isMajorDrain ? '✓' : ' '} | ${dynHint} (${trigg}) |`;
});

const disagreements = validForMetrics.filter(r => r.basePred !== r.finalExact);
const disagRows = disagreements.map(r => {
  const change =
    r.label === 1 && r.basePred === 0 && r.finalExact === 1 ? 'FN→TP' :
    r.label === 1 && r.basePred === 1 && r.finalExact === 0 ? 'TP→FN' :
    r.label === 0 && r.basePred === 1 && r.finalExact === 0 ? 'FP→TN' :
    r.label === 0 && r.basePred === 0 && r.finalExact === 1 ? 'TN→FP' : '-';
  return `| \`${r.address}\` | ${r.label} | ${r.basePred} | exact=${r.finalExact}/super=${r.finalSuper} | ${change} |`;
});

const report = [
  '# 파일럿 비교 평가 리포트 (30개 주소)',
  '',
  `> 생성: ${now}`,
  '',
  '## 데이터셋',
  '',
  `- 파일럿 주소: ${pilotEntries.length}개 (ponzi=${ponziEntries.length}, normal=${normalEntries.length})`,
  `- 소스 없음(정적 스킵): ${results.filter(r => r.sp.pred === -1).length}개`,
  `- 로그 없음(동적 스킵): ${results.filter(r => r.dp.exactPred === -1).length}개`,
  `- baseline 비교 가능: ${validForMetrics.length}개`,
  '',
  '---',
  '',
  '## 표 1. Ponzi 주소 잔고 진단',
  '',
  `> isMajorDrain: 최종잔고 < 최고잔고 × 10% → BALANCE_DROP 룰 트리거 가능`,
  '',
  '| 주소 | peak(Ξ) | final(Ξ) | ratio | drain? | dynamic hint (triggered rules) |',
  '|------|--------:|---------:|------:|:------:|-------------------------------|',
  ...(diagRows.length > 0 ? diagRows : ['| (없음) | | | | | |']),
  '',
  `**isMajorDrain 충족: ${majorDrainCount}/${withLog}개 (로그 있는 ponzi 기준)**`,
  `**dynamic exact match(ponzi_scheme) 탐지: ${dynamicExactHit}/${withLog}개**`,
  `**dynamic superclass(사기 전반) 탐지: ${dynamicSuperHit}/${withLog}개**`,
  '',
  '---',
  '',
  '## 표 2-A. Exact Match 평가',
  '',
  '> **exact_match는 정확한 유형 분류 성능**: dynamic_analyzer가 Ponzi Scheme(`ponzi_scheme` 또는 `ponzi_or_laundering`)으로 정확히 분류한 경우만 positive.',
  `> 평가 기준: baseline과 공통 ${validForMetrics.length}개 주소`,
  '',
  '| 시스템                               | Precision | Recall  | F1-Score |   TP |   FP |   FN |   TN |',
  '|--------------------------------------|----------:|--------:|---------:|-----:|-----:|-----:|-----:|',
  fmtRow('Baseline (Random Forest)',           mBase),
  fmtRow('정적 분석 (prevention_reasoner 재현)', mStatic),
  fmtRow('동적 분석 — exact match',            mDynExact),
  fmtRow('온톨로지 (exact, Static OR Dynamic)', mOntExact),
  '',
  '---',
  '',
  '## 표 2-B. Superclass 평가',
  '',
  '> **superclass는 사기 여부 자체를 걸러내는 성능**: `ponzi_scheme`, `rug_pull`, `money_laundering`, `pump_and_dump` 중 하나라도 탐지되면 positive.',
  `> 평가 기준: baseline과 공통 ${validForMetrics.length}개 주소`,
  '',
  '| 시스템                               | Precision | Recall  | F1-Score |   TP |   FP |   FN |   TN |',
  '|--------------------------------------|----------:|--------:|---------:|-----:|-----:|-----:|-----:|',
  fmtRow('Baseline (Random Forest)',            mBase),
  fmtRow('정적 분석 (prevention_reasoner 재현)',  mStatic),
  fmtRow('동적 분석 — superclass',             mDynSuper),
  fmtRow('온톨로지 (super, Static OR Dynamic)', mOntSuper),
  '',
  '---',
  '',
  `## 표 3. 판정 불일치 (Baseline ≠ Ontology Exact) — ${disagreements.length}건`,
  '',
  '| 주소 | 정답 | Baseline | Ontology(exact/super) | 변화 |',
  '|------|:----:|:--------:|:---------------------:|:----:|',
  ...(disagRows.length > 0 ? disagRows : ['| (없음) | | | | |']),
  '',
  '---',
  '',
  '## 분석 노트',
  '',
  '### isMajorDrain과 BALANCE_DROP',
  '- `dynamic_analyzer.js`의 BALANCE_DROP 룰: 최종잔고 < 최고잔고 × 10% **AND** `owner_withdraw_all` 액션 존재.',
  '- 블록 집계 → per-tx 변환 시, `isMajorDrain=true`인 마지막 출금 블록만 `owner_withdraw_all`로 변환.',
  '- isMajorDrain을 충족하지 않으면 BALANCE_DROP이 트리거되지 않아 ponzi_scheme 경로로 분류 불가.',
  '',
  '### 동적 분석 두 단계 평가',
  '- **Exact match**: `fraud_type_hint ∈ {ponzi_scheme, ponzi_or_laundering}` → positive.',
  '- **Superclass**: `fraud_type_hint ∈ {ponzi_scheme, ponzi_or_laundering, rug_pull, money_laundering, pump_and_dump}` → positive.',
  '- rug_pull로 분류되는 경우가 많은 이유: 블록 집계 데이터에서 개별 계정 추적 불가 → participantMidExit 미검출.',
  '',
  '### 정적 분석',
  '- `fraud_ontology.js`의 PonziScheme checklistItems detectPattern을 소스 코드에 regex 매칭.',
  '- 소스 코드 없음(미검증 컨트랙트 등) → pred=0으로 처리.',
].join('\n');

fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.writeFileSync(REPORT_OUT, report, 'utf8');
console.log(`\n리포트 → ${REPORT_OUT}`);
