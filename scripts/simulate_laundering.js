import { network } from "hardhat";
import { parseEther, formatEther } from "viem";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("=== 자금세탁 시뮬레이션 시작 ===\n");

  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const testClient = await viem.getTestClient();
  const [ownerClient, ...walletClients] = await viem.getWalletClients();

  const DEPOSITOR_COUNT = Math.min(parseInt(process.env.SCENARIO_PARTICIPANTS) || 19, walletClients.length);
  const DEPOSIT_MIN     = parseFloat(process.env.SCENARIO_DEPOSIT_MIN)          || 0.10;
  const DEPOSIT_MAX     = parseFloat(process.env.SCENARIO_DEPOSIT_MAX)          || 0.30;

  const wallets = walletClients.slice(0, DEPOSITOR_COUNT);

  const amounts = Array.from({ length: DEPOSITOR_COUNT }, () =>
    (DEPOSIT_MIN + Math.random() * (DEPOSIT_MAX - DEPOSIT_MIN)).toFixed(2)
  );

  console.log(`Owner: ${ownerClient.account.address}`);
  console.log(`분산 입금자 수: ${wallets.length}명\n`);

  const laundering = await viem.deployContract("MoneyLaundering");
  const contractAddress = laundering.address;
  console.log(`MoneyLaundering 배포 완료: ${contractAddress}\n`);

  const log = [];

  // Phase 1: 분산 소액 입금 (레이어링)
  console.log(`── Phase 1: 분산 소액 입금 (Layering) ──`);
  for (let i = 0; i < wallets.length; i++) {
    await testClient.mine({ blocks: 1 });

    const hash = await laundering.write.deposit({
      value: parseEther(amounts[i]),
      account: wallets[i].account
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const balance = await publicClient.getBalance({ address: contractAddress });
    const count = await laundering.read.getDepositorCount();

    log.push({
      block: receipt.blockNumber.toString(),
      timestamp: block.timestamp.toString(),
      from: wallets[i].account.address,
      to: contractAddress,
      action: "deposit",
      amount_eth: amounts[i],
      contract_balance_eth: formatEther(balance),
      participant_count: count.toString()
    });

    console.log(`  [Block ${receipt.blockNumber}] 입금 ${amounts[i]} ETH | 잔고: ${formatEther(balance)} ETH`);
  }

  // Phase 2: 단일 지갑 전액 집계 인출 (통합)
  console.log("\n── Phase 2: 단일 지갑 전액 집계 인출 (Integration) ──");
  await testClient.mine({ blocks: 3 });

  const totalBalance = await publicClient.getBalance({ address: contractAddress });
  const recipient = wallets[0].account.address;

  const hash = await laundering.write.withdrawAll(
    [recipient],
    { account: ownerClient.account }
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const balanceAfter = await publicClient.getBalance({ address: contractAddress });

  log.push({
    block: receipt.blockNumber.toString(),
    timestamp: block.timestamp.toString(),
    from: contractAddress,
    to: recipient,
    action: "owner_withdraw_all",
    amount_eth: formatEther(totalBalance),
    contract_balance_eth: formatEther(balanceAfter),
    participant_count: (await laundering.read.getDepositorCount()).toString()
  });

  console.log(`  [Block ${receipt.blockNumber}] 집계 인출 ${formatEther(totalBalance)} ETH → ${recipient}`);
  console.log(`  ⚠ 탐지 신호: ${wallets.length}명 소액 분산 → 단발 대형 인출`);

  // CSV 저장
  const logDir = path.join(__dirname, "../analysis/logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const csv = [
    "block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count",
    ...log.map(e => Object.values(e).join(","))
  ].join("\n");

  fs.writeFileSync(path.join(logDir, "laundering_log.csv"), csv);
  console.log(`\n✅ 로그 저장 완료: analysis/logs/laundering_log.csv`);
  console.log(`   총 ${log.length}개 트랜잭션 기록`);
}

main().catch(console.error);
