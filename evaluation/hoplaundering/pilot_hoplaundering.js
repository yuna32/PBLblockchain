/**
 * pilot_hoplaundering.js
 *
 * Phase 3 후속 Step 3-2 — EthereumHeist 시드 주소로 실제 Etherscan 데이터를
 * 수집(fetch_and_convert_v2.js)하고 체인 그래프(chain_graph.js)를 돌려
 * HopLaundering 조건이 실제 장물 세탁 경로에서 관측되는지 확인하는 소규모 파일럿.
 *
 * ⚠ 스코프 주의: 이 파일럿은 "온톨로지 HopLaundering 서브클래스 로직이 실제 자금
 * 흐름에서 작동하는가"를 보는 것이다. 시드 주소들은 EthereumHeist 라벨셋의
 * "탈취 사건 공격자 지갑"이며, 온톨로지 5-1절의 MoneyLaundering 유형(다수 입금자
 * → 단일 스마트컨트랙트 주소 패턴)을 분류/검증하는 것이 아니다. 결과를 "이 사건이
 * MoneyLaundering으로 분류됨"처럼 해석하면 안 된다.
 *
 * API 호출 예산(사용자 승인됨, 2026-08-09):
 *   시드 8개 × (시드 자신 + 1홉 경유 후보 최대 3개) = 주소 최대 32개 × 2콜(txlist+
 *   txlistinternal) = 약 64콜. 무료 티어 일일 쿼터(100,000) 대비 미미.
 *
 * 원본 파이프라인 파일은 전혀 수정하지 않는다 — fetch_and_convert_v2.js,
 * chain_graph.js 모두 evaluation/hoplaundering/ 내 신규 파일.
 *
 * 실행: node pilot_hoplaundering.js
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processOne, LOGS_DIR } from './fetch_and_convert_v2.js';
import { traceChain } from './chain_graph.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── 파일럿 시드 주소 (Heist label-etherscan.csv 에서 사건 유형별로 고르게 선정) ──
// 러그풀/CEX 해킹/DeFi 익스플로잇/플래시론 공격/허니팟/폰지 라벨을 각각 포함해
// 단일 사건 유형 편중을 피했다.
const SEEDS = [
  { address: '0x872254d530ae8983628cb1eaafc51f78d78c86d9', caseName: 'AnubisDAO Liquidity Rug 1' },
  { address: '0x1fcdb04d0c5364fbd92c73ca8af9baa72c269107', caseName: 'BadgerDAO Exploiter' },
  { address: '0x39fb0dcd13945b835d47410ae0de7181d3edf270', caseName: 'Bitmart Hacker' },
  { address: '0xc8a65fadf0e0ddaf421f28feab69bf6e2e589963', caseName: 'PolyNetwork Exploiter 1' },
  { address: '0xeb31973e0febf3e3d7058234a5ebbae1ab4b8c23', caseName: 'Kucoin Hacker' },
  { address: '0xf4a2eff88a408ff4c4550148151c33c93442619e', caseName: 'Plus Token Ponzi 1' },
  { address: '0x24354d31bc9d90f62fe5f2454709c32049cf866b', caseName: 'Cream Finance Flash Loan Exploiter' },
  { address: '0xf80f6fa4ccb6550c9dc58d58d51fb0928f9b323c', caseName: 'BELLE Honeypot Rug Pull' },
];

const MAX_HOP_CANDIDATES_PER_SEED = 3; // API 예산 통제 — 홉 후보 전부가 아니라 상위 N개만 실 수집

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchAddress(address, label) {
  process.stdout.write(`  [${label}] ${address} 수집 중... `);
  const result = await processOne(address);
  console.log(JSON.stringify(result));
  return result;
}

async function main() {
  const report = { seeds: [], summary: {} };
  let apiCallsEstimate = 0;

  for (const seed of SEEDS) {
    console.log(`\n=== 시드: ${seed.caseName} (${seed.address}) ===`);
    const seedResult = await fetchAddress(seed.address, 'seed');
    apiCallsEstimate += 2; // txlist + txlistinternal

    if (seedResult.status !== 'ok') {
      report.seeds.push({ ...seed, status: seedResult.status, reason: seedResult.reason });
      continue;
    }

    // 1차 체인 추적(depth=1)으로 hopAddrs(경유 후보) 발견
    const firstPass = traceChain(seed.address, LOGS_DIR, 1);
    const hopCandidates = (firstPass.rootCondition?.hopAddrs || []).slice(0, MAX_HOP_CANDIDATES_PER_SEED);

    console.log(`  경유 후보 ${firstPass.rootCondition?.hopAddrs?.length ?? 0}개 중 ` +
                `상위 ${hopCandidates.length}개 실 수집`);

    // 경유 후보 주소들도 실제로 수집 (예산 상한: MAX_HOP_CANDIDATES_PER_SEED)
    for (const hopAddr of hopCandidates) {
      const hopResult = await fetchAddress(hopAddr, 'hop candidate');
      apiCallsEstimate += 2;
    }

    // 2차 체인 추적(depth=2) — 경유 후보까지 수집된 상태로 다시 추적해 진짜
    // 통과(pass-through) 여부까지 확인
    const finalTrace = traceChain(seed.address, LOGS_DIR, 2);

    report.seeds.push({
      ...seed,
      status: 'ok',
      rootCondition: {
        hopAddrs: finalTrace.rootCondition.hopAddrs,
        bothSides: finalTrace.rootCondition.bothSides,
        hopLaunderingSetCondition: finalTrace.rootCondition.hopLaunderingSetCondition,
        depositCount: finalTrace.rootCondition.depositAddrList.length,
        withdrawCount: finalTrace.rootCondition.withdrawAddrList.length,
      },
      hopCandidatesFetched: hopCandidates,
      nodes: finalTrace.nodes,
      chains: finalTrace.chains,
    });
  }

  // ── 요약 집계 ─────────────────────────────────────────────────────────────
  const okSeeds = report.seeds.filter(s => s.status === 'ok');
  const hopLaunderingHits = okSeeds.filter(s => s.rootCondition.hopLaunderingSetCondition);
  const passThroughConfirmedHits = okSeeds.filter(s =>
    s.nodes.some(n => n.depth === 1 && n.passThroughConfirmed)
  );

  report.summary = {
    totalSeeds: SEEDS.length,
    seedsFetchedOk: okSeeds.length,
    estimatedApiCalls: apiCallsEstimate,
    hopLaunderingSetConditionHits: hopLaunderingHits.map(s => s.caseName),
    passThroughConfirmedHits: passThroughConfirmedHits.map(s => s.caseName),
  };

  console.log('\n=== 파일럿 요약 ===');
  console.log(JSON.stringify(report.summary, null, 2));

  const outPath = path.join(__dirname, 'results');
  fs.mkdirSync(outPath, { recursive: true });
  fs.writeFileSync(path.join(outPath, 'pilot_result.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n상세 결과 → ${path.join(outPath, 'pilot_result.json')}`);
}

main().catch(err => { console.error(err); process.exit(1); });
