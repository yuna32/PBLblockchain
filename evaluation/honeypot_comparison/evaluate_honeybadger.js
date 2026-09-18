/**
 * evaluate_honeybadger.js
 *
 * HoneyPot 코드축 서브클래스(HiddenStateUpdate / StrawManContract) 정밀도를
 * christoftorres/HoneyBadger 저장소의 실제 데이터로 검증한다.
 *
 * 데이터: data/HoneyBadger/datasets/source_code/{hidden_state_update,straw_man_contract}/*.sol
 *         data/HoneyBadger/results/evaluation/HoneyBadger Evaluation - *.csv
 *           (Address, Source Code, Positive[TRUE/FALSE] — 원 논문 저자가 수작업
 *            검증한 정답 라벨. 이 파일들은 이미 "HoneyBadger 자체 탐지기가
 *            flag한" 컨트랙트 집합이므로, 여기서 계산하는 정밀도는 "우리 boolean
 *            탐지기가 매치한 것 중 실제로 해당 기법인 비율"이다 — 원 논문의
 *            81.7%/88.2%와 동일한 정의(True Positives / (True Positives + False
 *            Positives)).
 *
 * 실행: node evaluation/honeypot_comparison/evaluate_honeybadger.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectHiddenStateUpdate, detectStrawManContract } from '../../analysis/analysis/prevention_reasoner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.join(__dirname, 'data', 'HoneyBadger');

function parseEvalCsv(csvPath) {
  const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const address = cols[0]?.trim();
    const positive = cols[2]?.trim().toUpperCase();
    if (!address || !address.startsWith('0x')) continue;
    if (positive !== 'TRUE' && positive !== 'FALSE') continue;
    rows.push({ address, positive: positive === 'TRUE' });
  }
  return rows;
}

function evaluate(category, csvName, sourceDirName, detectFn) {
  const csvPath = path.join(DATA_ROOT, 'results', 'evaluation', csvName);
  const srcDir  = path.join(DATA_ROOT, 'datasets', 'source_code', sourceDirName);

  const rows = parseEvalCsv(csvPath);
  let tp = 0, fp = 0, fn = 0, tn = 0, missingFile = 0;
  const fpList = [], fnList = [];

  for (const { address, positive } of rows) {
    const solPath = path.join(srcDir, `${address}.sol`);
    if (!fs.existsSync(solPath)) { missingFile++; continue; }

    const src   = fs.readFileSync(solPath, 'utf8');
    const lines = src.split('\n');
    const matched = detectFn(src, lines).matched;

    if (matched && positive)       { tp++; }
    else if (matched && !positive) { fp++; fpList.push(address); }
    else if (!matched && positive) { fn++; fnList.push(address); }
    else                            { tn++; }
  }

  const total     = tp + fp + fn + tn;
  const precision = (tp + fp) > 0 ? tp / (tp + fp) : null;
  const recall    = (tp + fn) > 0 ? tp / (tp + fn) : null;
  const matchRate = total > 0 ? (tp + fp) / total : null;

  return { category, total, missingFile, tp, fp, fn, tn, precision, recall, matchRate, fpList, fnList };
}

function fmtPct(x) { return x === null ? 'N/A' : (x * 100).toFixed(1) + '%'; }

function main() {
  if (!fs.existsSync(DATA_ROOT)) {
    console.error(`HoneyBadger 저장소 없음: ${DATA_ROOT} — 먼저 git clone 필요`);
    process.exit(1);
  }

  // detectHiddenStateUpdate(lines) 시그니처 — src 인자 불필요하므로 래핑
  const hsuResult = evaluate(
    'HiddenStateUpdate',
    'HoneyBadger Evaluation - Hidden State Update.csv',
    'hidden_state_update',
    (src, lines) => detectHiddenStateUpdate(lines)
  );

  const smcResult = evaluate(
    'StrawManContract',
    'HoneyBadger Evaluation - Straw Man Contract.csv',
    'straw_man_contract',
    (src, lines) => detectStrawManContract(src, lines)
  );

  const paperPrecision = { HiddenStateUpdate: 0.817, StrawManContract: 0.882 };

  for (const r of [hsuResult, smcResult]) {
    console.log(`\n=== ${r.category} ===`);
    console.log(`  CSV 총 행: ${r.total + r.missingFile}  (소스파일 누락: ${r.missingFile})`);
    console.log(`  평가 대상: ${r.total}`);
    console.log(`  우리 탐지기 매치: ${r.tp + r.fp}건 (TP=${r.tp}, FP=${r.fp})`);
    console.log(`  매치율(recall from HoneyBadger corpus): ${fmtPct(r.matchRate)}`);
    console.log(`  우리 탐지기 정밀도: ${fmtPct(r.precision)}  (TP/(TP+FP))`);
    console.log(`  원 논문 정밀도: ${fmtPct(paperPrecision[r.category])}`);
    console.log(`  Confusion: TP=${r.tp} FP=${r.fp} FN=${r.fn} TN=${r.tn}`);
    if (r.fpList.length) console.log(`  FP 주소(최대 10개): ${r.fpList.slice(0, 10).join(', ')}`);
  }

  const outPath = path.join(__dirname, 'results');
  fs.mkdirSync(outPath, { recursive: true });
  fs.writeFileSync(
    path.join(outPath, 'honeybadger_precision_report.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), hsuResult, smcResult, paperPrecision }, null, 2)
  );
  console.log(`\n저장: ${path.join(outPath, 'honeybadger_precision_report.json')}`);
}

main();
