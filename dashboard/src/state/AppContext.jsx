// 앱 상태: 선택 시나리오, 현재 작업·리포트, 실행 기록, 서버 상태, 용어집.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";
import { readStored, writeStored } from "./storage.js";

const AppContext = createContext(null);
const POLL_MS = 400;
const HEALTH_MS = 10000;
const SCENARIO_KEY = "pbl-demo.scenario";

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function AppProvider({ children }) {
  const [health, setHealth] = useState({ state: "checking", data: null });
  const [scenarios, setScenarios] = useState([]);
  const [glossary, setGlossary] = useState({});
  const [selected, setSelected] = useState(() => readStored(SCENARIO_KEY));
  const [useFixture, setUseFixture] = useState(false);
  const [job, setJob] = useState(null);
  const [history, setHistory] = useState([]);
  const [current, setCurrent] = useState({ status: "idle", reportId: null, data: null, error: null });
  const [lastByScenario, setLastByScenario] = useState({});
  const handledScenario = useRef(null); // 딥링크·선택으로 이미 처리한 시나리오 (중복 자동 로드 방지)
  const runToken = useRef(0);

  // 서버 상태 (10초마다)
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const data = await api.health();
        if (alive) setHealth({ state: "up", data });
      } catch (err) {
        if (alive) setHealth({ state: "down", data: null, error: err.message });
      }
    };
    check();
    const t = setInterval(check, HEALTH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // 시나리오 목록·용어집은 서버가 연결되면 한 번 읽는다
  useEffect(() => {
    if (health.state !== "up" || scenarios.length) return;
    api.scenarios().then(setScenarios).catch(() => {});
    api.glossary().then(setGlossary).catch(() => {});
  }, [health.state, scenarios.length]);

  const selectScenario = useCallback(id => {
    handledScenario.current = id;
    setSelected(id);
    writeStored(SCENARIO_KEY, id);
  }, []);

  const openReport = useCallback(async (reportId, meta = {}) => {
    const token = ++runToken.current;
    setCurrent(c => ({ ...c, status: "loading", error: null }));
    try {
      const [bundle, timeseries, ontology] = await Promise.all([
        api.report(reportId), api.timeseries(reportId), api.ontology(reportId)
      ]);
      if (token !== runToken.current) return;
      setCurrent({ status: "ready", reportId, data: { ...bundle, timeseries, ontology, job: meta.job ?? null }, error: null });
      const v = bundle.view;
      setLastByScenario(m => ({ ...m, [v.scenario]: {
        typeLabel: v.patterns.fraudTypeLabel,
        comboLabel: v.combination.label,
        comboKey: `${v.combination.codeRisk}-${v.combination.walletRisk}`
      } }));
      setHistory(h => h.map(e => (e.jobId === reportId ? { ...e, hash: bundle.envelope.report_sha256 } : e)));
    } catch (err) {
      if (token !== runToken.current) return;
      setCurrent(c => ({ ...c, status: "error", error: err }));
    }
  }, []);

  // 분석 실행: POST /api/analyze → /api/jobs/:id 400ms 폴링 → 리포트 열기
  const analyze = useCallback(async (scenario, mode) => {
    let jobId;
    try {
      ({ jobId } = await api.analyze(scenario, mode));
    } catch (err) {
      setJob({ id: null, scenario, mode, status: "error", error: err.message, stages: [] });
      setCurrent(c => ({ ...c, status: c.data ? "ready" : "error", error: c.data ? null : err }));
      return;
    }
    const startedAt = Date.now();
    setHistory(h => [{ jobId, scenario, mode, startedAt, status: "queued", source: null, hash: null, fallbackReason: null }, ...h]);
    for (;;) {
      let j;
      try {
        j = await api.job(jobId);
      } catch (err) {
        setJob(prev => ({ ...(prev ?? {}), id: jobId, scenario, mode, status: "error", error: err.message }));
        setHistory(h => h.map(e => (e.jobId === jobId ? { ...e, status: "error" } : e)));
        return;
      }
      setJob(j);
      setHistory(h => h.map(e => (e.jobId === jobId ? { ...e, status: j.status, source: j.source, fallbackReason: j.fallbackReason } : e)));
      if (j.status === "done") {
        await openReport(j.reportId, { job: j });
        return;
      }
      if (j.status === "error") return;
      await sleep(POLL_MS);
    }
  }, [openReport]);

  const value = useMemo(() => ({
    health, scenarios, glossary, selected, selectScenario, useFixture, setUseFixture,
    job, history, current, lastByScenario, analyze, openReport, handledScenario
  }), [health, scenarios, glossary, selected, selectScenario, useFixture, job, history, current, lastByScenario, analyze, openReport]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp은 AppProvider 안에서만 쓸 수 있습니다.");
  return ctx;
}
