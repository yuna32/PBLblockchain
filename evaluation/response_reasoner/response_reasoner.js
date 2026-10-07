/**
 * response_reasoner.js — 버전 간 불일치 케이스 요약 (MVP)
 *
 * 두 소스 트리(--old, --new) 각각의 analysis/dynamic_analyzer.js(analyzeDynamic)와
 * analysis/analysis/fraud_ontology.js(FraudOntology)를 그 트리에서 import해
 * N=272 평가(evaluation/ponzi_comparison/evaluate_comparison.js)와 같은 방식으로
 * 주소별 예측과 발동 규칙(triggered_rules)을 계산하고, 두 버전의 차이를 요약한다.
 *
 * - evaluate_comparison.js는 import하지 않는다. 그 파일은 export가 없고 import 시
 *   main()이 실행되어 results/를 덮어쓴다(evaluate_comparison.js:510).
 * - 어떤 트리에도 쓰지 않는다. 출력은 --out 아래에만 쓴다.
 * - 정적 checklist 항목 분해는 이번 MVP 범위가 아니다. 정적은 유형별 점수 합과 판정만 낸다.
 * - 수동 7단계(CLAUDE.md:563-565) 중 ①수집·②원인특정(규칙 귀속)·③규칙별 집계만 다룬다.
 *   ④수정안 제시 이후는 하지 않는다.
 *
 * 근거 문서: ~/pbl_backup/response_design/PROPOSAL.md, FINDINGS.md
 */

import fs     from 'fs';
import path   from 'path';
import crypto from 'crypto';
import { pathToFileURL } from 'url';

const USAGE = `사용법:
  node response_reasoner.js --old <tree> --new <tree> --out <dir> [옵션]

  <tree>는 저장소 루트 구조의 소스 트리(예: git archive 사본, ~/pbl_backup/repro/<커밋>/src).
  <dir>는 없거나 비어 있어야 하며, git 작업트리나 입력 트리 안이면 거부한다.

옵션:
  --old-pred <csv>    old 트리로 만든 ontology_predictions.csv (자체검사용)
  --new-pred <csv>    new 트리로 만든 ontology_predictions.csv (자체검사용)
  --old-label <name>  요약에 쓸 이름 (기본 old)
  --new-label <name>  요약에 쓸 이름 (기본 new)
  --exclude <a,b,..>  평가에서 뺄 주소 (EXCLUDE_ADDRESSES와 같은 의미, 양쪽 동일 적용)
  --scope shared|all  shared(기본): baseline_predictions.csv와 공유되는 주소(N=272)
                      all: labeled_addresses.csv 전체(EXCLUDE 적용 후)

종료 코드:
  0  정상 실행, 예측 변경 없음
  1  정상 실행, 예측 변경 있음 — 정보성 결과다. 실패가 아니며,
     regress.sh(회귀 검증 설계안)의 종료 코드 1(허용되지 않은 차이 = 실패)과 의미가 다르다.
  2  실행 오류 (인자, 파일 없음, import 실패, 출력 디렉터리 문제)
  3  자체검사 실패: 다시 계산한 예측이 --old-pred/--new-pred CSV와 다름
     (출력은 쓰고 summary.md 맨 위에 경고를 둔다)`;

// 복사 기준본: 저장소 c9e75ec의 evaluation/ponzi_comparison/evaluate_comparison.js (CR 제거 후 sha256).
// 트리의 evaluate_comparison.js가 이 값과 다르면 summary.md에 표시한다. 판정은 자체검사로 한다.
const COPY_REF_COMMIT = 'c9e75ec';
const COPY_REF_SHA256 = '4219831abfa5f15a7efe4130b74538ec9ee5d3cad9389a238ba0b858b5e3525f';

const PRED_COLS = ['static_pred', 'dynamic_exact_pred', 'dynamic_super_pred', 'final_exact_pred', 'final_super_pred'];

class UsageError extends Error {}

// ── 인자 ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const known = new Set(['--old', '--new', '--out', '--old-pred', '--new-pred',
                         '--old-label', '--new-label', '--exclude', '--scope']);
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '-h' || k === '--help') { console.log(USAGE); process.exit(0); }
    if (!known.has(k)) throw new UsageError(`알 수 없는 인자: ${k}`);
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`값 없음: ${k}`);
    a[k.slice(2)] = v;
  }
  for (const r of ['old', 'new', 'out']) if (!a[r]) throw new UsageError(`--${r} 필수`);
  a.scope ??= 'shared';
  if (!['shared', 'all'].includes(a.scope)) throw new UsageError(`--scope는 shared|all: ${a.scope}`);
  a['old-label'] ??= 'old';
  a['new-label'] ??= 'new';
  return a;
}

function sha256NoCR(file) {
  if (!fs.existsSync(file)) return '(없음)';
  const buf = fs.readFileSync(file).toString('utf8').replace(/\r/g, '');
  return crypto.createHash('sha256').update(buf, 'utf8').digest('hex');
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function prepareOut(outDir, trees) {
  const abs = path.resolve(outDir);
  for (const t of trees) {
    if (isInside(abs, t)) throw new UsageError(`--out이 입력 트리 안에 있음`);
  }
  // git 작업트리 안이면 거부 (저장소에 쓰지 않기 위해)
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

// ── [복사] evaluate_comparison.js:54-67 parseCSV — 원본 변경 시 동기화 필요 ──────
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

// ── [복사] evaluate_comparison.js:76-94 scoreAllFraudTypes — 원본 변경 시 동기화 필요 ──
// 변경점: 모듈 전역 FraudOntology 대신 트리별 FraudOntology를 인자로 받는다.
function scoreAllFraudTypes(FraudOntology, src) {
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

// ── [복사] evaluate_comparison.js:96-114 staticPredict — 원본 변경 시 동기화 필요 ──
// 변경점: 트리별 경로·FraudOntology를 인자로 받고, 유형별 점수(scores)를 함께 반환한다.
function staticPredict(FraudOntology, sourcesDir, address) {
  const solPath = path.join(sourcesDir, `${address}.sol`);
  if (!fs.existsSync(solPath)) return { pred: -1, reason: 'no_source', scores: null };

  const src    = fs.readFileSync(solPath, 'utf8');
  const scores = scoreAllFraudTypes(FraudOntology, src);

  if (Object.keys(scores).length === 0) return { pred: 0, reason: 'no_ontology', fraudType: null, scores };

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return { pred: 0, reason: 'no_pattern_hit', fraudType: null, scores };

  const topType = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  return {
    pred:      topType === 'PonziScheme' ? 1 : 0,
    fraudType: topType,
    score:     maxScore,
    scores,
  };
}

// ── [복사] evaluate_comparison.js:131-175 convertToPerTx — 원본 변경 시 동기화 필요 ──
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

// ── [복사] evaluate_comparison.js:186-213 dynamicPredict — 원본 변경 시 동기화 필요 ──
// 변경점: 트리별 analyzeDynamic·경로를 인자로 받는다. tmp 파일은 os.tmpdir()의 무작위 이름 대신
// --out/.tmp/ 아래 고정 이름을 쓴다. triggered_rules·dynamic_risk_score도 반환한다.
function dynamicPredict(analyzeDynamic, logsDir, tmpDir, tag, address) {
  if (!analyzeDynamic) return { exactPred: -1, superPred: -1, reason: 'no_analyzer' };

  const logPath = path.join(logsDir, `${address}.csv`);
  const rows    = parseCSV(logPath);
  if (!rows || rows.length === 0) return { exactPred: -1, superPred: -1, reason: 'no_log' };

  const perTx = convertToPerTx(rows, address);
  if (perTx.length === 0) return { exactPred: 0, superPred: 0, reason: 'no_value_txs', hint: 'none' };

  const tmpPath = path.join(tmpDir, `${tag}_${address}.csv`);
  try {
    fs.writeFileSync(tmpPath, [PER_TX_HEADER, ...perTx].join('\n') + '\n', 'utf8');
    const result = analyzeDynamic(tmpPath);
    const hint   = result.fraud_type_hint ?? 'unknown';
    return {
      exactPred: EXACT_HINTS.has(hint) ? 1 : 0,
      superPred: SUPER_HINTS.has(hint) ? 1 : 0,
      hint, verdict: result.verdict,
      score: result.dynamic_risk_score,
      triggered: (result.triggered_rules ?? []).map(r => ({
        id: r.id, weight: r.weight, weight_max: r.weight_max, fraction: r.fraction,
      })),
    };
  } catch (e) {
    // 출력에 절대경로가 남지 않도록 tmp 경로를 지운다
    return { exactPred: -1, superPred: -1, reason: `analyzer_error: ${String(e.message).split(tmpDir).join('<tmp>')}` };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

// ── 트리 하나 계산 ──────────────────────────────────────────────────────────────
async function loadTree(treeArg, tag, label) {
  const root = path.resolve(treeArg);
  const dynPath  = path.join(root, 'analysis', 'dynamic_analyzer.js');
  const ontoPath = path.join(root, 'analysis', 'analysis', 'fraud_ontology.js');
  const evalPath = path.join(root, 'evaluation', 'ponzi_comparison', 'evaluate_comparison.js');
  const pc       = path.join(root, 'evaluation', 'ponzi_comparison');
  for (const f of [dynPath, ontoPath,
                   path.join(pc, 'data', 'labeled_addresses.csv'),
                   path.join(pc, 'results', 'baseline_predictions.csv')]) {
    if (!fs.existsSync(f)) throw new UsageError(`${label}: 파일 없음: ${path.relative(root, f)}`);
  }
  const { analyzeDynamic } = await import(pathToFileURL(dynPath).href);
  const { FraudOntology }  = await import(pathToFileURL(ontoPath).href);
  if (typeof analyzeDynamic !== 'function') throw new UsageError(`${label}: analyzeDynamic export 없음`);
  if (!FraudOntology?.preventionRules)      throw new UsageError(`${label}: FraudOntology.preventionRules 없음`);

  const outliersPath = path.join(pc, 'data', 'known_outliers.csv');
  return {
    tag, label, root, pc, analyzeDynamic, FraudOntology,
    hashes: {
      dynamic_analyzer: sha256NoCR(dynPath),
      fraud_ontology:   sha256NoCR(ontoPath),
      evaluate_comparison: sha256NoCR(evalPath),
    },
    outliers: loadOutliers(outliersPath),
    hasOutliers: fs.existsSync(outliersPath),
  };
}

// known_outliers.csv: 두 번째 열이 따옴표 안에 쉼표를 가질 수 있어 첫 열과 마지막 열만 쓴다.
function loadOutliers(p) {
  const m = new Map();
  if (!fs.existsSync(p)) return m;
  let text = fs.readFileSync(p, 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const f = line.split(',');
    m.set(f[0].trim().toLowerCase(), f[f.length - 1].trim());
  }
  return m;
}

function computeTree(t, excludeSet, scope, tmpDir) {
  // [복사] evaluate_comparison.js:331-354 라벨 읽기·EXCLUDE — 원본 변경 시 동기화 필요
  let raw = fs.readFileSync(path.join(t.pc, 'data', 'labeled_addresses.csv'), 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  let entries = raw.trim().split(/\r?\n/).slice(1)
    .map(l => { const [a, lbl] = l.split(','); return { address: a?.trim(), label: parseInt(lbl?.trim()) }; })
    .filter(e => e.address && !isNaN(e.label));
  if (excludeSet.size > 0) entries = entries.filter(e => !excludeSet.has(e.address.toLowerCase()));

  // [복사] evaluate_comparison.js:362-365 baseMap — 원본 변경 시 동기화 필요
  const baseRows = parseCSV(path.join(t.pc, 'results', 'baseline_predictions.csv'));
  const baseMap  = new Map(
    (baseRows ?? []).map(r => [r.address, { pred: parseInt(r.predicted_label), score: parseFloat(r.predicted_score) }])
  );

  const sourcesDir = path.join(t.pc, 'data', 'sources');
  const logsDir    = path.join(t.pc, 'data', 'logs');
  const out = new Map();
  for (const { address, label } of entries) {
    const shared = baseMap.has(address);   // evaluate_comparison.js:419
    if (scope === 'shared' && !shared) continue;

    const sp = staticPredict(t.FraudOntology, sourcesDir, address);
    const dp = dynamicPredict(t.analyzeDynamic, logsDir, tmpDir, t.tag, address);

    // [복사] evaluate_comparison.js:385-390 결합 — 원본 변경 시 동기화 필요
    const sPred      = sp.pred      === -1 ? 0 : sp.pred;
    const dExact     = dp.exactPred === -1 ? 0 : dp.exactPred;
    const dSuper     = dp.superPred === -1 ? 0 : dp.superPred;
    const finalExact = (sPred === 1 || dExact === 1) ? 1 : 0;
    const finalSuper = (sPred === 1 || dSuper === 1) ? 1 : 0;
    const basePred   = baseMap.get(address)?.pred ?? 0;

    out.set(address, {
      address,
      true_label:         label,
      in_baseline:        shared,
      baseline_pred:      basePred,
      static_pred:        sPred,
      static_status:      sp.reason ?? 'scored',
      static_top_type:    sp.fraudType ?? null,
      static_scores:      sp.scores ?? null,
      dynamic_exact_pred: dExact,
      dynamic_super_pred: dSuper,
      final_exact_pred:   finalExact,
      final_super_pred:   finalSuper,
      dynamic_status:     dp.reason ?? 'analyzed',
      fraud_type_hint:    dp.hint ?? null,
      verdict:            dp.verdict ?? null,
      dynamic_risk_score: dp.score ?? null,
      triggered_rules:    dp.triggered ?? [],
      // 불일치 판정은 baseline 공유 주소에만 의미가 있다 (evaluate_comparison.js:419, :460-472)
      // (가) exact만 — 리포트 표 2 기준, evaluate_comparison.js:460-467
      disagree_exact:     shared ? (basePred !== finalExact ? 1 : 0) : null,
      // (나) exact OR super — disagreement_cases.csv 기준, evaluate_comparison.js:472
      disagree_or:        shared ? ((basePred !== finalExact || basePred !== finalSuper) ? 1 : 0) : null,
    });
  }
  return out;
}

// ── 자체검사 ─────────────────────────────────────────────────────────────────
function selfCheck(predCsv, computed) {
  if (!predCsv) return { ran: false, mismatches: [] };
  if (!fs.existsSync(predCsv)) throw new UsageError(`예측 CSV 없음: ${predCsv}`);
  const rows = parseCSV(predCsv) ?? [];
  const byAddr = new Map(rows.map(r => [r.address, r]));
  const mismatches = [];
  for (const addr of [...computed.keys()].sort()) {
    const c = computed.get(addr);
    const r = byAddr.get(addr);
    if (!r) { mismatches.push({ address: addr, column: '(행 없음)', csv: '', computed: '' }); continue; }
    for (const col of ['true_label', ...PRED_COLS]) {
      if (String(c[col]) !== String(r[col])) {
        mismatches.push({ address: addr, column: col, csv: r[col], computed: String(c[col]) });
      }
    }
  }
  return { ran: true, checked: computed.size, mismatches };
}

// ── 비교 ─────────────────────────────────────────────────────────────────────
const CLASS_KO = {
  new_FP: '신규 오탐', FP_resolved: '오탐 해소', new_TP: '신규 포착', new_FN: '신규 미탐',
};
function changeClass(trueLabel, o, n) {
  if (o === n) return '-';
  if (trueLabel === 0) return n === 1 ? 'new_FP' : 'FP_resolved';
  return n === 1 ? 'new_TP' : 'new_FN';
}

const ruleIds  = (r) => (r?.triggered_rules ?? []).map(x => x.id);
const ruleList = (r) => (r?.triggered_rules ?? []).map(x => `${x.id}:${x.weight}`).join(';');

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function compare(oldMap, newMap, outliers) {
  const addrs = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort();
  const changed = [], onlyOne = [], deltas = [];
  let baselineDiffers = 0, trueLabelDiffers = 0;

  for (const a of addrs) {
    const o = oldMap.get(a), n = newMap.get(a);
    if (!o || !n) { onlyOne.push({ address: a, side: o ? 'old_only' : 'new_only' }); continue; }
    if (o.baseline_pred !== n.baseline_pred) baselineDiffers++;
    if (o.true_label !== n.true_label) trueLabelDiffers++;

    for (const [crit, key] of [['exact', 'disagree_exact'], ['or', 'disagree_or']]) {
      if (o[key] !== n[key] && o[key] !== null && n[key] !== null) {
        deltas.push({ criterion: crit, address: a, direction: n[key] === 1 ? 'entered' : 'left',
                      true_label: n.true_label, o, n });
      }
    }

    if (!PRED_COLS.some(c => o[c] !== n[c])) continue;
    const staticChanged  = o.static_pred !== n.static_pred;
    const dynamicChanged = o.dynamic_exact_pred !== n.dynamic_exact_pred || o.dynamic_super_pred !== n.dynamic_super_pred;
    const oIds = new Set(ruleIds(o)), nIds = new Set(ruleIds(n));
    changed.push({
      address: a, o, n,
      class_exact: changeClass(n.true_label, o.final_exact_pred, n.final_exact_pred),
      class_super: changeClass(n.true_label, o.final_super_pred, n.final_super_pred),
      changed_layer: staticChanged && dynamicChanged ? 'both' : staticChanged ? 'static' : 'dynamic',
      rules_added:   [...nIds].filter(x => !oIds.has(x)).sort().join(';'),
      rules_removed: [...oIds].filter(x => !nIds.has(x)).sort().join(';'),
      outlier: outliers.get(a.toLowerCase()) ?? '',
    });
  }
  return { addrs, changed, onlyOne, deltas, baselineDiffers, trueLabelDiffers };
}

// ── 출력 ─────────────────────────────────────────────────────────────────────
function writeJsonl(file, map) {
  const lines = [...map.keys()].sort().map(a => JSON.stringify(map.get(a)));
  fs.writeFileSync(file, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
}

function writeChangedCsv(file, changed) {
  const hdr = ['address', 'true_label', 'baseline_pred_old', 'baseline_pred_new'];
  for (const c of PRED_COLS) hdr.push(`${c}_old`, `${c}_new`);
  hdr.push('class_exact', 'class_super', 'changed_layer', 'disagree_exact_old', 'disagree_exact_new',
           'disagree_or_old', 'disagree_or_new', 'hint_old', 'hint_new', 'verdict_old', 'verdict_new',
           'score_old', 'score_new', 'rules_old', 'rules_new', 'rules_added', 'rules_removed',
           'known_outlier_status');
  const lines = [hdr.join(',')];
  for (const r of changed) {
    const { o, n } = r;
    const row = [r.address, n.true_label, o.baseline_pred, n.baseline_pred];
    for (const c of PRED_COLS) row.push(o[c], n[c]);
    row.push(r.class_exact, r.class_super, r.changed_layer, o.disagree_exact, n.disagree_exact,
             o.disagree_or, n.disagree_or, o.fraud_type_hint, n.fraud_type_hint, o.verdict, n.verdict,
             o.dynamic_risk_score, n.dynamic_risk_score, ruleList(o), ruleList(n),
             r.rules_added, r.rules_removed, r.outlier);
    lines.push(row.map(csvCell).join(','));
  }
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

function writeDeltaCsv(file, deltas) {
  const hdr = 'criterion,address,direction,true_label,baseline_pred_old,baseline_pred_new,' +
              'final_exact_pred_old,final_exact_pred_new,final_super_pred_old,final_super_pred_new';
  const lines = [hdr, ...deltas.map(d => [d.criterion, d.address, d.direction, d.true_label,
    d.o.baseline_pred, d.n.baseline_pred, d.o.final_exact_pred, d.n.final_exact_pred,
    d.o.final_super_pred, d.n.final_super_pred].map(csvCell).join(','))];
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

function countDisagree(map, key) {
  let n = 0; for (const r of map.values()) if (r[key] === 1) n++; return n;
}

function short(a) { return a.slice(0, 10); }

function buildSummary(ctx) {
  const { args, trees, maps, checks, cmp, exitCode } = ctx;
  const [T0, T1] = trees;
  const L0 = T0.label, L1 = T1.label;
  const out = [];
  const p = (...l) => out.push(...l);

  const failedChecks = checks.filter(c => c.ran && c.mismatches.length > 0);
  if (failedChecks.length > 0) {
    p('> **경고: 자체검사 실패 (종료 코드 3).** 다시 계산한 예측이 입력 CSV와 다르다.',
      '> 복사한 evaluate_comparison.js 로직과 트리의 실제 로직이 어긋났을 수 있으므로 아래 결과를 그대로 쓰지 말 것.', '');
  }

  p('# 버전 간 불일치 케이스 요약', '');
  p(`- 비교: **${L0}** → **${L1}**`);
  p(`- 범위: ${args.scope === 'shared' ? 'shared (baseline_predictions.csv 공유 주소)' : 'all (labeled_addresses.csv 전체)'}` +
    `, EXCLUDE ${ctx.excludeCount}개`);
  p(`- 종료 코드: **${exitCode}** — 0 변경 없음 / 1 변경 있음(정보성. regress.sh의 1=실패와 의미가 다름) / 2 실행 오류 / 3 자체검사 실패`);
  p('', '## 1. 실행 조건', '');
  p('| 항목 | ' + L0 + ' | ' + L1 + ' |', '|---|---|---|');
  p(`| 주소 수 | ${maps[0].size} | ${maps[1].size} |`);
  p(`| analysis/dynamic_analyzer.js sha256 (CR 제거) | \`${T0.hashes.dynamic_analyzer.slice(0, 16)}\` | \`${T1.hashes.dynamic_analyzer.slice(0, 16)}\` |`);
  p(`| analysis/analysis/fraud_ontology.js sha256 | \`${T0.hashes.fraud_ontology.slice(0, 16)}\` | \`${T1.hashes.fraud_ontology.slice(0, 16)}\` |`);
  p(`| evaluate_comparison.js sha256 | \`${T0.hashes.evaluate_comparison.slice(0, 16)}\` | \`${T1.hashes.evaluate_comparison.slice(0, 16)}\` |`);
  p(`| evaluate_comparison.js = 복사 기준본(${COPY_REF_COMMIT})? | ${T0.hashes.evaluate_comparison === COPY_REF_SHA256 ? '같음' : '다름 (자체검사로 판단)'} | ${T1.hashes.evaluate_comparison === COPY_REF_SHA256 ? '같음' : '다름 (자체검사로 판단)'} |`);
  p(`| known_outliers.csv | ${T0.hasOutliers ? '있음' : '없음'} | ${T1.hasOutliers ? '있음' : '없음'} |`);
  p(`| node | ${process.version} | ${process.version} |`);

  p('', '## 2. 자체검사 (다시 계산한 예측 vs 입력 ontology_predictions.csv)', '');
  p('| 트리 | 실행 | 대조 주소 | 불일치 칸 |', '|---|---|---:|---:|');
  for (const [i, c] of checks.entries()) {
    p(`| ${trees[i].label} | ${c.ran ? '예' : '아니오 (--' + trees[i].tag + '-pred 없음)'} | ${c.ran ? c.checked : '-'} | ${c.ran ? c.mismatches.length : '-'} |`);
  }
  for (const [i, c] of checks.entries()) {
    if (!c.ran || c.mismatches.length === 0) continue;
    p('', `${trees[i].label} 불일치:`, '', '| 주소 | 열 | CSV | 재계산 |', '|---|---|---|---|');
    for (const m of c.mismatches) p(`| \`${m.address}\` | ${m.column} | ${m.csv} | ${m.computed} |`);
  }

  p('', '## 3. 예측 변경 요약', '');
  p(`- 5개 예측 열 중 하나라도 바뀐 주소: **${cmp.changed.length}개** (상세: \`changed.csv\`)`);
  if (cmp.onlyOne.length) p(`- 한쪽에만 있는 주소: ${cmp.onlyOne.length}개 (${cmp.onlyOne.map(x => `\`${short(x.address)}\` ${x.side}`).join(', ')})`);
  if (cmp.baselineDiffers) p(`- **주의**: baseline_pred가 두 트리에서 다른 주소 ${cmp.baselineDiffers}개`);
  if (cmp.trueLabelDiffers) p(`- **주의**: true_label이 두 트리에서 다른 주소 ${cmp.trueLabelDiffers}개`);
  p('', '| 분류 | exact (final_exact_pred) | super (final_super_pred) |', '|---|---:|---:|');
  for (const k of Object.keys(CLASS_KO)) {
    p(`| ${CLASS_KO[k]} (\`${k}\`) | ${cmp.changed.filter(r => r.class_exact === k).length} | ${cmp.changed.filter(r => r.class_super === k).length} |`);
  }
  p('', '분류 기준: true_label=0이고 final 0→1 신규 오탐, 1→0 오탐 해소 / true_label=1이고 0→1 신규 포착, 1→0 신규 미탐.');

  p('', '## 4. 기여도 분리 (어느 판정 층이 바뀌었나)', '');
  p('| changed_layer | 건수 | 설명 |', '|---|---:|---|');
  for (const [k, d] of [['dynamic', 'dynamic_exact/super_pred만 바뀜'], ['static', 'static_pred만 바뀜'], ['both', '둘 다 바뀜']]) {
    p(`| ${k} | ${cmp.changed.filter(r => r.changed_layer === k).length} | ${d} |`);
  }

  // 규칙별 기여도 (EVASION_ANALYSIS.md:473-479 형식): exact 분류 그룹별
  const groups = Object.keys(CLASS_KO).filter(k => cmp.changed.some(r => r.class_exact === k));
  const ids = [...new Set(cmp.changed.flatMap(r => [...ruleIds(r.o), ...ruleIds(r.n)]))].sort();
  p('', '## 5. 규칙별 기여도 (exact 분류 그룹별, 동적 triggered_rules)', '');
  if (groups.length === 0 || ids.length === 0) {
    p('(해당 없음)');
  } else {
    p(`셀: ${L1} 발동 건수 / 그룹 크기 (${L0} 발동 건수). 규칙 id 사전순.`, '');
    p('| 규칙 | ' + groups.map(g => `${CLASS_KO[g]} (n=${cmp.changed.filter(r => r.class_exact === g).length})`).join(' | ') + ' |');
    p('|---|' + groups.map(() => '---:').join('|') + '|');
    for (const id of ids) {
      const cells = groups.map(g => {
        const rs = cmp.changed.filter(r => r.class_exact === g);
        const nn = rs.filter(r => ruleIds(r.n).includes(id)).length;
        const oo = rs.filter(r => ruleIds(r.o).includes(id)).length;
        return `${nn}/${rs.length} (${oo})`;
      });
      p(`| ${id} | ${cells.join(' | ')} |`);
    }
    const supOnly = cmp.changed.filter(r => r.class_exact === '-').length;
    if (supOnly) p('', `exact 분류가 '-'(final_exact 불변)인 변경 ${supOnly}건은 이 표에 없다. changed.csv의 class_super 참고.`);
  }

  p('', '## 6. 불일치(Baseline ≠ Ontology) 건수', '');
  p('| 기준 | ' + L0 + ' | ' + L1 + ' | 새로 들어옴 | 빠짐 |', '|---|---:|---:|---:|---:|');
  for (const [crit, key, name] of [
    ['exact', 'disagree_exact', '(가) exact만 — 리포트 표 2 기준 (evaluate_comparison.js:460-467)'],
    ['or',    'disagree_or',    '(나) exact OR super — disagreement_cases.csv 기준 (evaluate_comparison.js:472)'],
  ]) {
    const ds = cmp.deltas.filter(d => d.criterion === crit);
    p(`| ${name} | ${countDisagree(maps[0], key)} | ${countDisagree(maps[1], key)} | ${ds.filter(d => d.direction === 'entered').length} | ${ds.filter(d => d.direction === 'left').length} |`);
  }
  p('', '출입 상세: `disagreement_delta.csv`. baseline 공유 주소만 센다.');

  p('', '## 7. 변경 주소 상세', '');
  if (cmp.changed.length === 0) {
    p('(없음)');
  } else {
    p('| 주소 | true | exact | super | 층 | hint | score | 추가 규칙 | 제거 규칙 | outlier |',
      '|---|:-:|---|---|---|---|---|---|---|---|');
    for (const r of cmp.changed) {
      p(`| \`${r.address}\` | ${r.n.true_label} | ${r.o.final_exact_pred}→${r.n.final_exact_pred} ${r.class_exact} | ` +
        `${r.o.final_super_pred}→${r.n.final_super_pred} ${r.class_super} | ${r.changed_layer} | ` +
        `${r.o.fraud_type_hint}→${r.n.fraud_type_hint} | ${r.o.dynamic_risk_score}→${r.n.dynamic_risk_score} | ` +
        `${r.rules_added || '-'} | ${r.rules_removed || '-'} | ${r.outlier || '-'} |`);
    }
  }

  p('', '## 8. 범위 밖', '',
    '- 이 요약은 수동 절차의 ①수집·②규칙 귀속·③규칙별 집계만 다룬다. 원인 해석과 수정안(④ 이후)은 사람이 한다.',
    '- 동적 규칙 발동은 evaluate_comparison.js의 convertToPerTx 합성 주소 변환을 거친 결과다(EVASION_ANALYSIS.md:487-500).',
    '- 정적은 유형별 점수 합과 판정만 낸다(checklist 항목 분해 없음).');
  return out.join('\n') + '\n';
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const oldRoot = path.resolve(args.old), newRoot = path.resolve(args.new);
  for (const [k, r] of [['old', oldRoot], ['new', newRoot]]) {
    if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) throw new UsageError(`--${k} 트리 없음`);
  }
  const outDir = prepareOut(args.out, [oldRoot, newRoot]);
  const tmpDir = path.join(outDir, '.tmp');

  const excludeSet = new Set((args.exclude ?? '').split(',').map(a => a.trim().toLowerCase()).filter(Boolean));

  const T0 = await loadTree(oldRoot, 'old', args['old-label']);
  const T1 = await loadTree(newRoot, 'new', args['new-label']);

  const m0 = computeTree(T0, excludeSet, args.scope, tmpDir);
  const m1 = computeTree(T1, excludeSet, args.scope, tmpDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const checks = [selfCheck(args['old-pred'], m0), selfCheck(args['new-pred'], m1)];
  // known_outliers 상태는 new 트리 것을 우선, 없으면 old 트리 것
  const outliers = new Map([...T0.outliers, ...T1.outliers]);
  const cmp = compare(m0, m1, outliers);

  const checkFailed = checks.some(c => c.ran && c.mismatches.length > 0);
  const hasChange = cmp.changed.length > 0 || cmp.onlyOne.length > 0;
  const exitCode = checkFailed ? 3 : hasChange ? 1 : 0;

  writeJsonl(path.join(outDir, 'old.jsonl'), m0);
  writeJsonl(path.join(outDir, 'new.jsonl'), m1);
  writeChangedCsv(path.join(outDir, 'changed.csv'), cmp.changed);
  writeDeltaCsv(path.join(outDir, 'disagreement_delta.csv'), cmp.deltas);
  fs.writeFileSync(path.join(outDir, 'summary.md'),
    buildSummary({ args, trees: [T0, T1], maps: [m0, m1], checks, cmp, exitCode,
                   excludeCount: excludeSet.size }), 'utf8');

  for (const [i, c] of checks.entries()) {
    for (const m of c.mismatches) {
      console.error(`[자체검사 실패] ${[T0, T1][i].label} ${m.address} ${m.column}: csv=${m.csv} 재계산=${m.computed}`);
    }
  }
  console.log(`${T0.label} → ${T1.label}: 주소 ${cmp.addrs.length}개, 예측 변경 ${cmp.changed.length}개, 종료 코드 ${exitCode}`);
  return exitCode;
}

main().then(code => process.exit(code)).catch(e => {
  if (e instanceof UsageError) { console.error(`[오류] ${e.message}\n\n${USAGE}`); }
  else { console.error(`[오류] ${e.stack ?? e}`); }
  process.exit(2);
});
