// node --test demo/test/*.test.js
// decision.js가 분석기(analysis/dynamic_analyzer.js)의 판정을 그대로 재현하는지 5개 fixture로 고정한다.
// 어긋나면 decision.js를 분석기에 억지로 맞추지 말고 어느 값이 왜 다른지 확인한다(분석기는 수정 금지).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildDecision, formatPercent, formatEth, roundHalfUp, withRo, THRESHOLDS, TYPE_LABELS, DEFAULT_DECISION_CONFIG } from "../lib/decision.js";
import { buildViewModel } from "../lib/viewmodel.js";
import { toTimeseries } from "../lib/timeseries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "fixtures");
const CSV = { normal: "normal_log.csv", ponzi: "ponzi_log.csv", rugpull: "rugpull_log.csv", laundering: "laundering_log.csv", pumpdump: "pumpdump_log.csv" };
const NAMES = Object.keys(CSV);

function load(name) {
  const dir = path.join(FIXTURES, name);
  return {
    report:   JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")),
    envelope: JSON.parse(fs.readFileSync(path.join(dir, "envelope.json"), "utf8")),
    rows:     toTimeseries(fs.readFileSync(path.join(dir, CSV[name]), "utf8"))
  };
}

// reasoning_steps 문자열에서 분석기가 적은 값을 읽는다 (dynamic_analyzer.js 243-348행의 형식)
function parseSteps(steps) {
  const find = re => {
    for (const s of steps) { const m = s.match(re); if (m) return m; }
    throw new Error(`reasoning_steps에 없음: ${re}`);
  };
  const slo = find(/^singleLargeOutflow: (true|false) \(([\d.]+) \/ peak ([\d.]+) = (\d+)%\)/);
  const dist = find(/^distributedInflow: (true|false) \((\d+) unique depositors\)/);
  const owa = find(/^ownerWithdrawAll: (true|false) /);
  const mid = find(/^participantMidExit: (true|false) \((\d+) mid-exit/);
  const wsr = find(/^withdrawSuccessRate: ([\d.]+)% \((\d+)\/(\d+) succeeded\)/);
  const npr = find(/^nonPrivilegedSuccessRate: ([\d.]+)% \(owner .* 제외 (\d+)건/);
  const baf = find(/^balanceAtFailure: ([\d.]+) ETH .*n=(\d+)\)/);
  const hint = find(/^→ ([a-z_]+)/);
  return {
    singleLargeOutflow: slo[1] === "true", maxSingle: slo[2], peak: slo[3], ratioPct: slo[4],
    distributedInflow: dist[1] === "true", depositors: Number(dist[2]),
    ownerWithdrawAll: owa[1] === "true",
    participantMidExit: mid[1] === "true", midExits: Number(mid[2]),
    withdrawSuccessPct: wsr[1], withdrawSucceeded: Number(wsr[2]), withdrawCount: Number(wsr[3]),
    nonPrivPct: npr[1], nonPrivCount: Number(npr[2]),
    balanceAtFailure: baf[1], failedCount: Number(baf[2]),
    hint: hint[1]
  };
}

for (const name of NAMES) {
  test(`${name}: 재계산한 유형·조건 값이 분석기 reasoning_steps와 같다`, () => {
    const { report, rows } = load(name);
    const d = buildDecision({ report, rows });
    const f = d.facts;
    const a = parseSteps(report.dynamic.reasoning_steps);
    assert.equal(d.hint, report.dynamic.fraud_type_hint, "유형");
    assert.equal(d.hint, a.hint, "reasoning_steps 마지막 판정");
    assert.equal(f.singleLargeOutflow, a.singleLargeOutflow, "singleLargeOutflow");
    assert.equal(f.maxSingleWithdrawEth.toFixed(3), a.maxSingle, "최대 단일 출금");
    assert.equal(f.peakBalanceEth.toFixed(3), a.peak, "최고 잔고");
    assert.equal((f.maxSingleWithdrawRatio * 100).toFixed(0), a.ratioPct, "최대 단일 출금 비율");
    assert.equal(f.distributedInflow, a.distributedInflow, "distributedInflow");
    assert.equal(f.uniqueDepositorCount, a.depositors, "입금자 수");
    assert.equal(f.ownerWithdrawAll, a.ownerWithdrawAll, "ownerWithdrawAll");
    assert.equal(f.participantMidExit, a.participantMidExit, "participantMidExit");
    assert.equal(f.midExitCount, a.midExits, "중도 출금 수");
    assert.equal((f.withdrawSuccessRate * 100).toFixed(1), a.withdrawSuccessPct, "출금 성공률");
    assert.equal(f.withdrawSuccessCount, a.withdrawSucceeded);
    assert.equal(f.withdrawCount, a.withdrawCount);
    assert.equal((f.nonOwnerSuccessRate * 100).toFixed(1), a.nonPrivPct, "비오너 출금 성공률");
    assert.equal(f.nonOwnerWithdrawCount, a.nonPrivCount, "비오너 출금 수");
    assert.equal(f.balanceAtFailureEth.toFixed(3), a.balanceAtFailure, "실패 시점 잔고");
    assert.equal(f.withdrawFailCount, a.failedCount, "실패 출금 수");
    // 리포트의 숫자 필드와도 같다
    assert.equal(+f.withdrawSuccessRate.toFixed(3), report.dynamic.withdraw_success_rate);
    assert.equal(+f.nonOwnerSuccessRate.toFixed(3), report.dynamic.non_privileged_success_rate);
    assert.equal(+f.balanceAtFailureEth.toFixed(4), report.dynamic.balance_at_failure_eth);
    assert.equal(f.zeroWithdrawBlock, report.dynamic.withdraw_block_warning.detected, "출금 차단 경고");
    assert.equal(+f.peakBalanceEth.toFixed(4), report.dynamic.metrics.peak_balance_eth);
    assert.equal(+f.maxSingleWithdrawEth.toFixed(4), report.dynamic.metrics.max_single_withdraw_eth);
  });
}

test("판정 사슬: 우선순위대로 매칭된 단계에서 멈추고, 결론·결론 띠가 맞다", () => {
  const expected = {
    normal:     { step: 6, conclusion: "no_evidence", summary: "1~5번 아니요, 6번 예 → 정상 스테이킹 → 근거 없음" },
    ponzi:      { step: 4, conclusion: "risk", summary: "1~3번 아니요, 4번 예 → 폰지 의심 → 위험" },
    rugpull:    { step: 3, conclusion: "risk", summary: "1·2번 아니요, 3번 예 → 러그풀 의심 → 위험" },
    laundering: { step: 2, conclusion: "risk", summary: "1번 아니요, 2번 예 → 자금세탁 의심 → 위험" },
    pumpdump:   { step: 1, conclusion: "risk", summary: "1번 예 → 펌프앤덤프 의심 → 위험" }
  };
  for (const name of NAMES) {
    const d = buildViewModel(load(name)).decision;
    assert.equal(d.matchedStep, expected[name].step, name);
    assert.equal(d.chain.length, expected[name].step, `${name}: 매칭된 단계까지만`);
    assert.equal(d.chain.at(-1).type, d.hint, name);
    assert.ok(d.chain.slice(0, -1).every(s => s.answer === "아니요"), name);
    assert.equal(d.conclusion, expected[name].conclusion, name);
    assert.equal(d.chainSummary, expected[name].summary, name);
    assert.ok(!d.whyNot.some(w => w.type === d.hint || w.type === "normal_staking"), `${name}: 다른 유형만`);
    assert.equal(d.whyNot.length, d.hint === "normal_staking" ? 5 : 4, name);
    assert.ok(d.whyNot.every(w => w.reason.length > 0), name);
  }
});

test("원금 회수 집계 (정의 A): 승인한 표와 같다", () => {
  const p = name => buildDecision(load(name)).principal;
  const n = p("normal");
  assert.deepEqual([n.participants.count, n.participants.fullCount, n.participants.partialCount, n.participants.unrecoveredCount], [10, 10, 0, 0]);
  const z = p("ponzi");
  assert.deepEqual([z.participants.count, z.participants.fullCount, z.participants.unrecoveredCount], [10, 3, 7]);
  assert.equal(formatEth(z.ownerReceivedEth), "6.7");
  const r = p("rugpull");
  assert.deepEqual([r.participants.count, r.participants.unrecoveredCount, formatEth(r.ownerReceivedEth)], [10, 10, "19"]);
  const l = p("laundering");
  assert.equal(l.participantWalletCount, 19);
  assert.equal(l.collector.address, "0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
  assert.deepEqual([l.participants.count, l.participants.unrecoveredCount, formatEth(l.participants.receivedEth)], [18, 18, "0"]);
  const u = p("pumpdump");
  assert.deepEqual([u.participants.count, u.insiders.count, formatEth(u.insiders.receivedEth)], [8, 3, "19.5"]);
  assert.deepEqual([u.late.count, u.late.unrecoveredCount, u.late.failedWithdrawCount, formatEth(u.late.receivedEth)], [5, 5, 5, "0"]);
});

test("formatPercent·formatEth: half-up, 정수면 정수·아니면 소수 첫째 자리", () => {
  assert.equal(formatPercent(0.375), "37.5%");
  assert.equal(formatPercent(1), "100%");
  assert.equal(formatPercent(1.049 / 15), "7%");
  assert.equal(formatPercent(6.7 / 10), "67%");
  assert.equal(formatPercent(0.05), "5%");
  assert.equal(formatPercent(0.7), "70%");
  assert.equal(formatPercent(1.0445), "104.5%");  // 이진수로는 104.4499…지만 half-up으로 104.5
  assert.equal(formatPercent(0.33333), "33.3%");
  assert.equal(formatPercent(0.00049), "0%");
  assert.equal(formatPercent(0), "0%");
  assert.equal(roundHalfUp(2.5, 0), 3);
  assert.equal(roundHalfUp(1.005, 2), 1.01);
  assert.equal(roundHalfUp(0.125, 2), 0.13);
  assert.equal(formatEth(19), "19");
  assert.equal(formatEth(10.444999999999999), "10.445");
  assert.equal(formatEth(3.78 / 19), "0.199");
});

test("문구의 숫자는 facts에서 나온다 (금액을 바꾸면 문구도 바뀐다)", () => {
  const { report, rows } = load("rugpull");
  const doubled = rows.map(r => ({ ...r, amount_eth: r.amount_eth * 2, contract_balance_eth: r.contract_balance_eth * 2 }));
  const base = buildDecision({ report, rows }).copy;
  const big = buildDecision({ report, rows: doubled }).copy;
  assert.ok(base.chartNotes[0].includes("19 ETH") && big.chartNotes[0].includes("38 ETH"));
  assert.ok(base.callouts.at(-1).detail.includes("19 ETH") && big.callouts.at(-1).detail.includes("38 ETH"));
  // 참여자 수도 행에서 센다
  const fewer = rows.filter(r => r.from !== "0xbcd4042de499d14e55001ccbb24a551f3b954096");
  const c = buildDecision({ report, rows: fewer }).copy;
  assert.ok(c.chartNotes[2].startsWith("참여자 9명"));
});

test("운영자 주소는 설정 한 곳에서 정하고 바꿀 수 있다", () => {
  const { report, rows } = load("rugpull");
  assert.equal(buildDecision({ report, rows }).ownerAddress, DEFAULT_DECISION_CONFIG.ownerAddress);
  const other = buildDecision({ report, rows, config: { ownerAddress: "0x000000000000000000000000000000000000dEaD" } });
  assert.equal(other.ownerAddress, "0x000000000000000000000000000000000000dead");
  assert.equal(other.facts.nonOwnerWithdrawCount, 1, "기본 운영자의 인출이 운영자 외 출금으로 바뀜");
  assert.equal(THRESHOLDS.singleLargeOutflowRatio, 0.7);
});

test("플래시론은 화면 문구·사슬에 나오지 않고, 결론은 판단 불가", () => {
  for (const name of NAMES) assert.ok(!JSON.stringify(buildDecision(load(name))).includes("플래시"), name);
  const { report, rows } = load("normal");
  const flash = buildDecision({ report: { dynamic: { triggered_rules: [{ id: "OSCILLATING_BALANCE" }] } }, rows });
  assert.equal(flash.hint, "flash_loan");
  assert.equal(flash.conclusion, "undetermined");
  assert.equal(flash.matchedStep, null);
  assert.ok(!JSON.stringify(flash).includes("플래시") && !JSON.stringify(flash.copy).includes("flash"));
  assert.equal(buildDecision({ report: {}, rows: [] }).conclusion, "undetermined");
});

test("조사 (으)로: 받침 없음·ㄹ → 로, 그 밖의 받침 → 으로 (모든 유형 이름)", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(TYPE_LABELS).map(([k, v]) => [k, withRo(v)])), {
    pump_and_dump: "펌프앤덤프로",
    money_laundering: "자금세탁으로",
    rug_pull: "러그풀로",
    ponzi_scheme: "폰지로",
    unclassified_warning: "출금 차단 경고로",
    normal_staking: "정상 스테이킹으로"
  });
  assert.equal(withRo("ABC"), "ABC(으)로");
  const why = buildDecision(load("pumpdump")).whyNot.find(w => w.type === "ponzi_scheme");
  assert.equal(why.reason, "폰지 조건도 일부 맞지만, 판정 순서상 앞선 펌프앤덤프 조건이 먼저 충족돼 펌프앤덤프로 판정했습니다");
  assert.ok(!JSON.stringify(NAMES.map(n => buildDecision(load(n)))).includes("(으)로"));
});

test("수정 문구: 정상·폰지·펌프앤덤프 (숫자는 facts에서)", () => {
  const n = buildDecision(load("normal"));
  assert.equal(n.copy.reasons[2], "운영자는 돈을 가져가지 않았습니다(운영자 수령 0 ETH)");
  assert.equal(n.copy.chartNotes[0], "참여자 10명이 맡긴 10 ETH보다 많은 10.445 ETH를 돌려받았습니다");
  assert.equal(n.chain[1].conditions.find(c => c.id === "distributed_inflow").valueText, "11개 (운영자 1개 포함)");
  assert.equal(n.flow.outs.every(o => o.ratioText === null), true, "정상은 비율 대신 ETH");
  const z = buildDecision(load("ponzi"));
  assert.equal(z.copy.reasons[2], "참여자 10명 중 3명만 원금 이상을 돌려받았습니다");
  assert.ok(!z.copy.reasons.some(r => r.includes("67%")), "67% 설명은 다른 유형이 아닌 이유에만");
  assert.ok(z.whyNot.some(w => w.reason.includes("67%")));
  assert.equal(z.chain[3].conditions[1].label, `대량 유출 신호 (누적 출금이 입금의 ${formatPercent(THRESHOLDS.flowSpikeRatio)} 이상)`);
  assert.equal(buildDecision(load("pumpdump")).copy.summary.analyzed, "입금 8건 · 출금 시도 8건 (성공 3건)");
  assert.equal(buildDecision(load("rugpull")).copy.summary.analyzed, "입금 10건 · 출금 1건");
});

test("폰지 그림 2: 운영자 입금이 없으면 원금 초과분의 출처, 있으면 '받은 돈이 입금보다 많았습니다'", () => {
  const { report, rows } = load("ponzi");
  assert.equal(buildDecision({ report, rows }).copy.chartNotes[1], "받은 3.3 ETH 중 원금을 넘는 0.3 ETH는 다른 참여자의 입금에서 나왔습니다");
  // 운영자가 컨트랙트에 돈을 넣은 데이터 (맨 앞에 운영자 입금 한 줄을 더한다)
  const funded = [{ ...rows[0], action: "fund_reward_pool", from: DEFAULT_DECISION_CONFIG.ownerAddress, amount_eth: 0.5 }, ...rows];
  const d = buildDecision({ report, rows: funded });
  assert.equal(d.hint, "ponzi_scheme");
  assert.equal(d.copy.chartNotes[1], "받은 돈이 입금보다 많았습니다");
});

test("출금 차단 경고(unclassified_warning): 손으로 만든 소형 거래 로그 (테스트 전용)", () => {
  const C = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
  const w = i => `0x${String(i).repeat(40)}`;
  const rows = [];
  for (let i = 1; i <= 5; i++) rows.push({ block: i, action: "deposit", from: w(i), to: C, amount_eth: 1, contract_balance_eth: i });
  for (let i = 1; i <= 3; i++) rows.push({ block: 10 + i, action: "withdraw", from: C, to: w(i), amount_eth: 0, contract_balance_eth: 5 });
  const d = buildDecision({ report: { dynamic: { triggered_rules: [] } }, rows });
  assert.equal(d.hint, "unclassified_warning");
  assert.equal(d.conclusion, "caution");
  assert.equal(d.matchedStep, 5);
  assert.equal(d.chainSummary, "1~4번 아니요, 5번 예 → 출금 차단 경고 → 주의");
  assert.equal(d.copy.headline, "사기 유형은 정해지지 않았지만 참여자 출금이 막혀 있습니다");
  assert.deepEqual(d.copy.reasons, [
    "운영자 외 출금 3건의 성공률이 0%로 기준(5% 이하)에 해당합니다",
    "출금이 실패한 시점에도 잔고 5 ETH가 남아 있었습니다",
    "알려진 사기 유형의 조건에는 맞지 않았습니다"
  ]);
  assert.equal(d.copy.chartNotes[2], "참여자 5명이 원금을 돌려받지 못했습니다");
  assert.equal(d.copy.summary.analyzed, "입금 5건 · 출금 시도 3건 (성공 0건)");
  assert.equal(d.whyNot.length, 4);
  assert.ok(d.whyNot.every(x => x.checked && x.reason.length > 0));
});

test("자금세탁 문구는 모은 지갑 제외를 밝힌다 (입금 지갑 19개 · 18개 지갑)", () => {
  const c = buildDecision(load("laundering")).copy;
  assert.ok(c.reasons[0].startsWith("19개 지갑"));
  assert.equal(c.chartNotes[2], "모은 지갑 1개를 뺀 18개 지갑은 원금을 돌려받지 못했습니다");
  assert.ok(!JSON.stringify(c).includes("운영자"), "자금세탁은 운영자라고 부르지 않는다");
});
