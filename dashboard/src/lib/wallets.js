// 지갑 점수 정렬·역할 표시 (순수). 입력은 report.trust.wallet_scores.
import { EXTRACTOR_PROFIT_RATIO } from "./network.js";

export const TRUST_AXES = ["blacklist_assoc", "flow_pattern", "scam_history", "activity_age", "tx_diversity"];

export function walletRole(w) {
  if (w.is_drainer) return "drainer";
  if (w.profit_ratio > EXTRACTOR_PROFIT_RATIO) return "extractor";
  return null;
}

// 점수 오름차순(위험한 지갑 먼저), 같으면 주소순으로 안정 정렬
export function sortWallets(wallets = [], dir = "asc") {
  const sign = dir === "desc" ? -1 : 1;
  return [...wallets].sort((a, b) => sign * (a.trust_score - b.trust_score) || a.address.localeCompare(b.address));
}

export function lowestWallet(wallets = []) {
  return sortWallets(wallets)[0] ?? null;
}

// 레이더용: breakdown 5축 → [{ axis, score }]
export function radarData(wallet) {
  if (!wallet?.breakdown) return [];
  return TRUST_AXES.map(axis => ({ axis, score: wallet.breakdown[axis]?.score ?? 0 }));
}
