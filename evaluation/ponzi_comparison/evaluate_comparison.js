/**
 * evaluate_comparison.js
 *
 * 온톨로지 파이프라인(prevention_reasoner + dynamic_analyzer)과
 * 베이스라인(Random Forest) 을 동일 주소 집합에서 비교 평가.
 *
 * 실행 전제:
 *   1. node prepare_labels.js              → data/labeled_addresses.csv
 *   2. ETHERSCAN_API_KEY=... node fetch_and_convert.js
 *                                          → data/sources/*.sol, data/logs/*.csv
 *   3. node baseline_classifier.js         → results/baseline_predictions.csv
 *
 * 실행: node evaluate_comparison.js
 */

import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DATA_DIR    = path.join(__dirname, 'data');
const RESULTS_DIR = path.join(__dirname, 'results');
const SOURCES_DIR = path.join(DATA_DIR, 'sources');
const LOGS_DIR    = path.join(DATA_DIR, 'logs');

fs.mkdirSync(RESULTS_DIR, { recursive: true });

// ── Upstream 모듈 동적 로드 ────────────────────────────────────────────────────
// prevention_reasoner.js 는 hardcoded path (PROJECT_ROOT/contracts/) 의존성 때문에
// 직접 호출 불가. 대신 동일 로직을 FraudOntology 임포트로 재현.
let analyzeDynamic = null;   // from ../../analysis/dynamic_analyzer.js
let FraudOntology  = null;   // from ../../analysis/analysis/fraud_ontology.js

try {
  const m = await import('../../analysis/dynamic_analyzer.js');
  analyzeDynamic = m.analyzeDynamic;
  console.log('[OK] dynamic_analyzer.js 로드 완료');
} catch (e) {
  console.warn(`[경고] dynamic_analyzer.js 로드 실패: ${e.message}`);
}

try {
  const m = await import('../../analysis/analysis/fraud_ontology.js');
  FraudOntology = m.FraudOntology;
  console.log('[OK] fraud_ontology.js 로드 완료');
} catch (e) {
  console.warn(`[경고] fraud_ontology.js 로드 실패: ${e.message}`);
}

// ── CSV 파서 ──────────────────────────────────────────────────────────────────
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

// ── 정적 분석 (prevention_reasoner.js 로직 재현) ─────────────────────────────
/**
 * prevention_reasoner.js 의 scoreAllFraudTypes 와 동일한 로직.
 * FraudOntology.preventionRules[type].checklistItems 의 detectPattern을 소스에 매칭.
 * prevention_reasoner.js 가 PROJECT_ROOT/contracts/ 에 파일을 요구하는 관계로
 * 직접 호출 대신 FraudOntology 임포트 후 동일 패턴 매칭을 재현함.
 */
function scoreAllFraudTypes(src) {
  if (!FraudOntology?.preventionRules) return {};
  const scores = {};
  for (const [typeName, rules] of Object.entries(FraudOntology.preventionRules)) {
    let score = 0;
    for (const item of rules.checklistItems) {
      const parts = item.detectPattern.split('|')
        .filter(p => !p.startsWith('ABSENCE:'));
      if (parts.length === 0) continue;
      const matched = parts.some(p => {
        try { return new RegExp(p).test(src); }
        catch { return false; }
      });
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

  if (Object.keys(scores).length === 0) return { pred: 0, reason: 'no_ontology', fraudType: null };

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return { pred: 0, reason: 'no_pattern_hit', fraudType: null };

  const topType = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  return {
    pred:      topType === 'PonziScheme' ? 1 : 0,
    fraudType: topType,
    score:     maxScore,
  };
}

// ── 동적 분석 — 포맷 어댑터 ──────────────────────────────────────────────────
/**
 * 블록 집계 CSV (our format) → per-transaction CSV (dynamic_analyzer.js format) 변환.
 *
 * dynamic_analyzer.js 는 아래 컬럼을 요구한다:
 *   block, action (deposit/withdraw/owner_withdraw_all),
 *   from, to, amount_eth, contract_balance_eth
 *
 * 우리 CSV (block-aggregated) 에는 개별 계정 정보가 없으므로
 * 합성 주소를 사용하는 근사 변환을 수행한다:
 *   - total_in  > 0 → action="deposit",        amount_eth=total_in
 *   - total_out > 0 → action="withdraw",        amount_eth=total_out
 *     (최종 대규모 인출로 잔고가 peak*10% 이하로 떨어지면 "owner_withdraw_all")
 *   - contract_balance_eth = cumulative_balance
 */
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
      // 합성 입금자 주소: 0x + 인덱스 hex (40자)
      const depAddr = `0x${depIdx.toString(16).padStart(40, '0')}`;
      perTx.push(
        `${blk},0,${depAddr},${addr},deposit,${tin.toFixed(8)},${(cumBal + tout).toFixed(8)},${depIdx}`
      );
    }

    if (tout > 1e-12) {
      const isOwnerDrain = isMajorDrain && row === lastOutRow;
      // 오너 인출: 예금자 집합에 없는 고정 주소
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

const PER_TX_HEADER =
  'block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count';

// exact_match: Ponzi Scheme 유형으로 정확히 분류된 경우만 positive
const EXACT_HINTS = new Set(['ponzi_scheme', 'ponzi_or_laundering']);
// superclass:  사기 컨트랙트(FraudContract 하위 유형) 여부만 판별
const SUPER_HINTS = new Set(['ponzi_scheme', 'ponzi_or_laundering',
                              'rug_pull', 'money_laundering', 'pump_and_dump']);

function dynamicPredict(address) {
  if (!analyzeDynamic) return { exactPred: -1, superPred: -1, reason: 'no_analyzer' };

  const logPath = path.join(LOGS_DIR, `${address}.csv`);
  const rows    = parseCSV(logPath);
  if (!rows || rows.length === 0) return { exactPred: -1, superPred: -1, reason: 'no_log' };

  const perTx = convertToPerTx(rows, address);
  if (perTx.length === 0) return { exactPred: 0, superPred: 0, reason: 'no_value_txs', hint: 'none' };

  const tmpPath = path.join(
    os.tmpdir(), `ponzi_eval_${Date.now()}_${Math.random().toString(36).slice(2)}.csv`
  );
  try {
    fs.writeFileSync(tmpPath, [PER_TX_HEADER, ...perTx].join('\n') + '\n', 'utf8');
    const result = analyzeDynamic(tmpPath);
    const hint   = result.fraud_type_hint ?? 'unknown';
    return {
      exactPred: EXACT_HINTS.has(hint) ? 1 : 0,
      superPred: SUPER_HINTS.has(hint) ? 1 : 0,
      hint, verdict: result.verdict,
    };
  } catch (e) {
    return { exactPred: -1, superPred: -1, reason: `analyzer_error: ${e.message}` };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

// ── 지표 계산 ─────────────────────────────────────────────────────────────────
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

// ── Markdown 리포트 생성 ──────────────────────────────────────────────────────
function buildReport(rows, disagreements, now) {
  const r2p = (n) => (n * 100).toFixed(2) + '%';

  const fmtRow = (label, m) =>
    `| ${label.padEnd(34)} | ${r2p(m.prec).padStart(9)} | ${r2p(m.rec).padStart(7)} | ${r2p(m.f1).padStart(8)} | ${String(m.tp).padStart(4)} | ${String(m.fp).padStart(4)} | ${String(m.fn).padStart(4)} | ${String(m.tn).padStart(4)} |`;

  const tableHeader = [
    '| 시스템                             | Precision | Recall  | F1-Score |   TP |   FP |   FN |   TN |',
    '|------------------------------------|----------:|--------:|---------:|-----:|-----:|-----:|-----:|',
  ];

  const disagRows = disagreements.map(d =>
    `| \`${d.address}\` | ${d.true_label} | ${d.baseline_pred} | ${d.ontology_pred} | ${
      d.true_label === 1 && d.baseline_pred === 0 && d.ontology_pred === 1 ? 'FN→TP' :
      d.true_label === 1 && d.baseline_pred === 1 && d.ontology_pred === 0 ? 'TP→FN' :
      d.true_label === 0 && d.baseline_pred === 1 && d.ontology_pred === 0 ? 'FP→TN' :
      d.true_label === 0 && d.baseline_pred === 0 && d.ontology_pred === 1 ? 'TN→FP' : '-'
    } |`
  );

  return [
    '# 폰지 탐지 시스템 비교 평가 리포트',
    '',
    `> 생성: ${now}`,
    '',
    '## 데이터셋 개요',
    '',
    `- 전체 평가 주소: **${rows.total}개**`,
    `- Ponzi (label=1): **${rows.nPonzi}개**`,
    `- Normal (label=0): **${rows.nNormal}개**`,
    `- 소스 없음(정적 스킵): ${rows.noSrc}개`,
    `- 로그 없음(동적 스킵): ${rows.noLog}개`,
    '',
    '---',
    '',
    '## 표 1-A. Exact Match 평가',
    '',
    `> 평가 기준: baseline_predictions.csv 공통 주소 **${rows.sharedN}개** (Ponzi=${rows.sharedPonzi}, Normal=${rows.sharedNormal}). 소스/로그 없음 → negative(0) 처리.`,
    '> **exact_match는 정확한 유형 분류 성능**: dynamic_analyzer가 Ponzi Scheme(`ponzi_scheme` 또는 `ponzi_or_laundering`)으로 정확히 분류한 경우만 positive.',
    '',
    ...tableHeader,
    fmtRow('Baseline (Random Forest)',          rows.mBase),
    fmtRow('정적 분석 (prevention_reasoner 재현)', rows.mStatic),
    fmtRow('동적 분석 — exact match',            rows.mDynExact),
    fmtRow('온톨로지 (exact, Static OR Dynamic)', rows.mOntExact),
    '',
    '---',
    '',
    '## 표 1-B. Superclass 평가',
    '',
    `> 평가 기준: baseline_predictions.csv 공통 주소 **${rows.sharedN}개** (Ponzi=${rows.sharedPonzi}, Normal=${rows.sharedNormal}). 소스/로그 없음 → negative(0) 처리.`,
    '> **superclass는 사기 여부 자체를 걸러내는 성능**: `ponzi_scheme`, `rug_pull`, `money_laundering`, `pump_and_dump` 중 하나라도 탐지되면 positive.',
    '',
    ...tableHeader,
    fmtRow('Baseline (Random Forest)',           rows.mBase),
    fmtRow('정적 분석 (prevention_reasoner 재현)',  rows.mStatic),
    fmtRow('동적 분석 — superclass',             rows.mDynSuper),
    fmtRow('온톨로지 (super, Static OR Dynamic)', rows.mOntSuper),
    '',
    '---',
    '',
    `## 표 2. 판정 불일치 주소 (Baseline ≠ Ontology Exact) — ${disagreements.length}건`,
    '',
    '> 상세: `./results/disagreement_cases.csv`',
    '',
    '| 주소 | 정답 | Baseline | Ontology(exact) | 변화 |',
    '|------|:----:|:--------:|:---------------:|:----:|',
    ...(disagRows.length > 0 ? disagRows : ['| (없음) | | | | |']),
    '',
    '---',
    '',
    '## 분석 노트',
    '',
    '### 정적 분석 (Static)',
    '- `fraud_ontology.js`의 `preventionRules.PonziScheme.checklistItems` 패턴을 소스에 적용.',
    '- `prevention_reasoner.js` 는 `PROJECT_ROOT/contracts/` 경로를 하드코딩하므로',
    '  동일 로직을 직접 재구현. 사용한 패턴 규칙은 온톨로지와 동일함.',
    '- 판정 기준: 사기 유형 중 **PonziScheme** 패턴 점수가 가장 높으면 positive.',
    '',
    '### 동적 분석 (Dynamic)',
    '- 블록 집계 CSV(total_in/total_out/cumulative_balance)를',
    '  `dynamic_analyzer.js` 가 요구하는 per-transaction 포맷으로 변환 후 실행.',
    '- 합성 주소 사용, 개별 계정 추적 불가 → 일부 규칙(CONCENTRATION_DRAIN, PROFIT_EXTRACTION) 정확도 제한.',
    '- **Exact match**: `fraud_type_hint ∈ {ponzi_scheme, ponzi_or_laundering}` → positive.',
    '- **Superclass**: `fraud_type_hint ∈ {ponzi_scheme, ponzi_or_laundering, rug_pull, money_laundering, pump_and_dump}` → positive.',
    '',
    '### 최종 온톨로지 판정 (Final)',
    '- **Union** 방식: 정적 OR 동적 중 하나라도 사기 판정하면 1.',
  ].join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Load labeled addresses
  const labelsPath = path.join(DATA_DIR, 'labeled_addresses.csv');
  if (!fs.existsSync(labelsPath)) {
    console.error('[오류] labeled_addresses.csv 없음 — prepare_labels.js 먼저 실행');
    process.exit(1);
  }
  let raw = fs.readFileSync(labelsPath, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

  const entries = raw.trim().split(/\r?\n/).slice(1)
    .map(l => { const [a, lbl] = l.split(','); return { address: a?.trim(), label: parseInt(lbl?.trim()) }; })
    .filter(e => e.address && !isNaN(e.label));

  // 2. Load baseline predictions (address → {pred, score})
  const basePath = path.join(RESULTS_DIR, 'baseline_predictions.csv');
  if (!fs.existsSync(basePath)) {
    console.error('[오류] baseline_predictions.csv 없음 — baseline_classifier.js 먼저 실행');
    process.exit(1);
  }
  const baseRows = parseCSV(basePath);
  const baseMap  = new Map(
    (baseRows ?? []).map(r => [r.address, { pred: parseInt(r.predicted_label), score: parseFloat(r.predicted_score) }])
  );

  // 3. Process each address
  const total   = entries.length;
  const results = [];
  let noSrc = 0, noLog = 0;

  console.log(`\n주소 ${total}개 처리 중...\n`);

  for (let i = 0; i < total; i++) {
    const { address, label } = entries[i];
    const pct = (((i + 1) / total) * 100).toFixed(1);
    process.stdout.write(`\r[${pct}%] ${i + 1}/${total}  ${address}`);

    const sp = staticPredict(address);
    const dp = dynamicPredict(address);

    if (sp.pred === -1)      noSrc++;
    if (dp.exactPred === -1) noLog++;

    const sPred      = sp.pred      === -1 ? 0 : sp.pred;
    const dExact     = dp.exactPred === -1 ? 0 : dp.exactPred;
    const dSuper     = dp.superPred === -1 ? 0 : dp.superPred;
    const finalExact = (sPred === 1 || dExact === 1) ? 1 : 0;
    const finalSuper = (sPred === 1 || dSuper === 1) ? 1 : 0;
    const basePred   = baseMap.get(address)?.pred ?? 0;

    results.push({
      address, label,
      static_pred:   sPred,
      dynamic_exact: dExact,
      dynamic_super: dSuper,
      final_exact:   finalExact,
      final_super:   finalSuper,
      base_pred:     basePred,
      _sp_detail:    sp,
      _dp_detail:    dp,
    });
  }
  process.stdout.write('\n');

  // 4. Save ontology_predictions.csv
  const ontFile = process.env.ONTOLOGY_PRED_FILE ?? 'ontology_predictions.csv';
  const ontPath = path.join(RESULTS_DIR, ontFile);
  const ontLines = [
    'address,true_label,static_pred,dynamic_exact_pred,dynamic_super_pred,final_exact_pred,final_super_pred',
    ...results.map(r =>
      `${r.address},${r.label},${r.static_pred},${r.dynamic_exact},${r.dynamic_super},${r.final_exact},${r.final_super}`
    ),
  ];
  fs.writeFileSync(ontPath, ontLines.join('\n') + '\n', 'utf8');
  console.log(`\n온톨로지 예측 → ${ontPath}  (${results.length}건)`);

  // 5. Compute metrics (only for addresses that appear in BOTH systems)
  const shared = results.filter(r => baseMap.has(r.address));
  const yTrue     = shared.map(r => r.label);
  const yBase     = shared.map(r => r.base_pred);
  const yStatic   = shared.map(r => r.static_pred);
  const yDynExact = shared.map(r => r.dynamic_exact);
  const yDynSuper = shared.map(r => r.dynamic_super);
  const yOntExact = shared.map(r => r.final_exact);
  const yOntSuper = shared.map(r => r.final_super);

  const mBase     = computeMetrics(yTrue, yBase);
  const mStatic   = computeMetrics(yTrue, yStatic);
  const mDynExact = computeMetrics(yTrue, yDynExact);
  const mDynSuper = computeMetrics(yTrue, yDynSuper);
  const mOntExact = computeMetrics(yTrue, yOntExact);
  const mOntSuper = computeMetrics(yTrue, yOntSuper);

  console.log('\n── [Exact Match] 동적 분석 = ponzi_scheme 유형만 positive ─────────────');
  console.log(`  ${'시스템'.padEnd(30)} ${'P'.padStart(7)} ${'R'.padStart(7)} ${'F1'.padStart(7)}`);
  console.log(`  ${'-'.repeat(55)}`);
  for (const [lbl, m] of [
    ['Baseline (RF)',            mBase    ],
    ['정적 분석',                 mStatic  ],
    ['동적 분석 (exact)',         mDynExact],
    ['온톨로지 (exact, OR 결합)', mOntExact],
  ]) {
    console.log(`  ${lbl.padEnd(30)} ${(m.prec * 100).toFixed(2).padStart(6)}%  ${(m.rec * 100).toFixed(2).padStart(6)}%  ${(m.f1 * 100).toFixed(2).padStart(6)}%`);
  }

  console.log('\n── [Superclass] 동적 분석 = 사기 컨트랙트 여부 판별 ──────────────────');
  console.log(`  ${'시스템'.padEnd(30)} ${'P'.padStart(7)} ${'R'.padStart(7)} ${'F1'.padStart(7)}`);
  console.log(`  ${'-'.repeat(55)}`);
  for (const [lbl, m] of [
    ['Baseline (RF)',             mBase    ],
    ['정적 분석',                  mStatic  ],
    ['동적 분석 (superclass)',    mDynSuper],
    ['온톨로지 (super, OR 결합)', mOntSuper],
  ]) {
    console.log(`  ${lbl.padEnd(30)} ${(m.prec * 100).toFixed(2).padStart(6)}%  ${(m.rec * 100).toFixed(2).padStart(6)}%  ${(m.f1 * 100).toFixed(2).padStart(6)}%`);
  }

  // 6. Disagreements (Baseline vs Ontology Exact Final, shared addresses only)
  const disagreements = shared
    .filter(r => r.base_pred !== r.final_exact)
    .map(r => ({
      address:       r.address,
      true_label:    r.label,
      baseline_pred: r.base_pred,
      ontology_pred: r.final_exact,
    }));

  const disagCsvLines = [
    'address,true_label,baseline_pred,ontology_exact_pred,ontology_super_pred',
    ...shared
      .filter(r => r.base_pred !== r.final_exact || r.base_pred !== r.final_super)
      .map(r =>
        `${r.address},${r.label},${r.base_pred},${r.final_exact},${r.final_super}`
      ),
  ];
  const disagFile = process.env.DISAGREEMENT_FILE ?? 'disagreement_cases.csv';
  const disagPath = path.join(RESULTS_DIR, disagFile);
  fs.writeFileSync(disagPath, disagCsvLines.join('\n') + '\n', 'utf8');
  console.log(`\n불일치 사례 → ${disagPath}  (${disagreements.length}건)`);

  // 7. Generate report
  const sharedPonzi  = shared.filter(r => r.label === 1).length;
  const sharedNormal = shared.filter(r => r.label === 0).length;
  const reportData = {
    total,
    nPonzi:       results.filter(r => r.label === 1).length,
    nNormal:      results.filter(r => r.label === 0).length,
    noSrc,
    noLog,
    sharedN:      shared.length,
    sharedPonzi,
    sharedNormal,
    mBase,
    mStatic,
    mDynExact,
    mDynSuper,
    mOntExact,
    mOntSuper,
  };
  const now    = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const report = buildReport(reportData, disagreements, now);

  const reportFile = process.env.REPORT_FILE ?? 'comparison_report.md';
  const reportPath = path.join(RESULTS_DIR, reportFile);
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log(`리포트    → ${reportPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
