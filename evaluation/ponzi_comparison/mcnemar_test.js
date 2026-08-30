/**
 * mcnemar_test.js
 *
 * 논문("온톨로지_방법론_letter.docx" 4.2절)에 인용된 McNemar 검정 수치를
 * 저장소에 존재하는 산출물(results/disagreement_cases.csv, N=272 비교실험의
 * 부산물)만으로 재현할 수 있는지 검증한다. 이 스크립트가 실행되기 전까지는
 * 저장소 어디에도 McNemar 계산 코드가 없었다(2026-08-09 전체 저장소 grep +
 * git log(커밋 1개) 확인 완료).
 *
 * 목표 수치 (논문 4.2절 기재값):
 *   Exact      : b=52, c=52, χ²=0.010, p=0.922
 *   Superclass : b=67, c=52, χ²=1.647, p=0.199
 *
 * McNemar 검정은 "판정이 다른(discordant) 쌍"에서 두 분류기 중 어느 쪽이
 * 정답(true_label)을 맞혔는지를 센다:
 *   b = baseline만 정답을 맞힌 건수 (baseline_pred == true_label, ontology_pred != true_label)
 *   c = 온톨로지만 정답을 맞힌 건수 (ontology_pred == true_label, baseline_pred != true_label)
 * disagreement_cases.csv 는 "baseline_pred != ontology_exact_pred OR
 * baseline_pred != ontology_super_pred" 인 행만 모아둔 파일(evaluate_comparison.js
 * 의 union 필터, 132행)이므로, Exact/Superclass 각각에 대해 실제로 두 예측이
 * 갈리는 행만 다시 골라내야 한다.
 *
 * read-only 분석 스크립트 — evaluate_comparison.js 등 원본 파이프라인 파일은
 * 전혀 수정하지 않는다.
 *
 * 실행: node mcnemar_test.js
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const CSV_PATH = path.join(__dirname, 'results', 'disagreement_cases.csv');

// ── CSV 파서 ──────────────────────────────────────────────────────────────────
function parseCSV(filepath) {
  let text = fs.readFileSync(filepath, 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.trim().split(/\r?\n/);
  const hdr = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const row  = {};
    hdr.forEach((h, i) => { row[h] = vals[i]?.trim() ?? ''; });
    return row;
  });
}

// ── erf/erfc 근사 (Abramowitz & Stegun 7.1.26, 오차 ≤ 1.5e-7) ──────────────────
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 =  0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p  = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function erfc(x) { return 1 - erf(x); }

// 자유도 1 카이제곱 분포의 상단꼬리 p-value: p = erfc( sqrt(chi2 / 2) )
function chiSquarePValueDf1(chi2) {
  if (chi2 < 0) return 1;
  return erfc(Math.sqrt(chi2 / 2));
}

// ── McNemar 통계량 ────────────────────────────────────────────────────────────
// 연속성 보정 있음: χ² = (|b-c| - 1)² / (b+c)
// 연속성 보정 없음: χ² = (b-c)² / (b+c)
function mcnemar(b, c) {
  const uncorrected = (b + c) > 0 ? Math.pow(b - c, 2) / (b + c) : 0;
  // 주의: (|b-c|-1)을 0으로 클램핑하면 안 된다. b=c인 경우 |b-c|-1 = -1이고,
  // 제곱하면 부호가 사라져 그대로 1이 되는 것이 표준 연속성 보정 공식의 의도된 동작이다.
  // (클램핑을 넣었다가 b=c=52 케이스에서 χ²가 0으로 잘못 나오는 버그를 냈던 적이 있음 — 재도입 금지)
  const corrected = (b + c) > 0 ? Math.pow(Math.abs(b - c) - 1, 2) / (b + c) : 0;
  return {
    uncorrected: { chi2: uncorrected, p: chiSquarePValueDf1(uncorrected) },
    corrected:   { chi2: corrected,   p: chiSquarePValueDf1(corrected) },
  };
}

// ── b/c 카운트 ────────────────────────────────────────────────────────────────
// predCol 이 baseline_pred 와 다른 행만 대상으로, true_label 과 일치하는 쪽을 승자로 카운트.
function countBC(rows, predCol) {
  let b = 0, c = 0; // b=baseline만 정답, c=온톨로지만 정답
  const discordant = [];
  for (const r of rows) {
    const truth    = parseInt(r.true_label);
    const basePred = parseInt(r.baseline_pred);
    const ontPred  = parseInt(r[predCol]);
    if (basePred === ontPred) continue; // 이 조건 기준으로는 판정이 갈리지 않음 → 대상 아님
    discordant.push(r);
    const baseCorrect = basePred === truth;
    const ontCorrect  = ontPred  === truth;
    if (baseCorrect && !ontCorrect) b++;
    else if (ontCorrect && !baseCorrect) c++;
    // 이론상 이진 분류 + 판정이 다른 경우 baseCorrect/ontCorrect 중 정확히 하나만 참이어야 함.
    // 둘 다 참이거나 둘 다 거짓이면 데이터 이상 — 아래에서 별도 카운트해 명시적으로 드러낸다.
  }
  const anomalies = discordant.filter(r => {
    const truth    = parseInt(r.true_label);
    const basePred = parseInt(r.baseline_pred);
    const ontPred  = parseInt(r[predCol]);
    const baseCorrect = basePred === truth;
    const ontCorrect  = ontPred  === truth;
    return baseCorrect === ontCorrect; // 둘 다 맞거나 둘 다 틀림 (있으면 안 되는 케이스)
  });
  return { b, c, discordantCount: discordant.length, anomalies };
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`[오류] ${CSV_PATH} 없음 — evaluate_comparison.js 먼저 실행 필요`);
    process.exit(1);
  }
  const rows = parseCSV(CSV_PATH);
  console.log(`disagreement_cases.csv 로드: ${rows.length}행`);
  console.log(`컬럼: ${Object.keys(rows[0]).join(', ')}`);

  const TARGETS = {
    Exact:      { b: 52, c: 52, chi2: 0.010, p: 0.922 },
    Superclass: { b: 67, c: 52, chi2: 1.647, p: 0.199 },
  };

  const results = {};
  for (const [label, predCol] of [['Exact', 'ontology_exact_pred'], ['Superclass', 'ontology_super_pred']]) {
    const { b, c, discordantCount, anomalies } = countBC(rows, predCol);
    const m = mcnemar(b, c);
    results[label] = { b, c, discordantCount, anomalies, m };

    console.log(`\n=== ${label} ===`);
    console.log(`  판정이 갈리는 행 수(discordant, b+c) : ${discordantCount}`);
    console.log(`  b (baseline만 정답) : ${b}`);
    console.log(`  c (온톨로지만 정답) : ${c}`);
    if (anomalies.length > 0) {
      console.log(`  [경고] 둘 다 맞거나 둘 다 틀린 이상 케이스 ${anomalies.length}건 발견 (이진 분류에서는 발생 불가능해야 함)`);
    }
    console.log(`  연속성 보정 없음 : χ² = ${m.uncorrected.chi2.toFixed(4)}, p = ${m.uncorrected.p.toFixed(4)}`);
    console.log(`  연속성 보정 있음 : χ² = ${m.corrected.chi2.toFixed(4)}, p = ${m.corrected.p.toFixed(4)}`);

    const t = TARGETS[label];
    const bcMatch    = b === t.b && c === t.c;
    const chi2Match  = Math.abs(m.corrected.chi2 - t.chi2) < 0.005;
    const pMatch     = Math.abs(m.corrected.p - t.p) < 0.005;
    console.log(`  논문 목표값: b=${t.b}, c=${t.c}, χ²=${t.chi2}, p=${t.p}`);
    console.log(`  일치 여부 (연속성 보정 기준) : b/c ${bcMatch ? '✅' : '❌'}  χ² ${chi2Match ? '✅' : '❌'}  p ${pMatch ? '✅' : '❌'}`);
    results[label].reproduced = bcMatch && chi2Match && pMatch;
  }

  const allReproduced = Object.values(results).every(r => r.reproduced);
  console.log(`\n=== 종합 결론 ===`);
  console.log(allReproduced
    ? '재현 성공 — 연속성 보정 있는 McNemar 검정(χ² = (|b-c|-1)²/(b+c))이 논문 4.2절 수치와 일치.'
    : '재현 실패 — 아래 리포트에서 원인 분석 필요.');

  // ── 리포트 저장 ────────────────────────────────────────────────────────────
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const lines = [
    '# McNemar 검정 재현 결과',
    '',
    `> 생성: ${now}`,
    '',
    '## 입력 데이터',
    '',
    `- \`results/disagreement_cases.csv\` (${rows.length}행) — \`evaluate_comparison.js\`가 ` +
      'baseline과 온톨로지(Exact 또는 Superclass) 판정이 갈리는 주소를 union 조건으로 모아 ' +
      '생성하는 파일. Phase 2 조사에서 이 132행이 논문의 "132건(disagreement cases)" 서술과 ' +
      '일치함을 확인했다.',
    '',
    '## 결과',
    '',
    '| 기준 | b(baseline만 정답) | c(온톨로지만 정답) | χ²(보정) | p(보정) | 논문 값 | 일치 |',
    '|---|---:|---:|---:|---:|---|:---:|',
    ...Object.entries(results).map(([label, r]) => {
      const t = TARGETS[label];
      return `| ${label} | ${r.b} | ${r.c} | ${r.m.corrected.chi2.toFixed(4)} | ${r.m.corrected.p.toFixed(4)} | b=${t.b}, c=${t.c}, χ²=${t.chi2}, p=${t.p} | ${r.reproduced ? '✅' : '❌'} |`;
    }),
    '',
    '### 연속성 보정 미적용 버전 (참고)',
    '',
    '| 기준 | χ²(미보정) | p(미보정) |',
    '|---|---:|---:|',
    ...Object.entries(results).map(([label, r]) =>
      `| ${label} | ${r.m.uncorrected.chi2.toFixed(4)} | ${r.m.uncorrected.p.toFixed(4)} |`
    ),
    '',
    '## 결론',
    '',
    allReproduced
      ? '**재현 성공.** 연속성 보정을 적용한 McNemar 검정(χ² = (|b-c|-1)²/(b+c), df=1)을 ' +
        '`disagreement_cases.csv`에 그대로 적용하면 논문 4.2절의 b, c, χ², p 값이 정확히 재현된다. ' +
        '논문이 사용한 검정 방식(연속성 보정 있음)과 b/c 정의(판정이 갈리는 행에서 true_label과 ' +
        '일치하는 쪽을 승자로 카운트)가 이것으로 확인됐다.'
      : '**재현 실패.** 아래 [원인 조사]를 참고해 사용자 확인이 필요하다.',
    '',
  ];

  fs.writeFileSync(path.join(__dirname, 'results', 'mcnemar_report.md'), lines.join('\n'), 'utf8');
  console.log(`\n리포트 → ${path.join(__dirname, 'results', 'mcnemar_report.md')}`);
}

main();
