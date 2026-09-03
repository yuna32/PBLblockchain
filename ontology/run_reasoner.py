"""
Task 5: Run OWL reasoning over fraud_with_rules.owl.

Java-based reasoners (Pellet, HermiT) require Java which is unavailable.
This script implements a pure-Python forward-chaining fallback that evaluates
each SWRL rule body against the loaded instances and asserts the head atoms.
Semantics are equivalent to what a DL reasoner would produce for these rules.
"""
from owlready2 import *

onto = get_ontology("ontology/fraud_with_rules.owl").load()

# ── Helper: get all superclasses (including self) ──────────────────────────────
def all_types(instance):
    """Return the set of all asserted and inferred class names."""
    return {c for c in instance.is_a if isinstance(c, ThingClass)}

def has_class(instance, cls_name):
    """Check if instance is asserted as a member of cls_name."""
    cls = onto[cls_name]
    if cls is None:
        return False
    return cls in instance.is_a

def has_signal_type(instance, sig_name):
    """Check if any signal attached to instance is of type sig_name."""
    sig_cls = onto[sig_name]
    if sig_cls is None:
        return False
    return any(sig_cls in s.is_a for s in getattr(instance, "hasSignal", []))

def has_pattern_type(instance, pat_name):
    """Check if any pattern attached to instance is of type pat_name."""
    pat_cls = onto[pat_name]
    if pat_cls is None:
        return False
    return any(pat_cls in p.is_a for p in getattr(instance, "hasPattern", []))

def assert_type(instance, cls_name):
    """Assert class membership if not already present."""
    cls = onto[cls_name]
    if cls is None:
        print(f"  [WARN] class {cls_name} not found in ontology")
        return False
    if cls not in instance.is_a:
        instance.is_a.append(cls)
        return True  # changed
    return False

# ── SWRL rule definitions (mirrors add_swrl_rules.py) ─────────────────────────
# Each rule is a dict:
#   body: list of (check_fn, arg) pairs — ALL must hold
#   head: class name to assert
# Body checks:
#   ("type", cls_name)    — instance must be of that type
#   ("signal", sig_name)  — instance must have that signal type
#   ("pattern", pat_name) — instance must have that pattern type

SWRL_RULES = [
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

# ── triggers / implies 인과관계 규칙 (설계서 4-3절, v0.2 신규) ─────────────────
# BehaviorPattern → AnomalySignal 인과관계. add_swrl_rules.py의 후처리와 동일한
# 규칙을 이 스크립트에서도 재현한다 (mirrors add_swrl_rules.py).
TRIGGER_IMPLIES_RULES = [
    ("OwnerWithdrawAll",    "triggers", "BalanceDrop"),
    ("SingleLargeOutflow",  "triggers", "MaxTxAlert"),
    ("ParticipantMidExit",  "triggers", "FlowSpike"),
    ("InsiderBulkDeposit",  "implies",  "InflowStop"),
    ("WithdrawAttemptFail", "implies",  "ZeroWithdrawBlock"),
]

def check_body_atom(instance, check_type, arg):
    if check_type == "type":
        # Check direct is_a membership (covers inferred types added this iteration)
        cls = onto[arg]
        if cls is None:
            return False
        # Check if instance is in this class or any subclass
        return cls in instance.is_a or any(
            issubclass(c, cls) for c in instance.is_a if isinstance(c, ThingClass)
        )
    elif check_type == "signal":
        return has_signal_type(instance, arg)
    elif check_type == "pattern":
        return has_pattern_type(instance, arg)
    return False

def evaluate_body(instance, body):
    return all(check_body_atom(instance, ct, arg) for ct, arg in body)

# ── Forward-chaining fixpoint ──────────────────────────────────────────────────
INSTANCE_NAMES = ["ponzi", "rugpull", "laundering", "pumpdump", "honeypot", "normal"]

instances = {}
for name in INSTANCE_NAMES:
    inst = onto.search_one(iri=f"*contract_{name}")
    if inst:
        instances[name] = inst

print("Running Python forward-chaining reasoner (Java not available)...")
iteration = 0
while True:
    changed = False
    iteration += 1
    for name, inst in instances.items():
        for rule in SWRL_RULES:
            if evaluate_body(inst, rule["body"]):
                if assert_type(inst, rule["head"]):
                    changed = True
                    print(f"  iter {iteration}: [{rule['name']}] → {name} "
                          f"asserted as {rule['head']}")
    if not changed:
        break

print(f"Fixpoint reached after {iteration} iteration(s).\n")

# ── triggers / implies 인과관계 후처리 (분류 fixpoint 수렴 후 별도 실행) ───────
# hasSignal/is_a는 건드리지 않고 패턴→신호 개체 사이에 triggers/implies
# 엣지만 추가하므로 위 분류 결과에는 영향을 주지 않는다.
predicted_count = 0
linked_count = 0
for name, inst in instances.items():
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
                        print(f"  [{relation_name}] {name}: {pattern_name} "
                              f"→ {signal_name} (관측된 신호에 연결)")
            else:
                already_predicted = any(signal_cls in s.is_a for s in edge_list)
                if not already_predicted:
                    pred_sig = signal_cls(f"sig_predicted_{signal_name.lower()}_{name}")
                    edge_list.append(pred_sig)
                    predicted_count += 1
                    print(f"  [{relation_name}] {name}: {pattern_name} "
                          f"→ {signal_name} (미관측 — 예측 신호 생성)")

print(f"triggers/implies 엣지: 관측 신호 연결 {linked_count}건, "
      f"예측 신호 생성 {predicted_count}건\n")

# ── Print results ──────────────────────────────────────────────────────────────
print("=" * 60)
for name in INSTANCE_NAMES:
    inst = instances.get(name)
    if not inst:
        print(f"\ncontract_{name}: NOT FOUND")
        continue

    types   = [c.name for c in inst.is_a if isinstance(c, ThingClass)]
    signals = [s.name for s in getattr(inst, "hasSignal",  [])]
    pats    = [p.name for p in getattr(inst, "hasPattern", [])]
    classified = [r.name for r in getattr(inst, "classifiedAs", [])]

    print(f"\ncontract_{name}:")
    print(f"  Types       : {types}")
    print(f"  ClassifiedAs: {classified}")
    print(f"  Signals     : {signals}")
    print(f"  Patterns    : {pats}")

# Save with inferred type assertions
onto.save(file="ontology/fraud_reasoned.owl", format="rdfxml")
print(f"\nfraud_reasoned.owl saved")
