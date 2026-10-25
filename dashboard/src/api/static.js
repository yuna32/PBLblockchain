// 정적 모드 API 어댑터: /api 대신 snapshot/ 아래 JSON(npm run demo:export가 만든 것)을 읽는다.
// 서버 API와 같은 모양으로 돌려주며, 리포트 id는 시나리오 id다. 서버가 필요한 기능은 static_mode 오류를 낸다.
// 증명 파일(attestation.json)은 index.json에서 상태 A인 시나리오만 읽는다(없는 파일을 요청해 404를 만들지 않는다).
import { ApiError } from "./errors.js";
import { attestStatusOf } from "../lib/attestStatus.js";

export const SNAPSHOT_BASE = `${import.meta.env?.BASE_URL ?? "/"}snapshot/`;
const SCENARIO_ID = /^[a-z][a-z0-9_-]*$/;

export function createStaticApi({ base = SNAPSHOT_BASE, fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  async function getJson(rel) {
    let res;
    try {
      res = await fetchImpl(`${base}${rel}`);
    } catch {
      throw new ApiError("스냅샷을 불러올 수 없습니다 (네트워크 오류).", { network: true });
    }
    if (!res.ok) throw new ApiError(`스냅샷 파일이 없습니다: ${rel} (HTTP ${res.status})`, { status: res.status, code: "snapshot_missing" });
    return res.json();
  }

  let indexPromise = null;
  const index = () => {
    indexPromise ??= getJson("index.json").catch(err => { indexPromise = null; throw err; });
    return indexPromise;
  };

  async function scenarioFile(id, file) {
    const idx = await index();
    if (!SCENARIO_ID.test(String(id)) || !idx.scenarios.some(s => s.id === id)) {
      throw new ApiError(`스냅샷에 없는 시나리오: ${id}`, { status: 404, code: "report_not_found" });
    }
    return getJson(`${id}/${file}`);
  }

  const unsupported = () => Promise.reject(new ApiError("정적 데모에서는 쓸 수 없습니다 (로컬 서버 모드에서 사용 가능).", { code: "static_mode" }));

  return {
    static: true,
    health: async () => ({ static: true, hardhatUsable: false }),
    snapshotIndex: index,
    scenarios: async () => (await index()).scenarios.map(({ id, label, expectedType, description }) => ({ id, label, expectedType, description })),
    glossary: async () => (await index()).glossary,
    report: async id => {
      const [report, envelope, view] = await Promise.all([scenarioFile(id, "report.json"), scenarioFile(id, "envelope.json"), scenarioFile(id, "viewmodel.json")]);
      return { report, envelope, view };
    },
    timeseries: id => scenarioFile(id, "timeseries.json"),
    ontology: id => scenarioFile(id, "ontology.json"),
    canonical: id => scenarioFile(id, "canonical.json"),
    // 상태 A면 attestation.json, 아니면 null. 파일 내용도 다시 판정한다(기능 감지).
    attestation: async id => {
      const s = (await index()).scenarios.find(x => x.id === id);
      if (s?.attestStatus !== "A") return null;
      const att = await scenarioFile(id, "attestation.json");
      return attestStatusOf(att) === "A" ? att : null;
    },
    analyze: unsupported,
    job: unsupported,
    attestBackends: unsupported,
    fixtureAttestations: unsupported,
    attest: unsupported,
    attestJob: unsupported,
    verify: unsupported
  };
}
