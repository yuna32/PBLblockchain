// 배포자 사실값(facts) → 대시보드가 읽는 결과 모양(lib/risk.js normalizeRisk 입력). 순수 함수, 네트워크 없음.
//
// facts = {
//   deployer, contract, asOf: { block, date },
//   activity: { firstTxDate, days, txCount, counterparties } | null,
//   firstFunding: { from, category, date } | null,
//   pastDeployments: [{ contract, deployedAt, deployedTs, publicLabel, sameDay }] | null,
//   passThroughEvents: number | null,
//   failures: [], sources: [], reason
// }
import { INDICATOR_RULES as R, SCORE_MAX, SCORE_BANDS, FUND_FLOW, MIN_HISTORY_TXS } from "./config.js";

// 기간을 읽기 쉬운 말로: 60일 미만은 "N일", 그 이상은 "약 N개월"
function gapText(fromTs, toDate) {
  const days = Math.round((Date.parse(toDate) - fromTs * 1000) / 86400000);
  if (!Number.isFinite(days)) return null;
  return days < 60 ? `${days}일` : `약 ${Math.round(days / 30)}개월`;
}

// 첫 자금을 보낸 지갑이 어떤 위험 주소인지 사용자 말로
function funderText(k) {
  if (k?.kind === "scam_deployer") return "그 전에 사기(폰지) 컨트랙트를 배포한 적이 있는 지갑입니다";
  if (k?.kind === "hack") return `해킹 사건에 쓰인 주소로 알려진 지갑입니다(${k.name})`;
  if (k?.kind === "goplus") return `보안 서비스(GoPlus)가 위험 주소(${k.name})로 표시한 지갑입니다`;
  return "알려진 위험 주소입니다";
}

// 화면 맨 위의 결론 한 문장. 어떤 근거인지 사용자 말로 바로 보이게 쓴다("안전"이라는 말은 쓰지 않는다).
function summarize(level, f, evidence, scams, short) {
  const keys = new Set(evidence.map(e => e.indicator_key));
  if (level === "strong") {
    const parts = [];
    if (keys.has("past_scam_deployments") && scams.length) {
      const gap = f.asOf ? gapText(scams[0].deployedTs, f.asOf.date) : null;
      parts.push(`이 배포자는 이 컨트랙트를 배포하기 ${gap ? gap + " " : ""}전, 사기(폰지)로 확인된 컨트랙트를 ${scams.length > 1 ? scams.length + "개 " : ""}만든 적이 있습니다`);
    }
    if (keys.has("past_scam_deployments") && !scams.length && f.goplus?.deployer?.maliciousContracts > 0)
      parts.push(`보안 서비스(GoPlus) 기준으로 이 배포자가 만든 악성 컨트랙트가 ${f.goplus.deployer.maliciousContracts}개 있습니다`);
    if (keys.has("first_funding")) parts.push(f.firstFunding?.category === "malicious"
      ? `이 배포자가 처음 받은 돈을 보낸 지갑은 ${funderText(f.firstFunding.knownAs).replace(/입니다$/, "")}입니다`
      : "이 배포자가 처음 받은 돈은 믹서에서 왔습니다");
    if (keys.has("external_flags") && f.goplus?.deployer?.direct.length)
      parts.push(`이 배포자 주소는 보안 서비스(GoPlus)에서 ${f.goplus.deployer.direct.join(", ")}(으)로 표시되어 있습니다`);
    return parts.join(". ");
  }
  if (level === "some") {
    const names = { fund_flow: "받은 돈을 바로 내보내는 패턴", external_flags: "보안 서비스의 의심 표시" };
    return `뚜렷한 위험 근거는 없지만 확인이 필요한 신호가 있습니다: ${[...keys].map(k => names[k] ?? k).join(", ")}`;
  }
  if (short) return `확인할 기록이 거의 없어(거래 ${f.activity.txCount}건) 판단 근거가 부족합니다. 위험 근거가 없다는 뜻이 아닙니다`;
  const past = Array.isArray(f.pastDeployments) ? `, 이전 배포 ${f.pastDeployments.length}개` : "";
  return `확인한 범위(활동 ${f.activity.days}일${past})에서 이 배포자의 위험 근거는 보이지 않습니다. 안전하다는 뜻은 아닙니다`;
}

export function scoreDeployer(f) {
  if (!f || !f.deployer || f.activity === null) {
    return { level: "nodata", target: { deployer: f?.deployer ?? null, contract: f?.contract ?? null }, indicators: [], evidence: [],
      scope: { failures: f?.failures ?? [], sources: f?.sources ?? [], reason: f?.reason ?? null } };
  }
  const indicators = [];
  const evidence = [];
  const add = (key, points, ev) => {
    const cap = R[key].cap;
    indicators.push({ key, points: Math.min(points, cap), cap });
    if (ev) evidence.push({ indicator_key: key, points: Math.min(points, cap), source: ev.source ?? null, strength: ev.strength, text: ev.text });
  };

  // 1. 첫 자금원
  if (f.firstFunding) {
    const ff = f.firstFunding;
    if (ff.category === "mixer") {
      add("first_funding", R.first_funding.mixer.points, { strength: R.first_funding.mixer.strength,
        text: `처음 받은 돈이 믹서에서 왔습니다 (${ff.date})`, source: f.goplus?.funder?.mixer ? "GoPlus, Etherscan" : "Tornado Cash 주소 목록, Etherscan" });
    } else if (ff.category === "malicious") {
      add("first_funding", R.first_funding.malicious.points, { strength: R.first_funding.malicious.strength,
        text: `처음 받은 돈을 보낸 지갑이 ${funderText(ff.knownAs)} (${ff.date})`,
        source: `${ff.knownAs?.source ?? "알려진 위험 주소"}, Etherscan`, label_based: ff.knownAs?.kind === "scam_deployer" });
    } else add("first_funding", 0);
  } // 없으면 지표를 넣지 않아 "데이터 없음"

  // 2. 지갑 성숙도: 구분력이 낮아 점수에 넣지 않고 참고로만(status: info)
  const young = R.wallet_maturity.young;
  if (typeof f.activity.days === "number") {
    const isYoung = f.activity.days < young.maxDays;
    indicators.push({ key: "wallet_maturity", status: "info", points: null, cap: R.wallet_maturity.cap,
      note: `${isYoung ? "새 지갑" : "새 지갑 아님"}: 이 컨트랙트를 만들 때 지갑을 쓴 지 ${f.activity.days}일. 정상 배포자에게도 흔해(사기 배포자와 1.3배 차이) 점수에는 넣지 않습니다` });
  }

  // 3. 과거 사기 배포: 분석 대상이 아닌, 24시간 이상 앞선 배포 중 공개 라벨이 사기인 것(같은 날 재배포는 제외)
  const scams = (f.pastDeployments ?? []).filter(p => p.publicLabel === "scam" && !p.sameDay);
  if (Array.isArray(f.pastDeployments)) {
    const rule = R.past_scam_deployments.any;
    const gpCount = f.goplus?.deployer?.maliciousContracts ?? 0;
    if (scams.length >= rule.minCount) {
      add("past_scam_deployments", rule.points, { strength: rule.strength,
        text: `이 컨트랙트보다 하루 이상 앞서 만든 컨트랙트 중 ${scams.length}개가 연구 데이터(XBlock)에서 폰지로 분류되어 있습니다 (처음 만든 날 ${scams[0].deployedAt})`,
        source: "XBlock 연구 데이터, Etherscan", label_based: true });
    } else if (gpCount > 0) {
      add("past_scam_deployments", rule.points, { strength: rule.strength,
        text: `보안 서비스(GoPlus) 기준으로 이 배포자가 만든 악성 컨트랙트가 ${gpCount}개 있습니다 (현재 시점 정보)`,
        source: "GoPlus" });
    } else add("past_scam_deployments", 0);
  }

  // 4. 외부 위험 플래그: GoPlus를 조회했을 때만(실주소 분석). 조회하지 않았으면 데이터 없음
  const gd = f.goplus?.deployer;
  if (gd) {
    if (gd.direct.length) add("external_flags", R.external_flags.direct.points, { strength: R.external_flags.direct.strength,
      text: `배포자 주소가 보안 서비스에서 ${gd.direct.join(", ")}(으)로 표시되어 있습니다 (현재 시점 정보)`, source: gd.source });
    else if (gd.doubt.length) add("external_flags", R.external_flags.doubt.points, { strength: R.external_flags.doubt.strength,
      text: `배포자 주소에 보안 서비스의 의심 표시가 있습니다: ${gd.doubt.join(", ")} (현재 시점 정보)`, source: gd.source });
    else add("external_flags", 0);
  }

  // 5. 자금 이동 패턴
  if (typeof f.passThroughEvents === "number") {
    const rule = R.fund_flow.passThrough;
    if (f.passThroughEvents >= rule.minEvents) {
      add("fund_flow", rule.points, { strength: rule.strength,
        text: `받은 돈의 ${FUND_FLOW.shareOut * 100}% 이상을 ${FUND_FLOW.withinSeconds / 60}분 안에 다른 곳으로 보낸 일이 ${f.passThroughEvents}번 있습니다`, source: "Etherscan" });
    } else add("fund_flow", 0);
  }

  const level = evidence.some(e => e.strength === "strong") ? "strong" : evidence.length ? "some" : "none";
  // 점수: 단계 구간의 시작점 + 구간 안에서 근거가 많을수록 높게(가장 강한 근거 하나는 구간 시작점에 이미 반영)
  const raw = indicators.reduce((s, i) => s + (typeof i.points === "number" ? i.points : 0), 0);
  const band = SCORE_BANDS[level];
  const first = level === "strong" ? 30 : level === "some" ? 10 : 0;
  const score = band.base + Math.min(band.span, Math.max(0, raw - first));
  const short = f.activity.txCount < MIN_HISTORY_TXS;

  // 과거 배포가 많으면 표에는 사기 라벨 배포와 최근 배포 일부만 싣는다
  const PAST_SHOWN = 10;
  let pastShown = f.pastDeployments;
  let reason = f.reason ?? null;
  if (Array.isArray(f.pastDeployments) && f.pastDeployments.length > PAST_SHOWN) {
    const scamRows = f.pastDeployments.filter(p => p.publicLabel === "scam");
    const recent = f.pastDeployments.filter(p => p.publicLabel !== "scam").slice(-(Math.max(PAST_SHOWN - scamRows.length, 0)));
    pastShown = [...scamRows, ...recent];
    reason = `${reason ? reason + " " : ""}기준 시점 이전 배포 ${f.pastDeployments.length}개 중 ${pastShown.length}개(사기 라벨과 최근 배포)만 표에 표시합니다.`;
  }

  return {
    level,
    score,
    score_max: SCORE_MAX,
    summary: summarize(level, f, evidence, scams, short),
    target: { deployer: f.deployer, contract: f.contract },
    indicators,
    evidence: evidence.sort((a, b) => (a.strength === "strong" ? 0 : 1) - (b.strength === "strong" ? 0 : 1)),
    first_funding: f.firstFunding ? { hops: 1, category: f.firstFunding.category } : null,
    past_deployments: pastShown,
    scope: {
      activity_days: f.activity.days,
      tx_count: f.activity.txCount,
      as_of: f.asOf ? `${f.asOf.date} (컨트랙트 배포 직전)` : null,
      failures: short ? [...(f.failures ?? []), `기록 부족(거래 ${MIN_HISTORY_TXS}건 미만)`] : (f.failures ?? []),
      sources: f.sources ?? [],
      reason
    }
  };
}
