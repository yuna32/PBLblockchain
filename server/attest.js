// 온체인 기록 관리: 백엔드 시작, fixture 사전 기록(local은 시작 때 기록, eas-sepolia는 JSON 파일에서 연결),
// 기록 작업 큐(직렬), 리포트별·백엔드별 기록 조회, 검증.
// 상태는 메모리에만 둔다(로컬 체인은 서버를 다시 띄우면 새로 시작하고 사전 기록도 다시 한다).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { SCENARIOS, FIXTURES_DIR } from "../demo/run.js";
import { toTimeseries } from "../demo/lib/timeseries.js";
import { canonicalize, hashableReport, reportHash } from "../demo/lib/attest/jcs.js";
import { buildPayload } from "../demo/lib/attest/schema.js";
import { TamperError, verifyAgainstChain } from "../demo/lib/attest/verify.js";
import { createAttestService } from "../demo/lib/attest/index.js";
import { BACKEND_ERROR_STATUS, BackendError } from "../demo/lib/attest/errors.js";
import { EAS_FIXTURES_BASENAME } from "../demo/lib/attest/config.js";
import { analyzerVersion } from "../demo/lib/attest/version.js";

export class AttestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const BACKEND_IDS = ["local", "eas-sepolia"];
// demo:eas:record-fixtures가 만드는 파일 (시나리오 → 기록, 비밀 정보 없음)
export const EAS_FIXTURES_FILE = path.join(FIXTURES_DIR, EAS_FIXTURES_BASENAME);

const UID_PATTERN = /^0x[0-9a-fA-F]{64}$/;
// 사전 기록 JSON에서 읽는 필드 (그 밖의 값은 버린다)
const EAS_FIXTURE_FIELDS = ["uid", "txHash", "chainId", "attester", "schemaUID", "contract", "blockNumber", "recordedAt", "reportHash", "payload"];

// 응답용: 기록 당시 canonical 스냅샷은 내보내지 않고 존재 여부만 알린다
export function publicRecord(rec) {
  if (!rec || rec.error) return null;
  const { snapshot, ...rest } = rec;
  return { ...rest, canonicalSnapshot: Boolean(snapshot) };
}

// options: createAttestService 옵션 + prerecord(기본 true), easFixturesFile(기본 demo/fixtures/attestations.sepolia.json)
// getJob(id): 분석 작업, loadReport(id): { report, envelope, csvText }
export function createAttestManager({ options = {}, projectRoot, getJob, loadReport }) {
  const service = createAttestService(options);
  const version = analyzerVersion(projectRoot);
  const easFixturesFile = options.easFixturesFile ?? EAS_FIXTURES_FILE;
  const records = new Map();                                            // `${backend}:${reportId}` → 기록
  const fixtureRecords = { local: new Map(), "eas-sepolia": new Map() }; // backend → scenario → 사전 기록
  const easFixtures = { loaded: 0, ignored: 0, stale: 0, error: null };
  const jobs = new Map();
  let tail = Promise.resolve();
  let state = options.enabled ? "starting" : "disabled";

  const key = (backend, reportId) => `${backend}:${reportId}`;
  const snapshotOf = report => canonicalize(hashableReport(report));
  const hide = text => service.redact(text);

  function readFixture(name) {
    const dir = path.join(FIXTURES_DIR, name);
    const read = f => fs.readFileSync(path.join(dir, f), "utf8");
    return { report: JSON.parse(read("report.json")), envelope: JSON.parse(read("envelope.json")), rows: toTimeseries(read(SCENARIOS[name].csv)) };
  }

  async function prerecordLocal() {
    const local = service.get("local");
    for (const name of Object.keys(SCENARIOS)) {
      try {
        const { report, envelope, rows } = readFixture(name);
        const payload = buildPayload({ report, envelope, rows, analyzerVersion: version });
        const att = await local.attest(payload);
        fixtureRecords.local.set(name, { ...att, reportId: null, scenario: name, prerecorded: true, snapshot: snapshotOf(report) });
      } catch (err) {
        fixtureRecords.local.set(name, { error: hide(err.message) });
      }
    }
  }

  // eas-sepolia 사전 기록: JSON 파일의 기록을 시나리오에 연결한다(체인 호출 없음).
  // 체인 ID나 EAS 주소가 지금 설정과 다르면 무시하고, fixture 리포트가 기록 뒤 바뀌었으면 stale로 표시한다.
  function loadEasFixtures() {
    const backend = service.get("eas-sepolia");
    fixtureRecords["eas-sepolia"].clear();
    Object.assign(easFixtures, { loaded: 0, ignored: 0, stale: 0, error: null });
    if (!backend.available || !fs.existsSync(easFixturesFile)) return;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(easFixturesFile, "utf8"));
    } catch {
      easFixtures.error = `${path.basename(easFixturesFile)}을(를) 읽을 수 없습니다`;
      return;
    }
    for (const [name, entry] of Object.entries(data && typeof data === "object" ? data : {})) {
      const valid = SCENARIOS[name] && entry && typeof entry === "object" && UID_PATTERN.test(entry.uid ?? "") &&
        entry.chainId === backend.chainId && String(entry.contract).toLowerCase() === backend.easAddress && entry.payload;
      if (!valid) { easFixtures.ignored += 1; continue; }
      const { report } = readFixture(name);
      const stale = String(entry.reportHash).toLowerCase() !== `0x${reportHash(report)}`;
      const picked = Object.fromEntries(EAS_FIXTURE_FIELDS.map(f => [f, entry[f]]));
      fixtureRecords["eas-sepolia"].set(name, {
        ...picked,
        backend: "eas-sepolia",
        explorerUrl: backend.explorerUrl(entry.uid),
        meta: backend.meta(),
        reportId: null,
        scenario: name,
        prerecorded: true,
        stale,
        snapshot: stale ? null : snapshotOf(report)
      });
      easFixtures.loaded += 1;
      if (stale) easFixtures.stale += 1;
    }
  }

  // 직접 기록이 없으면, fixture 모드로 만든 리포트는 그 시나리오의 사전 기록과 연결한다.
  // local은 해시가 같을 때만, eas-sepolia는 영구 기록이라 해시가 달라도 연결한다(검증에서 불일치로 드러난다).
  function recordFor(backend, reportId) {
    const direct = records.get(key(backend, reportId));
    if (direct) return direct;
    const job = getJob(reportId);
    if (!job || job.mode !== "fixture" || job.status !== "done") return null;
    const rec = fixtureRecords[backend]?.get(job.scenario);
    if (!rec || rec.error) return null;
    if (backend === "local") {
      const { envelope } = loadReport(reportId);
      if (rec.payload.reportHash !== `0x${envelope.report_sha256}`) return null;
    }
    return { ...rec, reportId };
  }

  function findSnapshot(backend, uid) {
    const own = [...records.entries()].filter(([k]) => k.startsWith(`${backend}:`)).map(([, r]) => r);
    for (const rec of [...own, ...(fixtureRecords[backend]?.values() ?? [])]) {
      if (rec.uid === uid && rec.snapshot) return rec.snapshot;
    }
    return null;
  }

  function backendId(id) {
    if (id === undefined || id === null) return "local";
    if (typeof id !== "string" || !BACKEND_IDS.includes(id)) {
      throw new AttestError(400, "unknown_backend", `알 수 없는 기록 방식: ${String(id).slice(0, 40)} (가능한 값: ${BACKEND_IDS.join(", ")})`);
    }
    return id;
  }

  function requireBackend(id) {
    const backend = service.get(backendId(id));
    if (!backend.available) throw new AttestError(409, "backend_unavailable", `${backend.id} 기록 방식을 쓸 수 없습니다: ${backend.reason}`);
    return backend;
  }

  function toAttestError(err) {
    if (err instanceof AttestError) return err;
    if (err instanceof BackendError) return new AttestError(BACKEND_ERROR_STATUS[err.code] ?? 502, err.code, hide(err.message));
    return err;
  }

  function payloadFor(reportId) {
    const { report, envelope, csvText } = loadReport(reportId);
    return { report, payload: buildPayload({ report, envelope, rows: toTimeseries(csvText), analyzerVersion: version }) };
  }

  async function run(job) {
    job.status = "running";
    try {
      const existing = recordFor(job.backend, job.reportId);
      if (existing && !job.force) {
        job.attestation = existing;
        job.reused = true;
      } else {
        const backend = requireBackend(job.backend);
        const { report, payload } = payloadFor(job.reportId);
        const att = await backend.attest(payload);
        const rec = { ...att, reportId: job.reportId, scenario: getJob(job.reportId)?.scenario ?? null, prerecorded: false, snapshot: snapshotOf(report) };
        records.set(key(job.backend, job.reportId), rec);
        job.attestation = rec;
      }
      job.status = "done";
    } catch (err) {
      job.status = "error";
      job.error = hide(err.message);
      job.errorCode = err.code ?? null;
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
        await prerecordLocal();
      }
      loadEasFixtures();
      state = result.available ? "ready" : "unavailable";
      const prerecorded = [...fixtureRecords.local.values()].filter(r => !r.error).length;
      return { ...result, prerecorded, easPrerecorded: { ...easFixtures } };
    },

    stop: () => service.stop(),
    killSync: () => service.killSync(),
    get chainPid() { return service.chainPid; },
    get state() { return state; },

    backends() {
      return service.list().map(b => (b.id === "eas-sepolia" && b.available
        ? { ...b, prerecorded: easFixtures.loaded, prerecordedStale: easFixtures.stale }
        : b));
    },

    fixtureAttestations(backend) {
      const id = backendId(backend);
      return Object.fromEntries(Object.keys(SCENARIOS).map(name => [name, publicRecord(fixtureRecords[id].get(name))]));
    },

    attestation(reportId, backend) {
      const id = backendId(backend);
      loadReport(reportId); // 없는 리포트 404, 끝나지 않은 작업 409
      const rec = recordFor(id, reportId);
      if (!rec) throw new AttestError(404, "attestation_not_found", `이 리포트의 온체인 기록이 없습니다 (${id}): ${reportId}`);
      return publicRecord(rec);
    },

    // 기록 요청. 새로 기록해야 하면 큐에 넣기 전에 점검한다(읽기 전용, 스키마 미등록, 잔액 부족, RPC 불가 → 바로 오류).
    async submit(reportId, { backend = "local", force = false } = {}) {
      const b = requireBackend(backend);
      if (b.mode === "readonly") {
        throw new AttestError(409, "backend_read_only", `${b.id}는 읽기 전용입니다 (기록용 키 없음). 조회와 검증만 할 수 있습니다.`);
      }
      const existing = recordFor(b.id, reportId);
      if (!(existing && !force) && b.preflight) {
        const { payload } = payloadFor(reportId);
        try {
          await b.preflight(payload);
        } catch (err) {
          throw toAttestError(err);
        }
      } else {
        loadReport(reportId);
      }
      const job = {
        id: crypto.randomUUID(), reportId, backend: b.id, force: Boolean(force),
        status: "queued", reused: false, attestation: null, error: null, errorCode: null,
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

    // body: { backend?, uid?, tamper? }. tamper는 메모리 사본만 바꾸며 어떤 것도 저장하지 않는다.
    async verify(reportId, body = {}) {
      const { report, csvText } = loadReport(reportId);
      const backend = requireBackend(body.backend);
      const id = backend.id;
      const rec = recordFor(id, reportId);
      const uid = body.uid ?? rec?.uid;
      if (!uid) throw new AttestError(404, "attestation_not_found", `이 리포트의 온체인 기록이 없습니다 (${id}): ${reportId}`);
      if (typeof uid !== "string" || !UID_PATTERN.test(uid)) throw new AttestError(400, "invalid_uid", "uid는 0x로 시작하는 64자리 16진수여야 합니다.");
      let onChain;
      try {
        onChain = await backend.read(uid);
      } catch (err) {
        throw toAttestError(err);
      }
      if (!onChain) throw new AttestError(404, "attestation_not_found_onchain", `체인에 해당 uid의 기록이 없습니다: ${uid}`);
      if (!onChain.payload) throw new AttestError(409, "schema_mismatch", "기록의 스키마가 이 서버의 스키마와 다릅니다.");
      let result;
      try {
        result = verifyAgainstChain({
          report, rows: toTimeseries(csvText), onChain: onChain.payload,
          snapshot: findSnapshot(id, uid), tamper: body.tamper ?? null, analyzerVersion: version
        });
      } catch (err) {
        if (err instanceof TamperError) throw new AttestError(400, err.code, err.message);
        throw err;
      }
      return { uid, backend: id, ...result, onChainRecord: { attester: onChain.attester, time: onChain.time, revoked: onChain.revoked } };
    },

    redact: hide
  };
}
