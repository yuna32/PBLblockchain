/**
 * cross_validate.js — 음성 대조군 검증.
 * evaluate_honeybadger.js에서 두 탐지기 모두 매치율 100%가 나온 것이 의심스러워
 * (탐지기가 너무 느슨해서 "거의 다 매치"하는 것 아닌지) 다른 6개 기법 폴더를
 * 음성 대조군으로 돌려 오탐률을 확인한다. 이상적으로는 hidden_state_update
 * 탐지기가 다른 폴더(특히 straw_man_contract 포함)에서는 낮은 매치율을 보여야
 * 진짜로 구별력 있는 탐지임을 알 수 있다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectHiddenStateUpdate, detectStrawManContract } from '../../analysis/analysis/prevention_reasoner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.join(__dirname, 'data', 'HoneyBadger', 'datasets', 'source_code');

const categories = fs.readdirSync(SRC_ROOT).filter(d =>
  fs.statSync(path.join(SRC_ROOT, d)).isDirectory()
);

for (const cat of categories) {
  const dir = path.join(SRC_ROOT, cat);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sol'));
  let hsuMatch = 0, smcMatch = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const lines = src.split('\n');
    if (detectHiddenStateUpdate(lines).matched) hsuMatch++;
    if (detectStrawManContract(src, lines).matched) smcMatch++;
  }
  console.log(
    `${cat.padEnd(24)} n=${String(files.length).padEnd(4)} ` +
    `HSU매치=${hsuMatch}/${files.length} (${(100*hsuMatch/files.length).toFixed(1)}%)  ` +
    `SMC매치=${smcMatch}/${files.length} (${(100*smcMatch/files.length).toFixed(1)}%)`
  );
}
