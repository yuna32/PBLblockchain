/**
 * extract_reasoning.mjs
 *
 * 목적: XBlock N=272 clean 데이터셋의 각 컨트랙트에 대해 정적/동적 판정 근거
 * (AnomalySignal 트리거, BehaviorPattern 불리언, usesEvasion 서브클래스)를
 * 재추출하여 evaluation/network_viz/reasoning_raw.json 으로 저장한다.
 *
 * 원본 파이프라인 파일은 읽기 전용으로만 참조한다 (수정 금지):
 *   - ../../analysis/dynamic_analyzer.js  (analyzeDynamic 함수)
 *   - ../../analysis/analysis/fraud_ontology.js (FraudOntology.preventionRules)
 *
 * evaluate_comparison.js 와 동일한 방식으로 두 모듈을 동적 import 하며,
 * convertToPerTx / scoreAllFraudTypes 로직도 evaluate_comparison.js 의 구현을
 * 그대로 재사용한다 (prevention_reasoner.js 는 PROJECT_ROOT/contracts/ 하드코딩
 * 경로 의존성 때문에 직접 호출 불가 — evaluate_comparison.js 상단 주석 참고).
 *
 * 실행: node extract_reasoning.mjs
 */

import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PONZI_CMP_DIR = path.join(__dirname, '..', 'ponzi_comparison');
const DATA_DIR       = path.join(PONZI_CMP_DIR, 'data');
const RESULTS_DIR    = path.join(PONZI_CMP_DIR, 'results');
const SOURCES_DIR    = path.join(DATA_DIR, 'sources');
const LOGS_DIR       = path.join(DATA_DIR, 'logs');
const OUT_PATH       = path.join(__dirname, 'reasoning_raw.json');

let analyzeDynamic = null;
let FraudOntology  = null;

const m1 = await import('../../analysis/dynamic_analyzer.js');
analyzeDynamic = m1.analyzeDynamic;
console.log('[OK] dynamic_analyzer.js 로드 완료');

const m2 = await import('../../analysis/analysis/fraud_ontology.js');
FraudOntology = m2.FraudOntology;
console.log('[OK] fraud_ontology.js 로드 완료');

// ── CSV 파서 (evaluate_comparison.js 와 동일) ────────────────────────────────
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

// ── 정적 분석 점수 (evaluate_comparison.js scoreAllFraudTypes 재사용) ────────
// exact/super 힌트 집합 (evaluate_comparison.js 와 동일)
const EXACT_HINTS = new Set(['ponzi_scheme', 'ponzi_or_laundering']);
const SUPER_HINTS = new Set(['ponzi_scheme', 'ponzi_or_laundering',
                              'rug_pull', 'money_laundering', 'pump_and_dump']);

// scoreAllFraudTypes 결과에서 staticPredict()와 동일한 방식으로 pred(0/1) 도출
function staticPredFromScores(scores) {
  const vals = Object.values(scores);
  if (vals.length === 0) return 0;
  const maxScore = Math.max(...vals);
  if (maxScore === 0) return 0;
  const topType = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  return topType === 'PonziScheme' ? 1 : 0;
}

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

// ── 블록 집계 CSV → per-tx 포맷 변환 (evaluate_comparison.js convertToPerTx 재사용) ─
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

const PER_TX_HEADER =
  'block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count';

function dynamicAnalyze(address) {
  const logPath = path.join(LOGS_DIR, `${address}.csv`);
  const rows    = parseCSV(logPath);
  if (!rows || rows.length === 0) return null;

  const perTx = convertToPerTx(rows, address);
  if (perTx.length === 0) return null;

  const tmpPath = path.join(
    os.tmpdir(), `netviz_${Date.now()}_${Math.random().toString(36).slice(2)}.csv`
  );
  try {
    fs.writeFileSync(tmpPath, [PER_TX_HEADER, ...perTx].join('\n') + '\n', 'utf8');
    return analyzeDynamic(tmpPath);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

// ── reasoning_steps 문자열에서 BehaviorPattern 불리언 파싱 ───────────────────
// dynamic_analyzer.js의 hintFraudType()이 남기는
// "singleLargeOutflow: true (...)" 형태의 문자열을 그대로 파싱한다.
function parseBehaviorFlags(steps) {
  const flags = {};
  const re = /^(\w+):\s*(true|false)/;
  for (const s of steps ?? []) {
    const mch = re.exec(s);
    if (mch) flags[mch[1]] = mch[2] === 'true';
  }
  return flags;
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
const fullEvasionRows = parseCSV(path.join(RESULTS_DIR, 'fullevasion_predictions.csv'));
if (!fullEvasionRows) {
  console.error('fullevasion_predictions.csv 를 찾을 수 없습니다.');
  process.exit(1);
}

console.log(`대상 주소 수: ${fullEvasionRows.length}`);

const results = {};
let ok = 0, fail = 0;

for (const row of fullEvasionRows) {
  const address = row.address;
  try {
    const solPath = path.join(SOURCES_DIR, `${address}.sol`);
    const staticScores = fs.existsSync(solPath)
      ? scoreAllFraudTypes(fs.readFileSync(solPath, 'utf8'))
      : {};

    // 거래 로그가 있어도 유효 입출금이 전혀 없는 경우(perTx 빈 배열)는
    // evaluate_comparison.js의 no_value_txs 처리와 동일하게 "신호 없음,
    // 판정 negative(0)"으로 취급한다 (제외하지 않고 N=272 유지).
    const dyn = dynamicAnalyze(address) ?? {
      fraud_type_hint: 'unknown', verdict: 'LOW_RISK', dynamic_risk_score: 0,
      triggered_rules: [], reasoning_steps: [], anomaly_signals: {},
      evasion_detected: false, evasion_subclass: null,
      evasion_confidence: 0, evasion_all_scores: {}
    };

    // evaluate_comparison.js main()의 finalExact/finalSuper 결합 공식을 그대로 재현
    // (ontology_predictions.csv는 dynamic_analyzer.js 규칙 개정 이전 스냅샷이라
    //  최신 로직과 어긋날 수 있으므로 CSV를 읽지 않고 직접 재계산한다)
    const staticPred  = staticPredFromScores(staticScores);
    const dynamicExact = EXACT_HINTS.has(dyn.fraud_type_hint) ? 1 : 0;
    const dynamicSuper = SUPER_HINTS.has(dyn.fraud_type_hint) ? 1 : 0;
    const finalExact   = (staticPred === 1 || dynamicExact === 1) ? 1 : 0;
    const finalSuper   = (staticPred === 1 || dynamicSuper === 1) ? 1 : 0;

    results[address] = {
      true_label:        row.label,
      static_scores:      staticScores,
      static_pred:        staticPred,
      dynamic_exact_pred: dynamicExact,
      dynamic_super_pred: dynamicSuper,
      final_exact_pred:   finalExact,
      final_super_pred:   finalSuper,
      fraud_type_hint:    dyn.fraud_type_hint,
      verdict:            dyn.verdict,
      dynamic_risk_score: dyn.dynamic_risk_score,
      triggered_rules:    dyn.triggered_rules,
      behavior_flags:     parseBehaviorFlags(dyn.reasoning_steps),
      reasoning_steps:    dyn.reasoning_steps,
      anomaly_signals:    dyn.anomaly_signals,
      evasion_detected:   dyn.evasion_detected,
      evasion_subclass:   dyn.evasion_subclass,
      evasion_confidence: dyn.evasion_confidence,
      evasion_all_scores: dyn.evasion_all_scores
    };
    ok++;
  } catch (e) {
    console.warn(`[실패] ${address}: ${e.message}`);
    fail++;
  }
}

fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2), 'utf8');
console.log(`완료: 성공 ${ok}건 / 실패 ${fail}건 → ${OUT_PATH}`);
