import { network } from "hardhat";
import { parseEther, formatEther } from "viem";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Scenario A — Distributed Drain (분산 출금)
 *
 * Target weakness: FLOW_SPIKE and CONCENTRATION_DRAIN both rely on fixed numeric
 * thresholds that become ineffective when the attacker distributes withdrawals.
 *
 * FLOW_SPIKE  condition: maxSingleWithdraw >= totalIn * 0.5
 *   → tracks only the single largest withdrawal, not cumulative outflow.
 *   → 4 × 2.4 ETH keeps each transfer below 5.0 ETH threshold → rule silent.
 *
 * CONCENTRATION_DRAIN condition: top3 recipients / totalOut >= 0.8
 *   → 4 equal recipients: top-3 share = 7.2 / 9.6 = 75% < 80% → rule silent.
 *
 * All actions use standard strings ("deposit", "withdraw") — no whitelist bypass.
 * BALANCE_DROP also misses because hasOwnerDrain requires "owner_withdraw_all".
 * PROFIT_EXTRACTION misses because recipients are fresh addresses (not in depositorMap).
 *
 * Net result: 9.6 ETH / 10 ETH (96%) extracted → dynamic risk score: 0 / LOW_RISK
 */
async function main() {
  console.log("=== 우회 시뮬레이션 A: 분산 출금 (Distributed Drain) ===\n");
  console.log("목표 취약점: FLOW_SPIKE의 단일-최대값 지표 + CONCENTRATION_DRAIN의 80% 임계값\n");

  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const testClient   = await viem.getTestClient();
  const [ownerClient, ...walletClients] = await viem.getWalletClients();
  const wallets     = walletClients.slice(0, 10);   // 10 genuine participants
  const recipients  = walletClients.slice(10, 14);  // 4 fresh recipient addresses

  console.log(`Owner:  ${ownerClient.account.address}`);
  console.log(`참여자: ${wallets.length}명`);
  console.log(`수령 지갑 (신규): ${recipients.length}개\n`);

  const evasive = await viem.deployContract("EvasiveContract");
  const contractAddress = evasive.address;
  console.log(`EvasiveContract 배포 완료: ${contractAddress}\n`);

  const log = [];

  // ── Phase 1: 10명 입금 (totalIn = 10 ETH) ──────────────────────────────────
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

  // ── Phase 2: 4 × 2.4 ETH to 4 distinct fresh addresses ────────────────────
  // Action "withdraw" ∈ WITHDRAW_ACTIONS → properly counted by all accumulators.
  // Evasion relies on threshold geometry, not missing action labels.
  //
  // FLOW_SPIKE:          maxSingleWithdraw = 2.4 < totalIn×0.5 = 5.0  → miss
  // CONCENTRATION_DRAIN: top3 = 7.2 / totalOut(9.6) = 0.75 < 0.8     → miss
  console.log("\n── Phase 2: 4 × 2.4 ETH 분산 인출 (각 별도 신규 주소) ──");
  console.log("   [FLOW_SPIKE 분석] 각 출금 2.4 ETH < 임계값 5.0 ETH (totalIn×0.5)");
  console.log("   [CONCENTRATION_DRAIN 분석] 4 수령자 → top-3 합계 7.2/9.6 = 75% < 80%\n");

  for (let i = 0; i < recipients.length; i++) {
    await testClient.mine({ blocks: 5 });

    const recipientAddr = recipients[i].account.address;
    const hash = await evasive.write.withdrawTo(
      [recipientAddr, parseEther("2.4")],
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
      to:                   recipientAddr,
      action:               "withdraw",
      amount_eth:           "2.4",
      contract_balance_eth: formatEther(balance),
      participant_count:    count.toString(),
    });

    console.log(`  [Block ${receipt.blockNumber}] withdraw 2.4 ETH → 수령자-${i + 1} (${recipientAddr.slice(0, 8)}…) | 잔고: ${formatEther(balance)} ETH`);
  }

  const finalBalance = await publicClient.getBalance({ address: contractAddress });

  // ── CSV 저장 ───────────────────────────────────────────────────────────────
  const logDir = path.join(__dirname, "../analysis/logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const csv = [
    "block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count",
    ...log.map(e => Object.values(e).join(",")),
  ].join("\n");

  fs.writeFileSync(path.join(logDir, "evasive_A_log.csv"), csv);
  console.log(`\n✅ 로그 저장 완료: analysis/logs/evasive_A_log.csv`);
  console.log(`   총 ${log.length}개 트랜잭션 기록 | 최종 잔고: ${formatEther(finalBalance)} ETH`);
  console.log(`\n탐지 우회 요약 (지표 설계 취약점):`);
  console.log(`  FLOW_SPIKE:          maxSingleWithdraw=2.4 < totalIn×0.5=5.0 → 미발동`);
  console.log(`  CONCENTRATION_DRAIN: top3=7.2/9.6=75% < 80% 임계값 → 미발동`);
  console.log(`  BALANCE_DROP:        hasOwnerDrain=false ("withdraw" 사용) → 미발동`);
  console.log(`  PROFIT_EXTRACTION:   신규 수령자 주소 ∉ depositorMap → 미발동`);
  console.log(`  → 총 9.6 ETH (96%) 탈취에도 동적 위험도: 0 / LOW_RISK`);
}

main().catch(console.error);
