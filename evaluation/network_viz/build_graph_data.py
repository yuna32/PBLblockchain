# -*- coding: utf-8 -*-
"""
build_graph_data.py

Phase 1 데이터 준비 최종 단계.
extract_reasoning.mjs 가 만든 reasoning_raw.json (판정 등급 + 동적/정적
판정 근거)을 evaluation/network_viz/graph_data.json 네트워크 구조로 변환한다.

원본 파이프라인 파일(analysis/*, evaluate_comparison.js 등)은 읽지 않고,
이미 evaluation/network_viz/ 안에 있는 read-only 산출물만 입력으로 사용한다.

노드 종류
  - contract : XBlock 컨트랙트 인스턴스 (269개)
  - signal   : 컨트랙트별 AnomalySignal 인스턴스
  - pattern  : 컨트랙트별 BehaviorPattern 인스턴스
  - evasion  : 컨트랙트별 회피 기법(usesEvasion) 인스턴스
  - fraudtype: 공유 FraudContract 서브클래스 허브 (classifiedAs 대상)

엣지 종류
  - hasSignal (초록) : contract → signal
  - hasPattern (파랑): contract → pattern
  - usesEvasion (분홍): contract → evasion
  - classifiedAs (빨강): contract → fraudtype 허브
  - triggers/implies (주황): pattern → signal (설계서 4-3절 인과관계 공리)
"""
import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

REASONING_PATH = os.path.join(BASE_DIR, "reasoning_raw.json")

OUT_PATH = os.path.join(BASE_DIR, "graph_data.json")

# 설계서 3장 클래스 계층 — dynamic_analyzer.js FRAUD_TYPE_MAP 과 동일한 명칭
FRAUD_TYPE_MAP = {
    "money_laundering":    "MoneyLaundering",
    "pump_and_dump":       "PumpDump",
    "rug_pull":            "RugPull",
    "ponzi_scheme":        "PonziScheme",
    "ponzi_or_laundering": "PonziScheme",
    "honeypot":            "Honeypot",
    # "flash_loan": "FlashLoan" 은 의도적으로 제외한다.
    # dynamic_analyzer.js 자체 FRAUD_TYPE_MAP에는 존재하지만(OSCILLATING_BALANCE
    # 규칙 → "잔고 0→복구→0 반복" 패턴 감지용 파이프라인 전용 카테고리),
    # 온톨로지_설계서_v0.2.docx 3-1절 FraudContract 계층(PonziScheme/RugPull/
    # MoneyLaundering/PumpAndDump/HoneyPot 5종)에는 FlashLoan이 존재하지 않는다.
    # classifiedAs의 Range는 설계서 4-1절 기준 FraudContract로 한정되므로,
    # 이 유형(272건 중 11건)은 classifiedAs 허브를 만들지 않고 제외한다
    # (사용자 확인 완료, 2026-09-09). 해당 11개 컨트랙트 자체와 그 signal/
    # pattern/evasion 노드는 그대로 유지되며, 등급(grade)에도 영향 없다.
}

# RULES id → 설계서 AnomalySignal 서브클래스 (직접 매칭되는 것만 사용)
SIGNAL_ID_MAP = {
    "BALANCE_DROP":        "BalanceDrop",
    "FLOW_SPIKE":          "FlowSpike",
    "CONCENTRATION_DRAIN": "ConcentrationDrain",
}

# triggers/implies 인과관계 공리 (ontology/build_ontology.py 5장 부가 공리 반영)
# pattern_flag_key → (relation, signal_class, pattern_class)
CAUSAL_AXIOMS = [
    ("ownerWithdrawAll",   "triggers", "BalanceDrop",  "OwnerWithdrawAll"),
    ("singleLargeOutflow", "triggers", "MaxTxAlert",   "SingleLargeOutflow"),
    ("participantMidExit", "triggers", "FlowSpike",    "ParticipantMidExit"),
]


def grade_of(final_exact, final_super):
    """최종 판정 등급 산정 (Agent légitime / suspect / frauduleux).

    final_exact_pred / final_super_pred 는 extract_reasoning.mjs 가
    evaluate_comparison.js의 finalExact/finalSuper 결합 공식
    (static_pred OR dynamic_pred)을 현재 dynamic_analyzer.js 로직으로
    직접 재계산한 값이다 (evaluate_comparison.js 자체는 read-only 참조만
    하며 수정하지 않음). ontology_predictions.csv는 규칙 개정 이전 스냅샷일
    수 있어 등급 산정에는 사용하지 않는다.
      - Frauduleux: exact_pred=1 (정확한 사기 유형까지 확정 — CRITICAL/HIGH급)
      - Suspect   : super_pred=1 이나 exact_pred=0 (사기 계열은 걸렸으나
                    정확한 유형 확정에는 실패한 경계 사례)
      - Legitime  : super_pred=0 (어떤 사기 유형으로도 판정되지 않음)
    """
    if final_exact == 1:
        return "Frauduleux"
    if final_super == 1:
        return "Suspect"
    return "Legitime"


def main():
    with open(REASONING_PATH, encoding="utf-8") as f:
        reasoning = json.load(f)

    nodes = []
    edges = []
    fraudtype_hubs = set()

    grade_counts = {"Legitime": 0, "Suspect": 0, "Frauduleux": 0}

    for address, r in reasoning.items():
        final_exact = r.get("final_exact_pred", 0)
        final_super = r.get("final_super_pred", 0)
        verdict     = r.get("verdict", "LOW_RISK")
        grade       = grade_of(final_exact, final_super)
        grade_counts[grade] += 1

        contract_node = {
            "id": address,
            "type": "contract",
            "grade": grade,
            "true_label": r.get("true_label"),
            "fraud_type_hint": r.get("fraud_type_hint"),
            "verdict": verdict,
            "dynamic_risk_score": r.get("dynamic_risk_score", 0),
            "final_exact_pred": final_exact,
            "final_super_pred": final_super,
        }
        nodes.append(contract_node)

        # ── hasSignal ────────────────────────────────────────────────────
        signal_names = set()
        for rule in r.get("triggered_rules", []):
            mapped = SIGNAL_ID_MAP.get(rule["id"])
            if mapped:
                signal_names.add(mapped)
        if r.get("anomaly_signals", {}).get("INFLOW_STOP", {}).get("detected"):
            signal_names.add("InflowStop")

        for sig in signal_names:
            sig_id = f"{address}_sig_{sig}"
            nodes.append({"id": sig_id, "type": "signal", "signal_class": sig, "owner": address})
            edges.append({"source": address, "target": sig_id, "relation": "hasSignal"})

        # ── hasPattern ───────────────────────────────────────────────────
        flags = r.get("behavior_flags", {})
        pattern_names = {name for name, v in flags.items() if v}

        hint = r.get("fraud_type_hint")
        if hint == "money_laundering":
            pattern_names.add("collectorIsDepositor")
        if hint == "honeypot":
            pattern_names.add("withdrawAttemptFail")
            pattern_names.add("inflowContinues")
        if hint == "pump_and_dump":
            pattern_names.add("insiderExitSuccess")
            pattern_names.add("insiderBulkDeposit")

        # camelCase 플래그명 → 설계서 BehaviorPattern 클래스명
        PATTERN_CLASS_MAP = {
            "singleLargeOutflow":  "SingleLargeOutflow",
            "distributedInflow":   "DistributedInflow",
            "ownerWithdrawAll":    "OwnerWithdrawAll",
            "participantMidExit":  "ParticipantMidExit",
            "collectorIsDepositor": "CollectorIsDepositor",
            "withdrawAttemptFail": "WithdrawAttemptFail",
            "inflowContinues":     "InflowContinues",
            "insiderExitSuccess":  "InsiderExitSuccess",
            "insiderBulkDeposit":  "InsiderBulkDeposit",
        }

        pattern_classes_present = set()
        for pname in pattern_names:
            pclass = PATTERN_CLASS_MAP.get(pname)
            if not pclass:
                continue
            pattern_classes_present.add(pclass)
            pat_id = f"{address}_pat_{pclass}"
            nodes.append({"id": pat_id, "type": "pattern", "pattern_class": pclass, "owner": address})
            edges.append({"source": address, "target": pat_id, "relation": "hasPattern"})

        # ── triggers / implies (pattern → signal 인과관계) ─────────────────
        for flag_key, relation, signal_class, pattern_class in CAUSAL_AXIOMS:
            if flags.get(flag_key) and pattern_class in pattern_classes_present:
                sig_id = f"{address}_sig_{signal_class}"
                if signal_class not in signal_names:
                    # 공리에 의해 존재가 함의되는 신호 — 노드를 새로 만든다
                    nodes.append({
                        "id": sig_id, "type": "signal",
                        "signal_class": signal_class, "owner": address,
                        "implied": True,
                    })
                    signal_names.add(signal_class)
                pat_id = f"{address}_pat_{pattern_class}"
                edges.append({"source": pat_id, "target": sig_id, "relation": relation})

        if "WithdrawAttemptFail" in pattern_classes_present:
            sig_id = f"{address}_sig_ZeroWithdrawBlock"
            if "ZeroWithdrawBlock" not in signal_names:
                nodes.append({
                    "id": sig_id, "type": "signal",
                    "signal_class": "ZeroWithdrawBlock", "owner": address, "implied": True,
                })
                signal_names.add("ZeroWithdrawBlock")
            edges.append({
                "source": f"{address}_pat_WithdrawAttemptFail",
                "target": sig_id, "relation": "implies",
            })

        # ── usesEvasion ──────────────────────────────────────────────────
        if r.get("evasion_detected") and r.get("evasion_subclass"):
            subclass = r["evasion_subclass"]  # e.g. "PonziScheme_MaxTxEvasion"
            evasion_id = f"{address}_evasion_{subclass}"
            nodes.append({
                "id": evasion_id, "type": "evasion",
                "evasion_class": subclass,
                "confidence": r.get("evasion_confidence", 0),
                "owner": address,
            })
            edges.append({"source": address, "target": evasion_id, "relation": "usesEvasion"})

        # ── classifiedAs (공유 허브) ─────────────────────────────────────
        fraud_class = FRAUD_TYPE_MAP.get(hint)
        if fraud_class:
            fraudtype_hubs.add(fraud_class)
            edges.append({"source": address, "target": f"hub_{fraud_class}", "relation": "classifiedAs"})

    for fc in fraudtype_hubs:
        nodes.append({"id": f"hub_{fc}", "type": "fraudtype", "fraud_class": fc})

    graph = {
        "meta": {
            "n_contracts": len(reasoning),
            "grade_counts": grade_counts,
            "source": "evaluation/ponzi_comparison (XBlock N=272 clean set)",
        },
        "nodes": nodes,
        "edges": edges,
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(graph, f, ensure_ascii=False, indent=2)

    print(f"컨트랙트 {len(reasoning)}개 / 등급 분포 {grade_counts}")
    print(f"노드 {len(nodes)}개, 엣지 {len(edges)}개 → {OUT_PATH}")


if __name__ == "__main__":
    main()
