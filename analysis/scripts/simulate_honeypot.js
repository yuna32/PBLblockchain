import { network } from "hardhat";
import { parseEther, formatEther } from "viem";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("=== 허니팟 시뮬레이션 시작 ===\n");

  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const testClient = await viem.getTestClient();
  const [ownerClient, ...walletClients] = await viem.getWalletClients();
  const wallets = walletClients.slice(0, 10);

  console.log(`Owner: ${ownerClient.account.address}`);
  console.log(`참여자 수: ${wallets.length}명\n`);

  const honeypot = await viem.deployContract("Honeypot");
  const contractAddress = honeypot.address;
  console.log(`Honeypot 배포 완료: ${contractAddress}\n`);

  const log = [];

  // Phase 1: 10명 입금 (정상 작동으로 신뢰 유도)
  console.log("── Phase 1: 10명 입금 ──");
  for (let i = 0; i < wallets.length; i++) {
    await testClient.mine({ blocks: 2 });

    const hash = await honeypot.write.deposit({
      value: parseEther("1.0"),
      account: wallets[i].account
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const balance = await publicClient.getBalance({ address: contractAddress });

    log.push({
      block: receipt.blockNumber.toString(),
      timestamp: block.timestamp.toString(),
      from: wallets[i].account.address,
      to: contractAddress,
      action: "deposit",
      amount_eth: "1.0",
      contract_balance_eth: formatEther(balance),
      participant_count: (i + 1).toString(),
      withdraw_success: ""
    });

    console.log(`  [Block ${receipt.blockNumber}] 입금 1.0 ETH | 잔고: ${formatEther(balance)} ETH`);
  }

  // Phase 2: 5명 출금 시도 (항상 실패 — _withdrawEnabled = false)
  console.log("\n── Phase 2: 5명 출금 시도 (실패 예상) ──");
  for (let i = 0; i < 5; i++) {
    await testClient.mine({ blocks: 2 });

    const blockNum = await publicClient.getBlockNumber();
    const block = await publicClient.getBlock({ blockNumber: blockNum });
    const balance = await publicClient.getBalance({ address: contractAddress });

    // withdraw() 호출 시 require(_withdrawEnabled) 조건으로 항상 revert
    // 실패 시도를 CSV에 기록 (실제 tx 없음)
    log.push({
      block: blockNum.toString(),
      timestamp: block.timestamp.toString(),
      from: wallets[i].account.address,
      to: contractAddress,
      action: "withdraw_attempt",
      amount_eth: "0.0",
      contract_balance_eth: formatEther(balance),
      participant_count: wallets.length.toString(),
      withdraw_success: "false"
    });

    console.log(`  [Block ${blockNum}] 출금 시도 (실패) 지갑: ${wallets[i].account.address.slice(0, 10)}... | 잔고: ${formatEther(balance)} ETH`);
  }

  // Phase 3: Owner가 백도어로 전액 수집
  console.log("\n── Phase 3: Owner 전액 수집 (ownerCollect) ──");
  await testClient.mine({ blocks: 2 });

  const finalBalance = await publicClient.getBalance({ address: contractAddress });
  const hash = await honeypot.write.ownerCollect({ account: ownerClient.account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });

  log.push({
    block: receipt.blockNumber.toString(),
    timestamp: block.timestamp.toString(),
    from: contractAddress,
    to: ownerClient.account.address,
    action: "owner_collect",
    amount_eth: formatEther(finalBalance),
    contract_balance_eth: "0.0",
    participant_count: wallets.length.toString(),
    withdraw_success: ""
  });

  console.log(`  [Block ${receipt.blockNumber}] OWNER 전액 수집 ${formatEther(finalBalance)} ETH | 잔고: 0 ETH`);

  // CSV 저장
  const logDir = path.join(__dirname, "../analysis/logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const csv = [
    "block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count,withdraw_success",
    ...log.map(e => [
      e.block, e.timestamp, e.from, e.to, e.action,
      e.amount_eth, e.contract_balance_eth, e.participant_count, e.withdraw_success
    ].join(","))
  ].join("\n");

  fs.writeFileSync(path.join(logDir, "honeypot_log.csv"), csv);
  console.log(`\n✅ 로그 저장 완료: analysis/logs/honeypot_log.csv`);
  console.log(`   총 ${log.length}개 트랜잭션 기록`);
  console.log(`   - 입금: 10건, 출금 시도(실패): 5건, 오너 수집: 1건`);
}

main().catch(console.error);
