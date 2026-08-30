/**
 * baseline_classifier.js
 * Chen et al. (2018) "Detecting Ponzi Schemes on Ethereum" 재현 베이스라인
 *
 * 특징 6개 (account features) → Random Forest (자체 구현) → 5-fold CV
 * 실행: node baseline_classifier.js
 */
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Config ─────────────────────────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, 'data');
const LOGS_DIR    = path.join(DATA_DIR, 'logs');
const RESULTS_DIR = path.join(__dirname, 'results');

const RF_OPTS = { nTrees: 100, maxDepth: 10, minLeaf: 2 };
const N_FOLDS = 5;
const SEED    = 42;

// ── CSV Parser ─────────────────────────────────────────────────────────────────
function parseCSV(filepath) {
  if (!fs.existsSync(filepath)) return null;
  let text = fs.readFileSync(filepath, 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const hdr = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const v = line.split(',');
    const r = {};
    hdr.forEach((h, i) => { r[h] = parseFloat(v[i] ?? '0') || 0; });
    return r;
  });
}

// ── Feature Extraction ─────────────────────────────────────────────────────────
/**
 * Chen et al. (2018) 계정 특징 6개.
 * 원 논문은 per-transaction / per-account 데이터를 사용하지만,
 * 여기서는 블록 집계 CSV (total_in, total_out, …)만 사용 가능하므로
 * 재현 불가능한 특징은 근사치로 대체하고 주석에 명시함.
 */
function extractFeatures(rows) {
  if (!rows || rows.length === 0) return null;

  const n    = rows.length;
  const mid  = Math.floor(n / 2);
  const last = rows[n - 1];

  const inBlocks  = rows.filter(r => r.total_in  > 1e-12);
  const outBlocks = rows.filter(r => r.total_out > 1e-12);

  // ── Balance ─────────────────────────────────────────────────────────────────
  // 원 논문: 조회 시점의 컨트랙트 ETH 잔고 (wei → ETH).
  // cumulative_balance 마지막 값으로 직접 대응. (원 논문과 동일)
  const balance = last.cumulative_balance;

  // ── N_investment ─────────────────────────────────────────────────────────────
  // 원 논문: 컨트랙트에 ETH를 입금한 고유 계정 수.
  // per-account 집계 불가 → total_in > 0 인 블록 수로 대체.
  // (원 논문 정의와 다름, 근사치)
  const n_investment = inBlocks.length;

  // ── N_payment ─────────────────────────────────────────────────────────────
  // 원 논문: 컨트랙트로부터 ETH를 받은 고유 계정 수.
  // per-account 집계 불가 → total_out > 0 인 블록 수로 대체.
  // (원 논문 정의와 다름, 근사치)
  const n_payment = outBlocks.length;

  // ── Known_rate ───────────────────────────────────────────────────────────────
  // 원 논문: 실제로 출금을 수령한 투자자 수 / 전체 투자자 수.
  // per-account 입출금 매핑 없이는 재현 불가.
  // 근사: (후반 절반 기간 총 출금) / (초기 절반 기간 총 출금).
  //   → 후반부로 갈수록 출금이 집중(폰지 붕괴)되면 값이 커짐.
  // (원 논문 정의와 다름, 근사치)
  const firstOut  = rows.slice(0, mid).reduce((s, r) => s + r.total_out, 0);
  const secondOut = rows.slice(mid).reduce((s, r) => s + r.total_out, 0);
  const known_rate = firstOut  > 1e-12 ? secondOut / firstOut
                   : secondOut > 1e-12 ? 1.0 : 0.0;

  // ── Paid_rate ────────────────────────────────────────────────────────────────
  // 원 논문: 투자금 이상을 환급받은 투자자 비율.
  // per-account 입출금 비교 불가.
  // 근사: (total_out > 0인 블록 수) / (total_in > 0인 블록 수).
  // (원 논문 정의와 다름, 근사치)
  const paid_rate = n_investment > 0 ? n_payment / n_investment : 0;

  // ── Max_payment_count ─────────────────────────────────────────────────────
  // 원 논문: 단일 계정이 수령한 출금의 최대 횟수.
  // per-account 출금 횟수 집계 불가.
  // 근사: 전 기간 max_single_tx의 최댓값 (단일 트랜잭션 최대 ETH).
  //   → 대규모 일회성 출금은 폰지 붕괴/러그풀과 상관.
  // (원 논문 정의와 다름, 근사치)
  const max_payment_count = rows.reduce((m, r) => Math.max(m, r.max_single_tx), 0);

  const safe = v => (Number.isFinite(v) && !isNaN(v) ? v : 0);
  return {
    balance:           safe(balance),
    n_investment:      safe(n_investment),
    n_payment:         safe(n_payment),
    known_rate:        safe(Math.min(known_rate, 100)),
    paid_rate:         safe(paid_rate),
    max_payment_count: safe(max_payment_count),
  };
}

const FEAT_KEYS = ['balance', 'n_investment', 'n_payment', 'known_rate', 'paid_rate', 'max_payment_count'];

// ── Seeded PRNG (mulberry32) ───────────────────────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Gini impurity (binary) ────────────────────────────────────────────────────
function gini(pos, total) {
  if (total === 0) return 0;
  const p = pos / total;
  return 1 - p * p - (1 - p) * (1 - p);
}

// ── Best split (sorted sweep, O(n log n) per feature) ────────────────────────
function bestSplit(X, y, subset) {
  const n       = y.length;
  const totPos  = y.reduce((s, v) => s + v, 0);
  const baseG   = gini(totPos, n);

  let bestGain = 0, bestFeat = -1, bestThresh = 0;

  for (const fi of subset) {
    const order = Array.from({ length: n }, (_, i) => i)
                       .sort((a, b) => X[a][fi] - X[b][fi]);
    let lPos = 0, rPos = totPos;

    for (let i = 0; i < n - 1; i++) {
      if (y[order[i]] === 1) { lPos++; rPos--; }

      if (X[order[i]][fi] === X[order[i + 1]][fi]) continue;

      const lN   = i + 1;
      const rN   = n - lN;
      const gain = baseG - (lN / n) * gini(lPos, lN) - (rN / n) * gini(rPos, rN);

      if (gain > bestGain) {
        bestGain   = gain;
        bestFeat   = fi;
        bestThresh = (X[order[i]][fi] + X[order[i + 1]][fi]) / 2;
      }
    }
  }
  return bestFeat >= 0 ? { feat: bestFeat, thresh: bestThresh } : null;
}

// ── Decision Tree (CART) ──────────────────────────────────────────────────────
function buildTree(X, y, depth, maxDepth, minLeaf, nFeats, rand) {
  const n   = y.length;
  const pos = y.reduce((s, v) => s + v, 0);

  if (depth >= maxDepth || n <= minLeaf || pos === 0 || pos === n) {
    return { leaf: true, prob: pos / n };
  }

  const nF    = X[0].length;
  const sub   = shuffle(Array.from({ length: nF }, (_, i) => i), rand).slice(0, nFeats);
  const split = bestSplit(X, y, sub);
  if (!split) return { leaf: true, prob: pos / n };

  const { feat, thresh } = split;
  const Xl = [], yl = [], Xr = [], yr = [];
  for (let i = 0; i < n; i++) {
    if (X[i][feat] <= thresh) { Xl.push(X[i]); yl.push(y[i]); }
    else                       { Xr.push(X[i]); yr.push(y[i]); }
  }
  if (!Xl.length || !Xr.length) return { leaf: true, prob: pos / n };

  return {
    leaf: false, feat, thresh,
    left:  buildTree(Xl, yl, depth + 1, maxDepth, minLeaf, nFeats, rand),
    right: buildTree(Xr, yr, depth + 1, maxDepth, minLeaf, nFeats, rand),
  };
}

function predictOne(tree, x) {
  let node = tree;
  while (!node.leaf) node = x[node.feat] <= node.thresh ? node.left : node.right;
  return node.prob;
}

// ── Random Forest ──────────────────────────────────────────────────────────────
function trainForest(X, y, { nTrees, maxDepth, minLeaf, seed }) {
  const rand   = mulberry32(seed);
  const n      = X.length;
  const nFeats = Math.max(1, Math.round(Math.sqrt(X[0].length)));
  const trees  = [];

  for (let t = 0; t < nTrees; t++) {
    const idx = Array.from({ length: n }, () => Math.floor(rand() * n));
    trees.push(buildTree(
      idx.map(i => X[i]), idx.map(i => y[i]),
      0, maxDepth, minLeaf, nFeats, rand
    ));
  }
  return trees;
}

function predictProba(trees, x) {
  return trees.reduce((s, t) => s + predictOne(t, x), 0) / trees.length;
}

// ── Metrics ────────────────────────────────────────────────────────────────────
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

// ── Stratified K-Fold ──────────────────────────────────────────────────────────
function stratifiedKFolds(y, k, rand) {
  const pos   = shuffle(y.reduce((a, l, i) => (l === 1 ? [...a, i] : a), []), rand);
  const neg   = shuffle(y.reduce((a, l, i) => (l === 0 ? [...a, i] : a), []), rand);
  const folds = Array.from({ length: k }, () => []);
  pos.forEach((idx, i) => folds[i % k].push(idx));
  neg.forEach((idx, i) => folds[i % k].push(idx));
  return folds;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Load label file
  const labelsPath = process.env.LABELS_FILE
    ? path.resolve(__dirname, process.env.LABELS_FILE)
    : path.join(DATA_DIR, 'labeled_addresses.csv');
  if (!fs.existsSync(labelsPath)) {
    console.error(`[오류] labels 파일 없음: ${labelsPath}`);
    process.exit(1);
  }
  let raw = fs.readFileSync(labelsPath, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

  const entries = raw.trim().split(/\r?\n/).slice(1)
    .map(l => { const [a, lbl] = l.split(','); return { address: a?.trim(), label: parseInt(lbl?.trim()) }; })
    .filter(e => e.address && !isNaN(e.label));

  // 2. Extract features from log CSVs
  console.log(`\n특징 추출 중 (${entries.length}개 주소)...`);
  const dataset = [];
  let nMissing  = 0;

  for (const { address, label } of entries) {
    const rows = parseCSV(path.join(LOGS_DIR, `${address}.csv`));
    if (!rows) { nMissing++; continue; }
    const feat = extractFeatures(rows);
    if (!feat)  { nMissing++; continue; }
    dataset.push({ address, label, feat });
  }

  const nPos = dataset.filter(d => d.label === 1).length;
  const nNeg = dataset.filter(d => d.label === 0).length;
  console.log(`유효 샘플: ${dataset.length}  (ponzi=${nPos}, normal=${nNeg})  로그 없음: ${nMissing}`);

  if (dataset.length < N_FOLDS * 4) {
    console.error(`\n[오류] 샘플 부족 (${dataset.length}개). fetch_and_convert.js 실행 후 재시도하세요.`);
    process.exit(1);
  }

  // 3. Feature matrix
  const X = dataset.map(d => FEAT_KEYS.map(k => d.feat[k]));
  const y = dataset.map(d => d.label);

  // Feature statistics (sanity check)
  console.log('\n── 특징 평균 (ponzi vs normal) ──────────────────────────────');
  const mean = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  for (let ki = 0; ki < FEAT_KEYS.length; ki++) {
    const vals = dataset.map((d, i) => ({ label: d.label, v: X[i][ki] }));
    const pM   = mean(vals.filter(e => e.label === 1).map(e => e.v));
    const nM   = mean(vals.filter(e => e.label === 0).map(e => e.v));
    console.log(`  ${FEAT_KEYS[ki].padEnd(20)} ponzi=${pM.toFixed(4).padStart(10)}  normal=${nM.toFixed(4).padStart(10)}`);
  }

  // 4. 5-fold Stratified CV
  console.log(`\n── 5-fold cross-validation  (n_trees=${RF_OPTS.nTrees}, max_depth=${RF_OPTS.maxDepth}) ──`);
  const cvRand   = mulberry32(SEED);
  const folds    = stratifiedKFolds(y, N_FOLDS, cvRand);
  const allProbs = new Float64Array(dataset.length);
  const allPreds = new Int8Array(dataset.length);
  const foldF1s  = [];

  for (let fold = 0; fold < N_FOLDS; fold++) {
    const testSet  = new Set(folds[fold]);
    const trainIdx = folds.flatMap((f, i) => (i !== fold ? f : []));
    const testIdx  = [...testSet];

    const ytrain = trainIdx.map(i => y[i]);
    const ytest  = testIdx.map(i  => y[i]);

    process.stdout.write(
      `  Fold ${fold + 1}/${N_FOLDS}  train=${ytrain.length}  test=${ytest.length} ... `
    );
    const t0 = Date.now();

    const forest = trainForest(
      trainIdx.map(i => X[i]), ytrain,
      { ...RF_OPTS, seed: SEED + fold * 997 }
    );

    const predProbs  = testIdx.map(i => predictProba(forest, X[i]));
    const predLabels = predProbs.map(p => p >= 0.5 ? 1 : 0);
    testIdx.forEach((i, j) => { allProbs[i] = predProbs[j]; allPreds[i] = predLabels[j]; });

    const { prec, rec, f1, tp, fp, fn, tn } = computeMetrics(ytest, predLabels);
    foldF1s.push(f1);

    console.log(
      `P=${prec.toFixed(3)}  R=${rec.toFixed(3)}  F1=${f1.toFixed(3)}` +
      `  [TP=${tp} FP=${fp} FN=${fn} TN=${tn}]  ${Date.now() - t0}ms`
    );
  }

  // 5. Overall metrics (aggregated across all folds)
  const overall = computeMetrics(y, [...allPreds]);
  const meanF1  = foldF1s.reduce((s, f) => s + f, 0) / N_FOLDS;
  const varF1   = foldF1s.reduce((s, f) => s + (f - meanF1) ** 2, 0) / N_FOLDS;

  console.log('\n── 전체 결과 (5-fold 집계) ───────────────────────────────────');
  console.log(`  Precision : ${overall.prec.toFixed(4)}`);
  console.log(`  Recall    : ${overall.rec.toFixed(4)}`);
  console.log(`  F1        : ${overall.f1.toFixed(4)}`);
  console.log(`  혼동행렬  : TP=${overall.tp}  FP=${overall.fp}  FN=${overall.fn}  TN=${overall.tn}`);

  console.log('\n── Fold별 F1 ─────────────────────────────────────────────────');
  foldF1s.forEach((f, i) => console.log(`  Fold ${i + 1}    : ${f.toFixed(4)}`));
  console.log(`  Mean F1   : ${meanF1.toFixed(4)}`);
  console.log(`  Variance  : ${varF1.toFixed(6)}`);
  console.log(`  Std Dev   : ${Math.sqrt(varF1).toFixed(4)}`);

  // 6. Save predictions
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = process.env.PREDICTIONS_FILE
    ? path.resolve(__dirname, process.env.PREDICTIONS_FILE)
    : path.join(RESULTS_DIR, 'baseline_predictions.csv');
  const outLines = [
    'address,true_label,predicted_label,predicted_score',
    ...dataset.map((d, i) =>
      `${d.address},${d.label},${allPreds[i]},${allProbs[i].toFixed(6)}`
    ),
  ];
  fs.writeFileSync(outPath, outLines.join('\n') + '\n', 'utf8');
  console.log(`\n예측 저장 → ${outPath}  (${dataset.length}건)`);
}

main().catch(err => { console.error(err); process.exit(1); });
