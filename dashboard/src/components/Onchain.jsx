// 온체인 상태 표시 조각: 개요 요약 띠의 배지, 오른쪽 시나리오 행의 작은 표시. 모두 선택한 기록 방식 기준.
import { Link2 } from "lucide-react";
import { CHAIN_SHORT_NAMES, onchainBadge, PHASE_LABELS, verifySummary } from "../lib/attest.js";
import { Badge, ICON } from "./ui.jsx";

// phase: lib/attest.js attestPhase(), verifyEntry: 마지막 검증 상태(컨텍스트), backend: 선택한 방식
export function OnchainBadge({ phase, verifyEntry, backend = "local" }) {
  const b = onchainBadge(phase, CHAIN_SHORT_NAMES[backend]);
  const v = verifySummary(verifyEntry);
  return (
    <span className="onchain-badge">
      <Badge tone={b.tone}>{b.label}</Badge>
      {b.extra && <Badge tone="neutral">{b.extra}</Badge>}
      {v && <span className={`small text-${v.tone}`}>{v.text}{v.tamperDemo ? " (변조 시연)" : ""}</span>}
    </span>
  );
}

// mark: recorded | prerecorded | attested(정적 모드, 상태 A)
export function OnchainMark({ mark, backend = "local" }) {
  if (!mark) return null;
  if (mark === "attested") {
    return (
      <span className="onchain-mark" title="이 시나리오의 리포트가 Sepolia에 기록되어 있습니다">
        <Link2 {...ICON} size={12} />
        {PHASE_LABELS.attested}
      </span>
    );
  }
  const chain = CHAIN_SHORT_NAMES[backend] ?? backend;
  const title = mark === "prerecorded"
    ? (backend === "local" ? "서버가 시작할 때 이 시나리오의 사전 생성본 리포트를 로컬 체인에 기록했습니다" : `이 시나리오의 사전 생성본 리포트가 ${chain}에 미리 기록되어 있습니다`)
    : `이번 세션에서 이 시나리오의 리포트를 ${chain}에 기록했습니다`;
  return (
    <span className="onchain-mark" title={title}>
      <Link2 {...ICON} size={12} />
      {PHASE_LABELS[mark]}{backend === "local" ? "" : ` · ${chain}`}
    </span>
  );
}
