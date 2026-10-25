// eas-sepolia 백엔드: 설정한 RPC·EAS·SchemaRegistry 주소로 동작하는 일반 EAS 백엔드.
// 기본값은 Sepolia지만 주소와 체인 ID를 바꾸면 로컬 노드에 배포한 EAS로도 같은 코드 경로가 돈다(시험).
//
// - 키(privateKey)는 이 함수의 클로저 안 viem 계정으로만 쓴다. 반환 객체의 속성이나 오류 메시지에 넣지 않는다.
// - 키가 없으면 읽기 전용: attest/register는 backend_read_only, read(조회·검증)는 동작한다.
// - 스키마 UID는 문자열에서 계산하고, 등록은 register()를 사람이 실행할 때만 한다(자동 등록 없음).
// - 기록 전 점검(preflight): 스키마 등록 여부, 잔액 ≥ 예상 수수료. 부족하면 체인에 보내기 전에 insufficient_funds.
// - RPC 연결 오류·시간 초과는 재시도 후 rpc_unavailable. 트랜잭션 전송 자체는 재시도하지 않는다(중복 전송 방지).
import { createPublicClient, createWalletClient, decodeEventLog, formatEther, http, zeroAddress, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EAS_ABI, SCHEMA_REGISTRY_ABI } from "./abi.js";
import { BackendError } from "./errors.js";
import { redact } from "./redact.js";
import { SCHEMA, SCHEMA_RESOLVER, SCHEMA_REVOCABLE, encodePayload, schemaUID as computeSchemaUID } from "./schema.js";
import { readAttestation } from "./verify.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RPC_ERROR_NAMES = new Set(["HttpRequestError", "TimeoutError", "WebSocketRequestError", "SocketClosedError", "AbortError"]);
const NET_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);

// RPC 연결 문제(재시도 대상)인지: viem 오류의 cause 사슬을 따라가며 이름·코드로 판단
export function isRpcError(err) {
  for (let e = err, i = 0; e && i < 12; e = e.cause, i++) {
    if (RPC_ERROR_NAMES.has(e.name) || NET_CODES.has(e.code)) return true;
  }
  return false;
}

function hasErrorNamed(err, name) {
  for (let e = err, i = 0; e && i < 12; e = e.cause, i++) if (e.name === name) return true;
  return false;
}

export const ATTESTATION_PATH = "/attestation/view/";
export const SCHEMA_PATH = "/schema/view/";

// config: lib/attest/config.js easConfigFromEnv()의 값
// tuning: { pollingIntervalMs, receiptTimeoutMs, rpcTimeoutMs, retries, retryDelayMs, feeMargin }
export function createEasBackend(config, tuning = {}) {
  const {
    pollingIntervalMs = 4000, receiptTimeoutMs = 180000, rpcTimeoutMs = 10000,
    retries = 3, retryDelayMs = 500, feeMargin = 1.2
  } = tuning;
  const { rpcUrl, chainId, explorerBase } = config;
  const easAddress = config.easAddress.toLowerCase();
  const registryAddress = config.registryAddress.toLowerCase();
  const secrets = [rpcUrl, config.privateKey];
  const hide = text => redact(text, secrets);
  const short = err => hide(err?.shortMessage ?? err?.message ?? String(err));

  const chain = {
    id: chainId, name: chainId === 11155111 ? "Sepolia" : `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } }
  };
  const transport = http(rpcUrl, { timeout: rpcTimeoutMs, retryCount: 0 });
  const pub = createPublicClient({ chain, transport });
  const account = config.privateKey ? privateKeyToAccount(config.privateKey) : null;
  const wallet = account ? createWalletClient({ chain, transport, account }) : null;
  const schemaUID = computeSchemaUID();
  const attester = account ? account.address.toLowerCase() : null;
  let status = { ok: false, code: "not_checked", reason: "아직 확인하지 않음" };
  let schemaRegistered = null;

  async function withRetry(fn) {
    let last;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err) {
        if (!isRpcError(err)) throw err;
        last = err;
        if (i < retries - 1) await sleep(retryDelayMs * (i + 1));
      }
    }
    throw new BackendError("rpc_unavailable", `RPC에 연결할 수 없습니다 (${retries}번 시도): ${short(last)}`);
  }

  const setStatus = (ok, code = null, reason = null) => { status = { ok, code, reason }; return status; };

  async function isSchemaRegistered() {
    const rec = await withRetry(() => pub.readContract({ address: registryAddress, abi: SCHEMA_REGISTRY_ABI, functionName: "getSchema", args: [schemaUID] }));
    schemaRegistered = Boolean(rec && rec.uid !== zeroHash);
    return schemaRegistered;
  }

  // 연결 점검: 체인 ID, 컨트랙트 코드, 스키마 등록 여부. 실패해도 던지지 않고 상태로 남긴다.
  async function init() {
    try {
      const id = await withRetry(() => pub.getChainId());
      if (id !== chainId) return setStatus(false, "chain_mismatch", `RPC의 체인 ID(${id})가 설정(${chainId})과 다릅니다.`);
      for (const [address, name] of [[easAddress, "EAS"], [registryAddress, "SchemaRegistry"]]) {
        const code = await withRetry(() => pub.getCode({ address }));
        if (!code || code === "0x") return setStatus(false, "contract_not_found", `${name} 컨트랙트 코드가 이 체인에 없습니다 (${address}).`);
      }
      await isSchemaRegistered();
      return setStatus(true);
    } catch (err) {
      return setStatus(false, err.code ?? "rpc_unavailable", short(err));
    }
  }

  async function ensureReady() {
    if (!status.ok) await init();
    if (!status.ok) throw new BackendError(status.code, status.reason);
  }

  function requireAccount() {
    if (!account) throw new BackendError("backend_read_only", "eas-sepolia는 읽기 전용입니다 (DEMO_EAS_PRIVATE_KEY 없음). 조회와 검증만 할 수 있습니다.");
  }

  async function balance() {
    requireAccount();
    return withRetry(() => pub.getBalance({ address: account.address }));
  }

  async function feePerGas() {
    const fees = await withRetry(() => pub.estimateFeesPerGas());
    return fees.maxFeePerGas ?? fees.gasPrice;
  }

  const withMargin = (gas, fee) => (gas * fee * BigInt(Math.round(feeMargin * 100))) / 100n;

  function attestArgs(payload) {
    return [{ schema: schemaUID, data: { recipient: zeroAddress, expirationTime: 0n, revocable: SCHEMA_REVOCABLE, refUID: zeroHash, data: encodePayload(payload), value: 0n } }];
  }

  // 예상 수수료 (가스 × maxFeePerGas × 여유분)
  async function estimateCost(fn) {
    let gas;
    try {
      gas = await withRetry(fn);
    } catch (err) {
      if (hasErrorNamed(err, "InsufficientFundsError")) throw new BackendError("insufficient_funds", "잔액이 부족해 가스를 추정할 수 없습니다.");
      throw err;
    }
    const fee = await feePerGas();
    return { gas, feePerGas: fee, cost: withMargin(gas, fee) };
  }

  const estimateAttestCost = payload => estimateCost(() => pub.estimateContractGas({
    account, address: easAddress, abi: EAS_ABI, functionName: "attest", args: attestArgs(payload)
  }));
  const estimateRegisterCost = () => estimateCost(() => pub.estimateContractGas({
    account, address: registryAddress, abi: SCHEMA_REGISTRY_ABI, functionName: "register", args: [SCHEMA, SCHEMA_RESOLVER, SCHEMA_REVOCABLE]
  }));

  async function requireFunds(costFn) {
    const bal = await balance();
    if (bal === 0n) throw new BackendError("insufficient_funds", `계정 잔액이 0 ETH입니다 (${attester}). 테스트 ETH를 받은 뒤 다시 시도하세요.`);
    const est = await costFn();
    if (bal < est.cost) {
      throw new BackendError("insufficient_funds", `잔액 부족: 필요 약 ${formatEther(est.cost)} ETH, 현재 ${formatEther(bal)} ETH (${attester}).`);
    }
    return { balance: bal, ...est };
  }

  // 기록 전 점검. 통과하면 { balance, gas, feePerGas, cost }
  async function preflight(payload) {
    requireAccount();
    await ensureReady();
    if (!(await isSchemaRegistered())) {
      throw new BackendError("schema_not_registered", `스키마가 레지스트리에 등록되지 않았습니다 (${schemaUID}). npm run demo:eas:register로 먼저 등록하세요.`);
    }
    return requireFunds(() => estimateAttestCost(payload));
  }

  // 보내고 영수증을 기다린다. 전송은 재시도하지 않는다.
  async function sendAndWait(write) {
    let hash;
    try {
      hash = await write();
    } catch (err) {
      if (hasErrorNamed(err, "InsufficientFundsError")) throw new BackendError("insufficient_funds", "잔액이 부족해 트랜잭션을 보내지 못했습니다.");
      if (isRpcError(err)) throw new BackendError("rpc_unavailable", `트랜잭션을 보내지 못했습니다: ${short(err)}`);
      throw new BackendError("tx_failed", `트랜잭션을 보내지 못했습니다: ${short(err)}`);
    }
    let receipt;
    try {
      receipt = await withRetry(() => pub.waitForTransactionReceipt({ hash, pollingInterval: pollingIntervalMs, timeout: receiptTimeoutMs }));
    } catch (err) {
      if (err instanceof BackendError) throw err;
      throw new BackendError("tx_unconfirmed", `트랜잭션을 보냈지만 확인되지 않았습니다 (tx ${hash}): ${short(err)}`);
    }
    if (receipt.status !== "success") throw new BackendError("tx_reverted", `트랜잭션이 실패했습니다 (tx ${hash}).`);
    return receipt;
  }

  function findEvent(abi, logs, address, eventName) {
    for (const log of logs) {
      if (log.address.toLowerCase() !== address) continue;
      try {
        const ev = decodeEventLog({ abi, data: log.data, topics: log.topics });
        if (ev.eventName === eventName) return ev;
      } catch {
        // 다른 이벤트
      }
    }
    return null;
  }

  const explorerUrl = uid => `${explorerBase}${ATTESTATION_PATH}${uid}`;
  const schemaUrl = () => `${explorerBase}${SCHEMA_PATH}${schemaUID}`;
  // 탐색기 attestation 경로는 문서로 확인하지 못했다(추정). 스키마 경로는 문서 확인.
  const meta = () => ({ explorerUrlVerified: false, schemaUrl: schemaUrl() });

  return {
    id: "eas-sepolia",
    available: true,
    get mode() { return account ? "readwrite" : "readonly"; },
    chainId,
    easAddress,
    registryAddress,
    explorerBase,
    schemaUID,
    attester,
    get status() { return status; },
    get schemaRegistered() { return schemaRegistered; },

    init,
    preflight,
    isSchemaRegistered,
    balance,
    estimateAttestCost,
    estimateRegisterCost,
    explorerUrl,
    schemaUrl,
    meta,
    redact: hide,

    async attest(payload) {
      await preflight(payload);
      const receipt = await sendAndWait(() => wallet.writeContract({
        account, chain, address: easAddress, abi: EAS_ABI, functionName: "attest", args: attestArgs(payload)
      }));
      const ev = findEvent(EAS_ABI, receipt.logs, easAddress, "Attested");
      if (!ev) throw new BackendError("tx_failed", `Attested 이벤트를 찾을 수 없습니다 (tx ${receipt.transactionHash}).`);
      const block = await withRetry(() => pub.getBlock({ blockNumber: receipt.blockNumber }));
      return {
        uid: ev.args.uid,
        txHash: receipt.transactionHash,
        backend: "eas-sepolia",
        chainId,
        attester,
        schemaUID,
        contract: easAddress,
        blockNumber: Number(receipt.blockNumber),
        recordedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
        explorerUrl: explorerUrl(ev.args.uid),
        meta: meta(),
        payload
      };
    },

    // 스키마 등록 (사람이 실행하는 스크립트에서만). 이미 있으면 보내지 않는다.
    async register() {
      requireAccount();
      await ensureReady();
      if (await isSchemaRegistered()) return { schemaUID, alreadyRegistered: true, txHash: null };
      await requireFunds(estimateRegisterCost);
      const receipt = await sendAndWait(() => wallet.writeContract({
        account, chain, address: registryAddress, abi: SCHEMA_REGISTRY_ABI, functionName: "register", args: [SCHEMA, SCHEMA_RESOLVER, SCHEMA_REVOCABLE]
      }));
      const ev = findEvent(SCHEMA_REGISTRY_ABI, receipt.logs, registryAddress, "Registered");
      if (!ev || ev.args.uid !== schemaUID) throw new BackendError("tx_failed", "등록 이벤트의 스키마 UID가 계산한 값과 다릅니다.");
      schemaRegistered = true;
      return { schemaUID, alreadyRegistered: false, txHash: receipt.transactionHash };
    },

    // 점검 스크립트용: 단계별 결과 (던지지 않음)
    async probe() {
      const r = { rpc: false, chainId: null, chainMatch: null, easCode: null, registryCode: null, schemaRegistered: null, balance: null, error: null };
      try {
        r.chainId = await withRetry(() => pub.getChainId());
        r.rpc = true;
        r.chainMatch = r.chainId === chainId;
        if (!r.chainMatch) return r;
        const code = async address => { const c = await withRetry(() => pub.getCode({ address })); return Boolean(c && c !== "0x"); };
        r.easCode = await code(easAddress);
        r.registryCode = await code(registryAddress);
        if (r.registryCode) r.schemaRegistered = await isSchemaRegistered();
        if (account) r.balance = await balance();
        if (r.easCode && r.registryCode) setStatus(true);
      } catch (err) {
        r.error = short(err);
      }
      return r;
    },

    async read(uid) {
      await ensureReady();
      return withRetry(() => readAttestation({ client: pub, easAddress, schemaUID, uid }));
    },

    // GET /api/attest/backends 항목
    describe() {
      return {
        mode: account ? "readwrite" : "readonly",
        chainId,
        explorerBase,
        explorerUrlVerified: false,
        schemaUID,
        schemaRegistered,
        attester,
        ...(status.ok ? {} : { reason: status.reason, reasonCode: status.code })
      };
    }
  };
}
