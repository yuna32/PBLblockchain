// 사기 발현 시점 추정 (D11 준비용 — 규칙은 아직 확정되지 않았다).
// 우선순위:
//   (1) 첫 owner_withdraw_all 행의 블록
//   (2) dynamic.anomaly_signals.INFLOW_STOP.last_deposit_block (detected 여부와 무관)
//   (3) 둘 다 없으면 null
// rows: parseCsv() 결과(값은 문자열), dynamic: 리포트의 dynamic 객체.

function toIntOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

export function computeOnset(rows, dynamic) {
  const drain = rows.find(r => r.action === "owner_withdraw_all");
  if (drain) {
    return {
      block: toIntOrNull(drain.block),
      timestamp: toIntOrNull(drain.timestamp),
      basis: "owner_withdraw_all",
      detail: { to: drain.to, amount_eth: drain.amount_eth }
    };
  }

  const inflowStop = dynamic?.anomaly_signals?.INFLOW_STOP;
  if (inflowStop && Number.isInteger(inflowStop.last_deposit_block)) {
    const block = inflowStop.last_deposit_block;
    const row = rows.find(r => toIntOrNull(r.block) === block);
    return {
      block,
      timestamp: row ? toIntOrNull(row.timestamp) : null,
      basis: "inflow_stop_last_deposit_block",
      detail: {
        inflow_stop_detected: inflowStop.detected,
        suppressed_reason: inflowStop.suppressed_reason ?? null
      }
    };
  }

  return null;
}
