import { network } from "hardhat";
import { parseEther, formatEther } from "viem";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 문자열 시드 → FNV-1a 32비트 해시 → mulberry32. [0, 1) 실수를 돌려주는 함수를 반환한다.
function seededRandom(seed) {
  let h = 0x811c9dc5;
  for (const ch of String(seed)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

  // DEMO_SEED가 있으면 시드 PRNG로 금액을 정해 실행마다 같은 로그를 만든다. 없으면 기존대로 Math.random.
  const random = process.env.DEMO_SEED ? seededRandom(process.env.DEMO_SEED) : Math.random;
  const amounts = Array.from({ length: DEPOSITOR_COUNT }, () =>
    (DEPOSIT_MIN + random() * (DEPOSIT_MAX - DEPOSIT_MIN)).toFixed(2)
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
  // DEMO_LOG_DIR: 시연용 로그 디렉터리. 없으면 analysis/logs.
  const logDir = process.env.DEMO_LOG_DIR
    ? path.resolve(process.env.DEMO_LOG_DIR)
    : path.join(__dirname, "../analysis/logs");
  const logLabel = process.env.DEMO_LOG_DIR ? logDir : "analysis/logs";
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const csv = [
    "block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count",
    ...log.map(e => Object.values(e).join(","))
  ].join("\n");

  fs.writeFileSync(path.join(logDir, "laundering_log.csv"), csv);
  console.log(`\n✅ 로그 저장 완료: ${logLabel}/laundering_log.csv`);
  console.log(`   총 ${log.length}개 트랜잭션 기록`);

  // Phase 3: 수집 지갑 이후 지갑 간 이동 (지갑 레이어 v1 시연용, docs/WALLET_LAYER.md 7절)
  // 위의 laundering_log.csv는 그대로 두고, 이동은 laundering_transfers.csv에 따로 기록한다.
  // WALLET_SCENARIO: positive(기본) | negative | none(Phase 3 생략)
  // 금액은 고정값이라 실행마다 같다. 가스비와 setBalance는 CSV에 기록하지 않는다.
  // 이전 실행의 하류 CSV가 남아 있으면 잘못 읽힐 수 있으므로 먼저 지운다.
  fs.rmSync(path.join(logDir, "laundering_transfers.csv"), { force: true });
  const walletScenario = process.env.WALLET_SCENARIO || "positive";
  if (walletScenario === "none") return;
  if (walletScenario !== "positive" && walletScenario !== "negative") {
    throw new Error(`알 수 없는 WALLET_SCENARIO: ${walletScenario} (positive | negative | none)`);
  }

  console.log(`\n── Phase 3: 수집 지갑 이후 지갑 간 이동 (${walletScenario}) ──`);
  const collector = recipient.toLowerCase();
  const HOP_A    = "0x1a00000000000000000000000000000000000001";
  const HOP_B    = "0x1b00000000000000000000000000000000000002";
  const HOLD_C   = "0x1c00000000000000000000000000000000000003";
  const SERVICE_X = "0x1e00000000000000000000000000000000000004";  // config/services_v1.json에 등록된 거래소 역할 주소

  // 고정 주소는 hardhat 계정이 아니므로 impersonate로 송금 권한을 얻고, 가스용 잔고만 넣는다.
  for (const address of [HOP_A, HOP_B, HOLD_C]) {
    await testClient.impersonateAccount({ address });
    await testClient.setBalance({ address, value: parseEther("0.01") });
  }

  const moves = walletScenario === "positive"
    ? [
        [collector, HOP_A,     "2.00"],
        [collector, HOLD_C,    "1.00"],
        [HOP_A,     HOP_B,     "1.98"],
        [HOP_B,     SERVICE_X, "1.96"]
      ]
    : [
        [collector, SERVICE_X, "3.00"]
      ];

  const transfers = [];
  for (const [from, to, amount] of moves) {
    await testClient.mine({ blocks: 1 });
    const sender = await viem.getWalletClient(from);
    const txHash = await sender.sendTransaction({ to, value: parseEther(amount) });
    const txReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const txBlock = await publicClient.getBlock({ blockNumber: txReceipt.blockNumber });
    transfers.push({
      block: txReceipt.blockNumber.toString(),
      timestamp: txBlock.timestamp.toString(),
      from,
      to,
      amount_eth: amount
    });
    console.log(`  [Block ${txReceipt.blockNumber}] ${from} → ${to} ${amount} ETH`);
  }

  const transfersCsv = [
    "block,timestamp,from,to,amount_eth",
    ...transfers.map(e => Object.values(e).join(","))
  ].join("\n");
  fs.writeFileSync(path.join(logDir, "laundering_transfers.csv"), transfersCsv);
  console.log(`\n하류 이동 저장 완료: ${logLabel}/laundering_transfers.csv (${transfers.length}행)`);
}

main().catch(console.error);
