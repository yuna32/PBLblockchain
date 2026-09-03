import { network } from "hardhat";
import { parseEther, formatEther } from "viem";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Scenario B — Threshold Cliff (임계값 절벽)
 *
 * Target weakness: BALANCE_DROP has a hard 90% cliff.
 *   Condition: peak > 0 && finalBal < peak * 0.1 && hasOwnerDrain
 *   → The threshold is a binary cliff: 90%+ drop triggers (+45 pts); 89% does not.
 *
 * Attack: extract exactly 8.9 ETH from 10 ETH pool → leave 1.1 ETH.
 *   peak = 10.0, peak * 0.1 = 1.0, finalBal = 1.1
 *   1.1 < 1.0 → FALSE — BALANCE_DROP is completely silent despite 89% extraction.
 *
 * The action IS "owner_withdraw_all" (in HIGH_RISK_ACTIONS), so hasOwnerDrain=true
 * and FLOW_SPIKE + CONCENTRATION_DRAIN both fire:
 *   FLOW_SPIKE:          8.9 >= 10×0.5=5.0 → fires (+35)
 *   CONCENTRATION_DRAIN: 8.9/8.9=100% >= 80% → fires (+30)
 *   Score: 65 / HIGH_RISK (borderline) — but the dedicated high-weight rule (+45)
 *   specifically designed for "large owner drain" was fully silenced by a 0.1 ETH buffer.
 *
 * Key insight: the 90% threshold is an arbitrary design choice, not a principled one.
 * An 89% drain is equally catastrophic, yet the rule treats them as completely different.
 */
async function main() {
  console.log("=== 우회 시뮬레이션 B: 임계값 절벽 (Threshold Cliff) ===\n");
  console.log("목표 취약점: BALANCE_DROP 의 90% 하드 클리프 — 89% 탈취로 최고가중치 규칙 침묵\n");

  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const testClient   = await viem.getTestClient();
  const [ownerClient, ...walletClients] = await viem.getWalletClients();
  const wallets = walletClients.slice(0, 10);

  console.log(`Owner:  ${ownerClient.account.address}`);
  console.log(`참여자: ${wallets.length}명\n`);

  const evasive = await viem.deployContract("EvasiveContract");
  const contractAddress = evasive.address;
  console.log(`EvasiveContract 배포 완료: ${contractAddress}\n`);

  const log = [];

  // ── Phase 1: 10명 입금 (totalIn = 10 ETH, peak = 10 ETH) ──────────────────
  console.log("── Phase 1: 10명 입금 (totalIn = 10 ETH) ──");
  for (let i = 0; i < wallets.length; i++) {
    await testClient.mine({ blocks: 2 });

    const hash = await evasive.write.deposit({
      value: parseEther("1.0"),
      account: wallets[i].account,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const block   = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const balance = await publicClient.getBalance({ address: contractAddress });
    const count   = await evasive.read.getParticipantCount();

    log.push({
      block:                receipt.blockNumber.toString(),
      timestamp:            block.timestamp.toString(),
      from:                 wallets[i].account.address,
      to:                   contractAddress,
      action:               "deposit",
      amount_eth:           "1.0",
      contract_balance_eth: formatEther(balance),
      participant_count:    count.toString(),
    });

    console.log(`  [Block ${receipt.blockNumber}] 입금 1.0 ETH | 잔고: ${formatEther(balance)} ETH`);
  }

  // ── Phase 2: 오너가 8.9 ETH 인출 — 1.1 ETH 잔류 (peak × 0.1 = 1.0 ETH 초과) ──
  // Action "owner_withdraw_all" ∈ HIGH_RISK_ACTIONS → hasOwnerDrain=true
  // BALANCE_DROP condition: finalBal(1.1) < peak(10) * 0.1(1.0) → 1.1 < 1.0 → FALSE
  // 0.1 ETH 버퍼 하나로 +45점짜리 핵심 규칙 완전 침묵.
  console.log("\n── Phase 2: owner_withdraw_all 8.9 ETH (잔고 1.1 ETH 유지) ──");
  console.log("   [BALANCE_DROP 분석] finalBal=1.1 > peak×0.1=1.0 → 0.1 ETH 차이로 규칙 미발동\n");

  await testClient.mine({ blocks: 5 });

  const hash = await evasive.write.withdrawTo(
    [ownerClient.account.address, parseEther("8.9")],
    { account: ownerClient.account }
  );

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const block   = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const balance = await publicClient.getBalance({ address: contractAddress });
  const count   = await evasive.read.getParticipantCount();

  log.push({
    block:                receipt.blockNumber.toString(),
    timestamp:            block.timestamp.toString(),
    from:                 contractAddress,
    to:                   ownerClient.account.address,
    action:               "owner_withdraw_all",
    amount_eth:           "8.9",
    contract_balance_eth: formatEther(balance),
    participant_count:    count.toString(),
  });

  console.log(`  [Block ${receipt.blockNumber}] owner_withdraw_all 8.9 ETH | 잔고: ${formatEther(balance)} ETH`);
  console.log(`  탈취율: 89% — 임계값(90%)을 0.1 ETH 차이로 미달`);

  // ── CSV 저장 ───────────────────────────────────────────────────────────────
  const logDir = path.join(__dirname, "../analysis/logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const csv = [
    "block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count",
    ...log.map(e => Object.values(e).join(",")),
  ].join("\n");

  fs.writeFileSync(path.join(logDir, "evasive_B_log.csv"), csv);
  console.log(`\n✅ 로그 저장 완료: analysis/logs/evasive_B_log.csv`);
  console.log(`   총 ${log.length}개 트랜잭션 기록`);
  console.log(`\n탐지 우회 요약 (지표 설계 취약점):`);
  console.log(`  BALANCE_DROP:        finalBal=1.1 > peak×0.1=1.0 → 미발동 (+45점 침묵)`);
  console.log(`  FLOW_SPIKE:          8.9 >= 5.0 → 발동 (+35점)`);
  console.log(`  CONCENTRATION_DRAIN: 100% 집중 → 발동 (+30점)`);
  console.log(`  최종 점수: 65/100 HIGH_RISK (경계선) — 핵심 규칙 없이 도달`);
  console.log(`  의미: 90% 하드 클리프는 89% 탈취를 완전히 다른 위험 등급으로 취급`);
}

main().catch(console.error);
