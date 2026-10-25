// 온체인 기록·검증 상태: 기록 방식 목록과 선택한 방식, 방식·리포트별 기록, 기록 작업(400ms 폴링), 마지막 검증 결과.
// 모두 메모리에만 둔다. 새로고침하면 사라지고 서버의 기록을 다시 읽는다.
// 진행 표시·시나리오 패널·개요 배지는 선택한 방식(기본 local)을 기준으로 한다.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApp } from "./AppContext.jsx";
import { attestPhase, backendOptions, lookupPlan, recordKey } from "../lib/attest.js";

// 정적 모드에서는 state/StaticAttest.jsx가 같은 컨텍스트를 채운다
export const AttestContext = createContext(null);
const POLL_MS = 400;
const STARTING_POLL_MS = 1500;
const FIXTURE_POLL_MS = 1000;
const FIXTURE_TRIES = 60;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const failure = err => ({ code: err?.code ?? null, message: err?.message ?? String(err), network: Boolean(err?.network) });

export function AttestProvider({ children }) {
  const { health, current, history } = useApp();
  const online = health.state === "up";
  const [backends, setBackends] = useState(null);
  const [backendId, setBackendId] = useState("local");
  const [fixtures, setFixtures] = useState({});  // backend → { data: { scenario → 기록 | null }, settled }
  const [records, setRecords] = useState({});    // `${backend}:${reportId}` → { status: loading|ready|none|error, record, error }
  const [jobs, setJobs] = useState({});          // `${backend}:${reportId}` → 기록 작업 (실패 시 { status: "error", failure })
  const [verifies, setVerifies] = useState({});  // `${backend}:${reportId}` → { status: running|done|error, result, error, tamper }
  const busy = useRef(new Set());                // 진행 중인 요청 (중복 클릭 방지)

  // 기록 방식: 서버가 연결되면 읽고, 로컬 체인이 시작 중이면 끝날 때까지 다시 읽는다
  useEffect(() => {
    if (!online) return;
    let alive = true;
    let timer = null;
    const load = async () => {
      try {
        const list = await api.attestBackends();
        if (!alive) return;
        setBackends(list);
        if (backendOptions(list).some(b => b.starting)) timer = setTimeout(load, STARTING_POLL_MS);
      } catch {
        if (alive) timer = setTimeout(load, STARTING_POLL_MS * 2);
      }
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [online]);

  const options = useMemo(() => backendOptions(backends), [backends]);
  const optionOf = useCallback(id => options.find(b => b.id === id) ?? null, [options]);
  const selected = optionOf(backendId);
  const selectedReady = selected?.available === true;

  // 선택한 방식의 시나리오별 사전 기록. local은 서버가 사용 가능으로 알린 뒤 사전 기록을 하므로 다 보일 때까지(최대 60번) 다시 읽는다.
  // eas-sepolia는 파일에서 읽은 것이라 한 번만 읽는다.
  useEffect(() => {
    if (!selectedReady) return;
    let alive = true;
    let timer = null;
    let tries = 0;
    const id = backendId;
    setFixtures(m => ({ ...m, [id]: { data: m[id]?.data ?? {}, settled: false } }));
    const load = async () => {
      tries += 1;
      try {
        const d = (await api.fixtureAttestations(id)) ?? {};
        if (!alive) return;
        const retry = id === "local" && Object.values(d).some(r => !r) && tries < FIXTURE_TRIES;
        setFixtures(m => ({ ...m, [id]: { data: d, settled: !retry } }));
        if (retry) timer = setTimeout(load, FIXTURE_POLL_MS);
      } catch {
        if (alive && tries < FIXTURE_TRIES) timer = setTimeout(load, FIXTURE_POLL_MS);
        else if (alive) setFixtures(m => ({ ...m, [id]: { data: m[id]?.data ?? {}, settled: true } }));
      }
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [backendId, selectedReady]);

  // 현재 리포트의 기록(선택한 방식).
  const reportId = current.data ? current.reportId : null;
  const mode = current.data?.job?.mode ?? history.find(e => e.jobId === reportId)?.mode ?? null;
  const scenario = current.data?.view.scenario ?? null;
  const fx = fixtures[backendId];
  const prerecord = fx?.data?.[scenario] ? "present" : fx?.settled ? "absent" : "pending";
  useEffect(() => {
    if (!reportId || !online) return;
    const plan = lookupPlan({ mode, localReady: selectedReady, prerecord });
    if (plan === "wait") return;
    const k = recordKey(backendId, reportId);
    if (plan === "none") {
      setRecords(m => (m[k] ? m : { ...m, [k]: { status: "none", record: null, error: null } }));
      return;
    }
    let alive = true;
    setRecords(m => (m[k]?.record ? m : { ...m, [k]: { status: "loading", record: null, error: null } }));
    api.attestation(reportId, backendId)
      .then(record => alive && setRecords(m => ({ ...m, [k]: { status: "ready", record, error: null } })))
      .catch(err => alive && setRecords(m => {
        if (err.code === "attestation_not_found") return { ...m, [k]: { status: "none", record: null, error: null } };
        if (m[k]?.record) return m;
        return { ...m, [k]: { status: "error", record: null, error: failure(err) } };
      }));
    return () => { alive = false; };
  }, [reportId, online, selectedReady, mode, prerecord, backendId]);

  // 기록: POST /api/report/:id/attest → /api/attest-jobs/:id 400ms 폴링
  const attest = useCallback(async (id, { backend = "local", force = false } = {}) => {
    const k = recordKey(backend, id);
    if (busy.current.has(`attest:${k}`)) return;
    busy.current.add(`attest:${k}`);
    setJobs(m => ({ ...m, [k]: { id: null, reportId: id, backend, force, status: "queued", reused: false, error: null } }));
    try {
      const { attestJobId } = await api.attest(id, { backend, force });
      for (;;) {
        const j = await api.attestJob(attestJobId);
        setJobs(m => ({ ...m, [k]: j }));
        if (j.status === "done") {
          setRecords(m => ({ ...m, [k]: { status: "ready", record: j.attestation, error: null } }));
          // 새 UID로 기록했으면 이전 검증 결과는 더 이상 이 기록의 결과가 아니다
          if (!j.reused) setVerifies(m => { const { [k]: _, ...rest } = m; return rest; });
          return;
        }
        if (j.status === "error") {
          setJobs(m => ({ ...m, [k]: { ...j, failure: { code: j.errorCode ?? null, message: j.error, network: false } } }));
          return;
        }
        await sleep(POLL_MS);
      }
    } catch (err) {
      setJobs(m => ({ ...m, [k]: { ...(m[k] ?? {}), status: "error", error: err.message, failure: failure(err) } }));
    } finally {
      busy.current.delete(`attest:${k}`);
    }
  }, []);

  // 검증: POST /api/report/:id/verify { backend, tamper? } (tamper는 서버 메모리 사본만 바꾼다)
  const verify = useCallback(async (id, { backend = "local", tamper = null } = {}) => {
    const k = recordKey(backend, id);
    if (busy.current.has(`verify:${k}`)) return;
    busy.current.add(`verify:${k}`);
    setVerifies(m => ({ ...m, [k]: { ...(m[k] ?? {}), status: "running", tamper, error: null } }));
    try {
      const result = await api.verify(id, { backend, tamper });
      setVerifies(m => ({ ...m, [k]: { status: "done", result, error: null, tamper } }));
    } catch (err) {
      setVerifies(m => ({ ...m, [k]: { status: "error", result: null, error: failure(err), tamper } }));
    } finally {
      busy.current.delete(`verify:${k}`);
    }
  }, []);

  const phaseOf = useCallback((id, backend = backendId) => {
    if (!id) return null;
    const k = recordKey(backend, id);
    return attestPhase({ online, local: optionOf(backend), entry: records[k], job: jobs[k] });
  }, [online, optionOf, records, jobs, backendId]);

  // 시나리오 → recorded | prerecorded (선택한 방식 기준, 이번 세션에서 직접 기록한 것이 우선)
  const scenarioMarks = useMemo(() => {
    const out = {};
    for (const [sc, rec] of Object.entries(fixtures[backendId]?.data ?? {})) if (rec) out[sc] = "prerecorded";
    for (const [k, e] of Object.entries(records)) {
      if (k.startsWith(`${backendId}:`) && e.record && !e.record.prerecorded && e.record.scenario) out[e.record.scenario] = "recorded";
    }
    return out;
  }, [fixtures, records, backendId]);

  const value = useMemo(() => ({
    options, selected, backendId, selectBackend: setBackendId,
    entryOf: (id, backend = backendId) => records[recordKey(backend, id)],
    jobOf: (id, backend = backendId) => jobs[recordKey(backend, id)],
    verifyOf: (id, backend = backendId) => verifies[recordKey(backend, id)],
    attest, verify, phaseOf, scenarioMarks,
    currentPhase: phaseOf(reportId)
  }), [options, selected, backendId, records, jobs, verifies, attest, verify, phaseOf, scenarioMarks, reportId]);

  return <AttestContext.Provider value={value}>{children}</AttestContext.Provider>;
}

export function useAttest() {
  const ctx = useContext(AttestContext);
  if (!ctx) throw new Error("useAttest는 AttestProvider 안에서만 쓸 수 있습니다.");
  return ctx;
}
