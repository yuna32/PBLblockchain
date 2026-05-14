import { network } from "hardhat";
import { parseEther, formatEther } from "viem";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("=== 플래시론 패턴 시뮬레이션 시작 ===\n");

  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const testClient = await viem.getTestClient();
  const [ownerClient, ...walletClients] = await viem.getWalletClients();
  const wallets = walletClients.slice(0, 5);

  console.log(`Owner: ${ownerClient.account.address}`);
  console.log(`플래시 공격자 수: ${wallets.length}명 (각 1라운드)\n`);

  const flashloan = await viem.deployContract("FlashLoanPattern");
  const contractAddress = flashloan.address;
  console.log(`FlashLoanPattern 배포 완료: ${contractAddress}\n`);

  const log = [];

  // 5라운드: 각 라운드마다 대량 입금 → 즉시 전액 인출
  // 실제 플래시론은 동일 블록에서 발생; 여기서는 연속 블록으로 시뮬레이션
  // 핵심 패턴: max_single_tx == total_in, 잔고가 절대 누적되지 않음
  console.log("── 플래시론 라운드 시뮬레이션 (입금 → 즉시 인출 반복) ──\n");

  const flashAmounts = ["10.0", "15.0", "8.0", "20.0", "12.0"];

  for (let round = 0; round < wallets.length; round++) {
    const wallet = wallets[round];
    const amount = flashAmounts[round];

    console.log(`  [Round ${round + 1}] 지갑: ${wallet.account.address}`);

    // Step A: 대량 입금
    await testClient.mine({ blocks: 1 });

    const depositHash = await flashloan.write.deposit({
      value: parseEther(amount),
      account: wallet.account
    });
    const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
    const depositBlock = await publicClient.getBlock({ blockNumber: depositReceipt.blockNumber });
    const balanceAfterDeposit = await publicClient.getBalance({ address: contractAddress });
    const userCountDeposit = await flashloan.read.getUserCount();

    log.push({
      block: depositReceipt.blockNumber.toString(),
      timestamp: depositBlock.timestamp.toString(),
      from: wallet.account.address,
      to: contractAddress,
      action: "deposit",
      amount_eth: amount,
      contract_balance_eth: formatEther(balanceAfterDeposit),
      participant_count: userCountDeposit.toString()
    });

    console.log(`    [Block ${depositReceipt.blockNumber}] 입금 ${amount} ETH | 잔고: ${formatEther(balanceAfterDeposit)} ETH`);

    // Step B: 즉시 전액 인출 (다음 블록 — 실제 플래시론 패턴 모방)
    await testClient.mine({ blocks: 1 });

    const withdrawHash = await flashloan.write.withdrawAll({ account: wallet.account });
    const withdrawReceipt = await publicClient.waitForTransactionReceipt({ hash: withdrawHash });
    const withdrawBlock = await publicClient.getBlock({ blockNumber: withdrawReceipt.blockNumber });
    const balanceAfterWithdraw = await publicClient.getBalance({ address: contractAddress });
    const userCountWithdraw = await flashloan.read.getUserCount();

    log.push({
      block: withdrawReceipt.blockNumber.toString(),
      timestamp: withdrawBlock.timestamp.toString(),
      from: contractAddress,
      to: wallet.account.address,
      action: "withdraw",
      amount_eth: amount,
      contract_balance_eth: formatEther(balanceAfterWithdraw),
      participant_count: userCountWithdraw.toString()
    });

    console.log(`    [Block ${withdrawReceipt.blockNumber}] 즉시 인출 ${amount} ETH | 잔고: ${formatEther(balanceAfterWithdraw)} ETH`);
    console.log(`    ✓ 잔고 복귀: ${formatEther(balanceAfterWithdraw)} ETH (누적 없음)\n`);
  }

  console.log("── 탐지 신호 요약 ──");
  console.log("  • max_single_tx == total_in (입금 즉시 전액 인출)");
  console.log("  • cumulative_balance 패턴: 0 → 피크 → 0 반복");
  console.log("  • 잔고 절대 누적되지 않음\n");

  // CSV 저장
  const logDir = path.join(__dirname, "../analysis/logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const csv = [
    "block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count",
    ...log.map(e => Object.values(e).join(","))
  ].join("\n");

  fs.writeFileSync(path.join(logDir, "flashloan_log.csv"), csv);
  console.log(`✅ 로그 저장 완료: analysis/logs/flashloan_log.csv`);
  console.log(`   총 ${log.length}개 트랜잭션 기록`);
}

main().catch(console.error);
