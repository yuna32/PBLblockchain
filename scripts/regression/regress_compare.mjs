/**
 * regress_compare.mjs — 정규화·비교·허용 목록·기준선 갱신 (regress.sh가 호출)
 *
 * 모드
 *   compare  --run <dir> --tree <dir> --baseline-root <dir> --expected <file> [--preview --reason <r>]
 *   confirm  --runs-root <dir> --confirm <run_id> --baseline-root <dir> --reason <r>
 *
 * 종료 코드
 *   compare: 0 통과 / 1 허용되지 않은 차이·미사용 허용 항목·NEW·MISSING·스모크 실패 / 2 실행 오류
 *            --preview: 0 미리보기 작성 / 2 거부·오류 (비교 결과는 summary.md에 적힌다)
 *   confirm: 0 기준선 작성 / 2 거부·오류
 *
 * 근거: ~/pbl_backup/regression_design/PROPOSAL.md (1~7절), FINDINGS.md
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

class RegressError extends Error {}
const ABSENT = '<absent>';
const EMPTY = '<empty>';
const N272_FILES = ['ontology_predictions.csv', 'disagreement_cases.csv', 'comparison_report.md', 'mcnemar_report.md'];
const N272_TAGS = {
  'ontology_predictions.csv': '[논문표1]',
  'comparison_report.md':     '[논문표1]',
  'disagreement_cases.csv':   '[논문 McNemar]',
  'mcnemar_report.md':        '[논문 McNemar]',
};
const REASONERS = { main: 'analysis/prevention_reasoner.js', nested: 'analysis/analysis/prevention_reasoner.js' };
const SMOKE_SCRIPT = 'evaluation/response_reasoner/response_reasoner.js';
// 발동 규칙 층: 스모크가 만든 <run>/out/smoke/new.jsonl 의 address·triggered_rules 만 쓴다
// (근거: ~/pbl_backup/response_rules_baseline_design/PROPOSAL.md)
const RULES_TARGET = 'rules/triggered_rules.csv';
const RULES_DETAIL_MAX = 50;

// ── 공통 ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--preview') { a.preview = true; continue; }
    if (k.startsWith('--')) {
      const v = argv[++i];
      if (v === undefined) throw new RegressError(`값 없음: ${k}`);
      a[k.slice(2)] = v;
    } else a._.push(k);
  }
  return a;
}
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const readText = (p) => fs.readFileSync(p, 'utf8');
const stripCR = (s) => s.replace(/\r/g, '');
const show = (v) => {
  const s = v === ABSENT ? ABSENT : JSON.stringify(v);
  return s.length > 160 ? s.slice(0, 157) + '...' : s;
};
function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ── 정규화 (PROPOSAL 5절) ──────────────────────────────────────────────────────
// CR 제거, 사본 트리 절대경로 → <TREE>, 파일 끝 개행 하나로 통일, md는 "> 생성:" 줄 제외
function normalizeText(s, rel, treePath) {
  let t = stripCR(s);
  if (treePath) t = t.split(treePath).join('<TREE>');
  if (rel.endsWith('.md')) t = t.split('\n').filter(l => !/^> 생성: /.test(l)).join('\n');
  return t.replace(/\n+$/, '') + '\n';
}

// 주소별 wide CSV: address + 규칙 id(사전순 합집합) 열, 셀 "weight/weight_max/fraction", 미발동은 빈 셀.
// 숫자는 String(number) = JSON 표기 그대로. 스모크가 PASS일 때만 만든다(그 밖에는 new.jsonl을 신뢰하지 않음).
function buildRulesCsv(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) throw new RegressError(`스모크 PASS인데 new.jsonl 없음: out/smoke/new.jsonl`);
  const rows = stripCR(readText(jsonlPath)).split('\n').filter(Boolean).map((l, i) => {
    const r = JSON.parse(l);
    if (typeof r.address !== 'string' || !Array.isArray(r.triggered_rules)) throw new RegressError(`new.jsonl ${i + 1}행: address/triggered_rules 형식 오류`);
    return r;
  }).sort((x, y) => (x.address < y.address ? -1 : x.address > y.address ? 1 : 0));
  const ids = [...new Set(rows.flatMap(r => r.triggered_rules.map(t => t.id)))].sort();
  const lines = [['address', ...ids].join(',')];
  for (const r of rows) {
    const m = new Map(r.triggered_rules.map(t => [t.id, `${t.weight}/${t.weight_max}/${t.fraction}`]));
    lines.push([r.address, ...ids.map(id => m.get(id) ?? '')].join(','));
  }
  return lines.join('\n') + '\n';
}

function writeNorm(runDir, treePath, smoke) {
  const raw = path.join(runDir, 'out', 'raw');
  const norm = path.join(runDir, 'out', 'norm');
  fs.rmSync(norm, { recursive: true, force: true });
  const absent = {};
  for (const w of Object.keys(REASONERS)) {
    const d = path.join(raw, 'prevention', w);
    absent[w] = fs.existsSync(path.join(d, '_module_absent'));
    for (const f of listFiles(d).filter(f => f.endsWith('.json'))) {
      const rel = `prevention/${w}/${f}`;
      const t = normalizeText(readText(path.join(d, f)), rel, treePath);
      JSON.parse(t); // 형식 확인
      fs.mkdirSync(path.dirname(path.join(norm, rel)), { recursive: true });
      fs.writeFileSync(path.join(norm, rel), t);
    }
  }
  for (const f of N272_FILES) {
    const p = path.join(raw, 'n272', f);
    if (!fs.existsSync(p)) throw new RegressError(`N=272 출력 없음: out/raw/n272/${f}`);
    fs.mkdirSync(path.join(norm, 'n272'), { recursive: true });
    fs.writeFileSync(path.join(norm, 'n272', f), normalizeText(readText(p), f, treePath));
  }
  if (smoke.status === 'PASS') {
    fs.mkdirSync(path.join(norm, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(norm, RULES_TARGET),
      normalizeText(buildRulesCsv(path.join(runDir, 'out', 'smoke', 'new.jsonl')), RULES_TARGET, treePath));
  }
  return { norm, absent };
}

// ── 비교기 ─────────────────────────────────────────────────────────────────────
function jsonPath(base, key) {
  return typeof key === 'number' ? `${base}[${key}]`
    : /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}
function diffJson(a, b, p = '$', out = []) {
  const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a;
  const tb = Array.isArray(b) ? 'array' : b === null ? 'null' : typeof b;
  if (ta !== tb) { out.push({ path: p, from: a, to: b }); return out; }
  if (ta === 'array') {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length) out.push({ path: jsonPath(p, i), from: ABSENT, to: b[i] });
      else if (i >= b.length) out.push({ path: jsonPath(p, i), from: a[i], to: ABSENT });
      else diffJson(a[i], b[i], jsonPath(p, i), out);
    }
  } else if (ta === 'object') {
    for (const k of Object.keys(a)) {
      if (!(k in b)) out.push({ path: jsonPath(p, k), from: a[k], to: ABSENT });
      else diffJson(a[k], b[k], jsonPath(p, k), out);
    }
    for (const k of Object.keys(b)) if (!(k in a)) out.push({ path: jsonPath(p, k), from: ABSENT, to: b[k] });
  } else if (a !== b) out.push({ path: p, from: a, to: b });
  return out;
}
function compareJsonText(baseText, curText) {
  const items = diffJson(JSON.parse(baseText), JSON.parse(curText));
  // 구조가 같은데 텍스트가 다르면 키 순서 차이다 (PROPOSAL 5절: 키 순서 유지 비교)
  if (items.length === 0 && baseText !== curText) items.push({ path: '$<key_order>', from: 'baseline', to: 'changed' });
  return items;
}

function parseCsv(text) {
  const lines = text.replace(/\n$/, '').split('\n');
  const header = lines[0].split(',');
  const rows = new Map(); const order = []; const dups = [];
  for (const l of lines.slice(1)) {
    const v = l.split(',');
    const key = v[0];
    if (rows.has(key)) dups.push(key);
    const r = {}; header.forEach((h, i) => { r[h] = v[i] ?? ''; });
    rows.set(key, { row: r, text: l }); order.push(key);
  }
  return { header, rows, order, dups };
}
// sparse: 한쪽에 열이 없고 다른 쪽 셀이 빈 값이면 같은 것으로 본다(rules CSV: 열 = 발동한 규칙 id)
function compareCsvText(baseText, curText, { sparse = false } = {}) {
  const A = parseCsv(baseText), B = parseCsv(curText), items = [];
  if (A.header.join(',') !== B.header.join(',')) items.push({ path: '$header', from: A.header.join(','), to: B.header.join(',') });
  if (A.header[0] !== 'address' || B.header[0] !== 'address') throw new RegressError('CSV 첫 열이 address가 아님');
  for (const d of [...A.dups, ...B.dups]) items.push({ path: '$duplicate_key', key: d, from: 'unique', to: 'duplicate' });
  const cols = [...new Set([...A.header, ...B.header])].filter(c => c !== 'address');
  for (const k of A.order) {
    if (!B.rows.has(k)) { items.push({ key: k, column: '<row>', from: A.rows.get(k).text, to: ABSENT }); continue; }
    const ra = A.rows.get(k).row, rb = B.rows.get(k).row;
    for (const c of cols) {
      const va = c in ra ? ra[c] : ABSENT, vb = c in rb ? rb[c] : ABSENT;
      if (sparse && ((va === ABSENT && vb === '') || (vb === ABSENT && va === ''))) continue;
      if (va !== vb) items.push({ key: k, column: c, from: va, to: vb });
    }
  }
  for (const k of B.order) if (!A.rows.has(k)) items.push({ key: k, column: '<row>', from: ABSENT, to: B.rows.get(k).text });
  const ao = A.order.filter(k => B.rows.has(k)), bo = B.order.filter(k => A.rows.has(k));
  if (ao.join('\n') !== bo.join('\n')) items.push({ path: '$row_order', from: 'baseline', to: 'changed' });
  const rowsTouched = new Set(items.filter(i => i.key).map(i => i.key)).size;
  return { items, rowsTouched };
}

function compareLines(baseText, curText) {
  const a = baseText.replace(/\n$/, '').split('\n'), b = curText.replace(/\n$/, '').split('\n');
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const items = []; let i = 0, j = 0, dels = [], adds = [];
  const flush = () => {
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      items.push({ path: 'line', from: dels[k]?.t ?? ABSENT, to: adds[k]?.t ?? ABSENT,
                   line_old: dels[k]?.n ?? null, line_new: adds[k]?.n ?? null });
    }
    dels = []; adds = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { adds.push({ t: b[j], n: j + 1 }); j++; }
    else { dels.push({ t: a[i], n: i + 1 }); i++; }
  }
  flush();
  return items;
}

// ── 허용 목록 (PROPOSAL 4절, B5) ───────────────────────────────────────────────
function loadExpected(file) {
  if (!fs.existsSync(file)) throw new RegressError(`허용 목록 없음: ${file}`);
  let j;
  try { j = JSON.parse(stripCR(readText(file))); } catch (e) { throw new RegressError(`허용 목록 JSON 오류: ${e.message}`); }
  if (!Array.isArray(j.entries)) throw new RegressError('허용 목록에 entries 배열 없음');
  const TARGET_RE = /^(prevention\/(main|nested)\/[A-Za-z0-9_*]+\.json|n272\/(ontology_predictions\.csv|disagreement_cases\.csv|comparison_report\.md|mcnemar_report\.md)|rules\/triggered_rules\.csv)$/;
  j.entries.forEach((e, idx) => {
    const where = `entries[${idx}]`;
    for (const f of ['target', 'from', 'to', 'commit', 'reason']) {
      if (!(f in e) || e[f] === '' || e[f] === undefined) throw new RegressError(`허용 목록 ${where}: ${f} 필수 (빈 값 불가, 빈 문자열은 "${EMPTY}")`);
    }
    if (!TARGET_RE.test(e.target)) throw new RegressError(`허용 목록 ${where}: target 형식 오류 (${e.target}). 와일드카드(*)는 prevention 파일명에만`);
    if (e.target.endsWith('.json') && !(typeof e.path === 'string' && e.path.startsWith('$'))) throw new RegressError(`허용 목록 ${where}: JSON 대상은 path("$..." ) 필수`);
    if (e.target.endsWith('.csv') && !e.path && !(e.key && e.column)) throw new RegressError(`허용 목록 ${where}: CSV 대상은 key와 column 필수 (또는 $header 등 path)`);
    if (e.target.endsWith('.md') && e.path !== 'line') throw new RegressError(`허용 목록 ${where}: md 대상은 path "line" 필수`);
  });
  return { baseline_id: j.baseline_id ?? '', entries: j.entries };
}
const tok = (v) => (v === EMPTY ? '' : v);
const globRe = (t) => new RegExp('^' + t.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
function entryMatches(e, target, item) {
  if (!globRe(e.target).test(target)) return false;
  if ((e.path ?? undefined) !== (item.path ?? undefined)) return false;
  if ((e.key ?? undefined) !== (item.key ?? undefined)) return false;
  if ((e.column ?? undefined) !== (item.column ?? undefined)) return false;
  return deepEqual(tok(e.from), item.from) && deepEqual(tok(e.to), item.to);
}

// ── 기준선 ─────────────────────────────────────────────────────────────────────
function loadBaseline(root) {
  const cur = path.join(root, 'CURRENT');
  if (!fs.existsSync(cur)) return null;
  const id = stripCR(readText(cur)).trim();
  if (!id) throw new RegressError('CURRENT가 비어 있음');
  const dir = path.join(root, 'baselines', id);
  if (!fs.existsSync(dir)) throw new RegressError(`CURRENT가 가리키는 기준선 디렉터리 없음: baselines/${id}`);
  const sums = path.join(dir, 'SHA256SUMS');
  if (!fs.existsSync(sums)) throw new RegressError(`기준선 SHA256SUMS 없음: ${id}`);
  const listed = new Set();
  for (const line of stripCR(readText(sums)).split('\n').filter(Boolean)) {
    const [h, rel] = line.split(/\s+/, 2);
    listed.add(rel);
    const p = path.join(dir, rel);
    if (!fs.existsSync(p)) throw new RegressError(`기준선 파일 없음: ${id}/${rel}`);
    if (sha256(stripCR(readText(p))) !== h) throw new RegressError(`기준선 무결성 오류(SHA256SUMS 불일치, CR 제거 후): ${id}/${rel}`);
  }
  const extra = listFiles(dir).filter(f => f !== 'SHA256SUMS' && !listed.has(f));
  if (extra.length) throw new RegressError(`SHA256SUMS에 없는 기준선 파일: ${extra.join(', ')}`);
  const manifest = JSON.parse(stripCR(readText(path.join(dir, 'MANIFEST.json'))));
  return { id, dir, manifest };
}
function writeBaselineNorm(baseline, runDir) {
  const out = path.join(runDir, 'out', 'baseline_norm');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  if (!baseline) return out;
  for (const rel of listFiles(baseline.dir)) {
    if (rel === 'MANIFEST.json' || rel === 'SHA256SUMS' || rel === 'smoke.json') continue;
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.writeFileSync(path.join(out, rel), normalizeText(readText(path.join(baseline.dir, rel)), rel, null));
  }
  return out;
}

// ── 스모크 (B8-3) ─────────────────────────────────────────────────────────────
function smokeResult(env) {
  const state = env.RG_SMOKE_STATE;
  if (state === 'absent_in_rev') return { status: 'SKIP', exit: null, changed: null, note: `이 rev에는 ${SMOKE_SCRIPT} 없음` };
  if (state === 'absent') return { status: 'MISSING', exit: null, changed: null, note: `사본 트리에 ${SMOKE_SCRIPT} 없음` };
  const exit = Number(env.RG_SMOKE_EXIT);
  const stdout = env.RG_SMOKE_STDOUT && fs.existsSync(env.RG_SMOKE_STDOUT) ? readText(env.RG_SMOKE_STDOUT) : '';
  const m = stdout.match(/예측 변경 (\d+)개/);
  const changed = m ? Number(m[1]) : null;
  const ok = exit === 0 && changed === 0;
  return { status: ok ? 'PASS' : 'DIFF', exit, changed, note: ok ? '' : `exit ${exit}, 예측 변경 ${changed ?? '(출력 없음)'}개` };
}

// ── compare ───────────────────────────────────────────────────────────────────
function runCompare(a, env) {
  const runDir = path.resolve(a.run);
  const treePath = a.tree ? fs.realpathSync(path.resolve(a.tree)) : null;
  const expected = loadExpected(a.expected);
  const baseline = loadBaseline(a['baseline-root']);
  if (!baseline && !a.preview) throw new RegressError(`기준선 없음 (${path.join(a['baseline-root'], 'CURRENT')}). 처음이면 --update-baseline --reason 으로 만든다`);
  if (expected.entries.length > 0 && expected.baseline_id !== (baseline?.id ?? null)) {
    throw new RegressError(`허용 목록의 baseline_id(${expected.baseline_id || '(빈 값)'})가 현재 기준선(${baseline?.id ?? '없음'})과 다름. 허용은 기준선 하나에 묶인다`);
  }

  const smoke = smokeResult(env);
  const { norm, absent } = writeNorm(runDir, treePath, smoke);
  const baseNorm = writeBaselineNorm(baseline, runDir);

  // 대상 목록
  const contractsOf = (root, w) => listFiles(path.join(root, 'prevention', w)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
  const curContracts = [...new Set([...contractsOf(norm, 'main'), ...contractsOf(norm, 'nested')])].sort();
  const baseContracts = [...new Set([...contractsOf(baseNorm, 'main'), ...contractsOf(baseNorm, 'nested')])].sort();
  const allContracts = [...new Set([...curContracts, ...baseContracts])].sort();

  const targets = [];
  for (const c of allContracts) for (const w of ['main', 'nested']) targets.push(`prevention/${w}/${c}.json`);
  for (const f of N272_FILES) targets.push(`n272/${f}`);
  targets.push(RULES_TARGET);

  const results = {};
  for (const t of targets) {
    const bp = path.join(baseNorm, t), cp = path.join(norm, t);
    if (t === RULES_TARGET && smoke.status !== 'PASS') {
      // 스모크 연동 (결정 3): SKIP → SKIP, DIFF → new.jsonl 신뢰 불가로 DIFF(비교 안 함), MISSING → 기준선에 있으면 MISSING
      if (smoke.status === 'SKIP') results[t] = { state: 'SKIP', items: [], note: `스모크 SKIP (${smoke.note})` };
      else if (smoke.status === 'DIFF') results[t] = { state: 'DIFF', items: [], note: `스모크 실패(${smoke.note})로 new.jsonl을 신뢰할 수 없어 비교하지 않음` };
      else if (fs.existsSync(bp)) results[t] = { state: 'MISSING', items: [], note: `스모크 ${smoke.status} (${smoke.note})` };
      continue;
    }
    const inB = fs.existsSync(bp), inC = fs.existsSync(cp);
    if (!inB && !inC) continue;
    if (!inB) { results[t] = { state: 'NEW', items: [] }; continue; }
    if (!inC) {
      const w = t.split('/')[1];
      results[t] = { state: 'MISSING', items: [], note: t.startsWith('prevention/') && absent[w] ? `${REASONERS[w]} 없음` : '' };
      continue;
    }
    const bt = readText(bp), ct = readText(cp);
    let items, extra = {};
    if (t.endsWith('.json')) items = compareJsonText(bt, ct);
    else if (t.endsWith('.csv')) { const r = compareCsvText(bt, ct, { sparse: t === RULES_TARGET }); items = r.items; extra.rowsTouched = r.rowsTouched; }
    else items = compareLines(bt, ct);
    results[t] = { state: items.length ? 'CHANGED' : 'PASS', items, ...extra };
  }

  // 허용 목록 적용
  const used = expected.entries.map(() => new Set());
  for (const [t, r] of Object.entries(results)) {
    if (r.state !== 'CHANGED') continue;
    const applied = new Set();
    for (const it of r.items) {
      const idx = expected.entries.findIndex(e => entryMatches(e, t, it));
      it.allowed = idx >= 0;
      if (idx >= 0) { used[idx].add(t); applied.add(idx); it.entry = idx; }
    }
    r.state = r.items.every(i => i.allowed) ? 'ALLOWED' : 'DIFF';
    r.appliedEntries = applied.size;
  }
  const unused = expected.entries.map((e, i) => ({ i, e })).filter(({ i }) => used[i].size === 0);

  // 표시용 라벨 (결정 6): 같은 address의 ontology_predictions.csv 셀 차이가 있으면 [예측 동반], 없으면 [규칙만]
  const predKeys = new Set((results['n272/ontology_predictions.csv']?.items || []).filter(i => i.key !== undefined).map(i => i.key));
  for (const it of results[RULES_TARGET]?.items || []) {
    if (it.key !== undefined) it.label = predKeys.has(it.key) ? '[예측 동반]' : '[규칙만]';
  }

  const statusLabel = (r) => !r ? '-' : r.state === 'ALLOWED' ? `ALLOWED (${r.appliedEntries})` : r.state;
  const failing = Object.values(results).some(r => ['DIFF', 'NEW', 'MISSING'].includes(r.state))
    || unused.length > 0 || ['DIFF', 'MISSING'].includes(smoke.status);
  const code = failing ? 1 : 0;

  // 매니페스트(실행) 정보
  const run = {
    run_id: env.RG_RUN_ID,
    source_rev: env.RG_SOURCE_REV, source_rev_short: (env.RG_SOURCE_REV || '').slice(0, 7),
    source_mode: env.RG_SOURCE_MODE,
    dirty: env.RG_DIRTY === 'true' ? true : env.RG_DIRTY === 'false' ? false : null,
    git_diff_stat: env.RG_DIFF_STAT_FILE && fs.existsSync(env.RG_DIFF_STAT_FILE) ? stripCR(readText(env.RG_DIFF_STAT_FILE)).trim() : '',
    node: process.version,
    env: { EXCLUDE_ADDRESSES: env.RG_EXCLUDE ?? '' },
    contracts: curContracts,
    reasoners: Object.entries(REASONERS).filter(([w]) => !absent[w]).map(([, p]) => p),
    smoke: { script: SMOKE_SCRIPT, ...smoke },
  };

  const summary = buildSummary({ run, baseline, results, allContracts, unused, expected, smoke, code, preview: !!a.preview, statusLabel });
  fs.writeFileSync(path.join(runDir, 'summary.md'), summary);
  fs.writeFileSync(path.join(norm, 'smoke.json'), JSON.stringify({ status: smoke.status, exit: smoke.exit, changed: smoke.changed }, null, 2) + '\n');
  fs.writeFileSync(path.join(runDir, 'run_manifest.json'), JSON.stringify(run, null, 2) + '\n');
  fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify({
    code, baseline_id: baseline?.id ?? null,
    targets: Object.fromEntries(Object.entries(results).map(([t, r]) => [t, { status: statusLabel(r), items: r.items.map(i => ({ ...i })) }])),
    unused_entries: unused.map(u => u.i), smoke,
  }, null, 2) + '\n');
  process.stdout.write(summary);

  if (!a.preview) return code;

  // ── 미리보기 (B7) ──
  if (!a.reason) throw new RegressError('--update-baseline 에는 --reason 필수');
  if (unused.length > 0) throw new RegressError(`허용 목록 미사용 항목 ${unused.length}개가 남아 있어 갱신 거부`);
  if (run.source_mode === 'working-tree' && run.dirty) throw new RegressError('source_mode=working-tree 이면서 dirty — 갱신 거부');
  if (run.source_mode === 'tree') throw new RegressError('source_mode=tree(외부 사본 트리)는 기준선으로 삼지 않음 — 갱신 거부');
  if (smoke.status !== 'PASS') throw new RegressError(`스모크 ${smoke.status}${smoke.note ? ` (${smoke.note})` : ''} — 발동 규칙을 기준선에 넣을 수 없어 갱신 거부`);
  const normFiles = listFiles(norm);
  fs.writeFileSync(path.join(runDir, 'preview.json'), JSON.stringify({
    preview_run_id: run.run_id, reason: a.reason, previous_baseline_id: baseline?.id ?? null,
    run, norm_sha256: Object.fromEntries(normFiles.map(f => [f, sha256(readText(path.join(norm, f)))])),
    comparison_code: code,
  }, null, 2) + '\n');
  return 0;
}

function buildSummary({ run, baseline, results, allContracts, unused, expected, smoke, code, preview, statusLabel }) {
  const L = [];
  const head = preview ? `PREVIEW (비교 결과 exit ${code})` : `${code === 0 ? 'PASS' : 'FAIL'} (exit ${code})`;
  L.push(`# regress ${run.run_id}  rev=${run.source_rev_short || run.source_rev}  mode=${run.source_mode}  baseline=${baseline?.id ?? '없음'}  result=${head}`, '');
  L.push(`- node: ${run.node}` + (baseline && baseline.manifest.node !== run.node ? ` — **경고: 기준선 node(${baseline.manifest.node})와 다름** (실패 아님)` : ''));
  L.push(`- EXCLUDE_ADDRESSES: "${run.env.EXCLUDE_ADDRESSES}" (빈 값만 다룸)`);
  L.push(`- dirty: ${run.dirty === null ? '해당 없음' : run.dirty}${run.source_mode === 'archive' ? ' (archive 모드: 소스는 커밋이므로 참고용 기록)' : ''}`);
  L.push(`- 컨트랙트(사본 트리 contracts/*.sol 자동 탐색): ${run.contracts.length}개 — ${run.contracts.join(', ')}`);
  L.push('', '## runPrevention', '', '| 컨트랙트 | main | nested |', '|---|---|---|');
  for (const c of allContracts) {
    const m = results[`prevention/main/${c}.json`], n = results[`prevention/nested/${c}.json`];
    L.push(`| ${c} | ${statusLabel(m)}${m?.note ? ` (${m.note})` : ''} | ${statusLabel(n)}${n?.note ? ` (${n.note})` : ''} |`);
  }
  L.push('', '## N=272', '', '| 파일 | 상태 | 요약 | 태그 |', '|---|---|---|---|');
  for (const f of N272_FILES) {
    const r = results[`n272/${f}`];
    let sum = '';
    if (r?.items?.length) {
      const al = r.items.filter(i => i.allowed).length;
      sum = f.endsWith('.csv')
        ? `${r.rowsTouched}행 / ${r.items.length}항목 (허용 ${al}, 미허용 ${r.items.length - al})`
        : `${r.items.length}줄 변경 (허용 ${al}, 미허용 ${r.items.length - al})`;
    }
    L.push(`| ${f} | ${statusLabel(r)} | ${sum} | ${r && r.state !== 'PASS' ? N272_TAGS[f] : ''} |`);
  }
  L.push('', '## response_reasoner 스모크', '');
  L.push(`| 상태 | exit | 예측 변경 | 비고 |`, '|---|---|---|---|');
  L.push(`| ${smoke.status} | ${smoke.exit ?? '-'} | ${smoke.changed ?? '-'} | ${smoke.note || ''} |`);
  L.push('', `- 스모크는 사본 트리의 \`${SMOKE_SCRIPT}\`를 --old=--new=사본 트리(+ 이번 실행의 ontology_predictions.csv로 자체검사)로 실행한다. 통과 조건은 exit 0과 "예측 변경 0개"다.`,
    '- 여기서 exit 0을 통과로 보는 것은 스모크 용도일 뿐이다. response_reasoner를 단독으로 쓸 때 exit 1은 "변경 있음"을 뜻하는 정보성 결과이며 실패가 아니다.');

  // 발동 규칙 절 (결정 6·7): 상세는 앞쪽 RULES_DETAIL_MAX셀, 총 셀·주소 수는 항상 표시
  const rr = results[RULES_TARGET];
  L.push('', `## 발동 규칙 (${RULES_TARGET})`, '');
  L.push('| 상태 | 변경 주소 | [예측 동반] | [규칙만] | 셀 (허용/미허용) | 비고 |', '|---|---|---|---|---|---|');
  if (!rr) {
    L.push('| - | | | | | 기준선과 이번 실행 모두 없음 |');
  } else {
    const cells = rr.items.filter(i => i.key !== undefined);
    const addrs = new Set(cells.map(i => i.key));
    const withPred = new Set(cells.filter(i => i.label === '[예측 동반]').map(i => i.key));
    const al = rr.items.filter(i => i.allowed).length;
    L.push(`| ${statusLabel(rr)} | ${addrs.size} | ${withPred.size} | ${addrs.size - withPred.size} | ${rr.items.length} (${al}/${rr.items.length - al}) | ${rr.note || ''} |`);
    if (rr.items.length) {
      L.push('', `총 ${rr.items.length}셀(주소 ${addrs.size}개${rr.items.length > cells.length ? `, 헤더 등 ${rr.items.length - cells.length}건 포함` : ''}). 상세는 앞쪽 ${RULES_DETAIL_MAX}셀까지 보인다(허용·종료 코드 판정은 전체 셀 기준).`, '');
      for (const i of rr.items.slice(0, RULES_DETAIL_MAX)) {
        const loc = i.key !== undefined ? `[${i.key}] ${i.column}` : i.path;
        L.push(`- ${loc}: ${show(i.from)} → ${show(i.to)}${i.label ? `   ${i.label}` : ''}${i.allowed ? '   (허용)' : ''}`);
      }
      if (rr.items.length > RULES_DETAIL_MAX) L.push(`- … 외 ${rr.items.length - RULES_DETAIL_MAX}셀 (result.json 참고)`);
    }
    L.push('', '- 셀 값은 `weight/weight_max/fraction`(빈 값 = 미발동). 라벨은 표시용이며 판정에 영향이 없다. 규칙이 같고 예측만 바뀐 주소는 위 N=272 비교가 잡는다.');
  }

  const diffs = Object.entries(results).filter(([t]) => t !== RULES_TARGET)
    .flatMap(([t, r]) => (r.items || []).filter(i => !i.allowed).map(i => ({ t, i })));
  const nm = Object.entries(results).filter(([, r]) => ['NEW', 'MISSING'].includes(r.state));
  L.push('', `## 차이 상세 (미허용만, 발동 규칙 셀은 위 절)`, '');
  if (!diffs.length && !nm.length) L.push('(없음)');
  const shown = diffs.slice(0, 200);
  for (const { t, i } of shown) {
    const tag = t.startsWith('n272/') ? ` ${N272_TAGS[t.slice(5)]}` : '';
    const loc = i.key !== undefined ? `[${i.key}] ${i.column ?? i.path}` : i.path === 'line' ? `line ${i.line_old ?? '-'}→${i.line_new ?? '-'}` : i.path;
    L.push(`- ${t} ${loc}: ${show(i.from)} → ${show(i.to)}${tag}`);
  }
  if (diffs.length > shown.length) L.push(`- … 외 ${diffs.length - shown.length}건 (result.json 참고)`);
  for (const [t, r] of nm) L.push(`- ${t}: ${r.state}${r.note ? ` (${r.note})` : ''}`);

  L.push('', '## 허용 적용', '');
  const applied = expected.entries.map((e, i) => ({ e, i, files: Object.entries(results).filter(([, r]) => (r.items || []).some(x => x.entry === i)).map(([t]) => t) })).filter(x => x.files.length);
  if (!applied.length) L.push('(없음)');
  for (const { e, i, files } of applied) L.push(`- entries[${i}] ${e.target}${e.target.includes('*') ? ` (매치 파일 ${files.length}개)` : ''} ${e.path ?? `[${e.key}] ${e.column}`} — ${e.commit}: ${e.reason}`);
  L.push('', '## 미사용 허용 항목 (실패)', '');
  if (!unused.length) L.push('(없음)');
  for (const { i, e } of unused) L.push(`- entries[${i}] ${e.target} ${e.path ?? `[${e.key}] ${e.column}`}: ${show(e.from)} → ${show(e.to)} — ${e.commit}`);
  L.push('', '## 주석', '',
    '- mcnemar_report.md의 "일치" 열은 `mcnemar_test.js:124-126`의 TARGETS가 v1 논문 값으로 고정되어 있어 항상 ❌다. 비교에는 영향이 없다(결정적).',
    '- 정규화: CR 제거, 파일 끝 개행 통일, md의 "> 생성:" 줄 제외, 사본 트리 절대경로 → <TREE>. CSV는 address 행 키로 셀 단위 비교.',
    '- 상태값: PASS / ALLOWED (n) / DIFF / NEW / MISSING / SKIP.');
  return L.join('\n') + '\n';
}

// ── confirm (B7-3) ────────────────────────────────────────────────────────────
function runConfirm(a) {
  if (!a.reason) throw new RegressError('--update-baseline 에는 --reason 필수');
  const id = a.confirm;
  if (!/^[0-9TZ_a-z-]+$/i.test(id)) throw new RegressError(`run id 형식 오류: ${id}`);
  const runDir = path.join(path.resolve(a['runs-root']), id);
  const pj = path.join(runDir, 'preview.json');
  if (!fs.existsSync(pj)) throw new RegressError(`미리보기 실행이 아님(preview.json 없음): ${id}`);
  const prev = JSON.parse(readText(pj));
  if (prev.reason !== a.reason) throw new RegressError('--reason 이 미리보기 때의 사유와 다름');
  const root = path.resolve(a['baseline-root']);
  const curPath = path.join(root, 'CURRENT');
  const curId = fs.existsSync(curPath) ? stripCR(readText(curPath)).trim() : null;
  if ((curId || null) !== prev.previous_baseline_id) throw new RegressError(`미리보기 이후 CURRENT가 바뀜 (미리보기 ${prev.previous_baseline_id ?? '없음'}, 현재 ${curId ?? '없음'})`);
  if (prev.run.source_mode === 'working-tree' && prev.run.dirty) throw new RegressError('working-tree + dirty 미리보기는 갱신 불가');
  if (prev.run.source_mode === 'tree') throw new RegressError('source_mode=tree 미리보기는 갱신 불가');
  const norm = path.join(runDir, 'out', 'norm');
  const files = listFiles(norm);
  const now = Object.fromEntries(files.map(f => [f, sha256(readText(path.join(norm, f)))]));
  if (!deepEqual(now, prev.norm_sha256)) throw new RegressError('미리보기 이후 정규화 출력이 바뀜 — 다시 미리보기 할 것');
  const dest = path.join(root, 'baselines', id);
  if (fs.existsSync(dest)) throw new RegressError(`이미 있는 기준선: ${id}`);

  fs.mkdirSync(dest, { recursive: true });
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
    fs.copyFileSync(path.join(norm, f), path.join(dest, f));
  }
  const manifest = {
    baseline_id: id,
    source_rev: prev.run.source_rev,
    source_rev_short: prev.run.source_rev_short,
    source_mode: prev.run.source_mode,
    dirty: prev.run.dirty,
    dirty_note: prev.run.source_mode === 'archive' ? 'archive 모드: 소스가 커밋이므로 dirty는 참고용 기록' : '',
    git_diff_stat: prev.run.git_diff_stat,
    node: prev.run.node,
    env: prev.run.env,
    contracts: prev.run.contracts,
    reasoners: prev.run.reasoners,
    smoke: prev.run.smoke,
    reason: a.reason,
    previous_baseline_id: prev.previous_baseline_id,
    preview_run_id: id,
    created_by: `regress.sh --update-baseline --reason <reason> --confirm ${id}`,
    normalization: 'CR 제거, 파일 끝 개행 하나, md "> 생성:" 줄 제외, 사본 트리 절대경로 → <TREE>',
  };
  fs.writeFileSync(path.join(dest, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  const sums = listFiles(dest).filter(f => f !== 'SHA256SUMS')
    .map(f => `${sha256(stripCR(readText(path.join(dest, f))))}  ${f}`);
  fs.writeFileSync(path.join(dest, 'SHA256SUMS'), sums.join('\n') + '\n');
  fs.writeFileSync(curPath, id + '\n');
  console.log(`기준선 작성: baselines/${id} (파일 ${files.length + 2}개), CURRENT → ${id} (이전: ${prev.previous_baseline_id ?? '없음'})`);
  console.log('허용 목록(expected_changes.json)은 자동으로 비우지 않는다. 항목이 남아 있으면 새 기준선과 baseline_id가 달라 다음 실행이 코드 2로 끝난다.');
  return 0;
}

// ── main ──────────────────────────────────────────────────────────────────────
try {
  const [mode, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);
  let code;
  if (mode === 'compare') {
    for (const k of ['run', 'tree', 'baseline-root', 'expected']) if (!a[k]) throw new RegressError(`--${k} 필수`);
    code = runCompare(a, process.env);
  } else if (mode === 'confirm') {
    for (const k of ['runs-root', 'confirm', 'baseline-root']) if (!a[k]) throw new RegressError(`--${k} 필수`);
    code = runConfirm(a);
  } else throw new RegressError('모드는 compare | confirm');
  process.exit(code);
} catch (e) {
  console.error(`[regress] 오류: ${e instanceof RegressError ? e.message : e.stack}`);
  process.exit(2);
}
