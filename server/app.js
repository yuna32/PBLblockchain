// 시연용 로컬 API (node:http, 외부 패키지 없음).
//   GET  /api/health                  { node, hardhatUsable, fixturesAvailable }
//   GET  /api/scenarios               [{ id, label, expectedType, description }]
//   POST /api/analyze                 { scenario, mode: "auto" | "fixture" } → 202 { jobId }
//   GET  /api/jobs/:id                { status, stage, source, reportId, error, ... }
//   GET  /api/report/:id              { report, envelope, view }
//   GET  /api/report/:id/timeseries   거래 행 배열
//   GET  /api/report/:id/canonical    { canonical, hash }
//   GET  /api/report/:id/ontology     { nodes, links, highlight, meta }
//   GET  /api/glossary                { [id]: { ko, desc, category } }
//   GET  /api/attest/backends         [{ id, label, available, reason?, mode?, chainId?, explorerBase?, prerecorded?, ... }]
//   POST /api/report/:id/attest       { backend: "local" | "eas-sepolia", force? } → 202 { attestJobId }
//                                     (읽기 전용·잔액 부족·스키마 미등록은 409, RPC 불가는 503 — 큐에 넣기 전에)
//   GET  /api/attest-jobs/:id         { status, attestation, reused, error, errorCode, ... }
//   GET  /api/report/:id/attestation?backend=   기록 (없으면 404 attestation_not_found, backend 생략 시 local)
//   POST /api/report/:id/verify       { backend?, uid?, tamper? } → { verified, hashMatch, fields, changedPaths, tamperDemo }
//   GET  /api/fixtures/attestations?backend=    시나리오별 사전 기록
// 오류는 { error, code } JSON.

import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { SCENARIOS, FIXTURES_DIR, checkNode } from "../demo/run.js";
import { canonicalize, hashableReport, sha256Hex } from "../demo/lib/canonical.js";
import { toTimeseries } from "../demo/lib/timeseries.js";
import { buildViewModel } from "../demo/lib/viewmodel.js";
import { GLOSSARY } from "../demo/lib/glossary.js";
import { buildOntologyGraph } from "../demo/lib/ontologygraph.js";
import { SCENARIO_LIST } from "./scenarios.js";
import { JobQueue, publicJob } from "./jobs.js";
import { AttestError, createAttestManager } from "./attest.js";

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
export const DEFAULT_RUNS_DIR = path.join(PROJECT_ROOT, "demo", "runs");
export const DEV_ORIGIN = "http://localhost:5173";
export const OWL_RESULTS_PATH = path.join(PROJECT_ROOT, "ontology", "owl_results.json");

// 온톨로지 그래프 meta.owlInferred용 참고 자료. 없거나 읽을 수 없으면 null.
function loadOwlResults(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const MODES = new Set(["auto", "fixture"]);
const MAX_BODY_BYTES = 64 * 1024;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError(413, "body_too_large", `요청 본문이 ${MAX_BODY_BYTES} bytes를 넘음`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function fixturesAvailable() {
  return Object.entries(SCENARIOS).every(([name, spec]) =>
    ["report.json", "envelope.json", spec.csv].every(f => fs.existsSync(path.join(FIXTURES_DIR, name, f))));
}

// options.runsDir: 작업 결과 디렉터리 (기본 demo/runs), options.runOptions: runScenario 옵션 (시험용),
// options.allowedOrigin: CORS 허용 출처 (기본 http://localhost:5173),
// options.owlResults: owl_results.json 내용 (기본 ontology/owl_results.json을 읽음),
// options.attest: 온체인 기록 설정 { enabled, rpcUrl, hardhatCli, nodeBin, startTimeoutMs, prerecord,
//   eas, easTuning, easFixturesFile } (기본 꺼짐). eas는 demo/lib/attest/config.js easConfigFromEnv()의 값.
//   반환값의 attest.start()로 로컬 체인을 시작하고 eas-sepolia 연결을 점검한다(server/index.js가 호출).
export function createApp(options = {}) {
  const {
    runsDir = DEFAULT_RUNS_DIR,
    runOptions = {},
    allowedOrigin = DEV_ORIGIN,
    owlResults = loadOwlResults(OWL_RESULTS_PATH),
    attest: attestOptions = { enabled: false }
  } = options;
  const queue = new JobQueue({ runsDir, runOptions });
  const attest = createAttestManager({ options: attestOptions, projectRoot: PROJECT_ROOT, getJob: id => queue.get(id), loadReport });

  // 본문이 없으면 {}. JSON 객체가 아니면 400.
  async function readJsonObject(req) {
    let body;
    try {
      body = JSON.parse(await readBody(req) || "{}");
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(400, "invalid_json", "요청 본문이 JSON이 아님");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "invalid_body", "요청 본문은 JSON 객체여야 함");
    return body;
  }

  function loadReport(id) {
    const job = queue.get(id);
    if (!job) throw new ApiError(404, "report_not_found", `리포트 없음: ${id}`);
    if (job.status !== "done") {
      throw new ApiError(409, "report_not_ready", `작업이 끝나지 않음 (status: ${job.status})`);
    }
    const spec = SCENARIOS[job.scenario];
    const read = f => fs.readFileSync(path.join(job.outDir, f), "utf8");
    return {
      report:   JSON.parse(read("report.json")),
      envelope: JSON.parse(read("envelope.json")),
      csvText:  read(spec.csv)
    };
  }

  async function route(req, res, url) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "api") throw new ApiError(404, "not_found", `경로 없음: ${url.pathname}`);
    const [, resource, id, sub] = parts;
    const method = req.method;
    const allow = expected => {
      if (method !== expected) throw new ApiError(405, "method_not_allowed", `${method} ${url.pathname} 지원하지 않음`);
    };

    if (resource === "health" && parts.length === 2) {
      allow("GET");
      return sendJson(res, 200, {
        node: process.version,
        hardhatUsable: checkNode(runOptions.nodeBin ?? process.execPath).ok,
        fixturesAvailable: fixturesAvailable()
      });
    }

    if (resource === "scenarios" && parts.length === 2) {
      allow("GET");
      return sendJson(res, 200, SCENARIO_LIST);
    }

    if (resource === "glossary" && parts.length === 2) {
      allow("GET");
      return sendJson(res, 200, GLOSSARY);
    }

    if (resource === "analyze" && parts.length === 2) {
      allow("POST");
      let body;
      try {
        body = JSON.parse(await readBody(req) || "null");
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError(400, "invalid_json", "요청 본문이 JSON이 아님");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new ApiError(400, "invalid_body", "요청 본문은 { scenario, mode } 객체여야 함");
      }
      const { scenario, mode = "auto" } = body;
      if (typeof scenario !== "string" || !SCENARIOS[scenario]) {
        throw new ApiError(400, "unknown_scenario", `알 수 없는 시나리오: ${scenario} (가능한 값: ${Object.keys(SCENARIOS).join(", ")})`);
      }
      if (!MODES.has(mode)) {
        throw new ApiError(400, "invalid_mode", `mode는 "auto" 또는 "fixture" (받은 값: ${mode})`);
      }
      const job = queue.submit(scenario, mode);
      return sendJson(res, 202, { jobId: job.id });
    }

    if (resource === "jobs" && id && parts.length === 3) {
      allow("GET");
      const job = queue.get(id);
      if (!job) throw new ApiError(404, "job_not_found", `작업 없음: ${id}`);
      return sendJson(res, 200, publicJob(job));
    }

    if (resource === "attest" && id === "backends" && parts.length === 3) {
      allow("GET");
      return sendJson(res, 200, attest.backends());
    }

    if (resource === "attest-jobs" && id && parts.length === 3) {
      allow("GET");
      return sendJson(res, 200, attest.job(id));
    }

    if (resource === "fixtures" && id === "attestations" && parts.length === 3) {
      allow("GET");
      return sendJson(res, 200, attest.fixtureAttestations(url.searchParams.get("backend") ?? undefined));
    }

    if (resource === "report" && id && parts.length === 4 && sub === "attest") {
      allow("POST");
      const body = await readJsonObject(req);
      const job = await attest.submit(id, { backend: body.backend ?? "local", force: body.force === true });
      return sendJson(res, 202, { attestJobId: job.id });
    }

    if (resource === "report" && id && parts.length === 4 && sub === "attestation") {
      allow("GET");
      return sendJson(res, 200, attest.attestation(id, url.searchParams.get("backend") ?? undefined));
    }

    if (resource === "report" && id && parts.length === 4 && sub === "verify") {
      allow("POST");
      const body = await readJsonObject(req);
      return sendJson(res, 200, await attest.verify(id, body));
    }

    if (resource === "report" && id && parts.length <= 4) {
      allow("GET");
      const { report, envelope, csvText } = loadReport(id);
      if (!sub) {
        const view = buildViewModel({ report, envelope, rows: toTimeseries(csvText) });
        return sendJson(res, 200, { report, envelope, view });
      }
      if (sub === "timeseries") return sendJson(res, 200, toTimeseries(csvText));
      if (sub === "canonical") {
        const canonical = canonicalize(hashableReport(report));
        return sendJson(res, 200, { canonical, hash: sha256Hex(canonical) });
      }
      if (sub === "ontology") return sendJson(res, 200, buildOntologyGraph(report, { owlResults }));
    }

    throw new ApiError(404, "not_found", `경로 없음: ${url.pathname}`);
  }

  const server = http.createServer(async (req, res) => {
    if (req.headers.origin === allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600"
      });
      return res.end();
    }
    try {
      await route(req, res, new URL(req.url, "http://localhost"));
    } catch (err) {
      if (err instanceof ApiError || err instanceof AttestError) {
        return sendJson(res, err.status, { error: attest.redact(err.message), code: err.code });
      }
      console.error(attest.redact(err?.stack ?? err));
      sendJson(res, 500, { error: attest.redact(err.message), code: "internal_error" });
    }
  });

  return { server, queue, attest };
}
