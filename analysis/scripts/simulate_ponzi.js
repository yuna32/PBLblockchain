import { network } from "hardhat";
import { parseEther, formatEther } from "viem";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("=== 폰지 시뮬레이션 시작 ===\n");

  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const testClient = await viem.getTestClient();
  const [ownerClient, ...walletClients] = await viem.getWalletClients();
  const wallets = walletClients.slice(0, 10);

  console.log(`Owner: ${ownerClient.account.address}`);
  console.log(`참여자 수: ${wallets.length}명\n`);

  const ponzi = await viem.deployContract("PonziLab");
  const contractAddress = ponzi.address;
  console.log(`PonziLab 배포 완료: ${contractAddress}\n`);

  const log = [];

  // Phase 1: 10명 입금
  console.log("── Phase 1: 10명 입금 ──");
  for (let i = 0; i < wallets.length; i++) {
    await testClient.mine({ blocks: 2 });

    const hash = await ponzi.write.participate({
      value: parseEther("1.0"),
      account: wallets[i].account
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const balance = await publicClient.getBalance({ address: contractAddress });
    const count = await ponzi.read.getParticipantCount();

    log.push({
      block: receipt.blockNumber.toString(),
      timestamp: block.timestamp.toString(),
      from: wallets[i].account.address,
      to: contractAddress,
      action: "deposit",
      amount_eth: "1.0",
      contract_balance_eth: formatEther(balance),
      participant_count: count.toString()
    });

    console.log(`  [Block ${receipt.blockNumber}] 입금 1.0 ETH | 잔고: ${formatEther(balance)} ETH`);
  }

  // Phase 2: 3명 출금
  console.log("\n── Phase 2: 3명 출금 ──");
  for (let i = 0; i < 3; i++) {
    await testClient.mine({ blocks: 1 });

    const balanceBefore = await publicClient.getBalance({ address: contractAddress });
    const hash = await ponzi.write.withdraw({ account: wallets[i].account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const balanceAfter = await publicClient.getBalance({ address: contractAddress });
    const withdrawn = balanceBefore - balanceAfter;

    log.push({
      block: receipt.blockNumber.toString(),
      timestamp: block.timestamp.toString(),
      from: contractAddress,
      to: wallets[i].account.address,
      action: "withdraw",
      amount_eth: formatEther(withdrawn),
      contract_balance_eth: formatEther(balanceAfter),
      participant_count: (await ponzi.read.getParticipantCount()).toString()
    });

    console.log(`  [Block ${receipt.blockNumber}] 출금 ${formatEther(withdrawn)} ETH | 잔고: ${formatEther(balanceAfter)} ETH`);
  }

  // Phase 3: 러그풀
  console.log("\n── Phase 3: 관리자 전액 인출 (러그풀) ──");
  await testClient.mine({ blocks: 3 });

  const finalBalance = await publicClient.getBalance({ address: contractAddress });
  const hash = await ponzi.write.ownerWithdrawAll({ account: ownerClient.account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });

  log.push({
    block: receipt.blockNumber.toString(),
    timestamp: block.timestamp.toString(),
    from: contractAddress,
    to: ownerClient.account.address,
    action: "owner_withdraw_all",
    amount_eth: formatEther(finalBalance),
    contract_balance_eth: "0.0",
    participant_count: (await ponzi.read.getParticipantCount()).toString()
  });

  console.log(`  [Block ${receipt.blockNumber}] OWNER 전액 인출 ${formatEther(finalBalance)} ETH | 잔고: 0 ETH`);

  // CSV 저장
  const logDir = path.join(__dirname, "../analysis/logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const csv = [
    "block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count",
    ...log.map(e => Object.values(e).join(","))
  ].join("\n");

  fs.writeFileSync(path.join(logDir, "ponzi_log.csv"), csv);
  console.log(`\n✅ 로그 저장 완료: analysis/logs/ponzi_log.csv`);
  console.log(`   총 ${log.length}개 트랜잭션 기록`);
}

main().catch(console.error);