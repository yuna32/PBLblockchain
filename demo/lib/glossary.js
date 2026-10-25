// 용어집: 리포트·온톨로지 그래프에 나오는 ID → { ko(한글 라벨), desc(한두 문장), category }.
// 예방 체크리스트 항목과 회피 서브클래스는 analysis/fraud_ontology.js의 label·ifDetected·consequence를 그대로 쓴다.
// collectTerms(report)는 리포트에 실제로 나온 ID를 모은다(용어집 누락 시험용).

import { FraudOntology } from "../../analysis/fraud_ontology.js";

const MANUAL = {
  // ── 동적 분석 규칙 (analysis/dynamic_analyzer.js) ──
  BALANCE_DROP:             ["dynamic_rule", "잔고 급락", "출금 뒤 잔고가 최고점 대비 얼마나 떨어졌는지를 점수로 매긴다. 50% 미만 하락은 0점, 전액 소진이면 만점이다."],
  FLOW_SPIKE:               ["dynamic_rule", "대량 유출", "누적 출금이 총 입금의 50% 이상인 경우다. 여러 번 나눠 인출해도 합산해서 본다."],
  CONCENTRATION_DRAIN:      ["dynamic_rule", "출금 집중", "출금액이 소수 지갑에 몰린 정도(허핀달-허쉬만 지수)를 점수로 매긴다."],
  PROFIT_EXTRACTION:        ["dynamic_rule", "과도 수익 인출", "입금액의 130%를 넘게 받아 간 지갑이 있는 경우다."],
  OSCILLATING_BALANCE:      ["dynamic_rule", "잔고 반복 소진", "잔고가 0 근처로 떨어졌다가 회복되기를 반복하는 패턴이다. 플래시론 순환에서 나타난다."],
  TEMPORAL_PATTERN:         ["dynamic_rule", "시간 패턴 이상", "입금이 끝난 뒤 오래 기다렸다가 인출하거나, 인출 속도가 급격한 경우다."],
  BALANCE_TIMESERIES_DRAIN: ["dynamic_rule", "단기 잔고 급락", "거래 종류와 관계없이 15블록 안에서 잔고가 50% 이상 줄어든 구간이 있는 경우다."],
  MAX_TX_ALERT:             ["signal", "최대 단일 거래 경보", "한 번의 거래가 직전 잔고의 대부분을 차지하는 경우를 가리키는 온톨로지 신호다. 메인 동적 분석기에는 같은 이름의 규칙이 없다."],

  // ── 정적 분석 규칙 (analysis/static_analyzer.js) ──
  UNCONSTRAINED_OWNER_DRAIN: ["static_rule", "무제한 오너 인출", "오너만 호출할 수 있는 전액 인출 함수가 있다. 러그풀과 폰지 사기의 핵심 위험이다."],
  PYRAMID_STRUCTURE:         ["static_rule", "피라미드 구조", "보상률은 있지만 별도 보상 풀이 없어, 신규 입금으로 기존 수익을 지급하는 구조다."],
  INSIDER_PRIVILEGE:         ["static_rule", "내부자 특권", "내부자 등록이나 내부자 전용 인출 기능이 있다. 펌프앤덤프 위험 신호다."],
  RAPID_EXIT_MECHANISM:      ["static_rule", "즉시 전액 인출", "매개변수 없이 잔고 전액을 인출하는 함수가 있다."],
  REWARD_PROMISE:            ["static_rule", "고정 수익 약속", "고정 수익률 변수가 있어 과도한 수익 보장이 의심된다. 정상 스테이킹에도 나타날 수 있다."],

  // ── 이상 신호 (온톨로지 anomalySignals, 리포트 anomaly_signals) ──
  BalanceDrop:        ["signal", "잔고 급락 신호", "블록 잔고가 직전 잔고의 20% 아래로 떨어지는 신호다. 이 화면에서는 동적 규칙 BALANCE_DROP으로 확인한다."],
  FlowSpike:          ["signal", "순유출 급증 신호", "한 블록의 순입출금 크기가 직전 잔고의 절반을 넘는 신호다. 이 화면에서는 동적 규칙 FLOW_SPIKE로 확인한다."],
  MaxTxAlert:         ["signal", "최대 단일 거래 신호", "단일 거래가 직전 잔고의 90% 이상인 신호다. 이 화면에서는 최대 단일 출금이 최고 잔고의 70% 이상인지로 근사한다."],
  ConcentrationDrain: ["signal", "집계 인출 신호", "입금 주소 수가 출금 주소 수의 3배를 넘어 자금이 소수 주소로 모이는 신호다."],
  ZeroWithdrawBlock:  ["signal", "출금 차단 신호", "오너가 아닌 지갑의 출금 시도가 거의 모두 실패하고, 실패 시점에도 잔고가 남아 있는 신호다. 사기 유형이 아니라 경고로 다룬다."],
  InputDataOpacity:   ["signal", "입력 데이터 불투명", "오너 전액 인출이 있거나 금액 0인 출금 시도가 있어 거래 의도를 확인하기 어려운 신호다."],
  InflowStop:         ["signal", "신규 유입 중단", "마지막 입금 이후 새 입금이 끊긴 상태다. 내부자 입금 구조에서 예상되는 신호다."],
  INFLOW_STOP:        ["signal", "유입 중단 신호", "마지막 입금 이후 전체 수명의 30% 이상 새 입금이 없고 잔고가 남아 있으면 감지된다. 정상 출금 패턴이면 억제된다."],

  // ── 코드 구조 패턴 (prevention.predicted_anomaly_signals) ──
  ParticipantMidExit: ["code_pattern", "참여자 중도 출금 구조", "출금 함수가 있어 참여자가 중간에 빠져나갈 수 있는 구조다. 순유출 급증으로 이어질 수 있다."],
  SingleLargeOutflow: ["code_pattern", "단일 대형 출금 구조", "오너에게 큰 금액을 한 번에 보내는 코드 구조다. 최대 단일 거래 신호로 이어질 수 있다."],
  InsiderBulkDeposit: ["code_pattern", "내부자 대량 입금 구조", "내부자 등록 구조가 있어 내부자가 먼저 대량 입금할 수 있다. 이후 신규 유입 중단을 함의한다."],
  HiddenStateUpdate:  ["code_pattern", "숨은 상태 갱신", "해시나 비밀값 비교로 출금 조건을 숨기는 코드 패턴이다."],
  StrawManContract:   ["code_pattern", "허수아비 컨트랙트", "생성자에서 주입한 외부 컨트랙트로 송금을 넘겨 실제 동작을 숨기는 코드 패턴이다."],

  // ── 온톨로지 조건 (fraudTypes.necessaryConditions / sufficientConditions) ──
  MidWithdrawalsExist:  ["condition", "중도 출금 있음", "마지막 블록 이전에 참여자 출금이 성공한 적이 있다."],
  NoMidWithdrawals:     ["condition", "중도 출금 없음", "참여자 출금 없이 마지막에 한 번에 자금이 빠져나갔다."],
  UniqueParticipants:   ["condition", "다수 입금자", "서로 다른 지갑 여러 개가 입금했다."],
  SingleDrain:          ["condition", "단일 대량 인출", "한 번의 출금이 잔고 대부분을 가져갔다."],
  InsiderPrivilege:     ["condition", "내부자 특권 조건", "코드에 내부자 전용 권한이 있다."],
  AsymmetricWithdrawal: ["condition", "비대칭 출금", "일부 지갑만 입금보다 훨씬 많이 받아 갔다."],
  LateParticipantLoss:  ["condition", "후발 참여자 손실", "나중에 들어온 참여자의 출금이 실패해 원금을 잃었다."],

  // ── 조건 근거 (demo/lib/ontologygraph.js CONDITION_EVIDENCE의 evidenceLabelKey) ──
  singleLargeOutflow:   ["evidence", "단일 대형 유출", "최대 단일 출금이 최고 잔고의 70% 이상이다 (동적 분석 판정 단계)."],
  distributedInflow:    ["evidence", "분산 유입", "서로 다른 입금자가 5명 이상이다 (동적 분석 판정 단계)."],
  participantMidExit:   ["evidence", "참여자 중도 출금", "마지막 블록 전에 금액이 있는 참여자 출금이 있다 (동적 분석 판정 단계)."],
  participantNoMidExit: ["evidence", "참여자 중도 출금 없음", "마지막 블록 전에 금액이 있는 참여자 출금이 없다 (동적 분석 판정 단계)."],
  withdrawFailure:      ["evidence", "출금 실패 발생", "출금 성공률이 100% 미만이다. 금액 0으로 끝난 출금 시도가 있다는 뜻이다."],

  // ── 회피 기법 (온톨로지 evasionTechniques, usesEvasion) ──
  OwnerWithdrawAll:        ["evasion_technique", "관리자 전액 인출", "오너가 잔고 전액을 한 번에 인출하는 기법이다. 잔고 급락을 일으킨다."],
  SmurfingDeposit:         ["evasion_technique", "스머핑 분산 입금", "여러 주소에서 소액으로 나눠 입금해 탐지 기준을 피하는 기법이다."],
  HiddenRequireCondition:  ["evasion_technique", "숨겨진 출금 차단 조건", "공개 함수로는 바꿀 수 없는 비공개 조건으로 출금을 막는 기법이다."],
  GradualDrainObfuscation: ["evasion_technique", "점진적 드레인 난독화", "큰 인출 전에 작은 인출을 여러 번 해 급락 신호를 흐리는 기법이다."],
  FlashRepayment:          ["evasion_technique", "플래시 상환", "같은 블록에서 대량 입금 후 바로 전액 상환하는 기법이다."],
  OwnerRecipientArbitrage: ["evasion_technique", "수령자 우회", "온톨로지에 정의 없음. fraud_ontology.js의 MoneyLaundering.usesEvasion에 이름만 있고 라벨·탐지 방법·패치는 없다."],

  // ── 지갑 역할 (온톨로지 WalletRole) ──
  Insider:         ["role", "내부자", "운영자나 내부자로, 사기 구조에서 이득을 보는 쪽이다."],
  LateParticipant: ["role", "후발 참여자", "나중에 들어와 손실을 떠안기 쉬운 참여자다."],
  Beneficiary:     ["role", "수혜자", "최종적으로 자금을 받아 가는 지갑이다."],
  Victim:          ["role", "피해자", "원금을 돌려받지 못한 참여자다."],
  Mixer:           ["role", "믹서", "자금 출처를 섞어 추적을 어렵게 하는 지갑이다."],
  Depositor:       ["role", "입금자", "온톨로지에 정의 없음. fraud_ontology.js의 MoneyLaundering.affectedRoles에 이름만 있다."],

  // ── 분류 클래스 ──
  FraudPattern:    ["class", "사기 패턴", "블록체인 사기 유형의 최상위 개념이다."],
  NormalContract:  ["class", "정상 컨트랙트", "어떤 사기 유형에도 해당하지 않고 출금 차단 신호도 없는 컨트랙트다."],
  PonziScheme:     ["class", "폰지 사기", "신규 입금으로 기존 참여자에게 수익을 지급하는 구조다."],
  RugPull:         ["class", "러그풀", "잔고가 정점일 때 운영자가 한 번에 전액을 인출하는 사기다."],
  MoneyLaundering: ["class", "자금세탁", "여러 지갑의 입금을 한 주소로 모아 출처를 흐리는 패턴이다."],
  PumpDump:        ["class", "펌프앤덤프", "내부자가 먼저 들어와 자금을 부풀린 뒤 빼내 후발 참여자가 손실을 보는 사기다."],
  PumpAndDump:     ["class", "펌프앤덤프", "PumpDump의 다른 표기다(온톨로지 클래스 목록과 OWL 결과가 이 이름을 쓴다)."],

  // ── 동적 분석 유형 힌트 (dynamic.fraud_type_hint) ──
  ponzi_scheme:         ["fraud_type_hint", "폰지 사기", "동적 분석이 폰지 사기로 판정했다."],
  rug_pull:             ["fraud_type_hint", "러그풀", "동적 분석이 러그풀로 판정했다."],
  money_laundering:     ["fraud_type_hint", "자금세탁", "동적 분석이 자금세탁으로 판정했다."],
  pump_and_dump:        ["fraud_type_hint", "펌프앤덤프", "동적 분석이 펌프앤덤프로 판정했다."],
  flash_loan:           ["fraud_type_hint", "플래시론 악용", "동적 분석이 플래시론 악용으로 판정했다."],
  normal_staking:       ["fraud_type_hint", "정상 스테이킹", "사기 조건에 맞지 않고 스테이킹·언스테이킹 패턴만 보였다."],
  unclassified_warning: ["fraud_type_hint", "유형 미확정 (출금 차단 경고)", "사기 유형 조건에는 맞지 않지만 출금 차단 신호가 있어 경고만 낸다."],
  unknown:              ["fraud_type_hint", "판정 불가", "어떤 판정 규칙에도 맞지 않았다."],

  // ── 위험 수준과 판정 ──
  LOW:         ["level", "낮음", "배포 전 예방 분석에서 위험 항목이 거의 없다."],
  MEDIUM:      ["level", "보통", "위험 항목이 일부 있어 모니터링이 필요하다."],
  HIGH:        ["level", "높음", "배포 전에 위험 항목을 고친 뒤 다시 검토해야 한다."],
  CRITICAL:    ["level", "매우 높음", "필수 수정 항목이 있어 수정 없이는 배포하면 안 된다."],
  LOW_RISK:    ["verdict", "낮은 위험", "정적 또는 동적 위험 점수가 낮은 구간이다."],
  MEDIUM_RISK: ["verdict", "중간 위험", "정적 또는 동적 위험 점수가 중간 구간이다."],
  HIGH_RISK:   ["verdict", "높은 위험", "정적 또는 동적 위험 점수가 높은 구간이다."],

  // ── 신뢰 점수 5축 (trust.wallet_scores[].breakdown) ──
  blacklist_assoc: ["trust_axis", "블랙리스트 연관도", "오너 전액 인출을 받은 지갑이면 0점이다. 가중치 30%."],
  flow_pattern:    ["trust_axis", "자금 이동 패턴", "입금 대비 수령 비율이 클수록 낮다. 가중치 25%."],
  scam_history:    ["trust_axis", "스캠 연루 이력", "과도 수익(130% 초과)이나 오너 드레인이 있으면 0점이다. 가중치 15%."],
  activity_age:    ["trust_axis", "활동 기간", "활동한 블록 구간이 길수록 높다. 가중치 15%."],
  tx_diversity:    ["trust_axis", "거래 다양성", "입금·출금 등 거래 종류가 다양할수록 높다. 가중치 15%."],

  // ── 핵심 용어 ──
  drainer:             ["term", "운영자 전액 인출 지갑 (drainer)", "owner_withdraw_all 거래로 자금을 받은 지갑이다(리포트 필드 is_drainer)."],
  extractor:           ["term", "과도 수익 지갑 (extractor)", "drainer가 아니면서 입금액의 1.3배를 넘게 받아 간 지갑이다."],
  lowest_wallet_grade: ["term", "최저 지갑 등급", "지갑별 신뢰 등급 중 가장 낮은 값이다. 평균 등급이 안전해 보여도 위험한 지갑이 숨어 있는지 보여 준다."],
  trust_grade:         ["term", "평균 지갑 등급", "지갑 신뢰 점수의 평균(60%)과 최저값(40%)을 섞은 점수의 등급이다."],
  trust_score:         ["term", "지갑 신뢰 점수", "지갑 하나를 5축으로 평가한 0~100 점수다. 높을수록 안전하다."],
  onset:               ["term", "사기 발현 시점", "사기로 분류된 경우 처음으로 자금이 빠져나간 블록이다."],
  prevention_risk_level: ["term", "코드 위험 수준", "배포 전 예방 분석(온톨로지 체크리스트)의 위험 등급이다."],
  withdraw_block_warning: ["term", "출금 차단 경고", "오너가 아닌 지갑의 출금이 막히는 신호다. 사기 유형과 별도로 표시한다."],
  code_pattern_warnings: ["term", "코드 패턴 경고", "출금 조건을 숨기는 코드 패턴(숨은 상태 갱신, 허수아비 컨트랙트)이 검출된 경우다."],
  evasion_subclass:    ["term", "회피 서브클래스", "사기 유형이 기본 탐지 신호를 피하려고 쓰는 하위 형태다."],
  report_hash:         ["term", "리포트 해시", "리포트를 정해진 규칙으로 직렬화한 뒤 계산한 SHA-256 값이다. 같은 입력이면 같은 값이 나온다."],
  canonical:           ["term", "정규 직렬화", "키 정렬 등 RFC 8785 규칙으로 리포트를 한 가지 문자열로 만든 것이다. 생성 시각과 파일 이름은 뺀다."],
  live:                ["term", "실시간 실행", "이번 요청에서 시뮬레이션을 실제로 돌려 만든 결과다."],
  fixture:             ["term", "사전 생성본", "시뮬레이션이 실패했거나 사전 생성본 모드일 때 쓰는, 미리 만들어 둔 결과다."]
};

function derived() {
  const out = {};
  for (const rules of Object.values(FraudOntology.preventionRules)) {
    for (const item of rules.checklistItems) out[item.id] = { ko: item.label, desc: item.ifDetected, category: "prevention_item" };
  }
  for (const item of FraudOntology.withdrawBlockWarning.checklistItems) {
    out[item.id] = { ko: item.label, desc: item.ifDetected, category: "prevention_item" };
  }
  for (const ft of Object.values(FraudOntology.fraudTypes)) {
    for (const sub of Object.values(ft.evasionSubclasses)) out[sub.id] = { ko: sub.label, desc: sub.consequence, category: "evasion_subclass" };
  }
  return out;
}

export const GLOSSARY = Object.freeze({
  ...derived(),
  ...Object.fromEntries(Object.entries(MANUAL).map(([id, [category, ko, desc]]) => [id, { ko, desc, category }]))
});

export function glossaryLabel(id) {
  return GLOSSARY[id]?.ko ?? id;
}

// 리포트에 실제로 나온 ID 모음 (숫자·자유 문장 제외)
export function collectTerms(report) {
  const ids = new Set();
  const add = v => { if (typeof v === "string" && v) ids.add(v); };
  const d = report.dynamic ?? {}, s = report.static ?? {}, p = report.prevention ?? {}, t = report.trust ?? {};
  (d.triggered_rules ?? []).forEach(r => add(r.id));
  (s.triggered_rules ?? []).forEach(r => add(r.id));
  (p.checklist ?? []).forEach(r => add(r.id));
  (p.predicted_anomaly_signals ?? []).forEach(r => { add(r.pattern); add(r.signal); });
  (p.code_pattern_warnings ?? []).forEach(r => add(r.codePattern?.replace(/Pattern$/, "")));
  (p.withdraw_block_warning?.matched_items ?? []).forEach(add);
  Object.keys(d.anomaly_signals ?? {}).forEach(add);
  add(d.evasion_subclass);
  Object.keys(d.evasion_all_scores ?? {}).forEach(add);
  add(d.fraud_type_hint);
  add(p.fraud_type_suspected);
  add(s.primary_fraud_class);
  add(p.risk_level);
  add(s.verdict);
  add(d.verdict);
  (s.gui_emphasis?.panel4 ?? []).forEach(add);
  (t.wallet_scores ?? []).forEach(w => Object.keys(w.breakdown ?? {}).forEach(add));
  return ids;
}
