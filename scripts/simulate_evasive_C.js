import { network } from "hardhat";
import { parseEther, formatEther } from "viem";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Scenario C — Score Weight Gap + Temporal Blindness (점수 가중치 격차 + 시간 무감각)
 *
 * Two layered indicator-design weaknesses:
 *
 * 1. Score weight gap — even when CONCENTRATION_DRAIN (+30) and PROFIT_EXTRACTION (+30)
 *    both fire, their combined weight of 60 falls 5 points short of the HIGH_RISK
 *    threshold (65).  The two "quantity-of-flow" rules (BALANCE_DROP +45, FLOW_SPIKE +35)
 *    are required to push a case over the line, but both are suppressed here:
 *      BALANCE_DROP  gates on hasOwnerDrain, which requires the literal string
 *        "owner_withdraw_all". Using "withdraw" (also a valid WITHDRAW_ACTIONS member)
 *        keeps hasOwnerDrain=false → rule silent despite finalBal < peak×0.1.
 *      FLOW_SPIKE    uses maxSingleWithdraw. Four 2.4 ETH withdrawals each stay below
 *        the 50%-of-totalIn threshold (5 ETH) → rule silent despite 9.6 ETH total out.
 *
 * 2. Temporal blindness — a 50-block gap between the deposit phase and drain phase
 *    is completely invisible to every rule. No rule evaluates the time-distance
 *    or velocity of balance changes, so deliberate delays are free evasion.
 *
 * Setup: owner deposits 1 ETH (enters depositorMap), 9 participants deposit 1 ETH each.
 * Drain:  4 × 2.4 ETH "withdraw" to owner address after 50-block delay.
 *
 * Triggered:  CONCENTRATION_DRAIN (+30): owner gets 9.6/9.6 = 100% of totalOut.
 *             PROFIT_EXTRACTION  (+30): owner deposited 1 ETH, received 9.6 ETH (9.6×).
 * Silent:     BALANCE_DROP, FLOW_SPIKE, OSCILLATING_BALANCE.
 * Score: 60 / MEDIUM_RISK — despite 96% extraction and suspicious temporal pattern.
 */
async function main() {
  console.log("=== 우회 시뮬레이션 C: 점수 가중치 격차 + 시간 무감각 ===\n");
  console.log("목표 취약점:");
  console.log("  1) CONCENTRATION_DRAIN+PROFIT_EXTRACTION=60 < HIGH_RISK 임계값 65");
  console.log("  2) BALANCE_DROP의 hasOwnerDrain 게이트 (action 리터럴 의존)");
  console.log("  3) FLOW_SPIKE의 단일-최대값 지표");
  console.log("  4) 시간 패턴 완전 무시 (50블록 지연)\n");

  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const testClient   = await viem.getTestClient();
  const [ownerClient, ...walletClients] = await viem.getWalletClients();
  const wallets = walletClients.slice(0, 9);  // 9 genuine participants

  console.log(`Owner:  ${ownerClient.account.address}`);
  console.log(`참여자: ${wallets.length}명\n`);

  const evasive = await viem.deployContract("EvasiveContract");
  const contractAddress = evasive.address;
  console.log(`EvasiveContract 배포 완료: ${contractAddress}\n`);

  const log = [];

  // ── Phase 1: 오너 1 ETH 입금 — depositorMap에 등록 ─────────────────────────
  // Owner deposits so that PROFIT_EXTRACTION can compare received/deposited later.
  console.log("── Phase 1: 오너 1 ETH 입금 (depositorMap 등록) ──");
  await testClient.mine({ blocks: 2 });

  {
    const hash = await evasive.write.deposit({
      value: parseEther("1.0"),
      account: ownerClient.account,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const block   = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const balance = await publicClient.getBalance({ address: contractAddress });
    const count   = await evasive.read.getParticipantCount();

    log.push({
      block:                receipt.blockNumber.toString(),
      timestamp:            block.timestamp.toString(),
      from:                 ownerClient.account.address,
      to:                   contractAddress,
      action:               "deposit",
      amount_eth:           "1.0",
      contract_balance_eth: formatEther(balance),
      participant_count:    count.toString(),
    });

    console.log(`  [Block ${receipt.blockNumber}] 오너 입금 1.0 ETH | 잔고: ${formatEther(balance)} ETH`);
  }

  // ── Phase 2: 9명 참여자 입금 (totalIn = 10 ETH) ────────────────────────────
  console.log("\n── Phase 2: 9명 참여자 입금 (총 totalIn = 10 ETH) ──");
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

    console.log(`  [Block ${receipt.blockNumber}] 참여자-${i + 1} 입금 1.0 ETH | 잔고: ${formatEther(balance)} ETH`);
  }

  // ── Phase 3: 50블록 시간 지연 ─────────────────────────────────────────────
  // This deliberate delay between accumulation and drain is invisible to all rules.
  // No rule measures velocity, time-distance, or block-gap between phases.
  console.log("\n── Phase 3: 50블록 시간 지연 (탐지 시스템에 완전 무시됨) ──");
  await testClient.mine({ blocks: 50 });
  const blockAfterDelay = await publicClient.getBlockNumber();
  console.log(`  50블록 마이닝 완료 (현재 블록: ${blockAfterDelay})`);
  console.log(`  → 어떤 규칙도 입금~인출 구간의 시간 패턴을 검사하지 않음\n`);

  // ── Phase 4: 오너 4 × 2.4 ETH 인출 (자기 주소로, action: "withdraw") ────────
  // "withdraw" ∈ WITHDRAW_ACTIONS → totalOut, maxSingleWithdraw, recipientMap 모두 집계됨.
  // Evasion relies entirely on threshold geometry and the hasOwnerDrain gate.
  //
  // BALANCE_DROP:        hasOwnerDrain=false ("withdraw" ≠ "owner_withdraw_all") → miss
  //                      (even though finalBal=0.4 < peak×0.1=1.0)
  // FLOW_SPIKE:          maxSingleWithdraw=2.4 < 5.0 → miss
  // CONCENTRATION_DRAIN: owner receives 9.6/9.6=100% → fires (+30)
  // PROFIT_EXTRACTION:   owner deposited 1 ETH, received 9.6 ETH (9.6×) → fires (+30)
  console.log("── Phase 4: 오너 4 × 2.4 ETH 인출 (자신의 주소, action: \"withdraw\") ──");
  console.log("   [BALANCE_DROP 분석] hasOwnerDrain=false — \"withdraw\" 사용으로 게이트 우회");
  console.log("   [FLOW_SPIKE 분석]   maxSingleWithdraw=2.4 < totalIn×0.5=5.0");
  console.log("   [PROFIT_EXTRACTION] 오너: 입금 1 ETH, 수령 9.6 ETH → ratio=9.6 → 발동\n");

  for (let i = 0; i < 4; i++) {
    await testClient.mine({ blocks: 3 });

    const hash = await evasive.write.withdrawTo(
      [ownerClient.account.address, parseEther("2.4")],
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
      action:               "withdraw",
      amount_eth:           "2.4",
      contract_balance_eth: formatEther(balance),
      participant_count:    count.toString(),
    });

    console.log(`  [Block ${receipt.blockNumber}] withdraw 2.4 ETH → 오너 | 잔고: ${formatEther(balance)} ETH`);
  }

  const finalBalance = await publicClient.getBalance({ address: contractAddress });

  // ── CSV 저장 ───────────────────────────────────────────────────────────────
  const logDir = path.join(__dirname, "../analysis/logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const csv = [
    "block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count",
    ...log.map(e => Object.values(e).join(",")),
  ].join("\n");

  fs.writeFileSync(path.join(logDir, "evasive_C_log.csv"), csv);
  console.log(`\n✅ 로그 저장 완료: analysis/logs/evasive_C_log.csv`);
  console.log(`   총 ${log.length}개 트랜잭션 기록 | 최종 잔고: ${formatEther(finalBalance)} ETH`);
  console.log(`\n탐지 우회 요약 (지표 설계 취약점):`);
  console.log(`  CONCENTRATION_DRAIN: 100% 집중 → 발동 (+30점)`);
  console.log(`  PROFIT_EXTRACTION:   9.6× 수익 → 발동 (+30점)`);
  console.log(`  BALANCE_DROP:        hasOwnerDrain=false ("withdraw" ≠ "owner_withdraw_all") → 미발동`);
  console.log(`  FLOW_SPIKE:          maxSingleWithdraw=2.4 < 5.0 → 미발동`);
  console.log(`  시간 패턴:           50블록 지연 구간 — 어떤 규칙도 감지하지 못함`);
  console.log(`  → 총 9.6 ETH (96%) 탈취에도 동적 위험도: 60 / MEDIUM_RISK`);
  console.log(`  → HIGH_RISK 임계값(65)에서 5점 부족 — 점수 가중치 설계 결함 노출`);
}

main().catch(console.error);
