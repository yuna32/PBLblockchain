import { network } from "hardhat";
import { parseEther, formatEther } from "viem";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("=== 정상 스테이킹 시뮬레이션 시작 ===\n");

  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const testClient = await viem.getTestClient();
  const [ownerClient, ...walletClients] = await viem.getWalletClients();
  const wallets = walletClients.slice(0, 10);

  console.log(`Owner: ${ownerClient.account.address}`);
  console.log(`참여자 수: ${wallets.length}명\n`);

  const staking = await viem.deployContract("NormalStaking", [], {
    value: parseEther("5.0")
  });
  const contractAddress = staking.address;
  console.log(`NormalStaking 배포 완료: ${contractAddress}\n`);

  const log = [];

  const deployBlock = await publicClient.getBlockNumber();
  const deployBlockData = await publicClient.getBlock({ blockNumber: deployBlock });
  log.push({
    block: deployBlock.toString(),
    timestamp: deployBlockData.timestamp.toString(),
    from: ownerClient.account.address,
    to: contractAddress,
    action: "fund_reward_pool",
    amount_eth: "5.0",
    contract_balance_eth: "5.0",
    participant_count: "0"
  });

  // Phase 1: 10명 스테이킹
  console.log("── Phase 1: 10명 스테이킹 ──");
  for (let i = 0; i < wallets.length; i++) {
    await testClient.mine({ blocks: 2 });

    const hash = await staking.write.stake({
      value: parseEther("1.0"),
      account: wallets[i].account
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const balance = await publicClient.getBalance({ address: contractAddress });
    const count = await staking.read.getStakerCount();

    log.push({
      block: receipt.blockNumber.toString(),
      timestamp: block.timestamp.toString(),
      from: wallets[i].account.address,
      to: contractAddress,
      action: "stake",
      amount_eth: "1.0",
      contract_balance_eth: formatEther(balance),
      participant_count: count.toString()
    });

    console.log(`  [Block ${receipt.blockNumber}] 스테이킹 1.0 ETH | 잔고: ${formatEther(balance)} ETH`);
  }

  // Phase 2: 블록 경과
  console.log("\n── Phase 2: 20블록 경과 (이자 누적) ──");
  await testClient.mine({ blocks: 20 });
  console.log("  20블록 마이닝 완료\n");

  // Phase 3: 10명 언스테이킹
  console.log("── Phase 3: 10명 언스테이킹 ──");
  for (let i = 0; i < wallets.length; i++) {
    await testClient.mine({ blocks: 1 });

    const balanceBefore = await publicClient.getBalance({ address: contractAddress });
    const hash = await staking.write.unstake({ account: wallets[i].account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const balanceAfter = await publicClient.getBalance({ address: contractAddress });
    const withdrawn = balanceBefore - balanceAfter;

    log.push({
      block: receipt.blockNumber.toString(),
      timestamp: block.timestamp.toString(),
      from: contractAddress,
      to: wallets[i].account.address,
      action: "unstake",
      amount_eth: formatEther(withdrawn),
      contract_balance_eth: formatEther(balanceAfter),
      participant_count: (await staking.read.getStakerCount()).toString()
    });

    console.log(`  [Block ${receipt.blockNumber}] 언스테이킹 ${formatEther(withdrawn)} ETH | 잔고: ${formatEther(balanceAfter)} ETH`);
  }

  // CSV 저장
  const logDir = path.join(__dirname, "../analysis/logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const csv = [
    "block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count",
    ...log.map(e => Object.values(e).join(","))
  ].join("\n");

  fs.writeFileSync(path.join(logDir, "normal_log.csv"), csv);
  console.log(`\n✅ 로그 저장 완료: analysis/logs/normal_log.csv`);
  console.log(`   총 ${log.length}개 트랜잭션 기록`);
}

main().catch(console.error);