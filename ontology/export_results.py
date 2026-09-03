"""
Task 6: Export OWL reasoning results to owl_results.json.

Reads fraud_reasoned.owl (produced by add_swrl_rules.py).
Classification comes from SWRL rule inference, not pre-assertion, so
inferred_types contains only classes the reasoner added at runtime.
"""
from owlready2 import *
import json, os

onto = get_ontology("ontology/fraud_reasoned.owl").load()

FRAUD_CLASSES = {
    "PonziScheme", "RugPull", "MoneyLaundering",
    "PumpAndDump", "HoneyPot", "NormalContract",
    "RugPull_SlowDrain", "RugPull_MaxTxEvasion",
    "RugPull_BalanceDropEvasion",
    "PonziScheme_SlowDrain", "PonziScheme_MaxTxEvasion",
    "PonziScheme_BalanceDropEvasion",
    "MoneyLaundering_HopLaundering",
    "MoneyLaundering_SlowDrain",
    "PumpDump_MaxTxEvasion", "PumpDump_SlowDrain",
    "PumpDump_DistributedDump",
}

INSTANCE_NAMES = ["ponzi", "rugpull", "laundering", "pumpdump", "honeypot", "normal"]

results = {}
for name in INSTANCE_NAMES:
    instance = onto.search_one(iri=f"*contract_{name}")
    if not instance:
        continue

    inferred_types = [
        c.name for c in instance.is_a
        if hasattr(c, "name") and c.name in FRAUD_CLASSES
    ]
    signals  = [s.name for s in getattr(instance, "hasSignal",  [])]
    patterns = [p.name for p in getattr(instance, "hasPattern", [])]

    # triggers/implies 인과관계 엣지 (설계서 4-3절, v0.2 신규) — 부가 정보이며
    # inferred_types/signals/patterns 등 기존 필드에는 영향을 주지 않는다.
    causal_edges = []
    for p in getattr(instance, "hasPattern", []):
        for sig in getattr(p, "triggers", []):
            causal_edges.append({"relation": "triggers", "from": p.name, "to": sig.name})
        for sig in getattr(p, "implies", []):
            causal_edges.append({"relation": "implies", "from": p.name, "to": sig.name})

    results[f"contract_{name}"] = {
        "inferred_types":      inferred_types,
        "reasoner_classified": True,
        "signals":             signals,
        "patterns":            patterns,
        "causal_edges":        causal_edges,
        "peak_balance":        getattr(instance, "peakBalance",  None),
        "final_balance":       getattr(instance, "finalBalance", None),
    }

out_path = "ontology/owl_results.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

size = os.path.getsize(out_path)
print(f"ontology/owl_results.json saved  ({size:,} bytes)\n")
print(json.dumps(results, indent=2, ensure_ascii=False))
