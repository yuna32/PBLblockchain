// 배포자 위험도 (순수 함수·상수). 화면은 아래 정규화된 모양만 읽는다.
//   { status, error, level, score, scoreMax, summary, target:{deployer, contract, simulated},
//     indicators:[{key, label, status, points, cap}], evidence:[{indicatorKey, strength, text, source, points}],
//     firstFunding:{hops, category}, pastDeployments:[...] | null,
//     scope:{activityDays, txCount, asOf, failures:[], sources:[], reason, assumption} }
// 팀 결과 파일(risk_result.json) 형식은 아직 정해지지 않았다. 형식이 정해지면 이 파일의 정규화만 고친다.
// 수준(level)은 원본 값을 그대로 쓰고 점수에서 계산하지 않는다.
import { detectContract } from "./network.js";

// 수준 4단계. 색은 거래 판정 배지와 같은 팔레트, 라벨은 수준 이름 그대로("위험"이라는 단어는 쓰지 않는다).
export const RISK_LEVELS = {
  strong: { label: "강한 근거",   tone: "danger",
    summary: "배포자 지갑에서 위험을 뒷받침하는 강한 근거가 보입니다" },
  some:   { label: "근거 있음",   tone: "caution",
    summary: "배포자 지갑에서 확인이 필요한 근거가 보입니다" },
  none:   { label: "근거 없음",   tone: "safe",
    summary: "확인한 범위에서는 배포자 위험 근거가 보이지 않습니다. 근거가 없다고 안전이 보장되는 것은 아닙니다" },
  nodata: { label: "데이터 없음", tone: "neutral",
    summary: "배포자 정보를 평가하지 않았습니다" }
};
export const RISK_LEVEL_ORDER = ["strong", "some", "none", "nodata"];

// 지표 5개 (마지막은 확장 지표). 항상 이 순서로 5개를 보여 준다.
export const INDICATORS = [
  { key: "first_funding",          label: "첫 자금원" },
  { key: "wallet_maturity",        label: "지갑 성숙도" },
  { key: "past_scam_deployments",  label: "과거 사기 배포 이력" },
  { key: "external_flags",         label: "외부 위험 플래그(GoPlus)" },
  { key: "past_rug_recovery",      label: "과거 배포 자금 회수 이력", extension: true }
];

// 지표 상태: 근거 있음(점수 > 0) / 근거 없음(확인했고 0점) / 데이터 없음(가져오지 못함, null)
export const INDICATOR_STATUS = {
  evidence: { label: "근거 있음",   tone: "caution" },
  none:     { label: "근거 없음",   tone: "safe" },
  nodata:   { label: "데이터 없음", tone: "neutral" }
};
export const STRENGTH_LABELS = { strong: "강한 근거", weak: "약한 근거" };
export const FUNDING_CATEGORIES = { exchange: "거래소", mixer: "믹서", malicious: "악성 주소", other: "기타" };
export const PUBLIC_LABELS = { scam: "사기", normal: "정상" };

export const RISK_COPY = {
  scoreUnit: "높을수록 위험",
  scoreNote: "근거마다 더한 점수의 합계이며, 위험 수준은 점수 구간이 아니라 근거의 강도로 정합니다",
  simulatedDeployer: "시뮬레이션 배포 계정(추정)",
  simulationReason: "이 예시는 로컬 시뮬레이션의 기본 계정으로 배포해 실제 이력이 없으므로 배포자 위험을 평가하지 않았습니다",
  simulationAssumption: "생성 거래가 로그에 없어 시뮬레이션 기본 계정을 배포자로 가정했습니다",
  combinationTitle: "결합 규칙 준비 중",
  combinationText: "코드 위험과 배포자 위험을 하나의 등급으로 합치는 규칙은 아직 정해지지 않아 지금은 따로 보여 줍니다",
  disclaimer: "배포자 위험도는 휴리스틱 분석이며 사기 여부를 확정하지 않습니다. 투자 판단의 근거가 될 수 없습니다",
  distinction: "개요의 위험·주의·근거 없음은 이 컨트랙트의 거래 패턴을 본 결과이고, 배포자 위험 수준은 배포한 지갑의 이력을 따로 본 결과입니다. 두 결과는 서로 다른 분석입니다",
  noFunding: "첫 자금원 데이터 없음",
  noPast: "데이터 없음(가져오지 않음)",
  zeroPast: "과거 배포 없음(0건)"
};

// 점수 표시: "{n} / {max} · 높을수록 위험", 점수가 없으면 "— · 높을수록 위험"
export function scoreValue(risk) {
  const n = risk?.score;
  return typeof n === "number" ? (typeof risk.scoreMax === "number" ? `${n} / ${risk.scoreMax}` : `${n}`) : "—";
}
export function scoreText(risk) {
  return `${scoreValue(risk)} · ${RISK_COPY.scoreUnit}`;
}

export function riskSummary(risk) {
  return risk?.summary ?? RISK_LEVELS[risk?.level]?.summary ?? RISK_LEVELS.nodata.summary;
}

// 지표 막대 비율 (상한 대비). 데이터 없음이거나 상한이 없으면 null(막대 없음).
export function indicatorRatio(ind) {
  if (ind?.status === "nodata" || typeof ind?.points !== "number" || !(ind?.cap > 0)) return null;
  return Math.max(0, Math.min(1, ind.points / ind.cap));
}

// 데이터 없는 지표가 있는데 합계 점수가 있으면 "부분 합계"
export function partialScore(risk) {
  if (typeof risk?.score !== "number") return null;
  const missing = (risk.indicators ?? []).filter(i => i.status === "nodata");
  return missing.length ? { missing: missing.length, note: `데이터 없음 지표 ${missing.length}개는 합계에 들어가지 않았습니다` } : null;
}

// 수준을 정한 근거 한 줄(점수와 수준이 달라 보일 때 이유를 보여 준다). 강한 근거면 강한 근거 문장, 근거 있음이면 첫 근거.
export function levelBasis(risk) {
  const ev = risk?.evidence ?? [];
  if (risk?.level === "strong") return ev.find(e => e.strength === "strong") ?? null;
  if (risk?.level === "some") return ev[0] ?? null;
  return null;
}

const emptyIndicators = () => INDICATORS.map(d => ({ key: d.key, label: d.label, extension: Boolean(d.extension), status: "nodata", points: null, cap: null }));

// ── 정규화 ─────────────────────────────────────────────────────────────────
// 팀 결과 파일의 필드 이름은 아직 정해지지 않아 후보 이름을 여기 한 곳에만 둔다(형식이 정해지면 이 표만 고친다).
const FIELDS = {
  level:       ["level", "risk_level", "riskLevel"],
  score:       ["score", "total_score", "totalScore"],
  scoreMax:    ["score_max", "scoreMax", "max_score", "maxScore"],
  summary:     ["summary"],
  target:      ["target"],
  deployer:    ["deployer", "deployer_address", "deployerAddress"],
  contract:    ["contract", "contract_address", "contractAddress"],
  indicators:  ["indicators"],
  indKey:      ["key", "indicator", "id"],
  indStatus:   ["status"],
  points:      ["points", "score"],
  cap:         ["cap", "max", "max_points", "maxPoints"],
  evidence:    ["evidence", "evidences"],
  evIndicator: ["indicator_key", "indicatorKey", "indicator", "key"],
  strength:    ["strength"],
  text:        ["text", "description"],
  source:      ["source"],
  firstFunding:["first_funding", "firstFunding"],
  hops:        ["hops"],
  category:    ["category"],
  past:        ["past_deployments", "pastDeployments"],
  deployedAt:  ["deployed_at", "deployedAt", "date"],
  publicLabel: ["public_label", "publicLabel"],
  ourVerdict:  ["our_verdict", "ourVerdict", "verdict"],
  scope:       ["scope"],
  activityDays:["activity_days", "activityDays"],
  txCount:     ["tx_count", "txCount"],
  asOf:        ["as_of", "asOf"],
  failures:    ["failures"],
  sources:     ["sources"],
  reason:      ["reason"]
};
const LEVEL_ALIASES = {
  strong: ["strong", "strong_evidence", "강한 근거", "강한근거"],
  some:   ["some", "some_evidence", "evidence", "근거 있음", "근거있음"],
  none:   ["none", "no_evidence", "근거 없음", "근거없음"],
  nodata: ["nodata", "no_data", "데이터 없음", "데이터없음"]
};
const STRENGTH_ALIASES = { strong: ["strong", "강한", "강한 근거"], weak: ["weak", "약한", "약한 근거"] };
const CATEGORY_ALIASES = {
  exchange: ["exchange", "cex", "거래소"], mixer: ["mixer", "믹서"],
  malicious: ["malicious", "악성", "악성 주소"], other: ["other", "기타"]
};
const PUBLIC_ALIASES = { scam: ["scam", "fraud", "사기"], normal: ["normal", "legit", "정상"] };
const VERDICTS = ["risk", "caution", "no_evidence", "undetermined"];

const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const has = (o, names) => isObj(o) && names.some(n => Object.hasOwn(o, n));
const pick = (o, names) => {
  if (!isObj(o)) return undefined;
  for (const n of names) if (Object.hasOwn(o, n)) return o[n];
  return undefined;
};
const alias = (table, v) => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return Object.keys(table).find(k => table[k].includes(s)) ?? null;
};
const str = v => (typeof v === "string" && v.trim() ? v.trim() : null);
const strList = v => (Array.isArray(v) ? v.filter(x => typeof x === "string" && x.trim()).map(x => x.trim()) : []);

const fail = (kind, detail) => ({
  status: "error", error: { kind, detail }, level: null, score: null, scoreMax: null, summary: null,
  target: { deployer: null, contract: null, simulated: false }, indicators: emptyIndicators(), evidence: [],
  firstFunding: { hops: null, category: null }, pastDeployments: null,
  scope: { activityDays: null, txCount: null, asOf: null, failures: [], sources: [], reason: null, assumption: null }
});

// raw: 팀 결과 파일을 파싱한 값(형식 추정). 데이터가 없으면 error.missing, 읽을 수 없으면 error.format.
// null은 null(데이터 없음), 0은 0(확인했고 해당 없음)으로 둔다. 숫자가 아닌 값은 null로 바꾸고 scope.failures에 남긴다.
export function normalizeRisk(raw) {
  if (raw === null || raw === undefined || raw === "") return fail("missing", "결과 파일 없음");
  if (!isObj(raw)) return fail("format", "객체가 아님");
  if (!has(raw, FIELDS.level)) return fail("format", "필수 필드 없음: level");
  const level = alias(LEVEL_ALIASES, pick(raw, FIELDS.level));
  if (!level) return fail("format", `알 수 없는 수준 값: ${String(pick(raw, FIELDS.level))}`);

  const failures = [];
  const num = (v, label) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    failures.push(`${label}(형식 오류)`);
    return null;
  };

  // 지표: 배열([{key, points, cap}]) 또는 객체({first_funding: {points, cap}}) 모두 받는다. 없으면 데이터 없음.
  const rawInd = pick(raw, FIELDS.indicators);
  if (rawInd === undefined && level !== "nodata") return fail("format", "필수 필드 없음: indicators");
  if (rawInd !== undefined && rawInd !== null && !Array.isArray(rawInd) && !isObj(rawInd)) return fail("format", "indicators 형식 오류");
  const indList = Array.isArray(rawInd) ? rawInd : isObj(rawInd) ? Object.entries(rawInd).map(([k, v]) => ({ key: k, ...(isObj(v) ? v : { points: v }) })) : [];
  const byKey = new Map(indList.filter(isObj).map(i => [pick(i, FIELDS.indKey), i]));
  const indicators = INDICATORS.map(d => {
    const i = byKey.get(d.key);
    const base = { key: d.key, label: d.label, extension: Boolean(d.extension) };
    if (!i) return { ...base, status: "nodata", points: null, cap: null };
    const points = num(pick(i, FIELDS.points), d.label);
    const cap = num(pick(i, FIELDS.cap), `${d.label} 상한`);
    const explicitNoData = alias({ nodata: LEVEL_ALIASES.nodata }, pick(i, FIELDS.indStatus)) === "nodata";
    const status = explicitNoData || points === null ? "nodata" : points > 0 ? "evidence" : "none";
    return { ...base, status, points: status === "nodata" ? null : points, cap };
  });

  const known = new Set(INDICATORS.map(d => d.key));
  const rawEv = pick(raw, FIELDS.evidence);
  const evidence = (Array.isArray(rawEv) ? rawEv : []).filter(isObj).map(e => ({
    indicatorKey: pick(e, FIELDS.evIndicator),
    strength: alias(STRENGTH_ALIASES, pick(e, FIELDS.strength)),
    text: str(pick(e, FIELDS.text)),
    source: str(pick(e, FIELDS.source)),
    points: num(pick(e, FIELDS.points), "근거 점수")
  })).filter(e => known.has(e.indicatorKey) && e.text);

  const t = pick(raw, FIELDS.target);
  const ff = pick(raw, FIELDS.firstFunding);
  const hops = pick(ff, FIELDS.hops);
  const past = pick(raw, FIELDS.past);
  const sc = pick(raw, FIELDS.scope);

  return {
    status: "ready",
    error: null,
    level,
    score: num(pick(raw, FIELDS.score), "점수"),
    scoreMax: num(pick(raw, FIELDS.scoreMax), "점수 상한"),
    summary: str(pick(raw, FIELDS.summary)),
    target: {
      deployer: str(pick(t, FIELDS.deployer) ?? pick(raw, FIELDS.deployer)),
      contract: str(pick(t, FIELDS.contract) ?? pick(raw, FIELDS.contract)),
      simulated: false
    },
    indicators,
    evidence,
    firstFunding: { hops: hops === 1 || hops === 2 ? hops : null, category: alias(CATEGORY_ALIASES, pick(ff, FIELDS.category)) },
    pastDeployments: Array.isArray(past)
      ? past.filter(isObj).map(p => ({
          contract: str(pick(p, FIELDS.contract)),
          deployedAt: str(pick(p, FIELDS.deployedAt)),
          publicLabel: alias(PUBLIC_ALIASES, pick(p, FIELDS.publicLabel)),
          ourVerdict: VERDICTS.includes(pick(p, FIELDS.ourVerdict)) ? pick(p, FIELDS.ourVerdict) : null
        }))
      : null,
    scope: {
      activityDays: num(pick(sc, FIELDS.activityDays), "활동 일수"),
      txCount: num(pick(sc, FIELDS.txCount), "거래 수"),
      asOf: str(pick(sc, FIELDS.asOf)),
      failures: [...strList(pick(sc, FIELDS.failures)), ...failures],
      sources: strList(pick(sc, FIELDS.sources)),
      reason: str(pick(sc, FIELDS.reason)),
      assumption: null
    }
  };
}

export const RISK_LOADING = { status: "loading" };

export const RISK_ERROR_COPY = {
  missing: "배포자 분석 결과 파일이 없습니다",
  format: "배포자 분석 결과의 형식을 읽을 수 없습니다(형식 확정 전)"
};
export const RISK_LOADING_COPY = "배포자 분석 결과를 불러오는 중입니다";
export const PREVIEW_BANNER = "예시 값이며 실제 분석이 아닙니다(화면 틀 확인용)";

// 시연 시나리오 5개의 기본값: 시뮬레이션 배포자는 이력이 없어 평가하지 않는다(데이터 없음).
// 배포자는 decision.ownerAddress(시뮬레이션 기본 계정)로 가정하고, 컨트랙트는 첫 입금을 받은 주소.
export function riskForScenario(view, rows = []) {
  return {
    status: "ready",
    error: null,
    level: "nodata",
    score: null,
    scoreMax: null,
    summary: null,
    target: {
      deployer: view?.decision?.ownerAddress ?? null,
      contract: detectContract(rows ?? []),
      simulated: true
    },
    indicators: emptyIndicators(),
    evidence: [],
    firstFunding: { hops: null, category: null },
    pastDeployments: null,
    scope: {
      activityDays: null, txCount: null, asOf: null, failures: [], sources: [],
      reason: RISK_COPY.simulationReason,
      assumption: RISK_COPY.simulationAssumption
    }
  };
}
