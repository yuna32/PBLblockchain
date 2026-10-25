// 온체인 기록·검증 상태: 기록 방식 목록, 리포트별 기록, 기록 작업(400ms 폴링), 리포트별 마지막 검증 결과.
// 모두 메모리에만 둔다. 새로고침하면 사라지고 서버의 기록을 다시 읽는다.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApp } from "./AppContext.jsx";
import { attestPhase, backendOptions, lookupPlan } from "../lib/attest.js";

const AttestContext = createContext(null);
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
  const [fixtures, setFixtures] = useState({});
  const [fixturesSettled, setFixturesSettled] = useState(false);
  const [records, setRecords] = useState({});   // reportId → { status: loading|ready|none|error, record, error }
  const [jobs, setJobs] = useState({});         // reportId → 기록 작업 (GET /api/attest-jobs/:id 응답, 실패 시 { status: "error", failure })
  const [verifies, setVerifies] = useState({}); // reportId → { status: running|done|error, result, error, tamper }
  const busy = useRef(new Set());               // 진행 중인 요청 (중복 클릭 방지)

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
  const local = options.find(b => b.id === "local") ?? null;
  const localReady = local?.available === true;

  // 시나리오별 사전 기록. 서버가 local을 사용 가능으로 알린 뒤 사전 기록을 하므로, 다 보일 때까지(최대 60번) 다시 읽는다.
  useEffect(() => {
    if (!localReady) return;
    let alive = true;
    let timer = null;
    let tries = 0;
    setFixturesSettled(false);
    const load = async () => {
      tries += 1;
      try {
        const d = (await api.fixtureAttestations()) ?? {};
        if (!alive) return;
        setFixtures(d);
        if (Object.values(d).some(r => !r) && tries < FIXTURE_TRIES) timer = setTimeout(load, FIXTURE_POLL_MS);
        else setFixturesSettled(true);
      } catch {
        if (alive && tries < FIXTURE_TRIES) timer = setTimeout(load, FIXTURE_POLL_MS);
        else if (alive) setFixturesSettled(true);
      }
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [localReady]);

  // 현재 리포트의 기록. 로컬 체인이 사용 가능해지면(사전 기록이 끝나면) 읽는다.
  const reportId = current.data ? current.reportId : null;
  const mode = current.data?.job?.mode ?? history.find(e => e.jobId === reportId)?.mode ?? null;
  const scenario = current.data?.view.scenario ?? null;
  const prerecord = fixtures[scenario] ? "present" : fixturesSettled ? "absent" : "pending";
  useEffect(() => {
    if (!reportId || !online) return;
    const plan = lookupPlan({ mode, localReady, prerecord });
    if (plan === "wait") return;
    if (plan === "none") {
      setRecords(m => (m[reportId] ? m : { ...m, [reportId]: { status: "none", record: null, error: null } }));
      return;
    }
    let alive = true;
    setRecords(m => (m[reportId]?.record ? m : { ...m, [reportId]: { status: "loading", record: null, error: null } }));
    api.attestation(reportId)
      .then(record => alive && setRecords(m => ({ ...m, [reportId]: { status: "ready", record, error: null } })))
      .catch(err => alive && setRecords(m => {
        if (err.code === "attestation_not_found") return { ...m, [reportId]: { status: "none", record: null, error: null } };
        if (m[reportId]?.record) return m;
        return { ...m, [reportId]: { status: "error", record: null, error: failure(err) } };
      }));
    return () => { alive = false; };
  }, [reportId, online, localReady, mode, prerecord]);

  // 기록: POST /api/report/:id/attest → /api/attest-jobs/:id 400ms 폴링
  const attest = useCallback(async (id, { backend = "local", force = false } = {}) => {
    const key = `attest:${id}`;
    if (busy.current.has(key)) return;
    busy.current.add(key);
    setJobs(m => ({ ...m, [id]: { id: null, reportId: id, backend, force, status: "queued", reused: false, error: null } }));
    try {
      const { attestJobId } = await api.attest(id, { backend, force });
      for (;;) {
        const j = await api.attestJob(attestJobId);
        setJobs(m => ({ ...m, [id]: j }));
        if (j.status === "done") {
          setRecords(m => ({ ...m, [id]: { status: "ready", record: j.attestation, error: null } }));
          // 새 UID로 기록했으면 이전 검증 결과는 더 이상 이 기록의 결과가 아니다
          if (!j.reused) setVerifies(m => { const { [id]: _, ...rest } = m; return rest; });
          return;
        }
        if (j.status === "error") {
          setJobs(m => ({ ...m, [id]: { ...j, failure: { code: null, message: j.error, network: false } } }));
          return;
        }
        await sleep(POLL_MS);
      }
    } catch (err) {
      setJobs(m => ({ ...m, [id]: { ...(m[id] ?? {}), status: "error", error: err.message, failure: failure(err) } }));
    } finally {
      busy.current.delete(key);
    }
  }, []);

  // 검증: POST /api/report/:id/verify { tamper? } (tamper는 서버 메모리 사본만 바꾼다)
  const verify = useCallback(async (id, { tamper = null } = {}) => {
    const key = `verify:${id}`;
    if (busy.current.has(key)) return;
    busy.current.add(key);
    setVerifies(m => ({ ...m, [id]: { ...(m[id] ?? {}), status: "running", tamper, error: null } }));
    try {
      const result = await api.verify(id, { tamper });
      setVerifies(m => ({ ...m, [id]: { status: "done", result, error: null, tamper } }));
    } catch (err) {
      setVerifies(m => ({ ...m, [id]: { status: "error", result: null, error: failure(err), tamper } }));
    } finally {
      busy.current.delete(key);
    }
  }, []);

  const phaseOf = useCallback(id => (id ? attestPhase({ online, local, entry: records[id], job: jobs[id] }) : null),
    [online, local, records, jobs]);

  // 시나리오 → recorded | prerecorded (이번 세션에서 직접 기록한 것이 우선)
  const scenarioMarks = useMemo(() => {
    const out = {};
    for (const [sc, rec] of Object.entries(fixtures)) if (rec) out[sc] = "prerecorded";
    for (const e of Object.values(records)) {
      if (e.record && !e.record.prerecorded && e.record.scenario) out[e.record.scenario] = "recorded";
    }
    return out;
  }, [fixtures, records]);

  const value = useMemo(() => ({
    options, local, records, jobs, verifies, attest, verify, phaseOf, scenarioMarks,
    currentPhase: phaseOf(reportId)
  }), [options, local, records, jobs, verifies, attest, verify, phaseOf, scenarioMarks, reportId]);

  return <AttestContext.Provider value={value}>{children}</AttestContext.Provider>;
}

export function useAttest() {
  const ctx = useContext(AttestContext);
  if (!ctx) throw new Error("useAttest는 AttestProvider 안에서만 쓸 수 있습니다.");
  return ctx;
}
