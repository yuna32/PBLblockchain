/**
 * prepare_labels.js
 * Ponzi_label.csv → labeled_addresses.csv
 *
 * - "error" 행 제거
 * - Ponzi==1 전부 보존
 * - Ponzi==0 은 seed=42 로 300개 다운샘플링
 */
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t     = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededSample(arr, n, seed) {
  const rand = mulberry32(seed);
  const a    = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const DATA_DIR   = path.join(__dirname, 'data');
const INPUT_PATH = path.join(DATA_DIR, 'Ponzi_label.csv');
const OUT_PATH   = path.join(DATA_DIR, 'labeled_addresses.csv');

if (!fs.existsSync(INPUT_PATH)) {
  console.error(`입력 파일 없음: ${INPUT_PATH}`);
  process.exit(1);
}

let raw = fs.readFileSync(INPUT_PATH, 'utf8');
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);   // BOM 제거

const lines  = raw.trim().split(/\r?\n/);
const header = lines[0].split(',').map(h => h.trim());

const contractIdx = header.findIndex(h => h.toLowerCase() === 'contract');
const ponziIdx    = header.findIndex(h => h.toLowerCase() === 'ponzi');

if (contractIdx === -1 || ponziIdx === -1) {
  console.error(`헤더 불일치. 발견된 컬럼: ${header.join(', ')}`);
  process.exit(1);
}

const ponziAddrs  = [];
const normalAddrs = [];
let   errorCount  = 0;
let   otherCount  = 0;

for (const line of lines.slice(1)) {
  if (!line.trim()) continue;
  const cols     = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
  const address  = cols[contractIdx]?.toLowerCase();
  const ponziVal = cols[ponziIdx]?.trim();

  if (!address) continue;

  if (ponziVal === undefined || ponziVal.toLowerCase() === 'error') {
    errorCount++;
    continue;
  }
  if (ponziVal === '1') {
    ponziAddrs.push(address);
  } else if (ponziVal === '0') {
    normalAddrs.push(address);
  } else {
    otherCount++;
  }
}

const N_SAMPLE      = 300;
const sampledNormal = normalAddrs.length <= N_SAMPLE
  ? normalAddrs
  : seededSample(normalAddrs, N_SAMPLE, 42);

console.log(`[prepare_labels] 결과 요약`);
console.log(`  제거된 error 행  : ${errorCount}`);
console.log(`  기타(무시)       : ${otherCount}`);
console.log(`  Ponzi==1         : ${ponziAddrs.length} (전부 보존)`);
console.log(`  Ponzi==0 (원본)  : ${normalAddrs.length}`);
console.log(`  Ponzi==0 (샘플)  : ${sampledNormal.length}  (seed=42)`);

fs.mkdirSync(DATA_DIR, { recursive: true });

const outLines = [
  'address,label',
  ...ponziAddrs.map(a  => `${a},1`),
  ...sampledNormal.map(a => `${a},0`),
];

fs.writeFileSync(OUT_PATH, outLines.join('\n') + '\n', 'utf8');
console.log(`\n저장 완료 → ${OUT_PATH}  (${outLines.length - 1}개 주소)`);
