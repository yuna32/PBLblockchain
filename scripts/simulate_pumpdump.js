import { network } from "hardhat";
import { parseEther, formatEther } from "viem";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("=== 펌프앤덤프 시뮬레이션 시작 ===\n");

  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const testClient = await viem.getTestClient();
  const [ownerClient, ...walletClients] = await viem.getWalletClients();

  const INSIDER_COUNT   = Math.min(parseInt(process.env.SCENARIO_INSIDER_COUNT)        || 3, Math.floor(walletClients.length / 2));
  const LATECOMER_COUNT = Math.min(parseInt(process.env.SCENARIO_LATECOMER_COUNT)      || 5, walletClients.length - INSIDER_COUNT);
  const DUMP_DELAY      = parseInt(process.env.SCENARIO_DUMP_DELAY_BLOCKS)             || 1;

  const pumpers    = walletClients.slice(0, INSIDER_COUNT);
  const lateComers = walletClients.slice(INSIDER_COUNT, INSIDER_COUNT + LATECOMER_COUNT);

  // Compute insider deposit amounts from ratio if env var is set, else use original defaults
  const LATECOMER_DEPOSIT_ETH = 1.5;
  let INSIDER_DEPOSIT_ETH;
  let INSIDER_DUMP_ETH;

  if (process.env.SCENARIO_INSIDER_DEPOSIT_RATIO) {
    const ratio = Math.min(0.95, Math.max(0.05, parseFloat(process.env.SCENARIO_INSIDER_DEPOSIT_RATIO)));
    const totalLatecomer = LATECOMER_COUNT * LATECOMER_DEPOSIT_ETH;
    const totalInsider   = (ratio / (1 - ratio)) * totalLatecomer;
    INSIDER_DEPOSIT_ETH  = totalInsider / INSIDER_COUNT;
    INSIDER_DUMP_ETH     = (totalInsider + totalLatecomer) / INSIDER_COUNT;
  } else {
    INSIDER_DEPOSIT_ETH = 4.0;
    INSIDER_DUMP_ETH    = (INSIDER_COUNT * 4.0 + LATECOMER_COUNT * LATECOMER_DEPOSIT_ETH) / INSIDER_COUNT;
  }

  console.log(`Owner: ${ownerClient.account.address}`);
  console.log(`내부자(펌퍼): ${pumpers.length}명 | 후발자: ${lateComers.length}명\n`);

  const pumpdump = await viem.deployContract("PumpDump");
  const contractAddress = pumpdump.address;
  console.log(`PumpDump 배포 완료: ${contractAddress}\n`);

  // 내부자 등록
  for (const p of pumpers) {
    await pumpdump.write.addInsider(
      [p.account.address],
      { account: ownerClient.account }
    );
  }
  console.log("내부자 등록 완료\n");

  const log = [];

  // Phase 1: 내부자 대량 입금 (Pump)
  console.log("── Phase 1: 내부자 대량 입금 (Pump) ──");
  for (let i = 0; i < pumpers.length; i++) {
    await testClient.mine({ blocks: 1 });

    const amount = INSIDER_DEPOSIT_ETH.toFixed(3);
    const hash = await pumpdump.write.deposit({
      value: parseEther(amount),
      account: pumpers[i].account
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const balance = await publicClient.getBalance({ address: contractAddress });
    const count = await pumpdump.read.getParticipantCount();

    log.push({
      block: receipt.blockNumber.toString(),
      timestamp: block.timestamp.toString(),
      from: pumpers[i].account.address,
      to: contractAddress,
      action: "deposit",
      amount_eth: amount,
      contract_balance_eth: formatEther(balance),
      participant_count: count.toString()
    });

    console.log(`  [Block ${receipt.blockNumber}] 내부자 ${i+1} 입금 ${amount} ETH | 잔고: ${formatEther(balance)} ETH`);
  }

  // Phase 2: 후발자 입금
  console.log("\n── Phase 2: 후발자 입금 (Late Entry) ──");
  for (let i = 0; i < lateComers.length; i++) {
    await testClient.mine({ blocks: 1 });

    const hash = await pumpdump.write.deposit({
      value: parseEther(LATECOMER_DEPOSIT_ETH.toFixed(1)),
      account: lateComers[i].account
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const balance = await publicClient.getBalance({ address: contractAddress });
    const count = await pumpdump.read.getParticipantCount();

    log.push({
      block: receipt.blockNumber.toString(),
      timestamp: block.timestamp.toString(),
      from: lateComers[i].account.address,
      to: contractAddress,
      action: "deposit",
      amount_eth: LATECOMER_DEPOSIT_ETH.toFixed(1),
      contract_balance_eth: formatEther(balance),
      participant_count: count.toString()
    });

    console.log(`  [Block ${receipt.blockNumber}] 후발자 ${i+1} 입금 ${LATECOMER_DEPOSIT_ETH.toFixed(1)} ETH | 잔고: ${formatEther(balance)} ETH`);
  }

  // Phase 3: 내부자 전략적 인출 (Dump)
  console.log("\n── Phase 3: 내부자 전액 인출 (Dump) ──");
  await testClient.mine({ blocks: DUMP_DELAY });

  for (let i = 0; i < pumpers.length; i++) {
    await testClient.mine({ blocks: 1 });

    const currentBalance = await publicClient.getBalance({ address: contractAddress });
    const dumpAmount = i === pumpers.length - 1
      ? currentBalance  // last insider takes whatever remains
      : parseEther(INSIDER_DUMP_ETH.toFixed(3));
    const safeAmount = dumpAmount > currentBalance ? currentBalance : dumpAmount;

    if (safeAmount === 0n) {
      console.log(`  내부자 ${i+1}: 잔고 소진 (스킵)`);
      continue;
    }
    const balanceBefore = await publicClient.getBalance({ address: contractAddress });
    const hash = await pumpdump.write.insiderWithdraw(
      [safeAmount],
      { account: pumpers[i].account }
    );
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const balanceAfter = await publicClient.getBalance({ address: contractAddress });
    const withdrawn = balanceBefore - balanceAfter;

    log.push({
      block: receipt.blockNumber.toString(),
      timestamp: block.timestamp.toString(),
      from: contractAddress,
      to: pumpers[i].account.address,
      action: "withdraw",
      amount_eth: formatEther(withdrawn),
      contract_balance_eth: formatEther(balanceAfter),
      participant_count: (await pumpdump.read.getParticipantCount()).toString()
    });

    console.log(`  [Block ${receipt.blockNumber}] 내부자 ${i+1} 인출 ${formatEther(withdrawn)} ETH | 잔고: ${formatEther(balanceAfter)} ETH`);
  }

  // Phase 4: 후발자 인출 시도 (피해)
  console.log("\n── Phase 4: 후발자 인출 시도 (피해 발생) ──");
  for (let i = 0; i < lateComers.length; i++) {
    await testClient.mine({ blocks: 1 });

    const balanceBefore = await publicClient.getBalance({ address: contractAddress });
    const hash = await pumpdump.write.withdraw({ account: lateComers[i].account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const balanceAfter = await publicClient.getBalance({ address: contractAddress });
    const withdrawn = balanceBefore - balanceAfter;

    log.push({
      block: receipt.blockNumber.toString(),
      timestamp: block.timestamp.toString(),
      from: contractAddress,
      to: lateComers[i].account.address,
      action: "withdraw",
      amount_eth: formatEther(withdrawn),
      contract_balance_eth: formatEther(balanceAfter),
      participant_count: (await pumpdump.read.getParticipantCount()).toString()
    });

    const status = withdrawn === 0n ? "❌ 0 ETH (전액 손실)" : `${formatEther(withdrawn)} ETH (부분 손실)`;
    console.log(`  [Block ${receipt.blockNumber}] 후발자 ${i+1} 인출: ${status} | 잔고: ${formatEther(balanceAfter)} ETH`);
  }

  // CSV 저장
  const logDir = path.join(__dirname, "../analysis/logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const csv = [
    "block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count",
    ...log.map(e => Object.values(e).join(","))
  ].join("\n");

  fs.writeFileSync(path.join(logDir, "pumpdump_log.csv"), csv);
  console.log(`\n✅ 로그 저장 완료: analysis/logs/pumpdump_log.csv`);
  console.log(`   총 ${log.length}개 트랜잭션 기록`);
}

main().catch(console.error);
