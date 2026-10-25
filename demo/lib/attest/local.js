// local 백엔드: 로컬 체인에 EAS·SchemaRegistry(demo/chain 사전 빌드)를 배포하고 스키마를 등록한 뒤 attest/read를 제공한다.
// 서명은 노드의 잠금 해제된 기본 계정(eth_accounts[0])으로 한다 — 코드에 키가 없다.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createPublicClient, createWalletClient, decodeEventLog, http, zeroAddress, zeroHash } from "viem";
import { SCHEMA, encodePayload } from "./schema.js";
import { readAttestation } from "./verify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHAIN_DIR = path.resolve(__dirname, "..", "..", "chain");
const artifact = name => JSON.parse(fs.readFileSync(path.join(CHAIN_DIR, `${name}.json`), "utf8"));

function findEvent(abi, logs, eventName) {
  for (const log of logs) {
    try {
      const ev = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (ev.eventName === eventName) return ev;
    } catch {
      // 다른 컨트랙트의 로그
    }
  }
  return null;
}

function localClients(rpcUrl, chainId) {
  const transport = http(rpcUrl, { timeout: 15000, retryCount: 0 });
  const chain = {
    id: chainId, name: "pbl-local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } }
  };
  return { chain, transport, pub: createPublicClient({ chain, transport }) };
}

// 로컬 노드에 EAS·SchemaRegistry를 배포한다(register=false면 스키마 등록 없이). 잠금 해제된 첫 계정으로 서명.
// local 백엔드와, eas-sepolia 코드 경로를 로컬 노드로 시험할 때 쓴다.
export async function deployEasContracts({ rpcUrl, chainId, register = true }) {
  const registryArt = artifact("SchemaRegistry");
  const easArt = artifact("EAS");
  const { chain, transport, pub } = localClients(rpcUrl, chainId);
  const [attester] = await createWalletClient({ chain, transport }).getAddresses();
  if (!attester) throw new Error("노드에 잠금 해제된 계정이 없습니다.");
  const wallet = createWalletClient({ chain, transport, account: attester });
  const wait = hash => pub.waitForTransactionReceipt({ hash, pollingInterval: 50, timeout: 30000 });

  const registryAddress = (await wait(await wallet.deployContract({ abi: registryArt.abi, bytecode: registryArt.bytecode }))).contractAddress;
  const easAddress = (await wait(await wallet.deployContract({ abi: easArt.abi, bytecode: easArt.bytecode, args: [registryAddress] }))).contractAddress;
  let schemaUID = null;
  if (register) {
    const regReceipt = await wait(await wallet.writeContract({
      address: registryAddress, abi: registryArt.abi, functionName: "register", args: [SCHEMA, zeroAddress, true]
    }));
    schemaUID = findEvent(registryArt.abi, regReceipt.logs, "Registered")?.args.uid;
    if (!schemaUID) throw new Error("스키마 등록 이벤트를 찾을 수 없습니다.");
  }
  return { easAddress: easAddress.toLowerCase(), registryAddress: registryAddress.toLowerCase(), schemaUID, attester: attester.toLowerCase(), pub, wallet, easArt, wait };
}

export async function createLocalBackend({ rpcUrl, chainId }) {
  const { easAddress, registryAddress, schemaUID, attester, pub, wallet, easArt, wait } = await deployEasContracts({ rpcUrl, chainId });

  return {
    id: "local",
    available: true,
    mode: "readwrite",
    chainId,
    attester,
    schemaUID,
    easAddress,
    registryAddress,

    async attest(payload) {
      const receipt = await wait(await wallet.writeContract({
        address: easAddress, abi: easArt.abi, functionName: "attest",
        args: [{ schema: schemaUID, data: { recipient: zeroAddress, expirationTime: 0n, revocable: true, refUID: zeroHash, data: encodePayload(payload), value: 0n } }]
      }));
      const ev = findEvent(easArt.abi, receipt.logs, "Attested");
      if (!ev) throw new Error("Attested 이벤트를 찾을 수 없습니다.");
      const block = await pub.getBlock({ blockNumber: receipt.blockNumber });
      return {
        uid: ev.args.uid,
        txHash: receipt.transactionHash,
        backend: "local",
        chainId,
        attester,
        schemaUID,
        contract: easAddress,
        blockNumber: Number(receipt.blockNumber),
        recordedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
        explorerUrl: null,
        payload
      };
    },

    // 없는 uid면 null
    read: uid => readAttestation({ client: pub, easAddress, schemaUID, uid })
  };
}
