// 온톨로지 그래프: analysis/fraud_ontology.js + 리포트 → { nodes, links, highlight, meta }. 순수 함수.
//
// 노드 kind: class(분류 클래스), parent(상위 클래스), condition(필요·충분 조건), evidence(리포트 근거),
//            evasion(회피 서브클래스·회피 기법), role(영향받는 역할), patch(권고 조치)
// 링크 kind: subClassOf, requires, supportedBy(evidence → condition), exhibits, affects, mitigatedBy
// active: 이 리포트가 실제로 충족·발동한 항목. 링크는 양 끝 노드가 모두 active일 때 active.
// highlight.path: 분류 클래스가 active일 때, 충족된 조건마다 [증거 노드, 조건 노드, 분류 클래스] id 배열.
// highlight.evasionPath: 활성 회피 기법마다 [증거 노드, 회피 기법 노드, 분류 클래스] (분류 추론과 분리).
// 사기로 분류되지 않으면(normal 등) 후보 사기 유형 4개와 조건 충족 상태를 비활성 클래스 아래에 그린다.
//
// CONDITION_EVIDENCE는 시연용 매핑이며 온톨로지 정의가 아니다. fraud_ontology.js에는 조건과 리포트 근거를
// 잇는 필드가 없어서(중첩 pipeline만 3개 조건을 코드로 연결) 이 파일에 둔다.
// TECHNIQUE_EVIDENCE(회피 기법 활성 판정)도 시연용 매핑이다. 해당 유형의 usesEvasion에 있는 기법만 그린다.

import { FraudOntology as O } from "../../analysis/fraud_ontology.js";
import { GLOSSARY, glossaryLabel } from "./glossary.js";

export const MAPPING_NOTE = "시연용 매핑, 온톨로지 정의 아님";
export const TECHNIQUE_MAPPING_NOTE =
  "회피 기법 활성 판정도 시연용 매핑이며, 해당 유형의 usesEvasion 목록에 있는 기법만 표시한다. " +
  "OwnerWithdrawAll은 중첩 pipeline(analysis/analysis/pipeline.js)과 같이 정적 UNCONSTRAINED_OWNER_DRAIN으로, " +
  "SmurfingDeposit은 분산 입금 신호(reasoning_steps.distributedInflow)로 판정한다. " +
  "중첩 pipeline의 CONCENTRATION_DRAIN 규칙은 의미가 달라 따르지 않음";
export const OWL_NOTE = "저장소의 예전 로그 기준 결과로 현재 fixture와 값이 다를 수 있음";

// 같은 클래스의 다른 표기 → fraud_ontology.js fraudTypes 키
export const CLASS_ALIASES = { PumpAndDump: "PumpDump" };
export const CLASS_DISPLAY = { PumpDump: "펌프앤덤프" };
export const HINT_TO_CLASS = {
  ponzi_scheme:     "PonziScheme",
  rug_pull:         "RugPull",
  money_laundering: "MoneyLaundering",
  pump_and_dump:    "PumpDump"
};

export function normalizeClass(name) {
  return CLASS_ALIASES[name] ?? name;
}

function dynamicRule(report, id) {
  const rules = report.dynamic?.triggered_rules;
  return Array.isArray(rules) ? rules.some(r => r.id === id) : null;
}

function staticRule(report, id) {
  const rules = report.static?.triggered_rules;
  return Array.isArray(rules) ? rules.some(r => r.id === id) : null;
}

// dynamic.reasoning_steps의 "key: true (...)" 줄 → true | false | null
function reasoningFlag(report, key) {
  const steps = report.dynamic?.reasoning_steps;
  if (!Array.isArray(steps)) return null;
  const step = steps.find(s => s.startsWith(`${key}:`));
  if (!step) return null;
  const value = step.slice(key.length + 1).trim().split(/\s/)[0];
  return value === "true" ? true : value === "false" ? false : null;
}

// "withdrawSuccessRate: 37.5% (3/8 succeeded)" → { succeeded, total }
function withdrawAttempts(report) {
  const steps = report.dynamic?.reasoning_steps;
  const step = Array.isArray(steps) ? steps.find(s => s.startsWith("withdrawSuccessRate:")) : null;
  const m = step?.match(/\((\d+)\/(\d+) succeeded\)/);
  return m ? { succeeded: Number(m[1]), total: Number(m[2]) } : null;
}

// test(report) → true(충족) | false(미충족) | null(근거 데이터 없음)
export const CONDITION_EVIDENCE = [
  { condition: "BalanceDrop", evidenceLabelKey: "BALANCE_DROP", approx: false,
    test: r => dynamicRule(r, "BALANCE_DROP"),
    note: "동적 규칙 BALANCE_DROP 발동 여부." },
  { condition: "FlowSpike", evidenceLabelKey: "FLOW_SPIKE", approx: false,
    test: r => dynamicRule(r, "FLOW_SPIKE"),
    note: "동적 규칙 FLOW_SPIKE 발동 여부." },
  { condition: "MaxTxAlert", evidenceLabelKey: "singleLargeOutflow", approx: true,
    test: r => reasoningFlag(r, "singleLargeOutflow"),
    note: "근사: 근거 기준은 최대 단일 출금이 최고 잔고의 70% 이상이고, 온톨로지 공식은 직전 잔고의 90% 이상이다." },
  { condition: "MidWithdrawalsExist", evidenceLabelKey: "participantMidExit", approx: false,
    test: r => reasoningFlag(r, "participantMidExit"),
    note: "dynamic.reasoning_steps의 participantMidExit가 true." },
  { condition: "NoMidWithdrawals", evidenceLabelKey: "participantNoMidExit", approx: false,
    test: r => { const v = reasoningFlag(r, "participantMidExit"); return v === null ? null : !v; },
    note: "dynamic.reasoning_steps의 participantMidExit가 false." },
  { condition: "UniqueParticipants", evidenceLabelKey: "distributedInflow", approx: true,
    test: r => reasoningFlag(r, "distributedInflow"),
    note: "근사: 근거 기준은 고유 입금자 5명 이상이고, 온톨로지 임계값은 비율 0.3(UNIQUE_PARTICIPANTS)이다." },
  { condition: "SingleDrain", evidenceLabelKey: "singleLargeOutflow", approx: false,
    test: r => reasoningFlag(r, "singleLargeOutflow"),
    note: "dynamic.reasoning_steps의 singleLargeOutflow가 true (최대 단일 출금이 최고 잔고의 70% 이상)." },
  { condition: "InsiderPrivilege", evidenceLabelKey: "INSIDER_PRIVILEGE", approx: false,
    test: r => staticRule(r, "INSIDER_PRIVILEGE"),
    note: "정적 규칙 INSIDER_PRIVILEGE 발동 여부." },
  { condition: "AsymmetricWithdrawal", evidenceLabelKey: "PROFIT_EXTRACTION", approx: true,
    test: r => dynamicRule(r, "PROFIT_EXTRACTION"),
    note: "근사: 입금액의 130%를 넘게 받은 지갑이 있으면 충족으로 본다. 그 지갑이 내부자인지는 보지 않는다." },
  { condition: "LateParticipantLoss", evidenceLabelKey: "withdrawFailure", approx: true,
    test: r => {
      const a = withdrawAttempts(r);
      const rate = r.dynamic?.withdraw_success_rate;
      if (!a || a.total === 0 || typeof rate !== "number") return null;
      return rate < 1;
    },
    note: "근사: 출금 성공률(dynamic.withdraw_success_rate)이 100% 미만이면 충족으로 본다. 실패한 지갑이 후발 참여자인지는 보지 않는다." }
];

// 회피 기법 활성 판정 (시연용 매핑, 온톨로지 정의 아님):
//   OwnerWithdrawAll ← 정적 UNCONSTRAINED_OWNER_DRAIN (중첩 pipeline buildOntologyMapping 규칙 준용.
//     중첩 pipeline은 RAPID_EXIT_MECHANISM도 쓰지만 시연 결정에 따라 넣지 않는다)
//   SmurfingDeposit  ← 분산 입금 신호 reasoning_steps.distributedInflow === true.
//     중첩 pipeline의 CONCENTRATION_DRAIN(출금 집중) 규칙은 분산 입금과 의미가 달라 따르지 않는다.
// 그래프에는 해당 유형의 usesEvasion 목록에 있는 기법만 나온다. 여기 없는 기법은 "근거 데이터 없음".
// test는 CONDITION_EVIDENCE와 같은 true | false | null.
export const TECHNIQUE_EVIDENCE = [
  { technique: "OwnerWithdrawAll", evidenceLabelKey: "UNCONSTRAINED_OWNER_DRAIN",
    test: r => staticRule(r, "UNCONSTRAINED_OWNER_DRAIN"),
    note: "정적 규칙 UNCONSTRAINED_OWNER_DRAIN 발동 여부 (중첩 pipeline 규칙 준용)." },
  { technique: "SmurfingDeposit", evidenceLabelKey: "distributedInflow",
    test: r => reasoningFlag(r, "distributedInflow"),
    note: "분산 입금 신호 dynamic.reasoning_steps의 distributedInflow가 true (중첩 pipeline의 CONCENTRATION_DRAIN 규칙은 따르지 않음)." }
];

const STATUS = { true: "met", false: "unmet", null: "no_data" };
const STATUS_KO = { met: "충족", unmet: "미충족", no_data: "근거 데이터 없음" };

export function conditionStatuses(report) {
  return Object.fromEntries(CONDITION_EVIDENCE.map(c => {
    const v = c.test(report);
    return [c.condition, v === true || v === false ? v : null];
  }));
}

export function techniqueStatuses(report) {
  return Object.fromEntries(TECHNIQUE_EVIDENCE.map(t => {
    const v = t.test(report);
    return [t.technique, v === true || v === false ? v : null];
  }));
}

export function buildOntologyGraph(report, options = {}) {
  const hint = report.dynamic?.fraud_type_hint ?? null;
  const scenarioClass = HINT_TO_CLASS[hint] ?? null;
  const classes = scenarioClass ? [scenarioClass] : Object.keys(O.fraudTypes);
  const statuses = conditionStatuses(report);
  const evidenceSpec = Object.fromEntries(CONDITION_EVIDENCE.map(c => [c.condition, c]));
  const techStatuses = techniqueStatuses(report);
  const techniqueSpec = Object.fromEntries(TECHNIQUE_EVIDENCE.map(t => [t.technique, t]));

  const nodes = new Map();
  const links = [];
  const addNode = n => { if (!nodes.has(n.id)) nodes.set(n.id, n); return nodes.get(n.id); };
  const addLink = (source, target, label, kind) => {
    if (!links.some(l => l.source === source && l.target === target && l.kind === kind)) links.push({ source, target, label, kind });
  };

  const parentId = "parent:FraudPattern";
  addNode({ id: parentId, label: glossaryLabel("FraudPattern"), kind: "parent", group: "class",
            active: scenarioClass !== null, desc: O.classes.FraudPattern.description });

  const paths = [];
  const evasionPaths = [];
  for (const cls of classes) {
    const ft = O.fraudTypes[cls];
    const classId = `class:${cls}`;
    const classActive = cls === scenarioClass;
    const aliases = Object.entries(CLASS_ALIASES).filter(([, to]) => to === cls).map(([from]) => from);
    addNode({
      id: classId, label: CLASS_DISPLAY[cls] ?? ft.label, kind: "class", group: "class", active: classActive,
      desc: ft.description + (aliases.length ? ` (다른 표기: ${aliases.join(", ")})` : "")
    });
    addLink(classId, parentId, "하위 클래스", "subClassOf");

    // 조건과 근거
    const conds = [
      ...ft.necessaryConditions.map(c => [c, "필요 조건"]),
      ...ft.sufficientConditions.map(c => [c, "충분 조건"])
    ];
    for (const [cond, relLabel] of conds) {
      const spec = evidenceSpec[cond];
      const value = spec ? statuses[cond] : null;
      const status = STATUS[value];
      const condId = `condition:${cond}`;
      const signal = O.anomalySignals[cond];
      addNode({
        id: condId, label: glossaryLabel(cond), kind: "condition", group: "condition",
        active: value === true, status, approx: spec?.approx ?? false,
        desc: [
          GLOSSARY[cond]?.desc,
          signal?.formula ? `온톨로지 공식: ${signal.formula}.` : null,
          spec?.approx ? spec.note : null,
          `이 리포트: ${STATUS_KO[status]}.`
        ].filter(Boolean).join(" ")
      });
      addLink(classId, condId, relLabel, "requires");
      if (spec) {
        const evId = `evidence:${spec.evidenceLabelKey}`;
        addNode({
          id: evId, label: glossaryLabel(spec.evidenceLabelKey), kind: "evidence", group: "evidence",
          active: value === true, status,
          desc: `${GLOSSARY[spec.evidenceLabelKey]?.desc ?? spec.evidenceLabelKey} ${spec.note} (${MAPPING_NOTE})`
        });
        addLink(evId, condId, "근거", "supportedBy");
        if (classActive && value === true) paths.push([evId, condId, classId]);
      }
    }

    // 회피 서브클래스
    for (const sub of Object.values(ft.evasionSubclasses)) {
      const score = report.dynamic?.evasion_all_scores?.[sub.id];
      addNode({
        id: `evasion:${sub.id}`, label: sub.label, kind: "evasion", group: "evasion_subclass",
        active: classActive && report.dynamic?.evasion_subclass === sub.id,
        desc: sub.consequence + (typeof score === "number" ? ` 이 리포트의 회피 점수 ${score}.` : "")
      });
      addLink(classId, `evasion:${sub.id}`, "회피 하위 유형", "exhibits");
    }

    // 회피 기법과 권고 조치: 이 유형의 usesEvasion 목록에 있는 기법만 그린다.
    // 활성 판정은 TECHNIQUE_EVIDENCE(시연용)로 하고, 근거가 없는 기법은 "근거 데이터 없음".
    for (const tech of ft.usesEvasion) {
      const def = O.evasionTechniques[tech];
      const spec = techniqueSpec[tech];
      const value = spec ? techStatuses[tech] : null;
      const status = STATUS[value];
      const techId = `technique:${tech}`;
      addNode({
        id: techId, label: glossaryLabel(tech), kind: "evasion", group: "evasion_technique",
        active: value === true, status,
        desc: [
          def ? GLOSSARY[tech]?.desc : "온톨로지에 정의 없음.",
          spec ? `${spec.note} 이 리포트: ${STATUS_KO[status]}.` : "이 리포트에서 사용 여부를 판정하는 근거는 없다."
        ].filter(Boolean).join(" ")
      });
      addLink(classId, techId, "사용 기법", "exhibits");
      if (spec) {
        const evId = `evidence:${spec.evidenceLabelKey}`;
        addNode({
          id: evId, label: glossaryLabel(spec.evidenceLabelKey), kind: "evidence", group: "evidence",
          active: value === true, status,
          desc: `${GLOSSARY[spec.evidenceLabelKey]?.desc ?? spec.evidenceLabelKey} ${spec.note} (${TECHNIQUE_MAPPING_NOTE})`
        });
        addLink(evId, techId, "근거", "supportedBy");
        if (classActive && value === true) evasionPaths.push([evId, techId, classId]);
      }
      if (def?.patch) {
        const patchId = `patch:${tech}`;
        addNode({ id: patchId, label: `${glossaryLabel(tech)} 대응`, kind: "patch", group: "evasion_patch",
                  active: value === true, desc: def.patch });
        addLink(techId, patchId, "권고 조치", "mitigatedBy");
      }
    }

    // 역할
    for (const [roles, relLabel] of [[ft.affectedRoles, "피해 역할"], [ft.beneficiaryRoles, "수혜 역할"]]) {
      for (const role of roles) {
        const roleId = `role:${role}`;
        const defined = O.classes.WalletRole.subClasses.includes(role);
        const n = addNode({
          id: roleId, label: glossaryLabel(role), kind: "role", group: "role", active: false,
          desc: defined ? GLOSSARY[role]?.desc ?? role : `온톨로지에 정의 없음. ${GLOSSARY[role]?.desc ?? ""}`.trim()
        });
        if (classActive) n.active = true;
        addLink(classId, roleId, relLabel, "affects");
      }
    }
  }

  // 예방 체크리스트에서 검출된 항목의 수정 권고 (리포트 값)
  const suspected = report.prevention?.fraud_type_suspected ? normalizeClass(report.prevention.fraud_type_suspected) : null;
  if (suspected && classes.includes(suspected)) {
    for (const item of report.prevention.checklist ?? []) {
      if (!item.detected || !item.fix) continue;
      const patchId = `patch:${item.id}`;
      addNode({ id: patchId, label: item.label, kind: "patch", group: "prevention", active: true,
                desc: `${item.consequence} 권고: ${item.fix}` });
      addLink(`class:${suspected}`, patchId, "권고 조치", "mitigatedBy");
    }
  }

  for (const l of links) l.active = nodes.get(l.source).active && nodes.get(l.target).active;

  // OWL 추론 결과 (참고용)
  let owlInferred = null, owlMismatch = null;
  const owl = options.owlResults?.[`contract_${report.type}`];
  if (owl) {
    owlInferred = owl.inferred_types;
    const owlClasses = owl.inferred_types.map(normalizeClass).filter(c => O.fraudTypes[c]);
    const reportClasses = scenarioClass ? [scenarioClass] : [];
    const same = owlClasses.length === reportClasses.length && owlClasses.every(c => reportClasses.includes(c));
    owlMismatch = same ? null : { owl: owlClasses, report: reportClasses };
  }

  return {
    nodes: [...nodes.values()],
    links,
    // path: 분류 추론 경로 [증거, 조건, 분류 클래스]. evasionPath: 활성 회피 기법 [증거, 회피 기법, 분류 클래스].
    // 회피 기법은 분류 조건이 아니라서 path에 섞지 않는다.
    highlight: { path: paths, evasionPath: evasionPaths },
    meta: {
      scenarioFraudClass: scenarioClass,
      fraudTypeHint: hint,
      source: {
        ontology: "analysis/fraud_ontology.js", report: report.contract ?? null,
        conditionMapping: MAPPING_NOTE, techniqueMapping: TECHNIQUE_MAPPING_NOTE
      },
      mappingNote: `${MAPPING_NOTE}. ${TECHNIQUE_MAPPING_NOTE}`,
      techniques: TECHNIQUE_EVIDENCE.map(t => ({
        technique: t.technique, label: glossaryLabel(t.technique), status: STATUS[techStatuses[t.technique]], note: t.note
      })),
      conditions: CONDITION_EVIDENCE.map(c => ({
        condition: c.condition, label: glossaryLabel(c.condition), status: STATUS[statuses[c.condition]],
        approx: c.approx, note: c.note,
        classes: Object.entries(O.fraudTypes)
          .filter(([, ft]) => ft.necessaryConditions.includes(c.condition) || ft.sufficientConditions.includes(c.condition))
          .map(([k]) => k)
      })),
      owlInferred,
      owlNote: owl ? OWL_NOTE : "owl_results.json에 이 컨트랙트 항목이 없음",
      owlMismatch
    }
  };
}
