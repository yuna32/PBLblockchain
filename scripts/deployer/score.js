// 배포자 사실값(facts) → 대시보드가 읽는 결과 모양(lib/risk.js normalizeRisk 입력). 순수 함수, 네트워크 없음.
//
// facts = {
//   deployer, contract, asOf: { block, date },
//   activity: { firstTxDate, days, txCount } | null,
//   firstFunding: { from, category, date } | null,
//   pastDeployments: [{ contract, deployedAt, publicLabel }] | null,
//   passThroughEvents: number | null,
//   failures: [], sources: [], reason
// }
import { INDICATOR_RULES as R, SCORE_MAX, FUND_FLOW } from "./config.js";

// 기간을 읽기 쉬운 말로: 60일 미만은 "N일", 그 이상은 "약 N개월"
function gapText(fromDate, toDate) {
  const days = Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400000);
  if (!Number.isFinite(days)) return null;
  return days < 60 ? `${days}일` : `약 ${Math.round(days / 30)}개월`;
}

// 화면 맨 위의 결론 한 문장. 어떤 근거인지 사용자 말로 바로 보이게 쓴다("안전"이라는 말은 쓰지 않는다).
function summarize(level, f, evidence) {
  const keys = new Set(evidence.map(e => e.indicator_key));
  const scams = (f.pastDeployments ?? []).filter(p => p.publicLabel === "scam");
  if (level === "strong") {
    const parts = [];
    if (keys.has("past_scam_deployments") && scams.length) {
      const gap = f.asOf ? gapText(scams[0].deployedAt, f.asOf.date) : null;
      parts.push(`이 배포자는 이 컨트랙트를 배포하기 ${gap ? gap + " " : ""}전, 사기(폰지)로 확인된 컨트랙트를 ${scams.length > 1 ? scams.length + "개 " : ""}만든 적이 있습니다`);
    }
    if (keys.has("first_funding")) parts.push("이 배포자가 처음 받은 돈은 믹서(Tornado Cash)에서 왔습니다");
    return parts.join(". ");
  }
  if (level === "some") {
    const names = { wallet_maturity: "새로 만든 지갑", fund_flow: "받은 돈을 바로 내보내는 패턴" };
    const list = [...keys].map(k => names[k] ?? k).join(", ");
    return `뚜렷한 위험 근거는 없지만 확인이 필요한 신호가 있습니다: ${list}`;
  }
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
    if (f.firstFunding.category === "mixer") {
      add("first_funding", R.first_funding.mixer.points, { strength: R.first_funding.mixer.strength,
        text: `처음 받은 돈이 믹서(Tornado Cash)에서 왔습니다 (${f.firstFunding.date})`, source: "Etherscan" });
    } else add("first_funding", 0);
  } // 없으면 지표를 넣지 않아 "데이터 없음"

  // 2. 지갑 성숙도: 분석 기준 시점에 활동 기간이 짧은가
  const young = R.wallet_maturity.young;
  if (typeof f.activity.days === "number") {
    if (f.activity.days < young.maxDays) {
      add("wallet_maturity", young.points, { strength: young.strength,
        text: `이 컨트랙트를 만들 때 지갑을 쓴 지 ${f.activity.days}일밖에 되지 않았습니다 (${young.maxDays}일 미만)`, source: "Etherscan" });
    } else add("wallet_maturity", 0);
  }

  // 3. 과거 사기 배포: 분석 대상이 아닌, 기준 시점 이전 배포 중 공개 라벨이 사기인 것
  if (Array.isArray(f.pastDeployments)) {
    const scams = f.pastDeployments.filter(p => p.publicLabel === "scam");
    const rule = R.past_scam_deployments.any;
    if (scams.length >= rule.minCount) {
      add("past_scam_deployments", rule.points, { strength: rule.strength,
        text: `이 컨트랙트 전에 만든 컨트랙트 ${f.pastDeployments.length}개 중 ${scams.length}개가 연구 데이터(XBlock)에서 폰지로 분류되어 있습니다 (처음 만든 날 ${scams[0].deployedAt})`,
        source: "XBlock 연구 데이터, Etherscan" });
    } else add("past_scam_deployments", 0);
  }

  // 4. 외부 위험 플래그: v0에서는 수집하지 않음(데이터 없음)

  // 5. 자금 이동 패턴
  if (typeof f.passThroughEvents === "number") {
    const rule = R.fund_flow.passThrough;
    if (f.passThroughEvents >= rule.minEvents) {
      add("fund_flow", rule.points, { strength: rule.strength,
        text: `받은 돈의 ${FUND_FLOW.shareOut * 100}% 이상을 곧바로(약 20분 안에) 다른 곳으로 보낸 일이 ${f.passThroughEvents}번 있습니다`, source: "Etherscan" });
    } else add("fund_flow", 0);
  }

  // 과거 배포가 많으면 표에는 사기 라벨 배포와 최근 배포 일부만 싣는다(전체 개수는 근거 문장·확인 범위에 남긴다)
  const PAST_SHOWN = 10;
  let pastShown = f.pastDeployments;
  let reason = f.reason ?? null;
  if (Array.isArray(f.pastDeployments) && f.pastDeployments.length > PAST_SHOWN) {
    const scamRows = f.pastDeployments.filter(p => p.publicLabel === "scam");
    const recent = f.pastDeployments.filter(p => p.publicLabel !== "scam").slice(-(Math.max(PAST_SHOWN - scamRows.length, 0)));
    pastShown = [...scamRows, ...recent];
    reason = `${reason ? reason + " " : ""}기준 시점 이전 배포 ${f.pastDeployments.length}개 중 ${pastShown.length}개(사기 라벨과 최근 배포)만 표에 표시합니다.`;
  }

  const level = evidence.some(e => e.strength === "strong") ? "strong" : evidence.length ? "some" : "none";
  const score = indicators.reduce((s, i) => s + i.points, 0);
  return {
    level,
    score,
    summary: summarize(level, f, evidence),
    score_max: SCORE_MAX,
    target: { deployer: f.deployer, contract: f.contract },
    indicators,
    // 강한 근거를 먼저 보여 준다
    evidence: evidence.sort((a, b) => (a.strength === "strong" ? 0 : 1) - (b.strength === "strong" ? 0 : 1)),
    first_funding: f.firstFunding ? { hops: 1, category: f.firstFunding.category } : null,
    past_deployments: pastShown,
    scope: {
      activity_days: f.activity.days,
      tx_count: f.activity.txCount,
      as_of: f.asOf ? `${f.asOf.date} (컨트랙트 배포 직전)` : null,
      failures: f.failures ?? [],
      sources: f.sources ?? [],
      reason
    }
  };
}
