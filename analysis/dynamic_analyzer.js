import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEPOSIT_ACTIONS   = new Set(["deposit", "stake", "fund_reward_pool"]);
const WITHDRAW_ACTIONS  = new Set(["withdraw", "unstake", "owner_withdraw_all"]);
const HIGH_RISK_ACTIONS = new Set(["owner_withdraw_all"]);

// HopLaundering bothSides 판정에서 제외할 범용 DEX 라우터/애그리게이터.
// EthereumHeist 파일럿(n=8, evaluation/hoplaundering/)에서 BELLE Honeypot Rug Pull
// 케이스의 bothSides 3개 중 2개가 아래 주소로 확인됨 — 활성 지갑이면 거의 누구나
// 상호작용하는 범용 인프라라 "양방향 주소"로 잡히는 게 세탁 의도가 아니라 정상
// 스왑의 부산물일 가능성이 큼. 범위는 이번에 실증된 주소로 한정(과확장 방지) —
// 새 주소 추가 시 실제로 bothSides에 걸린 사례를 근거로만 추가할 것.
const DEX_WHITELIST = new Set([
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", // Uniswap V2: Router 2
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff", // 0x: Exchange Proxy
]);

// ── 러그풀 교차공리 (2026-11, 팀 간소화안 반영) ─────────────────────────────────
// 원금을 넘는 돈을 한쪽이 몰아 가져가면 러그풀, 여러 참여자가 나눠 가지면 폰지.
//   RugPull ← Contract ∧ HasFlow ∧ ¬T ∧ NetDrain ∧ ¬SharedProfit
//   NetDrain     ≡ Σ_a max(0, received(a) − deposited(a)) ≥ netDrain × peak
//   SharedProfit ≡ |{a : deposited(a) > 0 ∧ received(a) ≥ profitRatio × deposited(a)}| ≥ profitSharers
//   T(반복 중계) ≡ 성공 출금(금액 > 0) ≥ passThroughMinWithdrawals건이고, 그중 직전 입금과 같은 금액
//                 (차이 ≤ passThroughAmountToleranceEth)인 건이 passThroughMatchShare 비율을 넘음
// 적용 범위(Contract ∧ HasFlow ∧ ¬T, 그리고 지갑별 장부가 있을 것) 밖이면 "정상"이 아니라
// "이 장부로는 판단할 수 없음"이다(scope.reason). 판정 체인의 다른 유형은 그대로 평가한다.
// 이 값은 이 파일 한 곳에서만 정한다. demo/lib는 import해 쓰고, 대시보드는 리포트의
// rugpull_axiom.thresholds를 읽는다. 기준값은 시뮬레이션 기준 측정값이다
// (NetDrain 70~85%에서 판정 불변, 90%에서 evasive_B·C가 바뀜. 실데이터 검증 없음).
export const RUGPULL_AXIOM = Object.freeze({
  version: 1,
  netDrain: 0.7,
  profitRatio: 1.05,
  profitSharers: 2,
  passThroughMinWithdrawals: 5,
  passThroughMatchShare: 0.5,
  passThroughAmountToleranceEth: 1e-9
});

// 금액 비교는 부동소수점 대신 wei 정수(BigInt)로 한다. 경계(정확히 70%, 정확히 105%)가
// 반올림 오차로 뒤집히지 않게 하기 위해서다. 파싱 규칙은 parseFloat(x) || 0과 같게
// 숫자로 읽을 수 없으면 0으로 본다. 소수 18자리 밑은 버린다.
const WEI_PER_ETH = 10n ** 18n;
function toWei(x) {
  let s = String(x ?? "").trim();
  if (/e/i.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return 0n;
    s = n.toFixed(18);
  }
  const m = /^([+-]?)(\d*)(?:\.(\d*))?/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return 0n;
  const frac = ((m[3] ?? "") + "0".repeat(18)).slice(0, 18);
  const v = BigInt(m[2] || "0") * WEI_PER_ETH + BigInt(frac);
  return m[1] === "-" ? -v : v;
}
function weiToNumber(v) {
  const neg = v < 0n, a = neg ? -v : v;
  const frac = (a % WEI_PER_ETH).toString().padStart(18, "0").replace(/0+$/, "");
  return Number(`${neg ? "-" : ""}${a / WEI_PER_ETH}${frac ? "." + frac : ""}`);
}
// 상수(소수 표기) → 분수. 0.7 → 7/10, 1.05 → 105/100
function toFraction(x) {
  const [i, f = ""] = String(x).split(".");
  return { num: BigInt(i + f), den: 10n ** BigInt(f.length) };
}
const roundTo = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// 러그풀 축 평가. ledger: "per_wallet"(기본, 주소별 거래 로그) | "aggregated"(블록 집계를
// 합성 주소로 펼친 N=272 같은 입력 — 주소가 실제 지갑이 아니므로 범위 밖, 판정 체인은 옛 술어 유지).
// isContract: 호출자가 알면 넘긴다. 없으면 컨트랙트로 가정한다(isContractSource "assumed").
export function computeRugPullAxiom(rows, opts = {}) {
  const A = RUGPULL_AXIOM;
  const ledger = opts.ledger === "aggregated" ? "aggregated" : "per_wallet";
  const isContract = opts.isContract !== false;
  const isContractSource = typeof opts.isContract === "boolean" ? "input" : "assumed";
  const tol = toWei(A.passThroughAmountToleranceEth);

  const dep = new Map(), rec = new Map(), order = [];
  const touch = a => { if (!dep.has(a)) { dep.set(a, 0n); rec.set(a, 0n); order.push(a); } };
  let peak = 0n, nDep = 0, nWd = 0, matched = 0, lastDep = null;
  for (const r of rows) {
    const amt = toWei(r.amount_eth), bal = toWei(r.contract_balance_eth);
    if (bal > peak) peak = bal;
    if (DEPOSIT_ACTIONS.has(r.action)) {
      const a = String(r.from ?? "").toLowerCase();
      touch(a); dep.set(a, dep.get(a) + amt);
      if (amt > 0n) { nDep++; lastDep = amt; }
    } else if (WITHDRAW_ACTIONS.has(r.action)) {
      const a = String(r.to ?? "").toLowerCase();
      touch(a); rec.set(a, rec.get(a) + amt);
      if (amt > 0n) {
        nWd++;
        if (lastDep !== null) { const d = amt - lastDep; if ((d < 0n ? -d : d) <= tol) matched++; }
      }
    }
  }

  const share = toFraction(A.passThroughMatchShare);
  const hasFlow = nDep > 0 && nWd > 0;
  const passThrough = nWd >= A.passThroughMinWithdrawals && BigInt(matched) * share.den > BigInt(nWd) * share.num;
  const reason = !isContract ? "eoa"
    : ledger === "aggregated" ? "no_wallet_ledger"
    : !hasFlow ? "no_flow"
    : passThrough ? "pass_through"
    : null;
  const scope = { isContract, isContractSource, ledger, hasFlow, passThrough,
                  passThroughDetail: { withdrawals: nWd, matched }, inScope: reason === null, reason };
  const thresholds = {
    netDrain: A.netDrain, profitRatio: A.profitRatio, profitSharers: A.profitSharers,
    passThroughMinWithdrawals: A.passThroughMinWithdrawals, passThroughMatchShare: A.passThroughMatchShare
  };

  if (ledger === "aggregated") {
    return {
      version: A.version, thresholds, scope,
      netDrain: { value: null, netOutflowEth: null, peakBalanceEth: weiToNumber(peak), threshold: A.netDrain, met: false },
      sharedProfit: { count: null, threshold: A.profitSharers, met: false, wallets: [] },
      wallets: [],
      verdict: false
    };
  }

  const nd = toFraction(A.netDrain), pr = toFraction(A.profitRatio);
  let netOut = 0n;
  const wallets = order.map(address => {
    const d = dep.get(address), r = rec.get(address);
    const gain = r - d;
    if (gain > 0n) netOut += gain;
    return {
      address, deposited: weiToNumber(d), received: weiToNumber(r), netGain: weiToNumber(gain),
      drainContributor: gain > 0n,
      profitSharer: d > 0n && r * pr.den >= d * pr.num
    };
  });
  const sharers = wallets.filter(w => w.profitSharer).map(w => w.address);
  const ndMet = peak > 0n && netOut * nd.den >= peak * nd.num;
  const spMet = sharers.length >= A.profitSharers;
  return {
    version: A.version, thresholds, scope,
    netDrain: {
      value: peak > 0n ? roundTo(weiToNumber(netOut) / weiToNumber(peak), 6) : null,
      netOutflowEth: weiToNumber(netOut), peakBalanceEth: weiToNumber(peak),
      threshold: A.netDrain, met: ndMet
    },
    sharedProfit: { count: sharers.length, threshold: A.profitSharers, met: spMet, wallets: sharers },
    wallets,
    verdict: scope.inScope && ndMet && !spMet
  };
}

function parseCSV(csvPath) {
  if (!fs.existsSync(csvPath)) return [];
  const lines = fs.readFileSync(csvPath, "utf8").trim().split("\n");
  const headers = lines[0].split(",");
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, vals[i]]));
  });
}

function detectContractAddress(rows) {
  const depositRow = rows.find(r => DEPOSIT_ACTIONS.has(r.action));
  return depositRow ? depositRow.to : null;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// EVASION_ANALYSIS.md 권고 2/6/7 적용 후 신설/변경되는 "얼마나/언제" 계열 규칙
// (BALANCE_DROP, FLOW_SPIKE, TEMPORAL_PATTERN, BALANCE_TIMESERIES_DRAIN)의 공용
// 억제 게이트. 기존에는 detectInflowStop() 내부에만 지역적으로 존재하던
// isNormalUnstake 판정을 이 함수로 추출·확장했다 — 단일 로직으로 통합해
// 두 군데서 조건이 미묘하게 갈리는 것을 방지한다.
//
// 확장한 조건 (기존: uniqueWithdrawers>=3, 금액 균등, 성공률>=80%):
//   - HIGH_RISK_ACTIONS(owner_withdraw_all)가 전혀 없을 것
//   - 출금액의 90% 이상이 원래 예치자 본인에게 돌아갈 것 (자금이 시스템 밖으로
//     나가지 않고 예치자에게 환급되는 패턴인지 확인)
//   - 금액 균등 조건의 경계값을 매우 근소한 차이로 비켜가는 것을 막기 위해
//     strict(<) 대신 <=로 완화 (flashloan_log에서 maxW(20)가 minW(8)*2.5와
//     정확히 같아 strict 비교로는 조직적 패턴이 누락되는 경계 버그 발견·수정)
function computeIsOrganicUnstake(rows, depositorMap, totalOut) {
  const withdrawals = rows.filter(r => WITHDRAW_ACTIONS.has(r.action));
  if (withdrawals.length === 0) return false;
  if (rows.some(r => HIGH_RISK_ACTIONS.has(r.action))) return false;

  const uniqueWithdrawers = new Set(withdrawals.map(r => r.to)).size;
  if (uniqueWithdrawers < 3) return false;

  const withdrawAmounts = withdrawals.map(r => parseFloat(r.amount_eth) || 0).filter(a => a > 0);
  if (withdrawAmounts.length === 0) return false;
  const successRatio = withdrawAmounts.length / withdrawals.length;
  if (successRatio < 0.8) return false;

  const maxW = Math.max(...withdrawAmounts);
  const minW = Math.min(...withdrawAmounts);
  if (maxW > minW * 2.5) return false;

  if (totalOut < 0.01) return false;
  let toDepositors = 0;
  for (const r of withdrawals) {
    if (depositorMap.has(r.to)) toDepositors += parseFloat(r.amount_eth) || 0;
  }
  return (toDepositors / totalOut) >= 0.9;
}

// 권고 7: action 문자열과 무관하게 잔고 시계열만으로 급락 구간을 탐지.
// maxBlockSpan 블록 이내에서 발생한 최대 상대 하락폭을 반환.
function maxWindowedDrawdown(rows, maxBlockSpan) {
  let maxDrop = 0;
  for (let i = 0; i < rows.length; i++) {
    const blockI = parseInt(rows[i].block);
    const balI = parseFloat(rows[i].contract_balance_eth) || 0;
    if (balI <= 0) continue;
    for (let j = i + 1; j < rows.length; j++) {
      const blockJ = parseInt(rows[j].block);
      if (blockJ - blockI > maxBlockSpan) break;
      const balJ = parseFloat(rows[j].contract_balance_eth) || 0;
      const drop = (balI - balJ) / balI;
      if (drop > maxDrop) maxDrop = drop;
    }
  }
  return maxDrop;
}

function checkOscillating(rows) {
  let nearZero = false;
  let recovered = false;
  let cycles = 0;
  for (const row of rows) {
    const bal = parseFloat(row.contract_balance_eth);
    if (bal < 0.01) {
      if (recovered) cycles++;
      nearZero = true;
      recovered = false;
    } else if (nearZero && bal > 0.5) {
      recovered = true;
    }
  }
  return cycles >= 2;
}

const RULES = [
  {
    id: "BALANCE_DROP",
    // EVASION_ANALYSIS.md 권고 2/3: hasOwnerDrain 게이트를 WITHDRAW_ACTIONS 전체로
    // 확장하고, peak*0.1(90%) 바이너리 클리프 대신 (1 - finalBal/peak) 기반 연속
    // 가중치로 전환. 50% 미만 하락은 0점, 100% 하락(완전 탈취)에서 만점.
    description: "출금 발생 후 잔고 급락 — 하락폭에 비례한 연속 점수 (러그풀/폰지 탈출)",
    detect: (ctx) => {
      if (ctx.isOrganicUnstake) return 0;
      const hasWithdrawal = ctx.rows.some(r => WITHDRAW_ACTIONS.has(r.action));
      if (!(ctx.peak > 0 && hasWithdrawal)) return 0;
      const drop = 1 - ctx.finalBal / ctx.peak;
      return clamp((drop - 0.5) / 0.5, 0, 1);
    },
    weight: 40
  },
  {
    id: "FLOW_SPIKE",
    // 권고 1: 단일-최대 출금(maxSingleWithdraw) 대신 누적 유출 비율(totalOut/totalIn)로
    // 교체 — 동일 금액을 여러 건으로 분산 인출해도 정확히 포착됨.
    description: "누적 출금이 총 입금의 50% 이상 (분산 인출 포함, 일거에 자금 흡수)",
    detect: (ctx) => {
      if (ctx.isOrganicUnstake) return false;
      return ctx.totalIn > 0 && (ctx.totalOut / ctx.totalIn) >= 0.5;
    },
    weight: 30
  },
  {
    id: "CONCENTRATION_DRAIN",
    // 권고 4: top3/totalOut >= 0.8 클리프 대신 허핀달-허쉬만 지수(HHI) 기반 연속 점수.
    description: "출금 수령 집중도(HHI) — 소수 지갑에 집중될수록 높은 연속 점수",
    detect: ({ totalOut, recipientMap }) => {
      if (totalOut < 0.01) return 0;
      const hhi = [...recipientMap.values()]
        .map(v => v / totalOut)
        .reduce((s, share) => s + share * share, 0);
      return clamp((hhi - 0.2) / 0.6, 0, 1);
    },
    weight: 35
  },
  {
    id: "PROFIT_EXTRACTION",
    description: "입금 대비 130% 이상 수령한 지갑 존재 (부당 수익 탈취)",
    detect: ({ depositorMap, recipientMap }) => {
      for (const [addr, deposited] of depositorMap.entries()) {
        if (deposited <= 0) continue;
        const received = recipientMap.get(addr) || 0;
        if (received / deposited > 1.3) return true;
      }
      return false;
    },
    weight: 35
  },
  {
    id: "OSCILLATING_BALANCE",
    description: "잔고 0 → 복구 → 0 반복 (플래시론 순환 패턴)",
    detect: ({ rows }) => checkOscillating(rows),
    weight: 30
  },
  {
    id: "TEMPORAL_PATTERN",
    // 권고 6: 시간 지표 신설. (a) 입금 종료 후 출금 시작까지의 대기(dormancy)
    // 구간이 전체 수명의 20%+인 경우, 또는 (b) 출금 구간의 ETH/block 속도가
    // peak 대비 15%+로 급격한 경우 중 더 높은 쪽을 채택.
    description: "입금 종료 후 장기 대기 뒤 인출 또는 급격한 인출 속도 (시간 패턴 이상)",
    detect: (ctx) => {
      if (ctx.isOrganicUnstake) return 0;
      const withdrawals = ctx.rows.filter(r => WITHDRAW_ACTIONS.has(r.action));
      const deposits = ctx.rows.filter(r => DEPOSIT_ACTIONS.has(r.action));
      if (withdrawals.length === 0 || deposits.length === 0) return 0;

      const lastDepositBlock = Math.max(...deposits.map(r => parseInt(r.block)));
      const wBlocks = withdrawals.map(r => parseInt(r.block));
      const firstWithdrawBlock = Math.min(...wBlocks);
      const lastWithdrawBlock = Math.max(...wBlocks);
      const firstBlock = parseInt(ctx.rows[0].block);
      const lastBlock = parseInt(ctx.rows[ctx.rows.length - 1].block);
      const totalBlocks = Math.max(1, lastBlock - firstBlock);

      const gapRatio = Math.max(0, firstWithdrawBlock - lastDepositBlock) / totalBlocks;
      const withdrawSpan = Math.max(1, lastWithdrawBlock - firstWithdrawBlock);
      const velocityRatio = ctx.peak > 0 ? (ctx.totalOut / withdrawSpan) / ctx.peak : 0;

      const fractionDormancy = clamp((gapRatio - 0.2) / 0.3, 0, 1);
      const fractionVelocity = clamp((velocityRatio - 0.15) / 0.35, 0, 1);
      return Math.max(fractionDormancy, fractionVelocity);
    },
    weight: 20
  },
  {
    id: "BALANCE_TIMESERIES_DRAIN",
    // 권고 7: action 문자열과 무관하게 잔고 시계열만으로 급락 탐지 (안전망 규칙).
    // 15블록 이내 구간에서 50% 이상 상대 하락이 있으면 연속 점수 부여.
    description: "action 종류와 무관하게 15블록 이내 잔고 50%+ 급락 탐지",
    detect: (ctx) => {
      if (ctx.isOrganicUnstake) return 0;
      const maxDrop = maxWindowedDrawdown(ctx.rows, 15);
      return clamp((maxDrop - 0.5) / 0.4, 0, 1);
    },
    weight: 20
  }
];

const VERDICT_THRESHOLDS = [
  { min: 65, label: "HIGH_RISK" },
  { min: 25, label: "MEDIUM_RISK" },
  { min: 0,  label: "LOW_RISK" }
];

// ── Cross-type disambiguation ─────────────────────────────────────────────────

function hintFraudType(rows, triggered, rugAxis) {
  const ids = new Set(triggered.map(r => r.id));
  const steps = [];

  const deposits    = rows.filter(r => DEPOSIT_ACTIONS.has(r.action));
  const withdrawals = rows.filter(r => WITHDRAW_ACTIONS.has(r.action));

  const peak = Math.max(0, ...rows.map(r => parseFloat(r.contract_balance_eth) || 0));
  const maxSingleWithdraw = Math.max(0, ...withdrawals.map(r => parseFloat(r.amount_eth) || 0));

  // Shared pre-computed conditions
  const depositFromAddrs    = new Set(deposits.map(r => r.from));
  const uniqueDepositorCount = depositFromAddrs.size;

  // singleLargeOutflow: largest withdrawal >= 70% of peak balance
  const singleLargeOutflow = peak > 0 && maxSingleWithdraw >= peak * 0.70;
  steps.push(
    `singleLargeOutflow: ${singleLargeOutflow}` +
    ` (${maxSingleWithdraw.toFixed(3)} / peak ${peak.toFixed(3)} = ` +
    `${peak > 0 ? (maxSingleWithdraw / peak * 100).toFixed(0) : 0}%)`
  );

  // distributedInflow: >= 5 unique depositor addresses
  const distributedInflow = uniqueDepositorCount >= 5;
  steps.push(`distributedInflow: ${distributedInflow} (${uniqueDepositorCount} unique depositors)`);

  // ownerWithdrawAll: recipient of the largest withdrawal is NOT a known depositor
  // (the deployer/owner never participated as a depositor)
  const largestW = withdrawals.reduce((best, r) => {
    return (parseFloat(r.amount_eth) || 0) > (parseFloat(best?.amount_eth) || 0) ? r : best;
  }, null);
  const ownerWithdrawAll = largestW ? !depositFromAddrs.has(largestW.to) : false;
  steps.push(
    `ownerWithdrawAll: ${ownerWithdrawAll}` +
    ` (recipient ${largestW?.to?.slice(0, 10) ?? "n/a"}... ` +
    `${ownerWithdrawAll ? "not in" : "found in"} depositor list)`
  );

  // participantMidExit: non-owner-withdraw withdrawals with amount > 0 before last block
  const lastBlock = parseInt(rows[rows.length - 1]?.block) || 0;
  const midExits  = withdrawals.filter(r =>
    r.action !== "owner_withdraw_all" &&
    (parseFloat(r.amount_eth) || 0) > 0 &&
    parseInt(r.block) < lastBlock
  );
  const participantMidExit = midExits.length > 0;
  steps.push(`participantMidExit: ${participantMidExit} (${midExits.length} mid-exit withdrawals)`);

  // pump-and-dump conditions
  const someWithdrawalsSucceed = withdrawals.some(r => (parseFloat(r.amount_eth) || 0) > 0);
  const someWithdrawalsFail    = withdrawals.some(r => (parseFloat(r.amount_eth) || 0) === 0);

  // depositor amount map for insider-exit check
  const depositorAmtMap = new Map();
  for (const r of deposits) {
    depositorAmtMap.set(r.from, (depositorAmtMap.get(r.from) || 0) + (parseFloat(r.amount_eth) || 0));
  }
  const insiderExitDetected = withdrawals.some(r => {
    const received = parseFloat(r.amount_eth) || 0;
    if (received === 0) return false;
    const deposited = depositorAmtMap.get(r.to) || 0;
    return received > deposited;
  });

  // ── 출금 차단 경고(ZeroWithdrawBlock)·PumpAndDump 판정용 데이터 속성 ──
  // 오너 판별 1안: 배포자/ownerClient 주소를 상수로 식별한다.
  // scripts/simulate_*.js가 공통으로 hardhat 기본 니모닉의 계정 0을
  // ownerClient로 사용하므로(예: ponzi_log.csv의 owner_withdraw_all 수신자와 동일
  // 주소) 이 주소는 시뮬레이션 전반에서 고정값이다.
  const OWNER_ADDRESS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

  // 출금 차단 경고(오너 외 출금이 거의 전부 실패) 판정 임계값. "거의 없음"을 5%로 잡은 근거는
  // 아직 실증 데이터 기반 튜닝이 아니라 잠정값이다 — 실제 사례가 쌓이면 재검토.
  const NON_PRIVILEGED_SUCCESS_EPSILON = 0.05;

  // PumpAndDump 판정용 "실패 시점 잔고 ≈ 0" 임계값.
  // TODO(ε 미정): 지금은 임의의 0.01 ETH 같은 숫자를 넣지 않고 엄격한 0
  // 비교만 적용한다 — 실제 PumpDump 시뮬레이션(analysis/logs/pumpdump_log.csv)의
  // balanceAtFailure는 정확히 0이라 이 값으로는 영향 없음. SelectiveTrap의
  // balanceAtFailure(예: 9.0 ETH)와는 이미 크게 벌어져 있어 엡실론을 늦게
  // 정해도 당장 오분류로 이어지지 않는다. 부동소수점 반올림 오차가 있는
  // 실데이터가 들어오면 이 값을 다시 정해야 한다.
  const PUMPDUMP_BALANCE_AT_FAILURE_EPSILON = 0; // TODO: 실증 데이터로 확정 필요

  const withdrawSuccessRate = withdrawals.length > 0
    ? withdrawals.filter(r => (parseFloat(r.amount_eth) || 0) > 0).length / withdrawals.length
    : 0;

  const nonPrivilegedWithdrawals = withdrawals.filter(
    r => (r.to || "").toLowerCase() !== OWNER_ADDRESS
  );
  const nonPrivilegedSuccessRate = nonPrivilegedWithdrawals.length > 0
    ? nonPrivilegedWithdrawals.filter(r => (parseFloat(r.amount_eth) || 0) > 0).length
        / nonPrivilegedWithdrawals.length
    : 0;

  // balanceAtFailure: someWithdrawalsFail과 동일한 필터(amount_eth === 0인 withdraw 행)에
  // contract_balance_eth 필드만 얹는다 — "실패"를 새로 재정의하지 않는다.
  // 평균이 아닌 최댓값을 채택: 오너가 일부만 먼저 인출하고 실패 시점들이 드레인
  // 전/후에 걸쳐 섞이면 평균은 드레인 이후의 낮은 잔고 쪽으로 끌려 내려가 "실패
  // 시점에도 자금이 남아있었다"는 증거가 희석된다. 최댓값은 단 한 번의 실패라도
  // 잔고가 유의미하게 남아있었다는 사실을 보존해 PumpDump(=항상 0)와 더 선명하게
  // 갈린다.
  const failedWithdrawBalances = withdrawals
    .filter(r => (parseFloat(r.amount_eth) || 0) === 0)
    .map(r => parseFloat(r.contract_balance_eth) || 0);
  const balanceAtFailure = failedWithdrawBalances.length > 0
    ? Math.max(...failedWithdrawBalances)
    : 0;

  steps.push(
    `withdrawSuccessRate: ${(withdrawSuccessRate * 100).toFixed(1)}% ` +
    `(${withdrawals.filter(r => (parseFloat(r.amount_eth) || 0) > 0).length}/${withdrawals.length} succeeded)`
  );
  steps.push(
    `nonPrivilegedSuccessRate: ${(nonPrivilegedSuccessRate * 100).toFixed(1)}% ` +
    `(owner ${OWNER_ADDRESS.slice(0, 10)}... 제외 ${nonPrivilegedWithdrawals.length}건 중 성공)`
  );
  steps.push(
    `balanceAtFailure: ${balanceAtFailure.toFixed(3)} ETH ` +
    `(amount_eth=0 시점 잔고 최댓값, n=${failedWithdrawBalances.length})`
  );

  // ── 출금 차단 신호 ZeroWithdrawBlock (2026-10, 허니팟 사기 유형 삭제) ──
  // 기존 honeypot 분기 조건에서 inflowContinues만 뺀 것: 오너 외 출금 시도가 있고, 그 성공률이
  // ε 이하이며, 실패 시점에도 잔고가 남아 있음. 오너만 인출하는 선택적 차단도 걸린다.
  // nonPrivilegedWithdrawals.length>0 가드: 비-오너 출금 시도가 한 건도 없으면(증거 부재)
  // nonPrivilegedSuccessRate가 0/0→0으로 계산돼 근거 없이 경고가 나지 않게 한다.
  // 사기 유형이 아니라 경고 신호다 — 아래 사기 조건이 모두 불일치일 때만 unclassified_warning을
  // 내고(Normal 대신), dynamic_risk_score에는 더하지 않는다.
  // 분류 체인과 무관하게 항상 계산해 withdraw_block_warning으로 병기한다(유형이 확정돼도 출력, b안).
  const zeroWithdrawBlock =
    nonPrivilegedWithdrawals.length > 0 &&
    nonPrivilegedSuccessRate <= NON_PRIVILEGED_SUCCESS_EPSILON &&
    balanceAtFailure > 0;
  const withdrawBlockWarning = {
    detected: zeroWithdrawBlock,
    reason: nonPrivilegedWithdrawals.length === 0
      ? "비오너 출금 시도 없음"
      : `비오너 출금 ${nonPrivilegedWithdrawals.length}건 중 성공률 ` +
        `${(nonPrivilegedSuccessRate * 100).toFixed(1)}% ` +
        `${nonPrivilegedSuccessRate <= NON_PRIVILEGED_SUCCESS_EPSILON ? "<=" : ">"} ` +
        `${(NON_PRIVILEGED_SUCCESS_EPSILON * 100).toFixed(0)}%, ` +
        `실패 시점 잔고 ${balanceAtFailure.toFixed(3)} ETH${balanceAtFailure > 0 ? " > 0" : ""}`
  };

  // ── 러그풀 축 (RUGPULL_AXIOM) ──
  // 지갑별 장부(per_wallet)에서는 교차공리 판정(rugAxis.verdict)을 쓴다.
  // 집계 장부(aggregated, N=272)는 주소가 합성값이라 공리를 평가할 수 없어(scope.reason
  // no_wallet_ledger) 옛 술어를 그대로 쓰고, 판단 과정 줄도 늘리지 않는다(N=272 산출물 불변).
  const aggregatedLedger = rugAxis.scope.ledger === "aggregated";
  const legacyRugPull = singleLargeOutflow && ownerWithdrawAll && !participantMidExit;
  if (!aggregatedLedger) {
    const sc = rugAxis.scope, nd = rugAxis.netDrain, sp = rugAxis.sharedProfit;
    steps.push(
      `rugpullScope: ${sc.inScope}` +
      ` (reason ${sc.reason ?? "none"}, contract ${sc.isContract ? sc.isContractSource : "no"}, ` +
      `hasFlow ${sc.hasFlow}, passThrough ${sc.passThrough} ${sc.passThroughDetail.matched}/${sc.passThroughDetail.withdrawals})`
    );
    steps.push(
      `netDrain: ${nd.met}` +
      ` (${nd.netOutflowEth.toFixed(3)} / peak ${nd.peakBalanceEth.toFixed(3)} = ` +
      `${nd.value === null ? 0 : (nd.value * 100).toFixed(1)}%, threshold ${(nd.threshold * 100).toFixed(0)}%)`
    );
    steps.push(
      `sharedProfit: ${sp.met}` +
      ` (${sp.count} wallets received >= ${(RUGPULL_AXIOM.profitRatio * 100).toFixed(0)}% of deposit, threshold ${sp.threshold})`
    );
  }
  const rugPull = aggregatedLedger ? legacyRugPull : rugAxis.verdict;

  // ── Priority 1: Flash Loan ──
  if (ids.has("OSCILLATING_BALANCE")) {
    steps.push("→ flash_loan (OSCILLATING_BALANCE signal)");
    return { hint: "flash_loan", reasoning_steps: steps,
             withdrawSuccessRate, nonPrivilegedSuccessRate, balanceAtFailure, withdrawBlockWarning };
  }

  // ── Priority 2: PumpAndDump ──
  // balanceAtFailure ≈ 0 조건을 추가로 요구한다(엡실론 값 자체는 위 TODO 참고,
  // 지금은 엄격한 0 비교). 오너만 인출하고 잔고가 남은 채 나머지 출금이 실패하는
  // 경우(balanceAtFailure > 0)는 이 조건으로 PumpAndDump에서 빠지고, 다른 사기 조건도
  // 불일치이면 아래 출금 차단 경고로 간다.
  if (someWithdrawalsSucceed && someWithdrawalsFail && insiderExitDetected &&
      balanceAtFailure <= PUMPDUMP_BALANCE_AT_FAILURE_EPSILON) {
    steps.push(
      "→ pump_and_dump (mixed withdrawal outcomes + insider profit extraction, " +
      `balanceAtFailure ${balanceAtFailure.toFixed(3)} ETH <= ε)`
    );
    return { hint: "pump_and_dump", reasoning_steps: steps,
             withdrawSuccessRate, nonPrivilegedSuccessRate, balanceAtFailure, withdrawBlockWarning };
  }

  // ── Priority 3: MoneyLaundering ──
  // Single large outflow + distributed inflow + recipient IS a known depositor
  if (singleLargeOutflow && distributedInflow && !ownerWithdrawAll) {
    steps.push(
      `→ money_laundering (large outflow + ${uniqueDepositorCount} distributed depositors` +
      ` + collector is a known depositor)`
    );
    return { hint: "money_laundering", reasoning_steps: steps,
             withdrawSuccessRate, nonPrivilegedSuccessRate, balanceAtFailure, withdrawBlockWarning };
  }

  // ── Priority 4: RugPull ──
  // 자금세탁(3순위)과는 장부상 같은 모양일 수 있어 판정 순서로 가른다(알려진 한계).
  if (rugPull) {
    steps.push(aggregatedLedger
      ? "→ rug_pull (large outflow to non-depositor address, no participant mid-exits)"
      : `→ rug_pull (rugpull_axiom: in scope, NetDrain ${(rugAxis.netDrain.value * 100).toFixed(1)}% >= ` +
        `${(RUGPULL_AXIOM.netDrain * 100).toFixed(0)}%, profit sharers ${rugAxis.sharedProfit.count} < ${RUGPULL_AXIOM.profitSharers})`);
    return { hint: "rug_pull", reasoning_steps: steps,
             withdrawSuccessRate, nonPrivilegedSuccessRate, balanceAtFailure, withdrawBlockWarning };
  }

  // ── Priority 5: PonziScheme ──
  if (ids.has("BALANCE_DROP") && ids.has("FLOW_SPIKE") && participantMidExit) {
    steps.push(
      `→ ponzi_scheme (balance drop + flow spike + ${midExits.length} participant mid-exits)`
    );
    return { hint: "ponzi_scheme", reasoning_steps: steps,
             withdrawSuccessRate, nonPrivilegedSuccessRate, balanceAtFailure, withdrawBlockWarning };
  }

  // ── Priority 6: 유형 미확정 + 출금 차단 경고 ──
  if (zeroWithdrawBlock) {
    steps.push(
      `→ unclassified_warning: 유형 미확정, 출금 차단 경고 (ZeroWithdrawBlock: ` +
      `nonPrivilegedSuccessRate ${(nonPrivilegedSuccessRate * 100).toFixed(1)}% ` +
      `<= ${(NON_PRIVILEGED_SUCCESS_EPSILON * 100).toFixed(0)}%, ` +
      `balanceAtFailure ${balanceAtFailure.toFixed(3)} ETH > 0, 사기 유형 조건 불일치)`
    );
    return { hint: "unclassified_warning", reasoning_steps: steps,
             withdrawSuccessRate, nonPrivilegedSuccessRate, balanceAtFailure, withdrawBlockWarning };
  }

  // ── Priority 7: Normal (사기 조건 불일치 AND NOT ZeroWithdrawBlock) ──
  if (!zeroWithdrawBlock && rows.some(r => r.action === "stake" || r.action === "unstake")) {
    steps.push("→ normal_staking (stake/unstake pattern, no fraud signals)");
    return { hint: "normal_staking", reasoning_steps: steps,
             withdrawSuccessRate, nonPrivilegedSuccessRate, balanceAtFailure, withdrawBlockWarning };
  }

  steps.push("→ unknown (no rules matched)");
  return { hint: "unknown", reasoning_steps: steps,
           withdrawSuccessRate, nonPrivilegedSuccessRate, balanceAtFailure, withdrawBlockWarning };
}

// ── InflowStop signal ─────────────────────────────────────────────────────────

function detectInflowStop(rows, isOrganicUnstake) {
  const deposits = rows.filter(r => DEPOSIT_ACTIONS.has(r.action));
  if (deposits.length === 0) {
    return { detected: false, stop_ratio: 0, last_deposit_block: null, last_block: null };
  }

  const lastDepositBlock = Math.max(...deposits.map(r => parseInt(r.block) || 0));
  const firstBlock  = parseInt(rows[0]?.block) || 0;
  const lastBlock   = parseInt(rows[rows.length - 1]?.block) || 0;
  const totalBlocks = lastBlock - firstBlock || 1;

  const stopRatio = (lastBlock - lastDepositBlock) / totalBlocks;
  const balanceAfterStop = rows
    .filter(r => parseInt(r.block) > lastDepositBlock)
    .some(r => parseFloat(r.contract_balance_eth) > 0);

  // Guard: normal unstaking (many unique recipients, roughly equal amounts, high success
  // rate, funds returning to depositors). Uses the shared computeIsOrganicUnstake() —
  // previously this guard was computed locally here only; it is now a single shared
  // gate also used by the RULES (BALANCE_DROP/FLOW_SPIKE/TEMPORAL_PATTERN/
  // BALANCE_TIMESERIES_DRAIN) so the two never drift apart.
  if (isOrganicUnstake) {
    return {
      detected: false,
      stop_ratio: +stopRatio.toFixed(3),
      suppressed_reason: "normal_unstake_pattern",
      last_deposit_block: lastDepositBlock,
      last_block: lastBlock
    };
  }

  return {
    detected: stopRatio >= 0.30 && balanceAfterStop,
    stop_ratio: +stopRatio.toFixed(3),
    last_deposit_block: lastDepositBlock,
    last_block: lastBlock
  };
}

// ── Evasion subclass scoring ──────────────────────────────────────────────────

function detectEvasionSubclass(rows, baseFraudType) {
  const THRESHOLD = 30;

  // Skip evasion check for non-fraud types (unclassified_warning maps to Unknown)
  if (baseFraudType === "Normal" || baseFraudType === "Unknown") return null;

  const withdrawals = rows.filter(r => WITHDRAW_ACTIONS.has(r.action));
  if (withdrawals.length === 0) return null;

  const peakBalance = Math.max(0, ...rows.map(r => parseFloat(r.contract_balance_eth) || 0));
  const maxSingleW  = Math.max(0, ...withdrawals.map(r => parseFloat(r.amount_eth) || 0));
  const maxRatio    = peakBalance > 0 ? maxSingleW / peakBalance : 0;

  const wBlocks    = withdrawals.map(r => parseInt(r.block) || 0);
  const firstBlock = parseInt(rows[0]?.block) || 0;
  const lastBlock  = parseInt(rows[rows.length - 1]?.block) || 0;
  const totalBlocks = lastBlock - firstBlock || 1;
  const wSpan      = wBlocks.length > 0
    ? Math.max(...wBlocks) - Math.min(...wBlocks)
    : 0;
  const spanRatio  = wSpan / totalBlocks;

  const scores = {
    BalanceDropEvasion: 0,
    MaxTxEvasion:       0,
    SlowDrain:          0,
    HopLaundering:      0,
    DistributedDump:    0
  };

  // BalanceDropEvasion: single withdrawal < 80% of peak
  if (maxRatio < 0.80) {
    scores.BalanceDropEvasion = Math.round((0.80 - maxRatio) / 0.80 * 100);
  }

  // MaxTxEvasion: repeated withdrawals, each < 90% of peak
  if (withdrawals.length >= 3 && maxRatio < 0.90) {
    scores.MaxTxEvasion = Math.min(100,
      Math.round(withdrawals.length / 3 * 50 + (0.90 - maxRatio) * 50)
    );
  }

  // SlowDrain: withdrawal span covers > 30% of contract lifespan
  if (spanRatio > 0.30) {
    scores.SlowDrain = Math.round((spanRatio - 0.30) / 0.70 * 100);
  }

  // HopLaundering (MoneyLaundering only): some withdrawal-side addresses never deposited
  if (baseFraudType === "MoneyLaundering") {
    const depositAddrs = new Set(
      rows.filter(r => DEPOSIT_ACTIONS.has(r.action)).map(r => r.from)
    );
    const withdrawAddrs = [...new Set(withdrawals.map(r => r.from))];
    const hopAddrs  = withdrawAddrs.filter(a => !depositAddrs.has(a));
    const bothSides = withdrawAddrs.filter(a => depositAddrs.has(a) && !DEX_WHITELIST.has(a));
    const whitelistedHits = withdrawAddrs.filter(a => depositAddrs.has(a) && DEX_WHITELIST.has(a));
    if (whitelistedHits.length > 0) {
      console.log(`[DEX_WHITELIST] MoneyLaundering 판정에서 제외된 주소: ${whitelistedHits.join(', ')}`);
    }
    if (hopAddrs.length >= 1 && bothSides.length >= 2) {
      scores.HopLaundering = Math.min(100, hopAddrs.length * 30 + bothSides.length * 20);
    }
  }

  // DistributedDump (PumpDump only): withdrawal-side addresses that never deposited
  if (baseFraudType === "PumpDump") {
    const depositAddrs = new Set(
      rows.filter(r => DEPOSIT_ACTIONS.has(r.action)).map(r => r.from)
    );
    const withdrawOnlyAddrs = [...new Set(withdrawals.map(r => r.from))]
      .filter(a => !depositAddrs.has(a));
    if (withdrawOnlyAddrs.length >= 2) {
      scores.DistributedDump = Math.min(100, withdrawOnlyAddrs.length * 25);
    }
  }

  // Select candidates relevant to the fraud type
  const relevant = ["BalanceDropEvasion", "MaxTxEvasion", "SlowDrain"];
  if (baseFraudType === "MoneyLaundering") relevant.push("HopLaundering");
  if (baseFraudType === "PumpDump")        relevant.push("DistributedDump");

  const candidates = relevant
    .filter(k => scores[k] >= THRESHOLD)
    .sort((a, b) => scores[b] - scores[a]);

  if (candidates.length === 0) return null;

  return {
    subclass:   `${baseFraudType}_${candidates[0]}`,
    confidence: scores[candidates[0]],
    all_scores: Object.fromEntries(
      relevant.map(k => [`${baseFraudType}_${k}`, scores[k]])
    )
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

const FRAUD_TYPE_MAP = {
  "money_laundering":    "MoneyLaundering",
  "pump_and_dump":       "PumpDump",
  "rug_pull":            "RugPull",
  "ponzi_scheme":        "PonziScheme",
  "ponzi_or_laundering": "PonziScheme",
  "flash_loan":          "FlashLoan",
  "normal_staking":      "Normal"
};

// opts.ledger: "per_wallet"(기본) | "aggregated" — 블록 집계를 합성 주소로 펼친 입력(N=272 평가 스크립트)은
//   반드시 "aggregated"를 넘긴다. opts.isContract: 입금 대상이 컨트랙트인지 호출자가 알면 넘긴다.
export function analyzeDynamic(csvPath, opts = {}) {
  const rows = parseCSV(csvPath);

  if (rows.length === 0) {
    return {
      csv:               path.basename(csvPath),
      error:             "CSV 없음 — 시뮬레이션을 먼저 실행하세요",
      triggered_rules:   [],
      dynamic_risk_score: 0,
      verdict:           "UNKNOWN",
      fraud_type_hint:   "unknown",
      reasoning_steps:   [],
      withdraw_success_rate:       0,
      non_privileged_success_rate: 0,
      balance_at_failure_eth:      0,
      withdraw_block_warning:      { detected: false, reason: "CSV 없음" },
      rugpull_axiom:     computeRugPullAxiom([], opts),
      anomaly_signals:   {},
      evasion_detected:  false,
      evasion_subclass:  null,
      evasion_confidence: 0,
      evasion_consequence: null,
      evasion_all_scores: {},
      counter_detection: null
    };
  }

  const contractAddr = detectContractAddress(rows);  // eslint-disable-line no-unused-vars
  let totalIn = 0, totalOut = 0, peak = 0, maxSingleWithdraw = 0;
  const depositorMap = new Map();
  const recipientMap = new Map();

  for (const row of rows) {
    const amount = parseFloat(row.amount_eth) || 0;
    const bal    = parseFloat(row.contract_balance_eth) || 0;
    if (bal > peak) peak = bal;

    if (DEPOSIT_ACTIONS.has(row.action)) {
      totalIn += amount;
      depositorMap.set(row.from, (depositorMap.get(row.from) || 0) + amount);
    }
    if (WITHDRAW_ACTIONS.has(row.action)) {
      totalOut += amount;
      if (amount > maxSingleWithdraw) maxSingleWithdraw = amount;
      recipientMap.set(row.to, (recipientMap.get(row.to) || 0) + amount);
    }
  }

  const finalBal = parseFloat(rows[rows.length - 1].contract_balance_eth) || 0;
  const isOrganicUnstake = computeIsOrganicUnstake(rows, depositorMap, totalOut);
  const ctx = { totalIn, totalOut, peak, finalBal, maxSingleWithdraw,
                depositorMap, recipientMap, rows, isOrganicUnstake };

  // Anomaly rule scoring. rule.detect()는 boolean(기존 규칙, true=1/false=0) 또는
  // 0~1 사이의 연속 fraction(BALANCE_DROP/CONCENTRATION_DRAIN 등)을 반환할 수 있다.
  // 획득 점수 = weight * fraction (반올림), fraction<=0이면 트리거되지 않은 것으로 간주.
  const triggered = [];
  let rawScore = 0;
  for (const rule of RULES) {
    const result = rule.detect(ctx);
    const fraction = typeof result === "boolean" ? (result ? 1 : 0) : clamp(result, 0, 1);
    if (fraction > 0) {
      const earned = Math.round(rule.weight * fraction);
      if (earned > 0) {
        triggered.push({
          id: rule.id,
          description: rule.description,
          weight: earned,
          weight_max: rule.weight,
          fraction: +fraction.toFixed(2)
        });
        rawScore += earned;
      }
    }
  }

  const dynamic_risk_score = Math.min(100, rawScore);
  const verdict = VERDICT_THRESHOLDS.find(t => dynamic_risk_score >= t.min).label;

  // Classification with reasoning
  const rugpull_axiom   = computeRugPullAxiom(rows, opts);
  const hintResult      = hintFraudType(rows, triggered, rugpull_axiom);
  const fraud_type_hint = hintResult.hint;
  const reasoning_steps = hintResult.reasoning_steps;
  const withdraw_block_warning = hintResult.withdrawBlockWarning;
  if (withdraw_block_warning.detected && fraud_type_hint !== "unclassified_warning") {
    reasoning_steps.push(`유형은 ${fraud_type_hint}으로 확정, 별도로 출금 차단 경고 병기 (${withdraw_block_warning.reason})`);
  }

  // InflowStop signal
  const inflowStop = detectInflowStop(rows, isOrganicUnstake);
  if (fraud_type_hint === "ponzi_scheme" && inflowStop.detected) {
    reasoning_steps.push(
      `PONZI_COLLAPSE_CONFIRMED: inflow stopped at block ${inflowStop.last_deposit_block}` +
      ` (${(inflowStop.stop_ratio * 100).toFixed(0)}% of lifespan without new deposits)`
    );
  }

  // Evasion subclass scoring
  const baseFraudType  = FRAUD_TYPE_MAP[fraud_type_hint] ?? "Unknown";
  const evasionResult  = detectEvasionSubclass(rows, baseFraudType);

  return {
    csv:              path.basename(csvPath),
    rows_analyzed:    rows.length,
    metrics: {
      total_in_eth:            +totalIn.toFixed(4),
      total_out_eth:           +totalOut.toFixed(4),
      net_flow_eth:            +(totalIn - totalOut).toFixed(4),
      peak_balance_eth:        +peak.toFixed(4),
      final_balance_eth:       +finalBal.toFixed(4),
      max_single_withdraw_eth: +maxSingleWithdraw.toFixed(4)
    },
    triggered_rules:   triggered,
    dynamic_risk_score,
    verdict,
    fraud_type_hint,
    reasoning_steps,
    withdraw_success_rate:       +hintResult.withdrawSuccessRate.toFixed(3),
    non_privileged_success_rate: +hintResult.nonPrivilegedSuccessRate.toFixed(3),
    balance_at_failure_eth:      +hintResult.balanceAtFailure.toFixed(4),
    withdraw_block_warning,
    rugpull_axiom,
    anomaly_signals: {
      INFLOW_STOP: inflowStop
    },
    evasion_detected:    evasionResult !== null,
    evasion_subclass:    evasionResult?.subclass    ?? null,
    evasion_confidence:  evasionResult?.confidence  ?? 0,
    evasion_consequence: evasionResult
      ? `Detected evasion pattern: ${evasionResult.subclass} (confidence ${evasionResult.confidence})`
      : null,
    evasion_all_scores:  evasionResult?.all_scores  ?? {},
    counter_detection:   null
  };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const csvArg = process.argv[2];
  if (!csvArg) {
    console.error("사용법: node analysis/dynamic_analyzer.js analysis/logs/ponzi_log.csv");
    process.exit(1);
  }
  const result = analyzeDynamic(path.resolve(csvArg),
    process.argv.includes("--aggregated") ? { ledger: "aggregated" } : {});
  console.log(JSON.stringify(result, null, 2));
}
