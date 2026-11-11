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

const emptyIndicators = () => INDICATORS.map(d => ({ key: d.key, label: d.label, extension: Boolean(d.extension), status: "nodata", points: null, cap: null }));

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
