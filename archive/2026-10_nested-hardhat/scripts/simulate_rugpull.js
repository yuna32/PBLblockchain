import { network } from "hardhat";
import { parseEther, formatEther } from "viem";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("=== 러그풀 시뮬레이션 시작 ===\n");

  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const testClient = await viem.getTestClient();
  const [ownerClient, ...walletClients] = await viem.getWalletClients();
  const wallets = walletClients.slice(0, 10);

  console.log(`Owner: ${ownerClient.account.address}`);
  console.log(`참여자 수: ${wallets.length}명\n`);

  const rugpull = await viem.deployContract("RugPull");
  const contractAddress = rugpull.address;
  console.log(`RugPull 배포 완료: ${contractAddress}\n`);

  const log = [];

  // Phase 1: 10명 점진 입금 — 잔고 역V자 상승
  console.log("── Phase 1: 10명 입금 (잔고 점진 축적) ──");
  const depositAmounts = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8];

  for (let i = 0; i < wallets.length; i++) {
    await testClient.mine({ blocks: 2 });

    const amount = depositAmounts[i].toFixed(1);
    const hash = await rugpull.write.deposit({
      value: parseEther(amount),
      account: wallets[i].account
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const balance = await publicClient.getBalance({ address: contractAddress });
    const count = await rugpull.read.getDepositorCount();

    log.push({
      block: receipt.blockNumber.toString(),
      timestamp: block.timestamp.toString(),
      from: wallets[i].account.address,
      to: contractAddress,
      action: "deposit",
      amount_eth: amount,
      contract_balance_eth: formatEther(balance),
      participant_count: count.toString()
    });

    console.log(`  [Block ${receipt.blockNumber}] 입금 ${amount} ETH | 잔고: ${formatEther(balance)} ETH`);
  }

  // Phase 2: 오너 단번 전액 인출 — 중간 출금 없이 피크에서 러그풀
  console.log("\n── Phase 2: 오너 전액 단번 인출 (러그풀 트리거) ──");
  await testClient.mine({ blocks: 3 });

  const peakBalance = await publicClient.getBalance({ address: contractAddress });
  const hash = await rugpull.write.rugPullAll({ account: ownerClient.account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });

  log.push({
    block: receipt.blockNumber.toString(),
    timestamp: block.timestamp.toString(),
    from: contractAddress,
    to: ownerClient.account.address,
    action: "owner_withdraw_all",
    amount_eth: formatEther(peakBalance),
    contract_balance_eth: "0.0",
    participant_count: (await rugpull.read.getDepositorCount()).toString()
  });

  console.log(`  [Block ${receipt.blockNumber}] OWNER 전액 인출 ${formatEther(peakBalance)} ETH | 잔고: 0 ETH`);
  console.log(`  ⚠ 피해: ${wallets.length}명 전원 자금 손실`);

  // CSV 저장
  const logDir = path.join(__dirname, "../analysis/logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const csv = [
    "block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count",
    ...log.map(e => Object.values(e).join(","))
  ].join("\n");

  fs.writeFileSync(path.join(logDir, "rugpull_log.csv"), csv);
  console.log(`\n✅ 로그 저장 완료: analysis/logs/rugpull_log.csv`);
  console.log(`   총 ${log.length}개 트랜잭션 기록`);
}

main().catch(console.error);
