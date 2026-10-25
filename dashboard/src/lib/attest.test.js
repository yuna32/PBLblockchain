import { describe, it, expect } from "vitest";
import {
  FIELD_ORDER, FIELD_LABELS, backendOptions, attestPhase, lookupPlan, onchainFlowState, onchainBadge, verifySummary, recordKey, explorerLinks,
  recordRows, formatField, payloadRows, pathLabel, verifyView, getPath, tamperPresets, attestError
} from "./attest.js";
import { fmtDateTime, shortMiddle } from "./format.js";
import { FIELD_NAMES, buildPayload } from "../../../demo/lib/attest/schema.js";
import { applyTamper, verifyAgainstChain } from "../../../demo/lib/attest/verify.js";
import { canonicalize, hashableReport } from "../../../demo/lib/canonical.js";
import { GLOSSARY } from "../../../demo/lib/glossary.js";
import { SCENARIO_IDS, loadFixture } from "./testFixtures.js";

const VERSION = "141e8db+jcs-rfc8785/pbl-demo-v1";

// 서버 응답과 같은 모양 (server/attest.js publicRecord, verify)
function recordOf(name, extra = {}) {
  const { report, envelope, rows } = loadFixture(name);
  return {
    uid: `0x${"ab".repeat(32)}`, txHash: `0x${"cd".repeat(32)}`, backend: "local", chainId: 31337,
    attester: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", schemaUID: `0x${"ef".repeat(32)}`,
    contract: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512", blockNumber: 5, recordedAt: "2026-10-25T03:48:14.000Z",
    explorerUrl: null, payload: buildPayload({ report, envelope, rows, analyzerVersion: VERSION }),
    reportId: null, scenario: name, prerecorded: true, canonicalSnapshot: true, ...extra
  };
}
function verifyResponse(name, tamper = null) {
  const { report, envelope, rows } = loadFixture(name);
  const onChain = buildPayload({ report, envelope, rows, analyzerVersion: VERSION });
  const result = verifyAgainstChain({ report, rows, onChain, snapshot: canonicalize(hashableReport(report)), tamper, analyzerVersion: VERSION });
  return { uid: `0x${"ab".repeat(32)}`, backend: "local", ...result };
}

describe("기록 필드와 기록 방식", () => {
  it("필드 7개가 서버 스키마와 같은 순서, 모두 한글 라벨", () => {
    expect(FIELD_ORDER).toEqual(FIELD_NAMES);
    expect(FIELD_ORDER.map(f => FIELD_LABELS[f])).toEqual(["컨트랙트 주소", "리포트 해시", "코드 위험 등급", "신뢰 점수", "최저 지갑 신뢰 점수", "스캔 시각", "분석기 버전"]);
  });

  it("backendOptions: local 사용 가능, eas-sepolia 미설정, 시작 중 구분", () => {
    const list = [
      { id: "local", label: "로컬 체인 (hardhat)", available: true, chainId: 31337 },
      { id: "eas-sepolia", label: "EAS (Sepolia 테스트넷)", available: false, reason: "미설정 (DEMO_EAS_RPC_URL 없음)" }
    ];
    const base = { explorerBase: null, explorerUrlVerified: null, prerecorded: null, prerecordedStale: 0, note: null };
    expect(backendOptions(list)).toEqual([
      { id: "local", label: "로컬 시연 체인", available: true, starting: false, reason: null, chainId: 31337, mode: "readwrite", ...base },
      { id: "eas-sepolia", label: "EAS (Sepolia 테스트넷)", available: false, starting: false, reason: "미설정 (DEMO_EAS_RPC_URL 없음)", chainId: null, mode: null, ...base }
    ]);
    expect(backendOptions([{ id: "local", available: false, reason: "시작 중" }])[0].starting).toBe(true);
    expect(backendOptions([{ id: "local", available: false, reason: "비활성 (서버 설정에서 꺼짐)" }])[0]).toMatchObject({ starting: false, available: false });
    expect(backendOptions(null)).toEqual([]);
  });

  it("backendOptions: eas-sepolia (server/attest.js backends 응답)", () => {
    const eas = {
      id: "eas-sepolia", label: "EAS (Sepolia 테스트넷)", available: true, mode: "readonly", chainId: 11155111,
      explorerBase: "https://sepolia.easscan.org", explorerUrlVerified: false, schemaUID: `0x${"ab".repeat(32)}`,
      schemaRegistered: true, attester: null, prerecorded: 5, prerecordedStale: 1
    };
    expect(backendOptions([eas])[0]).toEqual({
      id: "eas-sepolia", label: "EAS (Sepolia 테스트넷)", available: true, starting: false, reason: null, chainId: 11155111,
      mode: "readonly", explorerBase: "https://sepolia.easscan.org", explorerUrlVerified: false, prerecorded: 5, prerecordedStale: 1, note: null
    });
    expect(backendOptions([{ ...eas, schemaRegistered: false }])[0].note).toMatch(/demo:eas:register/);
    expect(backendOptions([{ ...eas, reason: "RPC에 연결할 수 없습니다", reasonCode: "rpc_unavailable" }])[0]).toMatchObject({ available: true, note: "RPC에 연결할 수 없습니다" });
    expect(recordKey("eas-sepolia", "r1")).toBe("eas-sepolia:r1");
  });

  it("explorerLinks: local은 없음, eas는 기록·스키마 링크와 형식 미확인 표시", () => {
    expect(explorerLinks(recordOf("ponzi"))).toBe(null);
    const uid = `0x${"ab".repeat(32)}`;
    const rec = recordOf("ponzi", {
      backend: "eas-sepolia", explorerUrl: `https://sepolia.easscan.org/attestation/view/${uid}`,
      meta: { explorerUrlVerified: false, schemaUrl: "https://sepolia.easscan.org/schema/view/0x1" }
    });
    expect(explorerLinks(rec)).toEqual({ attestation: `https://sepolia.easscan.org/attestation/view/${uid}`, verified: false, schema: "https://sepolia.easscan.org/schema/view/0x1" });
  });
});

describe("온체인 상태 도출", () => {
  const local = { id: "local", available: true, starting: false };
  const rec = prerecorded => ({ status: "ready", record: { uid: "0x1", prerecorded } });

  it("attestPhase: 우선순위 (진행 중 > 기록 > 실패 > 연결·체인 상태 > 조회)", () => {
    expect(attestPhase({ local, entry: rec(true), job: { status: "running" } })).toBe("running");
    expect(attestPhase({ local, entry: rec(true), job: { status: "queued" } })).toBe("running");
    expect(attestPhase({ local, entry: rec(true) })).toBe("prerecorded");
    expect(attestPhase({ local, entry: rec(false), job: { status: "done" } })).toBe("recorded");
    expect(attestPhase({ online: false, entry: rec(false) })).toBe("recorded");
    expect(attestPhase({ local, entry: { status: "none" }, job: { status: "error" } })).toBe("error");
    expect(attestPhase({ online: false, local, entry: { status: "none" } })).toBe("offline");
    expect(attestPhase({ local: null })).toBe("checking");
    expect(attestPhase({ local: { available: false, starting: true }, entry: { status: "none" } })).toBe("starting");
    expect(attestPhase({ local: { available: false, starting: false }, entry: { status: "none" } })).toBe("unavailable");
    expect(attestPhase({ local, entry: { status: "loading" } })).toBe("checking");
    expect(attestPhase({ local })).toBe("checking");
    expect(attestPhase({ local, entry: { status: "error" } })).toBe("error");
    expect(attestPhase({ local, entry: { status: "none" } })).toBe("none");
    // 읽기 전용(eas-sepolia, 키 없음): 기록이 없으면 readonly, 기록이 있으면 그대로 기록 상태
    const ro = { id: "eas-sepolia", available: true, starting: false, mode: "readonly" };
    expect(attestPhase({ local: ro, entry: { status: "none" } })).toBe("readonly");
    expect(attestPhase({ local: ro, entry: rec(true) })).toBe("prerecorded");
    expect(attestPhase({ local: ro, entry: { status: "loading" } })).toBe("checking");
  });

  it("lookupPlan: fixture 모드만 조회, 체인 준비 전에는 대기", () => {
    expect(lookupPlan({ mode: "fixture", localReady: true })).toBe("fetch");
    expect(lookupPlan({ mode: "auto", localReady: true })).toBe("none");
    expect(lookupPlan({ mode: null, localReady: true })).toBe("none");
    expect(lookupPlan({ mode: "fixture", localReady: false })).toBe("wait");
    expect(lookupPlan({ mode: "fixture", localReady: true, prerecord: "pending" })).toBe("wait");
    expect(lookupPlan({ mode: "fixture", localReady: true, prerecord: "absent" })).toBe("none");
    expect(lookupPlan({ mode: "auto", localReady: true, prerecord: "pending" })).toBe("none");
  });

  it("진행 표시와 개요 배지", () => {
    expect(onchainFlowState("prerecorded")).toEqual({ state: "done", sub: "완료 (사전 기록)" });
    expect(onchainFlowState("checking")).toEqual({ state: "pending", sub: "확인 중" });
    expect(onchainFlowState(null)).toEqual({ state: "pending", sub: "기록 전" });
    expect(onchainBadge("prerecorded")).toEqual({ tone: "primary", label: "온체인 기록됨", extra: "사전 기록" });
    expect(onchainBadge("recorded")).toEqual({ tone: "primary", label: "온체인 기록됨", extra: null });
    expect(onchainBadge("none").label).toBe("기록 전");
    expect(onchainBadge("unavailable")).toEqual({ tone: "neutral", label: "기록 전", extra: "로컬 체인 사용 불가" });
    expect(onchainBadge("unavailable", "Sepolia").extra).toBe("Sepolia 사용 불가");
    expect(onchainBadge("readonly")).toEqual({ tone: "neutral", label: "기록 전", extra: "읽기 전용" });
    expect(onchainFlowState("readonly")).toEqual({ state: "disabled", sub: "읽기 전용" });
  });

  it("verifySummary: 끝난 검증만", () => {
    expect(verifySummary(null)).toBe(null);
    expect(verifySummary({ status: "running" })).toBe(null);
    expect(verifySummary({ status: "done", result: verifyResponse("ponzi") })).toEqual({ tone: "safe", label: "일치", text: "검증 일치", tamperDemo: false });
    expect(verifySummary({ status: "done", result: verifyResponse("ponzi", { path: "trust.overall_trust_score", value: 95 }) }))
      .toEqual({ tone: "danger", label: "불일치", text: "검증 불일치", tamperDemo: true });
    // 정적 모드: 무결성 검증은 온체인 표현을 쓰지 않는다
    expect(verifySummary({ status: "done", kind: "integrity", result: { verified: false, tamperDemo: true } }).text).toBe("무결성 검증 불일치");
    expect(verifySummary({ status: "done", kind: "onchain", result: { verified: true } }).text).toBe("온체인 기록과 일치");
  });

  it("정적 모드 상태: Sepolia 기록 있음 / 온체인 기록 대기 중", () => {
    expect(onchainFlowState("attested")).toEqual({ state: "done", sub: "Sepolia 기록 있음" });
    expect(onchainFlowState("pending_onchain")).toEqual({ state: "pending", sub: "기록 대기 중" });
    expect(onchainBadge("attested").label).toBe("Sepolia 기록 있음");
    expect(onchainBadge("pending_onchain")).toEqual({ tone: "neutral", label: "온체인 기록 대기 중", extra: null });
  });
});

describe("기록 카드 표시", () => {
  it("recordRows: 6개 메타, hex 값 표시", () => {
    const rows = recordRows(recordOf("ponzi"));
    expect(rows.map(r => r.label)).toEqual(["UID", "트랜잭션 해시", "블록 번호", "체인 ID", "기록자 주소", "스키마 UID"]);
    expect(rows.filter(r => r.hex).map(r => r.key)).toEqual(["uid", "txHash", "attester", "schemaUID"]);
    expect(rows.find(r => r.key === "chainId").value).toBe("31337");
    expect(recordRows(null)).toEqual([]);
  });

  for (const name of SCENARIO_IDS) {
    it(`payloadRows ${name}: 7필드 한글 라벨과 형식`, () => {
      const rec = recordOf(name);
      const rows = payloadRows(rec.payload, GLOSSARY);
      expect(rows.map(r => r.name)).toEqual(FIELD_ORDER);
      const by = Object.fromEntries(rows.map(r => [r.name, r]));
      expect(by.reportHash.full).toBe(`0x${loadFixture(name).envelope.report_sha256}`);
      expect(by.reportHash.text).toBe(shortMiddle(by.reportHash.full));
      expect(by.contractAddress.mono).toBe(true);
      expect(by.trustScore.text).toBe(`${rec.payload.trustScore}점`);
      expect(by.codeRiskGrade.text).toBe(name === "normal" ? "LOW · 낮음" : "CRITICAL · 매우 높음");
      expect(by.scanTimestamp.text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(by.analyzerVersion.text).toBe(VERSION);
    });
  }

  it("formatField·포맷 보조", () => {
    expect(formatField("trustScore", null)).toEqual({ text: "-", full: null, mono: false });
    expect(formatField("codeRiskGrade", "WEIRD", GLOSSARY).text).toBe("WEIRD");
    expect(shortMiddle(`0x${"ab".repeat(32)}`)).toBe("0xabababab…abababab");
    expect(shortMiddle("0x1234")).toBe("0x1234");
    const ms = Date.UTC(2026, 9, 25, 3, 48, 14);
    const d = new Date(ms);
    expect(fmtDateTime(ms)).toBe(`2026-10-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:48:14`);
    expect(fmtDateTime("nope")).toBe("-");
    expect(fmtDateTime(null)).toBe("-");
  });
});

describe("검증 결과 뷰모델", () => {
  it("일치: 배지·해시 같음·7행·참고용 2개", () => {
    const v = verifyView(verifyResponse("ponzi"), GLOSSARY);
    expect([v.verified, v.tone, v.label, v.tamperDemo, v.hash.match]).toEqual([true, "safe", "일치", false, true]);
    expect(v.hash.onChain).toBe(v.hash.current);
    expect(v.rows).toHaveLength(7);
    expect(v.rows.filter(r => r.informational).map(r => r.label)).toEqual(["스캔 시각", "분석기 버전"]);
    expect(v.rows.every(r => r.match)).toBe(true);
    expect(v.changedPaths).toEqual([]);
    expect(v.summary).toBe("체인에 기록된 값과 현재 리포트가 같습니다.");
  });

  it("변조: 불일치, 해시 다름, 바뀐 경로와 라벨", () => {
    const v = verifyView(verifyResponse("ponzi", { path: "trust.overall_trust_score", value: 95 }), GLOSSARY);
    expect([v.verified, v.tone, v.label, v.tamperDemo, v.hash.match]).toEqual([false, "danger", "불일치", true, false]);
    expect(v.rows.filter(r => !r.match).map(r => r.name)).toEqual(["reportHash", "trustScore"]);
    expect(v.rows.find(r => r.name === "trustScore").current.text).toBe("95점");
    expect(v.changedPaths).toEqual([{ path: "trust.overall_trust_score", label: "신뢰 점수" }]);
  });

  it("참고용 필드만 다르면 일치 유지 (timestamp 변조)", () => {
    const v = verifyView(verifyResponse("pumpdump", { path: "timestamp", value: "2030-01-01T00:00:00.000Z" }), GLOSSARY);
    expect([v.verified, v.hash.match, v.tamperDemo]).toEqual([true, true, true]);
    expect(v.informationalMismatch).toEqual(["스캔 시각"]);
  });

  it("pathLabel: 용어집 → 기록 필드 → 없음", () => {
    expect(pathLabel("prevention.risk_level", GLOSSARY)).toBe("코드 위험 수준");
    expect(pathLabel("trust.wallet_scores.3.trust_score", GLOSSARY)).toBe("지갑 신뢰 점수");
    expect(pathLabel("trust.wallet_scores.3.breakdown.flow_pattern", GLOSSARY)).toBe("자금 이동 패턴");
    expect(pathLabel("trust.overall_trust_score", GLOSSARY)).toBe("신뢰 점수");
    expect(pathLabel("dynamic.metrics.total_in_eth", GLOSSARY)).toBe(null);
    expect(verifyView(null)).toBe(null);
  });
});

describe("변조 시연 프리셋", () => {
  for (const name of SCENARIO_IDS) {
    it(`${name}: 실제 값에서 만들고, 서버 규칙으로 적용하면 해시가 달라진다`, () => {
      const { report } = loadFixture(name);
      const presets = tamperPresets(report, GLOSSARY);
      expect(presets.map(p => p.id)).toEqual(["trust", "risk", "type", "wallet"]);
      for (const p of presets) {
        expect(getPath(report, p.path)).toEqual({ exists: true, value: p.from });
        expect(p.value).not.toEqual(p.from);
        const r = verifyResponse(name, { path: p.path, value: p.value });
        expect([r.hashMatch, r.verified, r.tamperDemo]).toEqual([false, false, true]);
        expect(r.changedPaths).toEqual([p.path]);
        expect(applyTamper(report, p)).not.toBe(report);
      }
      const by = Object.fromEntries(presets.map(p => [p.id, p]));
      expect(by.risk.value).toBe(name === "normal" ? "CRITICAL" : "LOW");
      expect(by.type.value).toBe(name === "normal" ? "ponzi_scheme" : "normal_staking");
      const min = Math.min(...report.trust.wallet_scores.map(w => w.trust_score));
      expect(by.wallet.from).toBe(min);
    });
  }

  it("normal 표시 문구와 ponzi 값", () => {
    const n = Object.fromEntries(tamperPresets(loadFixture("normal").report, GLOSSARY).map(p => [p.id, p]));
    expect([n.trust.from, n.trust.value, n.trust.toText]).toEqual([86, 46, "46점"]);
    expect([n.type.label, n.type.fromText]).toEqual(["감지 유형을 폰지 사기(으)로", "정상 스테이킹 (normal_staking)"]);
    const p = Object.fromEntries(tamperPresets(loadFixture("ponzi").report, GLOSSARY).map(x => [x.id, x]));
    expect([p.trust.value, p.risk.label, p.type.label]).toEqual([95, "코드 위험 등급을 LOW로", "감지 유형을 정상 스테이킹(으)로"]);
  });

  it("경로가 없으면 그 프리셋은 숨긴다", () => {
    const { report } = loadFixture("ponzi");
    const partial = structuredClone(report);
    delete partial.dynamic.fraud_type_hint;
    partial.trust.wallet_scores = [];
    expect(tamperPresets(partial, GLOSSARY).map(p => p.id)).toEqual(["trust", "risk"]);
    expect(tamperPresets({}, GLOSSARY)).toEqual([]);
    expect(tamperPresets(null, GLOSSARY)).toEqual([]);
    expect(getPath(report, "trust.wallet_scores.99.trust_score").exists).toBe(false);
    expect(getPath(report, "__proto__.x").exists).toBe(false);
  });
});

describe("오류 문구", () => {
  it("코드별 한글 제목 + 서버 메시지 + 안내", () => {
    expect(attestError({ code: "invalid_tamper_path", message: "리포트에 없는 경로입니다: trust.nope" }))
      .toEqual({ title: "이 리포트에는 바꾸려는 항목이 없습니다", detail: "리포트에 없는 경로입니다: trust.nope 목록의 다른 항목을 골라 주세요." });
    expect(attestError({ network: true }).title).toBe("시연 API 서버에 연결할 수 없습니다");
    expect(attestError({ code: "backend_unavailable", message: "x" }).title).toBe("이 기록 방식은 지금 쓸 수 없습니다");
    expect(attestError({ code: null, message: "boom" }, "기록하지 못했습니다")).toEqual({ title: "기록하지 못했습니다", detail: "boom" });
    expect(attestError(null)).toBe(null);
  });
});
