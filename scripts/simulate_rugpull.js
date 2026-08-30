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

  const PARTICIPANTS  = Math.min(parseInt(process.env.SCENARIO_PARTICIPANTS)   || 10,  walletClients.length);
  const DEPOSIT_MIN   = parseFloat(process.env.SCENARIO_DEPOSIT_MIN)           || 1.0;
  const DEPOSIT_MAX   = parseFloat(process.env.SCENARIO_DEPOSIT_MAX)           || 2.8;
  const DUMP_DELAY    = parseInt(process.env.SCENARIO_DUMP_DELAY_BLOCKS)       || 3;

  const wallets = walletClients.slice(0, PARTICIPANTS);

  // Linear ramp from DEPOSIT_MIN to DEPOSIT_MAX
  const depositAmounts = Array.from({ length: PARTICIPANTS }, (_, i) => {
    const t = PARTICIPANTS > 1 ? i / (PARTICIPANTS - 1) : 0;
    return (DEPOSIT_MIN + t * (DEPOSIT_MAX - DEPOSIT_MIN)).toFixed(2);
  });

  console.log(`Owner: ${ownerClient.account.address}`);
  console.log(`참여자 수: ${wallets.length}명\n`);

  const rugpull = await viem.deployContract("RugPull");
  const contractAddress = rugpull.address;
  console.log(`RugPull 배포 완료: ${contractAddress}\n`);

  const log = [];

  // Phase 1: 점진 입금
  console.log(`── Phase 1: ${PARTICIPANTS}명 입금 (잔고 점진 축적) ──`);
  for (let i = 0; i < wallets.length; i++) {
    await testClient.mine({ blocks: 2 });

    const amount = depositAmounts[i];
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

  // Phase 2: 오너 전액 인출
  console.log("\n── Phase 2: 오너 전액 단번 인출 (러그풀 트리거) ──");
  await testClient.mine({ blocks: DUMP_DELAY });

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
