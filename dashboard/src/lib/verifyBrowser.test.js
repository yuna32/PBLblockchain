// 정적 모드 브라우저 검증 시험. 실제 RPC 호출 없음(모의 클라이언트).
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { attestStatusOf, SEPOLIA_CHAIN_ID } from "./attestStatus.js";
import { canonicalize as browserCanonicalize, hashableReport as browserHashable, CANONICAL_VERSION as BROWSER_VERSION } from "./jcs.js";
import { verifyIntegrity, verifyOnchain, currentFields, integrityResult, onchainResult, applyTamper, LOOKUP_MESSAGES, MISMATCH_MESSAGE } from "./verifyBrowser.js";
import { decodePayload, SCHEMA as BROWSER_SCHEMA, EAS_READ_ABI } from "./onchain.js";
import { verifyView, tamperPresets } from "./attest.js";
import { createStaticApi } from "../api/static.js";
import * as canonical from "../../../demo/lib/canonical.js";
import { buildPayload, encodePayload, SCHEMA, schemaUID } from "../../../demo/lib/attest/schema.js";
import { EAS_ABI } from "../../../demo/lib/attest/abi.js";
import { GLOSSARY } from "../../../demo/lib/glossary.js";
import { SCENARIO_IDS, loadFixture } from "./testFixtures.js";

const UID = `0x${"ab".repeat(32)}`;
const TX = `0x${"cd".repeat(32)}`;

function snapshotOf(name, attestation = null) {
  const { report, envelope, rows } = loadFixture(name);
  const text = canonical.canonicalize(canonical.hashableReport(report));
  return { report, envelope, timeseries: rows, canonical: { canonical: text, hash: canonical.sha256Hex(text) }, attestation };
}

function sepoliaAttestation(name, overrides = {}) {
  const { report, envelope, rows } = loadFixture(name);
  return {
    scenario: name, uid: UID, txHash: TX, chainId: SEPOLIA_CHAIN_ID, schemaUID: schemaUID(),
    attester: "0x1111111111111111111111111111111111111111", contract: "0xc2679fbd37d54388ce493f1db75320d236e1815e",
    blockNumber: 1, recordedAt: "2026-10-25T00:00:00.000Z", reportHash: `0x${envelope.report_sha256}`, matchesSnapshotReport: true,
    payload: buildPayload({ report, envelope, rows, analyzerVersion: "x+jcs-rfc8785/pbl-demo-v1" }),
    explorerBase: "https://sepolia.easscan.org", explorerPathVerified: false, ...overrides
  };
}

// 모의 체인: chainId와 getAttestation 결과를 정한다. loadModule 호출 횟수를 센다.
function mockModule({ chainId = SEPOLIA_CHAIN_ID, attestation = null, chainError = false, readError = false } = {}) {
  const loadModule = vi.fn(async () => ({
    decodePayload,
    createReader: () => ({
      getChainId: async () => { if (chainError) throw new Error("fetch failed http://secret.example/rpc"); return chainId; },
      getAttestation: async () => { if (readError) throw new Error("timeout"); return attestation; }
    })
  }));
  return loadModule;
}
const onChainOf = (name, payloadOverrides = {}) => {
  const att = sepoliaAttestation(name);
  return { uid: UID, schema: att.schemaUID, attester: att.attester, revoked: false, data: encodePayload({ ...att.payload, ...payloadOverrides }) };
};

describe("증명 상태 판정", () => {
  it("파일 없음 → B, chainId 31337 → B, chainId 11155111 → A, 형식 오류 → B", () => {
    expect(attestStatusOf(null)).toBe("B");
    expect(attestStatusOf(undefined)).toBe("B");
    expect(attestStatusOf({ ...sepoliaAttestation("ponzi"), chainId: 31337 })).toBe("B");
    expect(attestStatusOf(sepoliaAttestation("ponzi"))).toBe("A");
    expect(attestStatusOf({ ...sepoliaAttestation("ponzi"), chainId: "11155111" })).toBe("B");
    expect(attestStatusOf({ ...sepoliaAttestation("ponzi"), uid: "0x1234" })).toBe("B");
    expect(attestStatusOf({ ...sepoliaAttestation("ponzi"), txHash: undefined })).toBe("B");
  });
});

describe("브라우저 canonical (jcs.js)은 demo/lib/canonical.js와 같다", () => {
  it("5개 fixture와 경계 사례", () => {
    expect(BROWSER_VERSION).toBe(canonical.CANONICAL_VERSION);
    for (const name of SCENARIO_IDS) {
      const { report } = loadFixture(name);
      expect(browserCanonicalize(browserHashable(report))).toBe(canonical.canonicalize(canonical.hashableReport(report)));
    }
    const edge = { b: [1, undefined, () => 1, "é\u0000\"\\", -0, 1e21, 0.1], a: { z: null, x: undefined }, "가": "나" };
    expect(browserCanonicalize(edge)).toBe(canonical.canonicalize(edge));
    expect(() => browserCanonicalize(NaN)).toThrow();
  });
});

describe("verifyIntegrity (WebCrypto SHA-256)", () => {
  for (const name of SCENARIO_IDS) {
    it(`${name}: 일치`, async () => {
      const r = await verifyIntegrity(snapshotOf(name));
      expect(r.ok).toBe(true);
      expect(r.localHash).toBe(`0x${loadFixture(name).envelope.report_sha256}`);
      expect(r.expectedHash).toBe(r.localHash);
      expect(r.canonicalMatches).toBe(true);
    });
  }

  it("값 변조 → 불일치와 바뀐 경로, 원본은 그대로", async () => {
    const snap = snapshotOf("ponzi");
    const before = JSON.stringify(snap.report);
    const r = await verifyIntegrity(snap, { tamper: { path: "trust.overall_trust_score", value: 95 } });
    expect([r.ok, r.tamperDemo, r.changedPaths]).toEqual([false, true, ["trust.overall_trust_score"]]);
    expect(r.localHash).not.toBe(r.expectedHash);
    expect(JSON.stringify(snap.report)).toBe(before);
    expect((await verifyIntegrity(snap)).ok).toBe(true);
  });

  it("배포된 canonical.json이 바뀌면 불일치, 없는 경로 변조는 오류", async () => {
    const snap = snapshotOf("normal");
    snap.canonical = { ...snap.canonical, canonical: snap.canonical.canonical.replace("\"trust_grade\":\"A\"", "\"trust_grade\":\"B\"") };
    expect((await verifyIntegrity(snap)).ok).toBe(false);
    expect(() => applyTamper(snap.report, { path: "trust.nope", value: 1 })).toThrow(/없는 경로/);
  });

  it("변조 프리셋(lib/attest.js tamperPresets)으로 모두 불일치", async () => {
    const snap = snapshotOf("pumpdump");
    for (const p of tamperPresets(snap.report, GLOSSARY)) {
      expect((await verifyIntegrity(snap, { tamper: { path: p.path, value: p.value } })).ok).toBe(false);
    }
  });
});

describe("verifyOnchain (모의 클라이언트)", () => {
  it("상태 B에서는 viem 모듈을 import하지 않는다", async () => {
    for (const att of [null, { ...sepoliaAttestation("ponzi"), chainId: 31337 }]) {
      const loadModule = mockModule();
      expect(await verifyOnchain(UID, snapshotOf("ponzi", att), { rpcUrl: "http://mock", loadModule })).toEqual({ status: "not_applicable" });
      expect(loadModule).not.toHaveBeenCalled();
    }
  });

  it("RPC 미설정 → 조회 실패(rpc_not_configured), import하지 않음", async () => {
    const loadModule = mockModule();
    const r = await verifyOnchain(UID, snapshotOf("ponzi", sepoliaAttestation("ponzi")), { rpcUrl: null, loadModule });
    expect([r.status, r.reason, r.message]).toEqual(["lookup_failed", "rpc_not_configured", LOOKUP_MESSAGES.rpc_not_configured]);
    expect(loadModule).not.toHaveBeenCalled();
  });

  it("일치", async () => {
    const loadModule = mockModule({ attestation: onChainOf("ponzi") });
    const r = await verifyOnchain(UID, snapshotOf("ponzi", sepoliaAttestation("ponzi")), { rpcUrl: "http://mock", loadModule });
    expect(r.status).toBe("match");
    expect(r.fields.map(f => f.name)).toEqual(["reportHash", "contractAddress", "codeRiskGrade", "trustScore", "minWalletTrustScore"]);
    expect(r.fields.every(f => f.match)).toBe(true);
    expect(loadModule).toHaveBeenCalledTimes(1);
    const view = verifyView(onchainResult(r), GLOSSARY, { kind: "onchain" });
    expect([view.label, view.verified]).toEqual(["온체인 기록과 일치", true]);
  });

  it("필드 불일치 → 검증 실패(불일치)", async () => {
    const loadModule = mockModule({ attestation: onChainOf("ponzi", { trustScore: 90 }) });
    const r = await verifyOnchain(UID, snapshotOf("ponzi", sepoliaAttestation("ponzi")), { rpcUrl: "http://mock", loadModule });
    expect([r.status, r.message]).toEqual(["mismatch", MISMATCH_MESSAGE]);
    expect(r.fields.filter(f => !f.match).map(f => f.name)).toEqual(["trustScore"]);
  });

  it("UID 없음 / 네트워크 오류 / 체인 불일치 / 스키마 다름 → 조회 실패(메시지에 RPC 주소 없음)", async () => {
    const snap = snapshotOf("rugpull", sepoliaAttestation("rugpull"));
    const cases = [
      [{ attestation: null }, "uid_not_found"],
      [{ chainError: true }, "network"],
      [{ readError: true, attestation: onChainOf("rugpull") }, "network"],
      [{ chainId: 1 }, "chain_mismatch"],
      [{ attestation: { ...onChainOf("rugpull"), schema: `0x${"99".repeat(32)}` } }, "schema_mismatch"]
    ];
    for (const [opts, reason] of cases) {
      const r = await verifyOnchain(UID, snap, { rpcUrl: "http://mock", loadModule: mockModule(opts) });
      expect([r.status, r.reason], reason).toEqual(["lookup_failed", reason]);
      expect(r.message).toBe(LOOKUP_MESSAGES[reason]);
      expect(r.message).not.toMatch(/secret|http/);
    }
  });

  it("현재 리포트에서 만든 비교 필드 = demo buildPayload", async () => {
    for (const name of SCENARIO_IDS) {
      const { report, envelope, rows } = loadFixture(name);
      const p = buildPayload({ report, envelope, rows, analyzerVersion: "x" });
      const c = currentFields(report, rows, `0x${envelope.report_sha256}`);
      for (const k of Object.keys(c)) expect(c[k], `${name}.${k}`).toEqual(p[k]);
    }
  });

  it("onchain.js의 스키마·ABI가 demo/lib/attest와 같다", () => {
    expect(BROWSER_SCHEMA).toBe(SCHEMA);
    const mine = EAS_READ_ABI.find(x => x.name === "getAttestation");
    const theirs = EAS_ABI.find(x => x.name === "getAttestation");
    expect(JSON.stringify(mine)).toBe(JSON.stringify(theirs));
    const att = sepoliaAttestation("laundering");
    expect(decodePayload(encodePayload(att.payload))).toEqual(att.payload);
  });
});

describe("무결성 결과 문구 (온체인 검증과 구분)", () => {
  it("상태 B: 일치·불일치 문구에 온체인 일치 표현 없음", async () => {
    const ok = verifyView(integrityResult(await verifyIntegrity(snapshotOf("normal"))), GLOSSARY, { kind: "integrity", attested: false });
    expect(ok.label).toBe("무결성 검증 일치");
    expect(ok.summary).toBe("무결성 검증: 일치 (이 데모는 아직 온체인에 기록되지 않았습니다)");
    expect(ok.hashLabels.recorded).toBe("envelope에 기록된 리포트 해시");
    expect(ok.rows).toEqual([]);
    const bad = verifyView(integrityResult(await verifyIntegrity(snapshotOf("normal"), { tamper: { path: "trust.trust_grade", value: "F" } })), GLOSSARY, { kind: "integrity" });
    expect(bad.label).toBe("무결성 검증 불일치");
    expect(bad.tamperDemo).toBe(true);
    expect(bad.changedPaths.map(c => c.path)).toEqual(["trust.trust_grade"]);
    for (const v of [ok, bad]) expect(`${v.label} ${v.summary}`).not.toMatch(/온체인 기록과|체인에 기록된 값/);
    expect(verifyView(integrityResult(await verifyIntegrity(snapshotOf("normal"))), GLOSSARY, { kind: "server" }).label).toBe("일치");
  });
});

describe("정적 API 어댑터 (snapshot/)", () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const SNAP = path.join(ROOT, "public", "snapshot");
  const fileFetch = vi.fn(async url => {
    const rel = String(url).replace(/^\/snapshot\//, "");
    const f = path.join(SNAP, rel);
    if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, "utf8")) };
  });

  it("스냅샷을 서버 응답 모양으로 읽고, 상태 B면 attestation.json을 요청하지 않는다", async () => {
    const api = createStaticApi({ base: "/snapshot/", fetchImpl: fileFetch });
    const list = await api.scenarios();
    expect(list.map(s => s.id)).toEqual(SCENARIO_IDS);
    expect(Object.keys(list[0]).sort()).toEqual(["description", "expectedType", "id", "label"]);
    const bundle = await api.report("ponzi");
    expect(Object.keys(bundle).sort()).toEqual(["envelope", "report", "view"]);
    expect(bundle.envelope.report_sha256).toBe(loadFixture("ponzi").envelope.report_sha256);
    expect((await api.timeseries("ponzi")).length).toBe(loadFixture("ponzi").rows.length);
    expect(await api.attestation("ponzi")).toBe(null);
    expect(fileFetch.mock.calls.some(([u]) => String(u).includes("attestation.json"))).toBe(false);
    await expect(api.report("../index")).rejects.toMatchObject({ code: "report_not_found" });
    await expect(api.analyze("ponzi", "auto")).rejects.toMatchObject({ code: "static_mode" });
    await expect(api.attest("ponzi")).rejects.toMatchObject({ code: "static_mode" });
    expect((await api.health()).static).toBe(true);
  });

  it("상태 A(모의 index)면 attestation.json을 읽고 내용도 다시 판정한다", async () => {
    const index = JSON.parse(fs.readFileSync(path.join(SNAP, "index.json"), "utf8"));
    index.scenarios = index.scenarios.map(s => (s.id === "ponzi" ? { ...s, attestStatus: "A" } : s));
    const files = { "index.json": index, "ponzi/attestation.json": sepoliaAttestation("ponzi") };
    const fetchImpl = async url => {
      const rel = String(url).replace(/^\/snapshot\//, "");
      return files[rel] ? { ok: true, status: 200, json: async () => files[rel] } : { ok: false, status: 404, json: async () => null };
    };
    const api = createStaticApi({ base: "/snapshot/", fetchImpl });
    expect((await api.attestation("ponzi")).uid).toBe(UID);
    files["ponzi/attestation.json"] = { ...sepoliaAttestation("ponzi"), chainId: 31337 };
    const api2 = createStaticApi({ base: "/snapshot/", fetchImpl });
    expect(await api2.attestation("ponzi")).toBe(null);
  });
});
