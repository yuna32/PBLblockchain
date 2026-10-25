// 신뢰 시트: 코드 위험과 지갑 신뢰를 나란히, 지갑별 5축 레이더와 지갑 표, 면책 문구.
import { useMemo, useState } from "react";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { useApp } from "../state/AppContext.jsx";
import { Badge, Card, EstimateTag, ReportGate, Stat, Term } from "../components/ui.jsx";
import { cssVar } from "../components/theme.js";
import { lowestWallet, radarData, sortWallets, walletRole } from "../lib/wallets.js";
import { term } from "../lib/terms.js";
import { fmtEth, shortAddr } from "../lib/format.js";

export default function Trust() {
  return <ReportGate>{data => <TrustBody key={data.envelope.report_sha256 + data.view.scenario} data={data} />}</ReportGate>;
}

function TrustBody({ data }) {
  const { view, report } = data;
  const wallets = useMemo(() => sortWallets(report.trust.wallet_scores), [report]);
  const [selected, setSelected] = useState(() => lowestWallet(report.trust.wallet_scores)?.address ?? null);
  const wallet = wallets.find(w => w.address === selected) ?? wallets[0];
  return (
    <div className="page">
      <div className="grid-2">
        <CodeCard code={view.codeAssessment} />
        <WalletCard w={view.walletAssessment} />
      </div>
      <div className="grid-2">
        <Card title="지갑 신뢰 5축"
          aside={
            <select className="select" value={wallet?.address ?? ""} onChange={e => setSelected(e.target.value)} aria-label="지갑 선택">
              {wallets.map(w => <option key={w.address} value={w.address}>{shortAddr(w.address)} · {w.grade} ({w.trust_score}점)</option>)}
            </select>
          }>
          <WalletRadar wallet={wallet} />
        </Card>
        <Card title="지갑 목록" aside={<span className="muted small">점수 낮은 순</span>} pad={false}>
          <WalletTable wallets={wallets} selected={wallet?.address} onSelect={setSelected} />
        </Card>
      </div>
      <p className="disclaimer">{view.disclaimer}</p>
    </div>
  );
}

function CodeCard({ code }) {
  const { glossary } = useApp();
  return (
    <Card title="코드 위험" aside={<EstimateTag>휴리스틱</EstimateTag>}>
      <div className="stats-row">
        <Stat label={<Term id="prevention_risk_level">예방 분석 위험 수준</Term>}
          value={<Term id={code.preventionRiskLevel}>{term(glossary, code.preventionRiskLevel).label}</Term>}
          sub={`${code.preventionRiskLabel ?? ""} · 점수 ${code.preventionRiskScore ?? "-"}`} />
        <Stat label="정적 분석 판정" value={<Term id={code.staticVerdict}>{term(glossary, code.staticVerdict).label}</Term>}
          sub={`위험 점수 ${code.staticRiskScore ?? "-"} / 100`} />
      </div>
      <h3 className="sub-title">주요 정적 규칙</h3>
      {code.mainRules.length === 0 ? <p className="muted">발동한 규칙 없음</p> : (
        <ul className="rows rows-static">
          {code.mainRules.map(r => (
            <li key={r.id} className="row">
              <span className="row-title"><Term id={r.id} /></span>
              <span className="row-value num">+{r.weight}</span>
            </li>
          ))}
        </ul>
      )}
      {code.fraudTypeSuspected && (
        <p className="muted small">예방 분석이 의심한 유형: <Term id={code.fraudTypeSuspected} /></p>
      )}
    </Card>
  );
}

function WalletCard({ w }) {
  const differs = w.lowestDiffersFromOverall;
  return (
    <Card title="지갑 신뢰" aside={<EstimateTag>휴리스틱</EstimateTag>}>
      <div className="stats-row">
        <Stat label={<Term id="trust_grade">평균 등급</Term>} value={w.trustGrade} sub={`신뢰 점수 ${w.trustScore} · 지갑 ${w.walletCount}개`} />
        <Stat label={<Term id="lowest_wallet_grade">최저 지갑 등급</Term>} value={w.lowestWallet?.grade ?? "-"}
          tone={differs ? "danger" : undefined} emphasis={differs}
          sub={differs ? <span className="text-danger">평균({w.trustGrade})과 다름 · {w.lowestWallet.trustScore}점</span> : `${w.lowestWallet?.trustScore ?? "-"}점`} />
      </div>
      <ul className="rows rows-static">
        <li className="row">
          <span className="row-title"><Term id="drainer">운영자 전액 인출 지갑 (drainer)</Term></span>
          <span className="row-value num">{w.drainerCount}개</span>
        </li>
        <li className="row">
          <span className="row-title">
            <span className="term" tabIndex={0}>과도 수익 지갑 (extractor)
              <span className="term-pop" role="tooltip">
                <span className="term-pop-title">extractor 정의</span>
                <span className="term-pop-desc">{w.extractorDefinition}</span>
              </span>
            </span>
          </span>
          <span className="row-value num">{w.extractorCount}개</span>
        </li>
      </ul>
    </Card>
  );
}

function WalletRadar({ wallet }) {
  const { glossary } = useApp();
  const data = radarData(wallet).map(d => ({ ...d, label: term(glossary, d.axis).label }));
  const primary = cssVar("--primary"), grid = cssVar("--border"), text3 = cssVar("--text-3"), text2 = cssVar("--text-2");
  if (!wallet) return <p className="muted">지갑 없음</p>;
  const role = walletRole(wallet);
  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke={grid} />
          <PolarAngleAxis dataKey="label" tick={{ fontSize: 12, fill: text2 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} tickCount={5} axisLine={false} stroke={text3} />
          <Radar dataKey="score" stroke={primary} fill={primary} fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
        </RadarChart>
      </ResponsiveContainer>
      <div className="radar-caption">
        <code className="mono small" title={wallet.address}>{shortAddr(wallet.address)}</code>
        <span className="num">등급 {wallet.grade} · {wallet.trust_score}점</span>
        {role && <RoleBadge role={role} />}
      </div>
    </div>
  );
}

function RoleBadge({ role }) {
  return role === "drainer"
    ? <Badge tone="danger"><Term id="drainer">drainer</Term></Badge>
    : <Badge tone="caution"><Term id="extractor">extractor</Term></Badge>;
}

function WalletTable({ wallets, selected, onSelect }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>지갑</th><th>구분</th><th className="r">등급</th><th className="r">점수</th><th className="r">입금</th><th className="r">수령</th></tr>
        </thead>
        <tbody>
          {wallets.map(w => {
            const role = walletRole(w);
            return (
              <tr key={w.address} className={w.address === selected ? "on" : ""} onClick={() => onSelect(w.address)}>
                <td><code className="mono" title={w.address}>{shortAddr(w.address)}</code></td>
                <td>{role ? <RoleBadge role={role} /> : <span className="muted">-</span>}</td>
                <td className="r num">{w.grade}</td>
                <td className="r num">{w.trust_score}</td>
                <td className="r num">{fmtEth(w.deposited_eth, 3)}</td>
                <td className="r num">{fmtEth(w.received_eth, 3)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
