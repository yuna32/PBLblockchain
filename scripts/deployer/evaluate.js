// 검증: 라벨 컨트랙트(XBlock 폰지 200개, 정상 표본 300개)마다, 그 컨트랙트를 배포하기 직전 시점의 배포자 이력으로
// ① 지표 후보별 "정상 대비 사기에서 몇 배"를 조정용/평가용 절반에서 각각 계산하고(기준은 조정용 절반으로만 정함)
// ② 현재 기준(config.js)으로 단계를 매겨 평가용 절반에서 폰지 vs 정상을 비교한다.
//
// 출력  evaluation/deployer_risk/evaluation.json, evaluation_summary.md
// 실행(저장소 루트): node --env-file=.env scripts/deployer/evaluate.js   (이력은 cache/에 저장되어 다시 실행하면 바로 끝남)
// 처음 실행할 때는 배포자마다 이전 컨트랙트 최대 5개의 입금 내역도 받아서 10~15분 걸릴 수 있다.
//
// 누수 주의: 과거 사기 배포·첫 자금원(사기 배포자)은 평가 라벨과 같은 XBlock 라벨을 쓴다.
//   그래서 그 두 근거를 뺀 "라벨과 독립인 근거만"의 결과도 함께 보고한다.
import fs from "node:fs";
import path from "node:path";
import { requireKey } from "./etherscan.js";
import { fetchHistory } from "./collect.js";
import { DIR, CACHE, loadAll, ratio } from "./features.js";
import { scoreDeployer } from "./score.js";
import { RULES_VERSION } from "./config.js";

const pct = (a, b) => (b ? `${a}/${b} (${((100 * a) / b).toFixed(1)}%)` : "—");
const LABEL_BASED = e => e.label_based === true;

async function main() {
  requireKey();
  const cand = JSON.parse(fs.readFileSync(path.join(DIR, "candidates.json"), "utf8"));
  const deployers = [...new Set(cand.contracts.filter(c => c.deployer).map(c => c.deployer))];
  let i = 0, failed = 0;
  for (const d of deployers) {
    try { await fetchHistory(d, CACHE); } catch (err) { if (err.fatal) throw err; failed++; }
    process.stdout.write(`\r배포자 이력 ${++i}/${deployers.length}${failed ? ` (실패 ${failed})` : ""}`);
  }
  process.stdout.write("\n");

  const rows = await loadAll();
  for (const r of rows) {
    const s = scoreDeployer(r.facts);
    const ev = s.evidence ?? [];
    const indep = ev.filter(e => !LABEL_BASED(e));
    r.level = s.level;
    r.score = s.score ?? null;
    r.levelIndependent = r.level === "nodata" ? "nodata" : indep.some(e => e.strength === "strong") ? "strong" : indep.length ? "some" : "none";
  }
  fs.writeFileSync(path.join(DIR, "evaluation.json"), JSON.stringify({
    generatedAt: new Date().toISOString(), rules: RULES_VERSION,
    rows: rows.map(({ facts, ...r }) => ({ ...r, asOf: facts.asOf?.date ?? null, failures: facts.failures }))
  }, null, 2) + "\n");

  const KEYS = [
    ["past_scam_any", "과거 사기 배포 (같은 날 재배포 포함)"],
    ["past_scam_24h", "과거 사기 배포 (24시간 이상 앞선 것만)"],
    ["funder_malicious", "첫 자금원: 사기 배포자에게서 받음"],
    ["funder_mixer", "첫 자금원: 믹서"],
    ["pass_through", "받은 돈을 30분 안에 대부분 보냄 (2번 이상)"],
    ["net_back", "이전 컨트랙트에서 넣은 돈의 2배 이상 돌려받음 (라벨 없음)"],
    ["past_drained", "이전 컨트랙트에 남의 돈이 들어왔고 배포자가 절반 이상 가져감 (라벨 없음)"],
    ["past_drained_or_back", "위 둘 중 하나 (라벨 없음)"],
    ["new_wallet", "새 지갑 (7일 미만)"],
    ["low_interaction", "상호작용 적음 (상대 주소 3개 미만)"],
    ["new_and_low", "새 지갑 + 상호작용 적음"],
    ["history_short", "기록 부족 (거래 5건 미만)"]
  ];
  const tune = rows.filter(r => r.split === "tune"), test = rows.filter(r => r.split === "test");
  const lrRow = ([k, name]) => {
    const a = ratio(tune, k), b = ratio(test, k);
    return `| ${name} | ${a.scam}/${a.scamN} | ${a.normal}/${a.normalN} | **${a.lr.toFixed(1)}배** | ${b.scam}/${b.scamN} | ${b.normal}/${b.normalN} | ${b.lr.toFixed(1)}배 |`;
  };
  const dist = (g, field) => ["strong", "some", "none", "nodata"].map(l => {
    const s = g.filter(r => r.label === "scam"), n = g.filter(r => r.label === "normal");
    const name = { strong: "강한 근거", some: "근거 있음", none: "근거 없음", nodata: "데이터 없음" }[l];
    return `| ${name} | ${pct(s.filter(r => r[field] === l).length, s.length)} | ${pct(n.filter(r => r[field] === l).length, n.length)} |`;
  });
  const avg = (g, lab) => { const x = g.filter(r => r.label === lab && typeof r.score === "number"); return x.length ? (x.reduce((a, r) => a + r.score, 0) / x.length).toFixed(1) : "—"; };

  const md = [
    `# 배포자 위험 점수 검증 (폰지 vs 정상)`,
    ``,
    `- 생성: ${new Date().toISOString().slice(0, 10)}, 기준: ${RULES_VERSION}`,
    `- 단위: 컨트랙트. 각 컨트랙트를 배포하기 직전 시점의 배포자 이력으로 계산 (분석 대상 컨트랙트 자신과의 거래는 제외)`,
    `- 대상: XBlock 폰지 ${rows.filter(r => r.label === "scam").length}개, 정상 표본 ${rows.filter(r => r.label === "normal").length}개, 배포자 ${deployers.length}명 (조회 실패 ${failed}명)`,
    `- 분할: 배포자 주소 해시로 조정용(배포자 ${new Set(tune.map(r => r.deployer)).size}명)과 평가용(배포자 ${new Set(test.map(r => r.deployer)).size}명)으로 나눔. 같은 배포자는 한쪽에만 들어감`,
    `- 기준은 조정용 절반의 배수로만 정함: 5배 이상 강함, 1.5~5배 약함, 1.5배 미만 점수 제외`,
    ``,
    `## ① 지표 후보별 배수 (정상 대비 사기에서 몇 배 더 자주 나오나, 0건은 0.5 보정)`,
    ``,
    `| 지표 후보 | 조정용 폰지 | 조정용 정상 | 조정용 배수 | 평가용 폰지 | 평가용 정상 | 평가용 배수 |`,
    `|---|---|---|---|---|---|---|`,
    ...KEYS.map(lrRow),
    ``,
    `## ② 평가용 절반: 단계 분포 (현재 기준)`,
    ``,
    `| 단계 | 폰지 | 정상 |`,
    `|---|---|---|`,
    ...dist(test, "level"),
    `| 평균 점수 | ${avg(test, "scam")} | ${avg(test, "normal")} |`,
    ``,
    `## ③ 평가용 절반: 라벨과 독립인 근거만 (XBlock 라벨을 쓰는 근거 제외)`,
    ``,
    `| 단계 | 폰지 | 정상 |`,
    `|---|---|---|`,
    ...dist(test, "levelIndependent"),
    ``,
    `## ④ 평가용 절반: 배포자 기준 (같은 배포자의 여러 컨트랙트를 한 번만 셈)`,
    ``,
    `컨트랙트 기준은 폰지를 여러 번 배포한 배포자가 크게 반영되므로, 배포자마다 "강한 근거가 한 번이라도 나왔나"로 다시 셈.`,
    ``,
    `| 강한 근거 | 폰지 배포자 | 정상 배포자 |`,
    `|---|---|---|`,
    ...[["level", "현재 기준 전체"], ["levelIndependent", "라벨과 독립인 근거만"]].map(([field, name]) => {
      const by = lab => { const m = new Map(); for (const r of test.filter(r => r.label === lab)) m.set(r.deployer, (m.get(r.deployer) || false) || r[field] === "strong"); return [[...m.values()].filter(Boolean).length, m.size]; };
      const [a, n] = by("scam"), [b, m] = by("normal");
      return `| ${name} | ${pct(a, n)} | ${pct(b, m)} |`;
    }),
    ``,
    `## 참고: 전체 500개 단계 분포`,
    ``,
    `| 단계 | 폰지 | 정상 |`,
    `|---|---|---|`,
    ...dist(rows, "level"),
    ``,
    `## 한계`,
    ``,
    `- 과거 사기 배포·첫 자금원(사기 배포자)은 평가 라벨과 같은 XBlock 라벨을 쓰고, 그 라벨이 당시에 알려져 있었다고 가정함 (③이 이 영향을 뺀 결과)`,
    `- 정상 표본도 XBlock 목록 안에서 뽑았고, 2016~2017년 폰지 위주라 믹서 근거는 검증하지 못함`,
    `- 조정용 절반이 작아(폰지 약 100개) 배수에 오차가 큼`,
    ``
  ].join("\n");
  fs.writeFileSync(path.join(DIR, "evaluation_summary.md"), md);
  console.log("\n" + md);
}

main().catch(err => { console.error("[실패]", err.message); process.exit(1); });
