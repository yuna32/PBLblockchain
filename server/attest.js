// 온체인 기록 관리: 백엔드 시작, fixture 5개 사전 기록, 기록 작업 큐(직렬), 리포트별 기록 조회, 검증.
// 상태는 메모리에만 둔다(로컬 체인은 서버를 다시 띄우면 새로 시작하고 사전 기록도 다시 한다).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { SCENARIOS, FIXTURES_DIR } from "../demo/run.js";
import { canonicalize, hashableReport } from "../demo/lib/canonical.js";
import { toTimeseries } from "../demo/lib/timeseries.js";
import { buildPayload } from "../demo/lib/attest/schema.js";
import { TamperError, verifyAgainstChain } from "../demo/lib/attest/verify.js";
import { createAttestService } from "../demo/lib/attest/index.js";
import { analyzerVersion } from "../demo/lib/attest/version.js";

export class AttestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UID_PATTERN = /^0x[0-9a-fA-F]{64}$/;

// 응답용: 기록 당시 canonical 스냅샷은 내보내지 않고 존재 여부만 알린다
export function publicRecord(rec) {
  if (!rec || rec.error) return null;
  const { snapshot, ...rest } = rec;
  return { ...rest, canonicalSnapshot: Boolean(snapshot) };
}

// options: createAttestService 옵션 + prerecord(기본 true). getJob(id): 분석 작업, loadReport(id): { report, envelope, csvText }
export function createAttestManager({ options = {}, projectRoot, getJob, loadReport }) {
  const service = createAttestService(options);
  const version = analyzerVersion(projectRoot);
  const records = new Map();         // reportId → 기록
  const fixtureRecords = new Map();  // scenario → 사전 기록 또는 { error }
  const jobs = new Map();
  let tail = Promise.resolve();
  let state = options.enabled ? "starting" : "disabled";

  const snapshotOf = report => canonicalize(hashableReport(report));

  async function prerecordFixtures() {
    const local = service.get("local");
    for (const name of Object.keys(SCENARIOS)) {
      try {
        const dir = path.join(FIXTURES_DIR, name);
        const read = f => fs.readFileSync(path.join(dir, f), "utf8");
        const report = JSON.parse(read("report.json"));
        const envelope = JSON.parse(read("envelope.json"));
        const rows = toTimeseries(read(SCENARIOS[name].csv));
        const payload = buildPayload({ report, envelope, rows, analyzerVersion: version });
        const att = await local.attest(payload);
        fixtureRecords.set(name, { ...att, reportId: null, scenario: name, prerecorded: true, snapshot: snapshotOf(report) });
      } catch (err) {
        fixtureRecords.set(name, { error: service.redact(err.message) });
      }
    }
  }

  // 직접 기록이 없으면, fixture 모드로 만든 리포트는 같은 해시의 사전 기록과 연결한다
  function recordFor(reportId) {
    const direct = records.get(reportId);
    if (direct) return direct;
    const job = getJob(reportId);
    if (!job || job.mode !== "fixture" || job.status !== "done") return null;
    const rec = fixtureRecords.get(job.scenario);
    if (!rec || rec.error) return null;
    const { envelope } = loadReport(reportId);
    if (rec.payload.reportHash !== `0x${envelope.report_sha256}`) return null;
    return { ...rec, reportId };
  }

  function findSnapshot(uid) {
    for (const rec of [...records.values(), ...fixtureRecords.values()]) {
      if (rec.uid === uid && rec.snapshot) return rec.snapshot;
    }
    return null;
  }

  function requireBackend(id) {
    const backend = service.get(id);
    if (!backend) throw new AttestError(400, "unknown_backend", `알 수 없는 기록 방식: ${id} (가능한 값: local, eas-sepolia)`);
    if (!backend.available) throw new AttestError(409, "backend_unavailable", `${id} 기록 방식을 쓸 수 없습니다: ${backend.reason}`);
    return backend;
  }

  async function run(job) {
    job.status = "running";
    try {
      const existing = recordFor(job.reportId);
      if (existing && !job.force) {
        job.attestation = existing;
        job.reused = true;
      } else {
        const backend = requireBackend(job.backend);
        const { report, envelope, csvText } = loadReport(job.reportId);
        const payload = buildPayload({ report, envelope, rows: toTimeseries(csvText), analyzerVersion: version });
        const att = await backend.attest(payload);
        const rec = { ...att, reportId: job.reportId, scenario: getJob(job.reportId)?.scenario ?? null, prerecorded: false, snapshot: snapshotOf(report) };
        records.set(job.reportId, rec);
        job.attestation = rec;
      }
      job.status = "done";
    } catch (err) {
      job.status = "error";
      job.error = service.redact(err.message);
    } finally {
      job.finishedAt = Date.now();
    }
  }

  return {
    analyzerVersion: version,

    async start() {
      const result = await service.start();
      if (result.available && options.prerecord !== false) {
        state = "prerecording";
        await prerecordFixtures();
      }
      state = result.available ? "ready" : "unavailable";
      const prerecorded = [...fixtureRecords.values()].filter(r => !r.error).length;
      return { ...result, prerecorded };
    },

    stop: () => service.stop(),
    killSync: () => service.killSync(),
    get chainPid() { return service.chainPid; },
    get state() { return state; },

    backends: () => service.list(),

    fixtureAttestations() {
      return Object.fromEntries(Object.keys(SCENARIOS).map(name => [name, publicRecord(fixtureRecords.get(name))]));
    },

    attestation(reportId) {
      loadReport(reportId); // 없는 리포트 404, 끝나지 않은 작업 409
      const rec = recordFor(reportId);
      if (!rec) throw new AttestError(404, "attestation_not_found", `이 리포트의 온체인 기록이 없습니다: ${reportId}`);
      return publicRecord(rec);
    },

    submit(reportId, { backend = "local", force = false } = {}) {
      requireBackend(backend);
      loadReport(reportId);
      const job = {
        id: crypto.randomUUID(), reportId, backend, force: Boolean(force),
        status: "queued", reused: false, attestation: null, error: null,
        createdAt: Date.now(), finishedAt: null
      };
      jobs.set(job.id, job);
      tail = tail.then(() => run(job));
      return job;
    },

    job(id) {
      const job = jobs.get(id);
      if (!job) throw new AttestError(404, "attest_job_not_found", `기록 작업 없음: ${id}`);
      const { attestation, ...rest } = job;
      return { ...rest, attestation: publicRecord(attestation) };
    },

    // body: { uid?, backend?, tamper? }. tamper는 메모리 사본만 바꾸며 어떤 것도 저장하지 않는다.
    async verify(reportId, body = {}) {
      const { report, csvText } = loadReport(reportId);
      const rec = recordFor(reportId);
      const uid = body.uid ?? rec?.uid;
      if (!uid) throw new AttestError(404, "attestation_not_found", `이 리포트의 온체인 기록이 없습니다: ${reportId}`);
      if (typeof uid !== "string" || !UID_PATTERN.test(uid)) throw new AttestError(400, "invalid_uid", "uid는 0x로 시작하는 64자리 16진수여야 합니다.");
      const backendId = body.backend ?? (rec && rec.uid === uid ? rec.backend : "local");
      const backend = requireBackend(backendId);
      const onChain = await backend.read(uid);
      if (!onChain) throw new AttestError(404, "attestation_not_found_onchain", `체인에 해당 uid의 기록이 없습니다: ${uid}`);
      if (!onChain.payload) throw new AttestError(409, "schema_mismatch", "기록의 스키마가 이 서버의 스키마와 다릅니다.");
      let result;
      try {
        result = verifyAgainstChain({
          report, rows: toTimeseries(csvText), onChain: onChain.payload,
          snapshot: findSnapshot(uid), tamper: body.tamper ?? null, analyzerVersion: version
        });
      } catch (err) {
        if (err instanceof TamperError) throw new AttestError(400, err.code, err.message);
        throw err;
      }
      return { uid, backend: backendId, ...result, onChainRecord: { attester: onChain.attester, time: onChain.time, revoked: onChain.revoked } };
    },

    redact: text => service.redact(text)
  };
}
