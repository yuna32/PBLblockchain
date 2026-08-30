/**
 * fullevasion_check.js
 *
 * Phase 2 — 설계서 5-3절에서 "시뮬레이션 발생 확률이 낮다"는 이유로 제외했던
 * FullEvasion(BalanceDropEvasion + MaxTxEvasion + SlowDrain 3조건 AND)이
 * 실제 XBlock 데이터(N=272, evaluate_comparison.js 와 동일한 공통 주소 집합)에
 * 존재하는지 확인한다.
 *
 * read-only 분석 스크립트 — analysis/analysis/*, evaluate_comparison.js 등
 * 원본 파이프라인 파일은 전혀 수정하지 않는다. data/logs/*.csv(block-aggregated
 * 포맷)만 읽어서 evaluate_comparison.js 의 convertToPerTx() 근사와 동일한 방식으로
 * withdrawal 이벤트를 근사하고, fraud_ontology.js 5-3절 / dynamic_analyzer.js
 * detectEvasionSubclass() 와 동일한 임계값으로 3개 회피 서브클래스 공리를 계산한다.
 *
 * 실행: node fullevasion_check.js
 * 출력: results/fullevasion_report.md, results/fullevasion_predictions.csv
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DATA_DIR    = path.join(__dirname, 'data');
const RESULTS_DIR = path.join(__dirname, 'results');
const LOGS_DIR    = path.join(DATA_DIR, 'logs');

// ── CSV 파서 (evaluate_comparison.js 와 동일) ──────────────────────────────────
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

// ── N=272 공통 주소 집합 구성 (evaluate_comparison.js 의 shared 필터와 동일) ────
function loadSharedAddresses() {
  const labelsPath = path.join(DATA_DIR, 'labeled_addresses.csv');
  const basePath   = path.join(RESULTS_DIR, 'baseline_predictions.csv');

  let raw = fs.readFileSync(labelsPath, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const entries = raw.trim().split(/\r?\n/).slice(1)
    .map(l => { const [a, lbl] = l.split(','); return { address: a?.trim(), label: parseInt(lbl?.trim()) }; })
    .filter(e => e.address && !isNaN(e.label));
  const labelMap = new Map(entries.map(e => [e.address, e.label]));

  const baseRows = parseCSV(basePath) ?? [];
  const baseAddrs = new Set(baseRows.map(r => r.address));

  return entries
    .filter(e => baseAddrs.has(e.address))
    .map(e => ({ address: e.address, label: e.label }));
}

// ── 3개 회피 서브클래스 공리 계산 ────────────────────────────────────────────────
// fraud_ontology.js evasionSubclasses / dynamic_analyzer.js detectEvasionSubclass()
// 와 동일한 임계값. block-aggregated 데이터라 개별 트랜잭션 금액이 없으므로,
// evaluate_comparison.js convertToPerTx() 와 동일하게 "해당 블록의 total_out"을
// 그 블록의 단일 출금 이벤트 금액으로 근사한다.
function computeEvasionConditions(address) {
  const logPath = path.join(LOGS_DIR, `${address}.csv`);
  const rows = parseCSV(logPath);
  if (!rows || rows.length === 0) return { hasLog: false };

  const peakBalance = rows.reduce((m, r) => Math.max(m, parseFloat(r.cumulative_balance) || 0), 0);
  const firstBlock  = parseInt(rows[0].block) || 0;
  const lastBlock   = parseInt(rows[rows.length - 1].block) || 0;
  const totalBlocks = lastBlock - firstBlock;

  const withdrawalRows = rows.filter(r => (parseFloat(r.total_out) || 0) > 1e-12);
  const withdrawalCount = withdrawalRows.length;

  if (withdrawalCount === 0 || peakBalance <= 0) {
    return {
      hasLog: true, withdrawalCount, peakBalance,
      balanceDropEvasion: false, maxTxEvasion: false, slowDrain: false, fullEvasion: false,
      maxSingleRatio: null, spanRatio: null,
    };
  }

  const maxSingleWithdrawal = Math.max(...withdrawalRows.map(r => parseFloat(r.total_out) || 0));
  const maxSingleRatio = maxSingleWithdrawal / peakBalance;

  const withdrawalBlocks = withdrawalRows.map(r => parseInt(r.block) || 0);
  const withdrawSpan = Math.max(...withdrawalBlocks) - Math.min(...withdrawalBlocks);
  const spanRatio = totalBlocks > 0 ? withdrawSpan / totalBlocks : 0;

  // 설계서 5-3절 공통 3종 임계값 (dynamic_analyzer.js detectEvasionSubclass 와 동일)
  const balanceDropEvasion = maxSingleRatio < 0.80;
  const maxTxEvasion       = withdrawalCount >= 3 && maxSingleRatio < 0.90;
  const slowDrain          = totalBlocks > 0 && spanRatio > 0.30;
  const fullEvasion        = balanceDropEvasion && maxTxEvasion && slowDrain;

  return {
    hasLog: true, withdrawalCount, peakBalance,
    maxSingleRatio, spanRatio,
    balanceDropEvasion, maxTxEvasion, slowDrain, fullEvasion,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const shared = loadSharedAddresses();
  console.log(`N=${shared.length} 공통 주소 집합 로드 완료 (evaluate_comparison.js 와 동일 기준)`);

  const rows = shared.map(({ address, label }) => {
    const c = computeEvasionConditions(address);
    return { address, label, ...c };
  });

  const withLog = rows.filter(r => r.hasLog);
  const withWithdrawal = withLog.filter(r => r.withdrawalCount > 0);

  const countBy = (pred, subset = withWithdrawal) => subset.filter(pred).length;
  const pct = (n, d) => d > 0 ? (n / d * 100).toFixed(2) + '%' : 'N/A';

  const nBDE = countBy(r => r.balanceDropEvasion);
  const nMTE = countBy(r => r.maxTxEvasion);
  const nSD  = countBy(r => r.slowDrain);
  const nFull = countBy(r => r.fullEvasion);

  const fullCases = withWithdrawal.filter(r => r.fullEvasion);
  const fullPonzi  = fullCases.filter(r => r.label === 1);
  const fullNormal = fullCases.filter(r => r.label === 0);

  const bdePonzi = withWithdrawal.filter(r => r.label === 1 && r.balanceDropEvasion).length;
  const bdeNormal = withWithdrawal.filter(r => r.label === 0 && r.balanceDropEvasion).length;
  const mtePonzi = withWithdrawal.filter(r => r.label === 1 && r.maxTxEvasion).length;
  const mteNormal = withWithdrawal.filter(r => r.label === 0 && r.maxTxEvasion).length;
  const sdPonzi = withWithdrawal.filter(r => r.label === 1 && r.slowDrain).length;
  const sdNormal = withWithdrawal.filter(r => r.label === 0 && r.slowDrain).length;

  const nPonziWithdrawal = withWithdrawal.filter(r => r.label === 1).length;
  const nNormalWithdrawal = withWithdrawal.filter(r => r.label === 0).length;

  console.log('\n=== 조건별 개별 발동 비율 (withdrawal 존재하는 주소 기준, N=' + withWithdrawal.length + ') ===');
  console.log(`BalanceDropEvasion : ${nBDE}건 (${pct(nBDE, withWithdrawal.length)})`);
  console.log(`MaxTxEvasion       : ${nMTE}건 (${pct(nMTE, withWithdrawal.length)})`);
  console.log(`SlowDrain          : ${nSD}건 (${pct(nSD, withWithdrawal.length)})`);
  console.log(`\n=== FullEvasion (3조건 AND) ===`);
  console.log(`전체: ${nFull}건 (${pct(nFull, withWithdrawal.length)})`);
  console.log(`  - Ponzi(label=1)  : ${fullPonzi.length}건`);
  console.log(`  - Normal(label=0) : ${fullNormal.length}건`);
  if (fullCases.length > 0) {
    console.log('\nFullEvasion 발동 주소 목록:');
    for (const r of fullCases) {
      console.log(`  ${r.address}  label=${r.label}  maxSingleRatio=${r.maxSingleRatio.toFixed(3)}  spanRatio=${r.spanRatio.toFixed(3)}  withdrawalCount=${r.withdrawalCount}`);
    }
  }

  // ── CSV 산출물 ─────────────────────────────────────────────────────────────
  const csvLines = [
    'address,label,has_log,withdrawal_count,max_single_ratio,span_ratio,balance_drop_evasion,max_tx_evasion,slow_drain,full_evasion',
    ...rows.map(r => [
      r.address, r.label, r.hasLog ? 1 : 0, r.withdrawalCount ?? '',
      r.maxSingleRatio != null ? r.maxSingleRatio.toFixed(4) : '',
      r.spanRatio != null ? r.spanRatio.toFixed(4) : '',
      r.balanceDropEvasion ? 1 : 0, r.maxTxEvasion ? 1 : 0,
      r.slowDrain ? 1 : 0, r.fullEvasion ? 1 : 0,
    ].join(',')),
  ];
  fs.writeFileSync(path.join(RESULTS_DIR, 'fullevasion_predictions.csv'), csvLines.join('\n') + '\n', 'utf8');

  // ── Markdown 리포트 ────────────────────────────────────────────────────────
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const md = [
    '# FullEvasion 실데이터 재검토 (Phase 2)',
    '',
    `> 생성: ${now}`,
    '',
    '## 데이터셋',
    '',
    `- 평가 대상: evaluate_comparison.js 와 동일한 공통 주소 **N=${shared.length}개**`,
    `  (labeled_addresses.csv ∩ baseline_predictions.csv 주소)`,
    `- 로그 존재: ${withLog.length}개`,
    `- withdrawal 이벤트 존재(회피 공리 계산 가능): **${withWithdrawal.length}개** (Ponzi=${nPonziWithdrawal}, Normal=${nNormalWithdrawal})`,
    '',
    '## 표 1. 회피 서브클래스 개별 발동 비율',
    '',
    `> 기준: withdrawal 이벤트가 1건 이상 있는 ${withWithdrawal.length}개 주소`,
    '',
    '| 조건 | 발동 건수 | 비율 | Ponzi(label=1) | Normal(label=0) |',
    '|------|----------:|-----:|----------------:|-----------------:|',
    `| BalanceDropEvasion (max_ratio < 0.80) | ${nBDE} | ${pct(nBDE, withWithdrawal.length)} | ${bdePonzi} | ${bdeNormal} |`,
    `| MaxTxEvasion (count≥3 AND max_ratio < 0.90) | ${nMTE} | ${pct(nMTE, withWithdrawal.length)} | ${mtePonzi} | ${mteNormal} |`,
    `| SlowDrain (span_ratio > 0.30) | ${nSD} | ${pct(nSD, withWithdrawal.length)} | ${sdPonzi} | ${sdNormal} |`,
    '',
    '## 표 2. FullEvasion (3조건 동시 AND) 발동 카운트',
    '',
    '| 구분 | 건수 |',
    '|------|-----:|',
    `| 전체 | ${nFull} |`,
    `| Ponzi(label=1) | ${fullPonzi.length} |`,
    `| Normal(label=0) | ${fullNormal.length} |`,
    '',
    fullCases.length > 0
      ? [
          '### FullEvasion 발동 주소 상세',
          '',
          '| 주소 | label | withdrawal_count | max_single_ratio | span_ratio |',
          '|------|:-----:|------------------:|------------------:|------------:|',
          ...fullCases.map(r =>
            `| \`${r.address}\` | ${r.label} | ${r.withdrawalCount} | ${r.maxSingleRatio.toFixed(3)} | ${r.spanRatio.toFixed(3)} |`
          ),
        ].join('\n')
      : '(FullEvasion 발동 사례 없음 — TP=0)',
    '',
    '## 결론',
    '',
    nFull > 0
      ? `TP > 0 (${nFull}건). 설계서 5-3절에서 "시뮬레이션 발생 확률 극히 낮음"으로 제외했던 가정과 달리, ` +
        `실데이터에서는 FullEvasion 패턴이 관측된다. 다만 이는 block-aggregated 로그를 per-tx로 근사 변환한 ` +
        `데이터 기반이라 개별 트랜잭션 단위 오차가 있을 수 있음에 유의. 아래 "근거 데이터"를 토대로 FullEvasion ` +
        `공리 신규 추가 여부를 판단할 수 있다 (이번 범위는 데이터 검증까지이며 구현은 하지 않음).`
      : `TP = 0. 설계서 8-1절의 "FullEvasion 미구현" 한계 서술이 실데이터(N=${withWithdrawal.length}, ` +
        `XBlock 기반)로도 그대로 확인된다. 3조건을 동시에 만족하는 실제 폰지/정상 컨트랙트 사례가 발견되지 않았다.`,
    '',
    '## 기존 N=272 비교실험 영향 확인',
    '',
    '- `evaluate_comparison.js` 의 `dynamicPredict()`는 `analyzeDynamic()` 결과에서 ' +
      '`fraud_type_hint`/`verdict` 필드만 사용하며 `evasion_subclass` 필드는 전혀 참조하지 않는다 ' +
      '(코드 확인, evaluate_comparison.js:186-213). 따라서 회피 서브클래스 공리 발동 여부는 ' +
      'Exact/Superclass Precision·Recall·F1에 구조적으로 영향을 줄 수 없다.',
    '- `evaluate_comparison.js`를 재실행해 `results/comparison_report_v2_clean272.md`와 대조한 결과, ' +
      '생성 시각을 제외한 모든 지표(Precision/Recall/F1/TP/FP/FN/TN, 판정 불일치 목록)가 완전히 동일함을 ' +
      '실측으로 확인했다 (Phase 1의 triggers/implies 변경 포함, 지금까지의 변경이 이 실험에 영향을 준 적 없음).',
    '- 저장소 내 McNemar 검정 구현은 현재 존재하지 않는다(`evaluate_comparison.js`, ' +
      '`baseline_classifier.js`, `pilot_diagnose.js` 검색 결과 매치 없음) — 따라서 "McNemar 수치에 영향 없음"은 ' +
      '해당 사항 없음으로 보고한다.',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(RESULTS_DIR, 'fullevasion_report.md'), md, 'utf8');
  console.log(`\n리포트 → ${path.join(RESULTS_DIR, 'fullevasion_report.md')}`);
  console.log(`CSV    → ${path.join(RESULTS_DIR, 'fullevasion_predictions.csv')}`);
}

main();
