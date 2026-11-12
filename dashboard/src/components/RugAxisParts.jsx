// 러그풀 축 화면 조각: 범위 밖 안내, 지갑별 낸 돈 vs 받은 돈, 러그풀 vs 폰지 비교.
// 상태(Context)를 쓰지 않는 순수 컴포넌트. 값은 모두 view.decision.rugpull(lib/rugaxis.js)에서 온다.
import { useState } from "react";
import { CircleDashed } from "lucide-react";
import { Badge, ICON, Legend } from "./ui.jsx";
import { ConditionBar } from "./ConditionsParts.jsx";
import { rugVsPonzi, scopeNotice, walletLedgerRows } from "../lib/rugaxis.js";
import { fmtEth, shortAddr } from "../lib/format.js";

// 범위 밖: 회색 중립 톤 (결론 "판단 불가"와 같은 색). 안전하다는 뜻으로 읽히지 않게 문구를 붙인다.
export function ScopeNotice({ rug }) {
  const n = scopeNotice(rug);
  if (!n) return null;
  return (
    <div className="scope-notice" role="note">
      <CircleDashed {...ICON} size={18} aria-hidden="true" />
      <div>
        <strong>{n.title}</strong>
        <span className="scope-notice-reason"> · {n.reason}</span>
        <p>{n.text}</p>
        <p className="muted small">{n.note}</p>
      </div>
    </div>
  );
}

const LEDGER_LIMIT = 10;
const signed = v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtEth(Math.abs(v), 3)}`;

// 거래 분석: 지갑별 낸 돈 vs 받은 돈 (가로 막대 두 줄, 같은 축 = 가장 큰 금액)
export function WalletLedger({ decision }) {
  const [all, setAll] = useState(false);
  const rug = decision?.rugpull;
  const data = walletLedgerRows(rug, decision?.ownerAddress);
  if (!data) return null;
  const shown = all ? data.rows : data.rows.slice(0, LEDGER_LIMIT);
  const w = v => `${data.max > 0 ? (v / data.max) * 100 : 0}%`;
  return (
    <div className="wl">
      <ScopeNotice rug={rug} />
      {data.rows.length === 0
        ? <p className="muted">지갑별로 나눌 수 있는 거래 기록이 없습니다.</p>
        : (
          <>
            <div className="wl-head">
              <Legend items={[
                { key: "dep", label: "낸 돈 (누적 입금)", swatch: <rect x="-6" y="-3" width="12" height="6" rx="2" style={{ fill: "var(--deposit)" }} /> },
                { key: "rec", label: "받은 돈 (누적 수령)", swatch: <rect x="-6" y="-3" width="12" height="6" rx="2" style={{ fill: "var(--withdraw)" }} /> }
              ]} />
              {data.inScope && (
                <p className="muted small">
                  원금보다 더 받은 지갑 {data.contributorCount}개 · 원금의 {data.profitRatioText} 이상 받은 참여자 {data.sharerCount}명
                </p>
              )}
            </div>
            <ol className="wl-rows">
              {shown.map(r => (
                <li key={r.address} className={`wl-row ${r.contributor ? "wl-contrib" : ""}`}
                  title={`${r.address} · 낸 돈 ${fmtEth(r.deposited, 6)} · 받은 돈 ${fmtEth(r.received, 6)} · 차액 ${signed(r.netGain)}`}>
                  <div className="wl-who">
                    <code className="mono small">{shortAddr(r.address)}</code>
                    {r.isOwner && <Badge tone="neutral">운영자</Badge>}
                    {r.contributor && <Badge tone="danger">원금보다 {signed(r.netGain)}</Badge>}
                    {r.sharer && <Badge tone="neutral">수익자 · 원금의 {data.profitRatioText} 이상</Badge>}
                  </div>
                  <div className="wl-bars">
                    <span className="wl-track"><span className="wl-fill wl-dep" style={{ width: w(r.deposited) }} /></span>
                    <span className="wl-val num">낸 돈 {fmtEth(r.deposited, 3)}</span>
                    <span className="wl-track"><span className="wl-fill wl-rec" style={{ width: w(r.received) }} /></span>
                    <span className="wl-val num">받은 돈 {fmtEth(r.received, 3)}</span>
                  </div>
                </li>
              ))}
            </ol>
            {data.rows.length > LEDGER_LIMIT && (
              <button type="button" className="link-btn" onClick={() => setAll(v => !v)}>
                {all ? "접기" : `지갑 ${data.rows.length - LEDGER_LIMIT}개 더 보기`}
              </button>
            )}
          </>
        )}
    </div>
  );
}

// 판정 조건: 러그풀 vs 폰지 — 원금을 넘는 돈이 빠져나갔을 때, 원금 이상 돌려받은 참여자 수로 갈린다
export function RugVsPonzi({ decision }) {
  const rug = decision?.rugpull;
  const c = rugVsPonzi(rug);
  if (!c) return null;
  return (
    <div className="rvp">
      <p className="muted">
        같은 입출금 기록이라도 원금을 넘는 돈을 누가 가져갔는지에 따라 갈립니다. 한쪽이 몰아 가져가면 러그풀, 여러 참여자가 나눠 가지면 폰지 쪽입니다.
      </p>
      <ScopeNotice rug={rug} />
      <div className="rvp-meters">
        <div className="rvp-meter">
          <div className="rvp-meter-head">
            <span>원금을 넘어 빠져나간 돈 (최고 잔고 대비)</span>
            <span className="num"><strong>{c.netDrain.text ?? "계산할 수 없음"}</strong><span className="muted"> · 기준 {c.netDrain.thresholdText} 이상</span></span>
          </div>
          {c.netDrain.bar && <ConditionBar bar={c.netDrain.bar} met={false} tone="neutral" />}
        </div>
        <div className="rvp-meter">
          <div className="rvp-meter-head">
            <span>원금의 {c.sharers.ratioText} 이상 돌려받은 참여자</span>
            <span className="num"><strong>{c.sharers.text ?? "계산할 수 없음"}</strong><span className="muted"> · 기준 {c.sharers.thresholdText}</span></span>
          </div>
          {c.sharers.bar && <ConditionBar bar={c.sharers.bar} met={false} tone="neutral" />}
        </div>
      </div>
      <div className="rvp-split" aria-label="원금을 넘는 돈이 빠져나갔을 때 갈리는 두 모양">
        <div className={`rvp-side ${c.side === "rug" ? "rvp-on" : ""}`}>
          <strong>한쪽이 몰아 가져감</strong>
          <span>원금 이상 받은 참여자 {c.sharers.thresholdText} 미만 → 러그풀 쪽</span>
        </div>
        <div className={`rvp-side ${c.side === "ponzi" ? "rvp-on" : ""}`}>
          <strong>여럿이 나눠 가짐</strong>
          <span>원금 이상 받은 참여자 {c.sharers.thresholdText} 이상 → 폰지 쪽</span>
        </div>
      </div>
      <p className={`rvp-result ${c.inScope ? "" : "rvp-result-out"}`}><strong>이 예시: {c.label}</strong> · {c.text}</p>
      <p className="muted small">이 비교는 러그풀 판정에서 본 돈의 모양입니다. 폰지 판정은 지금은 기존 조건으로 하며, 기준값은 시뮬레이션 예시로만 확인했습니다.</p>
    </div>
  );
}
