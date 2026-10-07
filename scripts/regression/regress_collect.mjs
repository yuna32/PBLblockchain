/**
 * regress_collect.mjs — 사본 트리의 runPrevention 결과 수집 (regress.sh가 호출)
 *
 * 사용: node regress_collect.mjs <tree> <main|nested> <outDir>
 *
 * - <tree>/contracts/*.sol을 자동 탐색한다(하드코딩 목록 없음). 이름순 정렬.
 * - <tree> 안의 reasoner 모듈만 import한다. 저장소 본체의 모듈은 import하지 않는다
 *   (runPrevention은 모듈 위치 기준으로 contracts/를 찾는다: analysis/prevention_reasoner.js:11, :73).
 * - 결과는 <outDir>/<컨트랙트>.json (JSON.stringify(r, null, 2) + "\n").
 * - reasoner 모듈 파일이 트리에 없으면 <outDir>/_module_absent 를 쓰고 0으로 끝난다(비교 단계에서 MISSING).
 * - 그 밖의 오류는 종료 코드 2.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const MODULES = {
  main:   'analysis/prevention_reasoner.js',
  nested: 'analysis/analysis/prevention_reasoner.js',
};

function fail(msg) { console.error(`[collect] ${msg}`); process.exit(2); }

const [treeArg, which, outDir] = process.argv.slice(2);
if (!treeArg || !MODULES[which] || !outDir) fail('사용: node regress_collect.mjs <tree> <main|nested> <outDir>');

const tree = fs.realpathSync(path.resolve(treeArg));
fs.mkdirSync(outDir, { recursive: true });

const modPath = path.join(tree, MODULES[which]);
if (!fs.existsSync(modPath)) {
  fs.writeFileSync(path.join(outDir, '_module_absent'), `${MODULES[which]}\n`);
  console.log(`[collect] ${which}: 모듈 없음 (${MODULES[which]})`);
  process.exit(0);
}
const resolved = fs.realpathSync(modPath);
const rel = path.relative(tree, resolved);
if (rel.startsWith('..') || path.isAbsolute(rel)) fail(`모듈이 트리 밖으로 해석됨: ${resolved}`);

const contractsDir = path.join(tree, 'contracts');
const names = fs.existsSync(contractsDir)
  ? fs.readdirSync(contractsDir).filter(f => f.endsWith('.sol')).map(f => f.slice(0, -4)).sort()
  : [];

let runPrevention;
try {
  ({ runPrevention } = await import(pathToFileURL(resolved).href));
} catch (e) {
  fail(`${which} reasoner import 실패: ${e.message}`);
}
if (typeof runPrevention !== 'function') fail(`${which} reasoner에 runPrevention export 없음`);

for (const n of names) {
  const r = await runPrevention(n);
  fs.writeFileSync(path.join(outDir, `${n}.json`), JSON.stringify(r, null, 2) + '\n');
  console.log(`${which} ${n}: fraud=${r?.fraud_type_suspected} level=${r?.risk_level} score=${r?.risk_score}`);
}
console.log(`[collect] ${which}: ${names.length}개`);
