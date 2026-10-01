// 메인 흐름(analysis/pipeline.js, ontology/load_instances.py)의 Honeypot fixture
// analysis/logs/honeypot_log.csv(8열)와 같은 시나리오를 재현한다:
//   입금 5 → 출금 시도 3(실패) → 입금 3 → 출금 시도 2(실패), 잔고는 컨트랙트에 묶인 채 끝남.
// 출력은 analysis/logs/honeypot_sim_log.csv — fixture(honeypot_log.csv)는 덮어쓰지 않는다.
import { network } from "hardhat";
import { parseEther, formatEther } from "viem";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// fixture 표기에 맞춘 ETH 문자열 ("5" → "5.0", "0.5" → "0.5")
const ethStr = wei => { const s = formatEther(wei); return s.includes(".") ? s : `${s}.0`; };

async function main() {
  console.log("=== 허니팟 시뮬레이션 시작 ===\n");

  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const testClient = await viem.getTestClient();
  const [ownerClient, ...walletClients] = await viem.getWalletClients();
  const wallets = walletClients.slice(0, 8);

  console.log(`Owner: ${ownerClient.account.address}`);
  console.log(`참여자 수: ${wallets.length}명\n`);

  const honeypot = await viem.deployContract("Honeypot");
  const contractAddress = honeypot.address;
  console.log(`Honeypot 배포 완료: ${contractAddress}\n`);

  const log = [];
  let participants = 0;

  // fixture와 같은 채굴 간격: 배포 직후 블록부터 행마다 2블록씩 (2, 4, 6, …)
  let nextBlock = (await publicClient.getBlockNumber()) + 1n;
  async function mineUntil(target) {
    const n = Number(target - await publicClient.getBlockNumber());
    if (n > 0) await testClient.mine({ blocks: n });
  }

  async function deposit(i) {
    await mineUntil(nextBlock - 1n); // 트랜잭션이 다음 블록(nextBlock)에 담긴다
    nextBlock += 2n;

    const hash = await honeypot.write.deposit({
      value: parseEther("1.0"),
      account: wallets[i].account
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    const balance = await publicClient.getBalance({ address: contractAddress });
    participants++;

    log.push({
      block: receipt.blockNumber.toString(),
      timestamp: block.timestamp.toString(),
      from: wallets[i].account.address,
      to: contractAddress,
      action: "deposit",
      amount_eth: "1.0",
      contract_balance_eth: ethStr(balance),
      participant_count: participants.toString()
    });

    console.log(`  [Block ${receipt.blockNumber}] 입금 1.0 ETH | 잔고: ${ethStr(balance)} ETH`);
  }

  // withdraw()는 require(_withdrawEnabled)로 항상 revert — 실제로 revert되는지 확인한 뒤에만
  // 실패 행(컨트랙트→지갑, amount_eth=0)을 기록한다. 성공하면 시나리오가 깨진 것이므로 중단.
  async function withdrawAttempt(i) {
    await mineUntil(nextBlock);
    nextBlock += 2n;

    const blockNum = await publicClient.getBlockNumber();
    const block = await publicClient.getBlock({ blockNumber: blockNum });
    const balance = await publicClient.getBalance({ address: contractAddress });

    let reason = null;
    try {
      await publicClient.simulateContract({
        address: contractAddress,
        abi: honeypot.abi,
        functionName: "withdraw",
        args: [parseEther("1.0")],
        account: wallets[i].account
      });
    } catch (e) {
      reason = e.shortMessage || e.message;
    }
    if (reason === null) throw new Error(`withdraw()가 성공했다 — 지갑 ${wallets[i].account.address}`);

    log.push({
      block: blockNum.toString(),
      timestamp: block.timestamp.toString(),
      from: contractAddress,
      to: wallets[i].account.address,
      action: "withdraw",
      amount_eth: "0",
      contract_balance_eth: ethStr(balance),
      participant_count: participants.toString()
    });

    console.log(`  [Block ${blockNum}] 출금 시도 실패 지갑: ${wallets[i].account.address.slice(0, 10)}... | 잔고: ${ethStr(balance)} ETH`);
  }

  console.log("── Phase 1: 5명 입금 ──");
  for (const i of [0, 1, 2, 3, 4]) await deposit(i);

  console.log("\n── Phase 2: 먼저 입금한 3명 출금 시도 (실패) ──");
  for (const i of [0, 1, 2]) await withdrawAttempt(i);

  console.log("\n── Phase 3: 출금 실패 이후에도 신규 3명 입금 ──");
  for (const i of [5, 6, 7]) await deposit(i);

  console.log("\n── Phase 4: 나머지 2명 출금 시도 (실패) ──");
  for (const i of [3, 4]) await withdrawAttempt(i);

  // CSV 저장
  const logDir = path.join(__dirname, "../analysis/logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const csv = [
    "block,timestamp,from,to,action,amount_eth,contract_balance_eth,participant_count",
    ...log.map(e => [
      e.block, e.timestamp, e.from, e.to, e.action,
      e.amount_eth, e.contract_balance_eth, e.participant_count
    ].join(","))
  ].join("\n");

  fs.writeFileSync(path.join(logDir, "honeypot_sim_log.csv"), csv + "\n");
  console.log(`\n✅ 로그 저장 완료: analysis/logs/honeypot_sim_log.csv`);
  console.log(`   총 ${log.length}개 행 기록 (입금 8건, 출금 시도 실패 5건)`);
}

main().catch(console.error);
