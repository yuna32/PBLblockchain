// 정적 모드의 증명 상태: index.json의 시나리오별 attestStatus와 attestation.json(상태 A일 때만)으로 정한다.
// 기록·서버 검증은 없다. 브라우저 검증 결과(무결성·온체인 조회)는 메모리에만 두어 개요 배지에 쓴다.
// AttestContext와 같은 모양을 채워 진행 표시·시나리오 패널·개요가 그대로 쓰게 한다.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApp } from "./AppContext.jsx";
import { AttestContext } from "./AttestContext.jsx";

const noop = async () => {};

export function StaticAttestProvider({ children }) {
  const { current } = useApp();
  const [statuses, setStatuses] = useState(null);     // scenario → "A" | "B"
  const [attestations, setAttestations] = useState({}); // scenario → attestation | null (상태 A만 읽는다)
  const [verifies, setVerifies] = useState({});         // scenario → { status, result, kind, tamper }

  useEffect(() => {
    let alive = true;
    api.snapshotIndex()
      .then(idx => alive && setStatuses(Object.fromEntries(idx.scenarios.map(s => [s.id, s.attestStatus]))))
      .catch(() => alive && setStatuses({}));
    return () => { alive = false; };
  }, []);

  const scenario = current.data?.view.scenario ?? null;
  useEffect(() => {
    if (!scenario || !statuses || scenario in attestations) return;
    let alive = true;
    api.attestation(scenario)
      .then(a => alive && setAttestations(m => ({ ...m, [scenario]: a })))
      .catch(() => alive && setAttestations(m => ({ ...m, [scenario]: null })));
    return () => { alive = false; };
  }, [scenario, statuses, attestations]);

  const phaseOf = useCallback(id => {
    if (!id) return null;
    if (!statuses) return "checking";
    if (statuses[id] !== "A") return "pending_onchain";
    if (!(id in attestations)) return "checking";
    return attestations[id] ? "attested" : "pending_onchain";
  }, [statuses, attestations]);

  const scenarioMarks = useMemo(() => Object.fromEntries(
    Object.entries(statuses ?? {}).filter(([, s]) => s === "A").map(([id]) => [id, "attested"])
  ), [statuses]);

  const setVerifyEntry = useCallback((id, entry) => setVerifies(m => ({ ...m, [id]: entry })), []);

  const value = useMemo(() => ({
    static: true,
    options: [], selected: null, backendId: "static", selectBackend: () => {},
    entryOf: () => undefined, jobOf: () => undefined,
    verifyOf: id => verifies[id],
    setVerifyEntry,
    attestationOf: id => attestations[id],
    attest: noop, verify: noop,
    phaseOf, scenarioMarks,
    currentPhase: phaseOf(current.data ? current.reportId : null)
  }), [verifies, setVerifyEntry, attestations, phaseOf, scenarioMarks, current.data, current.reportId]);

  return <AttestContext.Provider value={value}>{children}</AttestContext.Provider>;
}
