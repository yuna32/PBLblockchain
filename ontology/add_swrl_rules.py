"""
Task 4: Add SWRL classification rules and run Python forward-chaining reasoner.

SWRL rule heads already use valid class-assertion syntax (ClassName(?c)).
Java-based reasoners (Pellet, HermiT) require Java which is unavailable in this
environment, so we fall back to a Python forward-chaining fixpoint evaluator that
produces semantically equivalent results.

Output files:
  fraud_with_rules.owl   — ontology + SWRL rules (no inferred facts)
  fraud_reasoned.owl     — ontology + inferred class memberships from rule firing
"""
from owlready2 import *
import os

onto = get_ontology("ontology/fraud_with_instances.owl").load()

with onto:

    # ── Rule 1: PonziScheme ────────────────────────────────────────────────────
    # BalanceDrop + OwnerWithdrawAll + ParticipantMidExit
    # (partial withdrawals before owner drain = ponzi characteristic)
    imp1 = Imp()
    imp1.set_as_rule(
        "FraudContract(?c), "
        "hasSignal(?c, ?s1), BalanceDrop(?s1), "
        "hasPattern(?c, ?p1), OwnerWithdrawAll(?p1), "
        "hasPattern(?c, ?p2), ParticipantMidExit(?p2) "
        "-> PonziScheme(?c)"
    )
    imp1.name = "Rule_PonziScheme"

    # ── Rule 2: RugPull ────────────────────────────────────────────────────────
    # BalanceDrop + OwnerWithdrawAll + SingleLargeOutflow
    # (no distributed collector = external owner drains entirely)
    imp2 = Imp()
    imp2.set_as_rule(
        "FraudContract(?c), "
        "hasSignal(?c, ?s1), BalanceDrop(?s1), "
        "hasPattern(?c, ?p1), OwnerWithdrawAll(?p1), "
        "hasPattern(?c, ?p2), SingleLargeOutflow(?p2) "
        "-> RugPull(?c)"
    )
    imp2.name = "Rule_RugPull"

    # ── Rule 3: MoneyLaundering ────────────────────────────────────────────────
    # DistributedInflow + CollectorIsDepositor + SingleLargeOutflow
    # CollectorIsDepositor distinguishes laundering from rug-pull:
    #   the collector address appears in the depositor list (layering structure).
    # SingleLargeOutflow required to exclude normal/pumpdump which also have
    #   CollectorIsDepositor but no single dominant outflow.
    imp3 = Imp()
    imp3.set_as_rule(
        "FraudContract(?c), "
        "hasPattern(?c, ?p1), DistributedInflow(?p1), "
        "hasPattern(?c, ?p2), CollectorIsDepositor(?p2), "
        "hasPattern(?c, ?p3), SingleLargeOutflow(?p3) "
        "-> MoneyLaundering(?c)"
    )
    imp3.name = "Rule_MoneyLaundering"

    # ── Rule 4: HoneyPot ──────────────────────────────────────────────────────
    # WithdrawAttemptFail + InflowContinues
    # All withdrawals fail (amount=0) while new deposits still arrive
    imp4 = Imp()
    imp4.set_as_rule(
        "FraudContract(?c), "
        "hasPattern(?c, ?p1), WithdrawAttemptFail(?p1), "
        "hasPattern(?c, ?p2), InflowContinues(?p2) "
        "-> HoneyPot(?c)"
    )
    imp4.name = "Rule_HoneyPot"

    # ── Rule 5: PumpAndDump ────────────────────────────────────────────────────
    # InsiderExitSuccess + WithdrawAttemptFail (mixed outcomes)
    # Some withdrawals succeed (insiders), some return 0 (latecomers)
    imp5 = Imp()
    imp5.set_as_rule(
        "FraudContract(?c), "
        "hasPattern(?c, ?p1), InsiderExitSuccess(?p1), "
        "hasPattern(?c, ?p2), WithdrawAttemptFail(?p2) "
        "-> PumpAndDump(?c)"
    )
    imp5.name = "Rule_PumpAndDump"

    # ── Rule 6: RugPull_SlowDrain subclass ────────────────────────────────────
    # Evasion subclass: RugPull with InflowStop signal
    imp6 = Imp()
    imp6.set_as_rule(
        "RugPull(?c), "
        "hasSignal(?c, ?s), InflowStop(?s) "
        "-> RugPull_SlowDrain(?c)"
    )
    imp6.name = "Rule_RugPull_SlowDrain"

    # ── Rule 7: PonziScheme_MaxTxEvasion subclass ─────────────────────────────
    # Evasion subclass: PonziScheme with ParticipantMidExit and InflowStop
    imp7 = Imp()
    imp7.set_as_rule(
        "PonziScheme(?c), "
        "hasPattern(?c, ?p), ParticipantMidExit(?p), "
        "hasSignal(?c, ?s), InflowStop(?s) "
        "-> PonziScheme_MaxTxEvasion(?c)"
    )
    imp7.name = "Rule_PonziScheme_MaxTxEvasion"

    # ── Rule 8: PumpDump_MaxTxEvasion subclass ────────────────────────────────
    # Evasion subclass: PumpAndDump with distributed inflow (many participants)
    imp8 = Imp()
    imp8.set_as_rule(
        "PumpAndDump(?c), "
        "hasPattern(?c, ?p1), InsiderExitSuccess(?p1), "
        "hasPattern(?c, ?p2), DistributedInflow(?p2) "
        "-> PumpDump_MaxTxEvasion(?c)"
    )
    imp8.name = "Rule_PumpDump_MaxTxEvasion"

    # ── Rule 9~13: triggers / implies 인과관계 (설계서 4-3절, v0.2 신규) ────────
    # BehaviorPattern과 그 원인으로 촉발되는 AnomalySignal이 같은 컨트랙트에 함께
    # 관측된 경우, 둘 사이의 인과관계를 triggers/implies 프로퍼티로 명시적으로
    # 연결한다. classifiedAs/is_a를 건드리지 않는 순수 부가(explanatory) 규칙이라
    # 기존 분류 결과(5-1~5-3)에는 영향을 주지 않는다.
    # (SWRL은 새 개체를 생성할 수 없으므로, 패턴만 있고 신호가 아직 관측되지
    #  않은 "예측" 케이스는 아래 Python forward-chaining 폴백에서 별도 처리한다.)
    imp9 = Imp()
    imp9.set_as_rule(
        "hasPattern(?c, ?p), OwnerWithdrawAll(?p), "
        "hasSignal(?c, ?s), BalanceDrop(?s) "
        "-> triggers(?p, ?s)"
    )
    imp9.name = "Rule_Trigger_OwnerWithdrawAll_BalanceDrop"

    imp10 = Imp()
    imp10.set_as_rule(
        "hasPattern(?c, ?p), SingleLargeOutflow(?p), "
        "hasSignal(?c, ?s), MaxTxAlert(?s) "
        "-> triggers(?p, ?s)"
    )
    imp10.name = "Rule_Trigger_SingleLargeOutflow_MaxTxAlert"

    imp11 = Imp()
    imp11.set_as_rule(
        "hasPattern(?c, ?p), ParticipantMidExit(?p), "
        "hasSignal(?c, ?s), FlowSpike(?s) "
        "-> triggers(?p, ?s)"
    )
    imp11.name = "Rule_Trigger_ParticipantMidExit_FlowSpike"

    imp12 = Imp()
    imp12.set_as_rule(
        "hasPattern(?c, ?p), InsiderBulkDeposit(?p), "
        "hasSignal(?c, ?s), InflowStop(?s) "
        "-> implies(?p, ?s)"
    )
    imp12.name = "Rule_Implies_InsiderBulkDeposit_InflowStop"

    # 설계서 원문은 "WithdrawBlock → implies → WithdrawAttemptFail"이나, 3-1
    # 클래스 계층(WithdrawBlock=AnomalySignal, WithdrawAttemptFail=BehaviorPattern)
    # 및 4-1 Domain/Range(Domain=BehaviorPattern)와 모순되고 "WithdrawBlock" 클래스
    # 자체가 구현체에 존재하지 않는다. WithdrawAttemptFail(BehaviorPattern, 원인)
    # → implies → ZeroWithdrawBlock(AnomalySignal, 결과)로 정정하여 반영한다.
    imp13 = Imp()
    imp13.set_as_rule(
        "hasPattern(?c, ?p), WithdrawAttemptFail(?p), "
        "hasSignal(?c, ?s), ZeroWithdrawBlock(?s) "
        "-> implies(?p, ?s)"
    )
    imp13.name = "Rule_Implies_WithdrawAttemptFail_ZeroWithdrawBlock"

onto.save(file="ontology/fraud_with_rules.owl", format="rdfxml")

size = os.path.getsize("ontology/fraud_with_rules.owl")
print(f"fraud_with_rules.owl saved  ({size:,} bytes)")

rules = list(onto.rules())
print(f"\nTotal SWRL rules: {len(rules)}")
for r in rules:
    nm = getattr(r, "name", "?")
    print(f"  [{nm}]")
    body = [str(a) for a in r.body]
    head = [str(a) for a in r.head]
    print(f"    body: {', '.join(body)}")
    print(f"    head: {', '.join(head)}")

# ── Run reasoner ───────────────────────────────────────────────────────────────
# Try Java-based reasoners first; fall back to Python forward-chaining.
print("\nRunning reasoner...")
reasoner_used = None

try:
    sync_reasoner_pellet(infer_property_values=True, infer_data_property_values=True)
    reasoner_used = "Pellet"
    print("Pellet reasoner completed.")
except Exception as e:
    print(f"Pellet unavailable: {type(e).__name__}")
    try:
        sync_reasoner_hermit(infer_property_values=True)
        reasoner_used = "HermiT"
        print("HermiT reasoner completed.")
    except Exception as e2:
        print(f"HermiT unavailable: {type(e2).__name__}")
        print("Using Python forward-chaining fallback...")
        reasoner_used = "Python/forward-chain"

        # ── Forward-chaining helpers ───────────────────────────────────────────
        def _has_signal_type(instance, sig_name):
            sig_cls = onto[sig_name]
            if sig_cls is None:
                return False
            return any(sig_cls in s.is_a for s in getattr(instance, "hasSignal", []))

        def _has_pattern_type(instance, pat_name):
            pat_cls = onto[pat_name]
            if pat_cls is None:
                return False
            return any(pat_cls in p.is_a for p in getattr(instance, "hasPattern", []))

        def _assert_type(instance, cls_name):
            cls = onto[cls_name]
            if cls is None:
                return False
            if cls not in instance.is_a:
                instance.is_a.append(cls)
                return True
            return False

        def _check_atom(instance, check_type, arg):
            if check_type == "type":
                cls = onto[arg]
                if cls is None:
                    return False
                return cls in instance.is_a or any(
                    issubclass(c, cls)
                    for c in instance.is_a if isinstance(c, ThingClass)
                )
            if check_type == "signal":
                return _has_signal_type(instance, arg)
            if check_type == "pattern":
                return _has_pattern_type(instance, arg)
            return False

        # Mirrors the SWRL rules above for the forward-chaining evaluator
        FC_RULES = [
            {
                "name": "Rule_PonziScheme",
                "body": [
                    ("type",    "FraudContract"),
                    ("signal",  "BalanceDrop"),
                    ("pattern", "OwnerWithdrawAll"),
                    ("pattern", "ParticipantMidExit"),
                ],
                "head": "PonziScheme",
            },
            {
                "name": "Rule_RugPull",
                "body": [
                    ("type",    "FraudContract"),
                    ("signal",  "BalanceDrop"),
                    ("pattern", "OwnerWithdrawAll"),
                    ("pattern", "SingleLargeOutflow"),
                ],
                "head": "RugPull",
            },
            {
                "name": "Rule_MoneyLaundering",
                "body": [
                    ("type",    "FraudContract"),
                    ("pattern", "DistributedInflow"),
                    ("pattern", "CollectorIsDepositor"),
                    ("pattern", "SingleLargeOutflow"),
                ],
                "head": "MoneyLaundering",
            },
            {
                "name": "Rule_HoneyPot",
                "body": [
                    ("type",    "FraudContract"),
                    ("pattern", "WithdrawAttemptFail"),
                    ("pattern", "InflowContinues"),
                ],
                "head": "HoneyPot",
            },
            {
                "name": "Rule_PumpAndDump",
                "body": [
                    ("type",    "FraudContract"),
                    ("pattern", "InsiderExitSuccess"),
                    ("pattern", "WithdrawAttemptFail"),
                ],
                "head": "PumpAndDump",
            },
            {
                "name": "Rule_RugPull_SlowDrain",
                "body": [
                    ("type",    "RugPull"),
                    ("signal",  "InflowStop"),
                ],
                "head": "RugPull_SlowDrain",
            },
            {
                "name": "Rule_PonziScheme_MaxTxEvasion",
                "body": [
                    ("type",    "PonziScheme"),
                    ("pattern", "ParticipantMidExit"),
                    ("signal",  "InflowStop"),
                ],
                "head": "PonziScheme_MaxTxEvasion",
            },
            {
                "name": "Rule_PumpDump_MaxTxEvasion",
                "body": [
                    ("type",    "PumpAndDump"),
                    ("pattern", "InsiderExitSuccess"),
                    ("pattern", "DistributedInflow"),
                ],
                "head": "PumpDump_MaxTxEvasion",
            },
        ]

        NAMES = ["ponzi", "rugpull", "laundering", "pumpdump", "honeypot", "normal"]
        instances = {
            n: onto.search_one(iri=f"*contract_{n}")
            for n in NAMES
        }
        instances = {k: v for k, v in instances.items() if v is not None}

        iteration = 0
        while True:
            changed = False
            iteration += 1
            for n, inst in instances.items():
                for rule in FC_RULES:
                    if all(_check_atom(inst, ct, arg) for ct, arg in rule["body"]):
                        if _assert_type(inst, rule["head"]):
                            changed = True
                            print(f"  iter {iteration}: [{rule['name']}] → "
                                  f"{n} asserted as {rule['head']}")
            if not changed:
                break
        print(f"Fixpoint reached after {iteration} iteration(s).")

        # ── triggers / implies 인과관계 후처리 (설계서 4-3절, v0.2 신규) ───────
        # 분류 fixpoint가 수렴한 뒤에 별도로 실행하여 분류 규칙(FC_RULES)의
        # 수렴 과정에는 절대 개입하지 않는다. hasSignal/is_a는 건드리지 않고
        # 패턴 개체 → 신호 개체 사이에 triggers/implies 엣지만 추가하므로
        # 기존 분류·회피 서브클래스 추론 결과는 그대로 유지된다.
        # 대응 신호가 이미 관측된 경우 그 개체에 연결하고, 패턴만 있고 신호가
        # 아직 관측되지 않은 경우 새 신호 개체를 만들어 연결한다(예측).
        # 새로 만든 신호 개체는 hasSignal에는 추가하지 않아 hasSignal 기반의
        # 분류 규칙 판단에 영향을 주지 않는다.
        TRIGGER_IMPLIES_RULES = [
            ("OwnerWithdrawAll",   "triggers", "BalanceDrop"),
            ("SingleLargeOutflow", "triggers", "MaxTxAlert"),
            ("ParticipantMidExit", "triggers", "FlowSpike"),
            ("InsiderBulkDeposit", "implies",  "InflowStop"),
            ("WithdrawAttemptFail","implies",  "ZeroWithdrawBlock"),
        ]

        predicted_count = 0
        linked_count = 0
        for n, inst in instances.items():
            for pattern_name, relation_name, signal_name in TRIGGER_IMPLIES_RULES:
                pattern_cls = onto[pattern_name]
                signal_cls  = onto[signal_name]
                relation    = onto[relation_name]
                if pattern_cls is None or signal_cls is None or relation is None:
                    continue

                pattern_individuals = [p for p in getattr(inst, "hasPattern", [])
                                        if pattern_cls in p.is_a]
                if not pattern_individuals:
                    continue

                existing_signals = [s for s in getattr(inst, "hasSignal", [])
                                     if signal_cls in s.is_a]

                for pat in pattern_individuals:
                    edge_list = getattr(pat, relation_name)
                    if existing_signals:
                        for sig in existing_signals:
                            if sig not in edge_list:
                                edge_list.append(sig)
                                linked_count += 1
                                print(f"  [{relation_name}] {n}: {pattern_name} "
                                      f"→ {signal_name} (관측된 신호에 연결)")
                    else:
                        already_predicted = any(
                            signal_cls in s.is_a for s in edge_list
                        )
                        if not already_predicted:
                            pred_sig = signal_cls(f"sig_predicted_{signal_name.lower()}_{n}")
                            edge_list.append(pred_sig)
                            predicted_count += 1
                            print(f"  [{relation_name}] {n}: {pattern_name} "
                                  f"→ {signal_name} (미관측 — 예측 신호 생성)")

        print(f"triggers/implies 엣지: 관측 신호 연결 {linked_count}건, "
              f"예측 신호 생성 {predicted_count}건")

# ── Save with inferred type assertions ────────────────────────────────────────
onto.save(file="ontology/fraud_reasoned.owl", format="rdfxml")
size = os.path.getsize("ontology/fraud_reasoned.owl")
print(f"\nfraud_reasoned.owl saved  ({size:,} bytes)  [reasoner: {reasoner_used}]")

# ── Print classification summary ──────────────────────────────────────────────
FRAUD_CLASSES = {
    "PonziScheme", "RugPull", "MoneyLaundering", "PumpAndDump", "HoneyPot",
    "RugPull_SlowDrain", "RugPull_MaxTxEvasion", "RugPull_BalanceDropEvasion",
    "PonziScheme_SlowDrain", "PonziScheme_MaxTxEvasion", "PonziScheme_BalanceDropEvasion",
    "MoneyLaundering_HopLaundering", "MoneyLaundering_SlowDrain",
    "PumpDump_MaxTxEvasion", "PumpDump_SlowDrain", "PumpDump_DistributedDump",
}

print("\n" + "=" * 60)
for n in ["ponzi", "rugpull", "laundering", "pumpdump", "honeypot", "normal"]:
    inst = onto.search_one(iri=f"*contract_{n}")
    if inst:
        types = [c.name for c in inst.is_a
                 if hasattr(c, "name") and c.name in FRAUD_CLASSES]
        sigs  = [s.name for s in getattr(inst, "hasSignal",  [])]
        pats  = [p.name for p in getattr(inst, "hasPattern", [])]
        print(f"\ncontract_{n}:")
        print(f"  inferred_types : {types}")
        print(f"  signals        : {sigs}")
        print(f"  patterns       : {pats}")
