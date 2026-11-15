// 지갑 레이어 v1 시험. node --test demo/test/*.test.js
// 시뮬레이션 Phase 3와 같은 주소·금액을 직접 넣어 시험한다 (docs/WALLET_LAYER.md 7절).
import test from "node:test";
import assert from "node:assert/strict";
import { FraudOntology } from "../../analysis/fraud_ontology.js";
import { computeWalletFacts } from "../../analysis/chain_graph_v2.js";
import { runWalletLayer, WALLET_PARAMS } from "../../analysis/wallet_reasoner_v1.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const loadReport = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, name, "report.json"), "utf8"));

const CONTRACT  = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const COLLECTOR = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const DEPLOYER  = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const A = "0x1a00000000000000000000000000000000000001";
const B = "0x1b00000000000000000000000000000000000002";
const C = "0x1c00000000000000000000000000000000000003";
const X = "0x1e00000000000000000000000000000000000004";
const SERVICES = new Map([[X, { address: X, type: "exchange" }]]);

const tx = (block, from, to, amount_eth) => ({ block, timestamp: 0, from, to, amount_eth });
const INFLOW = [tx(43, CONTRACT, COLLECTOR, 3.78)];
const POSITIVE = [tx(45, COLLECTOR, A, 2.0), tx(47, COLLECTOR, C, 1.0), tx(49, A, B, 1.98), tx(51, B, X, 1.96)];
const NEGATIVE = [tx(45, COLLECTOR, X, 3.0)];

const run = (transfers, extra = {}) => runWalletLayer({
  contractClass: "MoneyLaundering", contract: CONTRACT, collector: COLLECTOR,
  transfers, inflows: INFLOW, services: SERVICES,
  deploys: [{ wallet: DEPLOYER, contract: CONTRACT }], ...extra
});
const classesOf = (result, address) => result.verdicts.find(v => v.address === address)?.classes ?? null;

test("경유: A·B는 LayeringWallet, HopLaundering 부착", () => {
  const r = run(POSITIVE);
  assert.equal(r.status, "evaluated");
  assert.deepEqual(classesOf(r, A), ["LayeringWallet"]);
  assert.deepEqual(classesOf(r, B), ["LayeringWallet"]);
  assert.equal(r.hopLaundering.attached, true);
});

test("보관: C는 전달 비율이 0이라 LayeringWallet 아님", () => {
  const r = run(POSITIVE);
  const c = r.facts.wallets.find(w => w.address === C);
  assert.equal(c.forwardRatio, 0);
  assert.deepEqual(classesOf(r, C), []);
});

test("거래소 중단: 서비스는 판정 대상이 아니고 그 뒤로 추적하지 않음", () => {
  const pos = run(POSITIVE);
  assert.equal(classesOf(pos, X), null, "양성: X는 3홉째라 판정 목록에 없음");
  assert.ok(pos.facts.stops.some(s => s.address === X && s.reason === "known_service"));

  const neg = run(NEGATIVE);
  assert.deepEqual(classesOf(neg, X), [], "음성: X는 1홉이지만 서비스라 LayeringWallet 아님");
  assert.equal(neg.verdicts.filter(v => v.classes.includes("LayeringWallet")).length, 0);
  assert.equal(neg.hopLaundering.attached, false);
});

test("시드 자신: 수집 지갑은 LayeringWallet 아님", () => {
  const r = run(POSITIVE);
  assert.deepEqual(classesOf(r, COLLECTOR), []);
  const w = r.facts.wallets.find(x => x.address === COLLECTOR);
  assert.equal(w.isSeed, true);
  assert.equal(w.hopsFromSource, 0);
});

test("배포자: 배포 관계가 있는 지갑은 DeployerWallet", () => {
  const r = run(POSITIVE);
  assert.deepEqual(classesOf(r, DEPLOYER), ["DeployerWallet"]);
});

test("값 없음: 받은 금액이 없으면 비율은 null이고 판정하지 않음", () => {
  const facts = computeWalletFacts({ transfers: [tx(45, A, B, 1.0)], seeds: [COLLECTOR], services: SERVICES, maxHops: 2 });
  const seedOnly = facts.wallets.find(w => w.address === COLLECTOR);
  assert.equal(seedOnly.forwardRatio, null);
  assert.equal(facts.wallets.length, 1, "시드와 연결되지 않은 A→B는 추적 범위 밖");
});

test("상태: 자금세탁이 아니면 not_applicable, 하류 데이터가 없으면 missing", () => {
  assert.equal(runWalletLayer({ contractClass: "PonziScheme" }).status, "not_applicable");
  assert.equal(runWalletLayer({ contractClass: "MoneyLaundering", collector: COLLECTOR, transfers: null }).status, "missing");
  assert.equal(runWalletLayer({ contractClass: "MoneyLaundering", collector: null, transfers: POSITIVE }).status, "missing");
});

test("온톨로지 기반: 규칙에서 전달 비율 조건을 빼면 코드 수정 없이 C도 LayeringWallet", () => {
  const changed = structuredClone(FraudOntology.walletLayer);
  changed.rules.LayeringWallet.all = changed.rules.LayeringWallet.all.filter(c => c.id !== "FORWARD_RATIO_HIGH");
  const r = run(POSITIVE, { walletLayer: changed });
  assert.deepEqual(classesOf(r, C), ["LayeringWallet"]);
  assert.deepEqual(classesOf(run(POSITIVE), C), [], "원래 규칙에서는 아님");
});

test("기준값: 시연 결과는 임시 기준값 선택에 좌우되지 않음", () => {
  for (const minForwardRatio of [0.5, 0.8, 0.95]) {
    const r = run(POSITIVE, { params: { ...WALLET_PARAMS, minForwardRatio } });
    assert.deepEqual(r.verdicts.filter(v => v.classes.includes("LayeringWallet")).map(v => v.address).sort(), [A, B].sort());
  }
});

test("리포트 연결: laundering fixture에 지갑 결과, 다른 4개는 해당 없음", () => {
  const r = loadReport("laundering").wallet_layer;
  assert.equal(r.status, "evaluated");
  assert.deepEqual(r.verdicts.filter(v => v.classes.includes("LayeringWallet")).map(v => v.address).sort(), [A, B].sort());
  assert.equal(r.hopLaundering.attached, true);
  for (const name of ["normal", "ponzi", "rugpull", "pumpdump"]) {
    assert.equal(loadReport(name).wallet_layer.status, "not_applicable", name);
  }
});
