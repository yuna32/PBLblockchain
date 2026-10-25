// 온체인 기록·검증 화면 로직 (순수). 응답 구조는 server/attest.js(기록·작업)와 demo/lib/attest/verify.js(검증) 기준.
import { term } from "./terms.js";
import { fmtDateTime, shortMiddle } from "./format.js";

// 기록 필드 7개 (demo/lib/attest/schema.js FIELD_NAMES와 같은 순서)
export const FIELD_ORDER = ["contractAddress", "reportHash", "codeRiskGrade", "trustScore", "minWalletTrustScore", "scanTimestamp", "analyzerVersion"];
export const FIELD_LABELS = {
  contractAddress: "컨트랙트 주소",
  reportHash: "리포트 해시",
  codeRiskGrade: "코드 위험 등급",
  trustScore: "신뢰 점수",
  minWalletTrustScore: "최저 지갑 신뢰 점수",
  scanTimestamp: "스캔 시각",
  analyzerVersion: "분석기 버전"
};

export const BACKEND_NAMES = { local: "로컬 시연 체인", "eas-sepolia": "EAS (Sepolia 테스트넷)" };
// 서버가 로컬 체인을 띄우는 동안 local 백엔드의 reason (demo/lib/attest/index.js)
export const STARTING_REASON = "시작 중";

// GET /api/attest/backends → 화면용 선택지
export function backendOptions(backends) {
  return (backends ?? []).map(b => ({
    id: b.id,
    label: BACKEND_NAMES[b.id] ?? b.label ?? b.id,
    available: b.available === true,
    starting: b.available !== true && b.reason === STARTING_REASON,
    reason: b.available === true ? null : b.reason ?? null,
    chainId: b.chainId ?? null
  }));
}

// 기록 조회 계획. 서버는 fixture 모드 리포트만 사전 기록과 연결하므로(server/attest.js recordFor)
// 그 밖의 리포트는 이 화면에서 기록하기 전에는 기록이 없다 → 조회하지 않는다(매번 404를 받지 않도록).
// 다른 곳에서 이미 기록한 리포트라도 '온체인에 기록'을 누르면 서버가 기존 기록을 돌려준다(reused).
// 서버는 local을 사용 가능으로 알린 뒤에 사전 기록을 시작하므로, 그 시나리오의 사전 기록이 보일 때까지 기다린다.
// prerecord: present | pending(아직 없음, 확인 중) | absent(확인을 마쳤는데 없음)
// → fetch | none | wait
export function lookupPlan({ mode, localReady, prerecord = "present" }) {
  if (!localReady) return "wait";
  if (mode !== "fixture") return "none";
  return prerecord === "present" ? "fetch" : prerecord === "pending" ? "wait" : "none";
}

// 현재 리포트의 온체인 상태 하나로 정리한다.
// offline | checking | starting | unavailable | none | running | recorded | prerecorded | error
export function attestPhase({ online = true, local = null, entry = null, job = null } = {}) {
  if (job && (job.status === "queued" || job.status === "running")) return "running";
  if (entry?.record) return entry.record.prerecorded ? "prerecorded" : "recorded";
  if (job?.status === "error") return "error";
  if (!online) return "offline";
  if (!local) return "checking";
  if (local.starting) return "starting";
  if (!local.available) return "unavailable";
  if (!entry || entry.status === "loading") return "checking";
  if (entry.status === "error") return "error";
  return "none";
}

export const PHASE_LABELS = {
  offline: "서버 끊김",
  checking: "확인 중",
  starting: "체인 시작 중",
  unavailable: "사용 불가",
  none: "기록 전",
  running: "기록 중",
  recorded: "기록됨",
  prerecorded: "사전 기록",
  error: "기록 실패"
};

// 진행 표시의 "온체인 기록" 단계
export function onchainFlowState(phase) {
  switch (phase) {
    case "running": return { state: "running", sub: "기록 중" };
    case "recorded": return { state: "done", sub: "완료" };
    case "prerecorded": return { state: "done", sub: "완료 (사전 기록)" };
    case "error": return { state: "error", sub: "기록 실패" };
    case "unavailable": return { state: "disabled", sub: "사용 불가" };
    default: return { state: "pending", sub: PHASE_LABELS[phase] ?? "기록 전" };
  }
}

// 개요 요약 띠의 온체인 배지
export function onchainBadge(phase) {
  if (phase === "recorded" || phase === "prerecorded") {
    return { tone: "primary", label: "온체인 기록됨", extra: phase === "prerecorded" ? "사전 기록" : null };
  }
  if (phase === "running") return { tone: "neutral", label: "기록 중", extra: null };
  if (phase === "error") return { tone: "danger", label: "기록 실패", extra: null };
  return { tone: "neutral", label: "기록 전", extra: phase === "unavailable" ? "로컬 체인 사용 불가" : phase === "offline" ? "서버 끊김" : null };
}

// 마지막 검증 결과 요약 (개요 배지 옆)
export function verifySummary(entry) {
  if (!entry || entry.status !== "done" || !entry.result) return null;
  const ok = entry.result.verified;
  return { tone: ok ? "safe" : "danger", label: ok ? "일치" : "불일치", tamperDemo: Boolean(entry.result.tamperDemo) };
}

// 기록 카드의 메타 행 (hex 값은 앞뒤만 보이고 복사 버튼을 단다)
export function recordRows(record) {
  if (!record) return [];
  return [
    { key: "uid", label: "UID", value: record.uid, hex: true },
    { key: "txHash", label: "트랜잭션 해시", value: record.txHash, hex: true },
    { key: "blockNumber", label: "블록 번호", value: String(record.blockNumber) },
    { key: "chainId", label: "체인 ID", value: String(record.chainId) },
    { key: "attester", label: "기록자 주소", value: record.attester, hex: true },
    { key: "schemaUID", label: "스키마 UID", value: record.schemaUID, hex: true }
  ];
}

// 기록 필드 값 표시: { text, full, mono }
export function formatField(name, value, glossary) {
  if (value === null || value === undefined) return { text: "-", full: null, mono: false };
  switch (name) {
    case "contractAddress":
    case "reportHash":
      return { text: shortMiddle(value), full: value, mono: true };
    case "codeRiskGrade": {
      const t = term(glossary, value);
      return { text: t.known && t.label !== value ? `${value} · ${t.label}` : String(value), full: null, mono: false };
    }
    case "trustScore":
    case "minWalletTrustScore":
      return { text: `${value}점`, full: null, mono: false };
    case "scanTimestamp":
      return { text: fmtDateTime(Number(value) * 1000), full: String(value), mono: false };
    default:
      return { text: String(value), full: null, mono: name === "analyzerVersion" };
  }
}

export function payloadRows(payload, glossary) {
  if (!payload) return [];
  return FIELD_ORDER.map(name => ({ name, label: FIELD_LABELS[name], ...formatField(name, payload[name], glossary) }));
}

// 리포트 경로 → 한글 라벨. 용어집에 있으면 용어집 라벨, 없으면 기록 필드 라벨, 둘 다 없으면 null.
const PATH_TERMS = {
  "prevention.risk_level": "prevention_risk_level",
  "trust.trust_grade": "trust_grade",
  "dynamic.evasion_subclass": "evasion_subclass"
};
const PATH_FIELDS = {
  "trust.overall_trust_score": "trustScore",
  "prevention.risk_level": "codeRiskGrade",
  timestamp: "scanTimestamp"
};
export function pathLabel(path, glossary) {
  const segs = String(path).split(".").filter(s => !/^\d+$/.test(s));
  const candidates = [PATH_TERMS[path], ...segs.slice(-2).reverse()];
  for (const id of candidates) {
    if (id && glossary?.[id]?.ko) return glossary[id].ko;
  }
  return PATH_FIELDS[path] ? FIELD_LABELS[PATH_FIELDS[path]] : null;
}

// POST /api/report/:id/verify 응답 → 화면용
export function verifyView(result, glossary) {
  if (!result) return null;
  const rows = (result.fields ?? []).map(f => ({
    name: f.name,
    label: FIELD_LABELS[f.name] ?? f.name,
    informational: Boolean(f.informational),
    match: Boolean(f.match),
    onChain: formatField(f.name, f.onChain, glossary),
    current: formatField(f.name, f.current, glossary)
  }));
  const verified = Boolean(result.verified);
  const summary = verified
    ? "체인에 기록된 값과 현재 리포트가 같습니다."
    : result.hashMatch
      ? "리포트 해시는 같지만 기록 필드 일부가 현재 리포트와 다릅니다."
      : "현재 리포트의 해시가 체인에 기록된 해시와 다릅니다. 기록한 뒤 리포트 내용이 바뀌었습니다.";
  return {
    uid: result.uid,
    verified,
    tone: verified ? "safe" : "danger",
    label: verified ? "일치" : "불일치",
    summary,
    hash: { onChain: result.onChainReportHash, current: result.currentReportHash, match: Boolean(result.hashMatch) },
    rows,
    informationalMismatch: rows.filter(r => r.informational && !r.match).map(r => r.label),
    changedPaths: (result.changedPaths ?? []).map(p => ({ path: p, label: pathLabel(p, glossary) })),
    snapshotAvailable: result.snapshotAvailable !== false,
    tamperDemo: Boolean(result.tamperDemo)
  };
}

// 점 경로 조회 (자기 속성만, 배열은 숫자 인덱스). 서버의 applyTamper와 같은 규칙.
export function getPath(obj, path) {
  let cur = obj;
  for (const key of String(path).split(".")) {
    if (cur === null || typeof cur !== "object") return { exists: false, value: undefined };
    if (Array.isArray(cur) ? !(/^\d+$/.test(key) && Number(key) < cur.length) : !Object.prototype.hasOwnProperty.call(cur, key)) {
      return { exists: false, value: undefined };
    }
    cur = cur[key];
  }
  return { exists: true, value: cur };
}

// 변조 시연 프리셋: 현재 리포트의 실제 값에서 만든다. 경로가 없거나 바꿔도 같은 값이면 뺀다.
export function tamperPresets(report, glossary) {
  const out = [];
  const add = (id, label, path, value, show = v => String(v)) => {
    const cur = getPath(report, path);
    if (!cur.exists || cur.value === value || value === undefined) return;
    out.push({ id, label, path, from: cur.value, value, fromText: show(cur.value), toText: show(value) });
  };
  const score = v => `${v}점`;
  const named = v => { const t = term(glossary, v); return t.known && t.label !== v ? `${t.label} (${v})` : String(v); };

  const trust = getPath(report, "trust.overall_trust_score").value;
  if (typeof trust === "number") add("trust", "신뢰 점수를 다른 값으로", "trust.overall_trust_score", trust >= 80 ? Math.round(trust) - 40 : 95, score);

  const level = getPath(report, "prevention.risk_level").value;
  if (typeof level === "string") {
    const to = level === "LOW" ? "CRITICAL" : "LOW";
    add("risk", `코드 위험 등급을 ${to}로`, "prevention.risk_level", to, named);
  }

  const hint = getPath(report, "dynamic.fraud_type_hint").value;
  if (typeof hint === "string") {
    const to = hint === "normal_staking" ? "ponzi_scheme" : "normal_staking";
    add("type", `감지 유형을 ${term(glossary, to).label}(으)로`, "dynamic.fraud_type_hint", to, named);
  }

  const wallets = getPath(report, "trust.wallet_scores").value;
  if (Array.isArray(wallets) && wallets.length) {
    let idx = -1;
    wallets.forEach((w, i) => {
      if (typeof w?.trust_score === "number" && (idx < 0 || w.trust_score < wallets[idx].trust_score)) idx = i;
    });
    if (idx >= 0) {
      const v = wallets[idx].trust_score;
      add("wallet", "최저 지갑 신뢰 점수를 다른 값으로", `trust.wallet_scores.${idx}.trust_score`, v < 90 ? 95 : 10, score);
    }
  }
  return out;
}

// 오류 → { title, detail }. 기존 StatusView에 그대로 넘긴다.
const ERROR_TITLES = {
  invalid_tamper_path: "이 리포트에는 바꾸려는 항목이 없습니다",
  invalid_tamper: "바꾸려는 값을 쓸 수 없습니다",
  invalid_uid: "기록 UID 형식이 올바르지 않습니다",
  backend_unavailable: "이 기록 방식은 지금 쓸 수 없습니다",
  unknown_backend: "알 수 없는 기록 방식입니다",
  attestation_not_found: "아직 온체인 기록이 없습니다",
  attestation_not_found_onchain: "체인에서 이 기록을 찾지 못했습니다",
  schema_mismatch: "기록 형식(스키마)이 이 서버와 다릅니다",
  report_not_found: "리포트를 찾을 수 없습니다",
  attest_job_not_found: "기록 작업을 찾을 수 없습니다"
};
const ERROR_HINTS = {
  invalid_tamper_path: "목록의 다른 항목을 골라 주세요.",
  attestation_not_found: "먼저 '온체인에 기록'을 눌러 주세요.",
  attestation_not_found_onchain: "서버를 다시 시작하면 로컬 체인이 새로 만들어져 이전 기록은 사라집니다. 다시 기록해 주세요.",
  report_not_found: "서버가 다시 시작됐을 수 있습니다. 분석을 다시 실행해 주세요.",
  attest_job_not_found: "서버가 다시 시작됐을 수 있습니다."
};
export function attestError(err, fallbackTitle = "요청을 처리하지 못했습니다") {
  if (!err) return null;
  if (err.network) return { title: "시연 API 서버에 연결할 수 없습니다", detail: "WSL에서 npm run demo:server를 실행했는지 확인하세요." };
  const title = ERROR_TITLES[err.code] ?? fallbackTitle;
  const detail = [err.message, ERROR_HINTS[err.code]].filter(Boolean).join(" ");
  return { title, detail };
}
