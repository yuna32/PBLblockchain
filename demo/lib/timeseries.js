// 거래 행 정규화: CSV 텍스트 → 행 배열. CR 제거(parseCsv), 숫자 열은 숫자로.
import { parseCsv } from "./csv.js";

export const NUMERIC_COLUMNS = ["block", "timestamp", "amount_eth", "contract_balance_eth", "participant_count"];

export function toTimeseries(csvText) {
  return parseCsv(csvText).map(row => {
    const out = { ...row };
    for (const col of NUMERIC_COLUMNS) {
      if (col in out) {
        const n = Number(out[col]);
        out[col] = Number.isNaN(n) ? null : n;
      }
    }
    return out;
  });
}
