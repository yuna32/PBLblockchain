"""
Task 3: Load CSV logs as OWL instances with signals and patterns.
Reads analysis/logs/*.csv and populates fraud_with_instances.owl.
"""
import os
import pandas as pd
from owlready2 import *

onto = get_ontology("ontology/fraud.owl").load()

CSV_MAP = {
    "ponzi":      ("analysis/logs/ponzi_log.csv",      "PonziScheme"),
    "rugpull":    ("analysis/logs/rugpull_log.csv",     "RugPull"),
    "laundering": ("analysis/logs/laundering_log.csv",  "MoneyLaundering"),
    "pumpdump":   ("analysis/logs/pumpdump_log.csv",    "PumpAndDump"),
    "honeypot":   ("analysis/logs/honeypot_log.csv",    "HoneyPot"),
    "normal":     ("analysis/logs/normal_log.csv",      "NormalContract"),
}

with onto:
    for name, (csv_path, class_name) in CSV_MAP.items():
        if not os.path.exists(csv_path):
            print(f"SKIP {name}: {csv_path} not found")
            continue

        df = pd.read_csv(csv_path)

        # Instances start as generic FraudContract; SWRL rules classify them.
        # class_name is kept for the report line only — not used for type assertion.
        instance = onto.FraudContract(f"contract_{name}")

        # ── Data properties ────────────────────────────────────────────────────
        balances = df["contract_balance_eth"].astype(float)
        instance.peakBalance  = float(balances.max())
        instance.finalBalance = float(balances.iloc[-1])

        # ── Signal detection ───────────────────────────────────────────────────

        # BalanceDrop: any row where balance falls more than 80% vs. previous row
        diffs = balances.diff()
        prev  = balances.shift(1)
        if ((diffs < -(prev * 0.8)) & (prev > 0)).any():
            sig = onto.BalanceDrop(f"sig_balancedrop_{name}")
            instance.hasSignal.append(sig)

        # FlowSpike / InputDataOpacity: owner_withdraw_all action present
        owner_mask = df["action"].str.contains(
            "owner|all|drain", case=False, na=False
        )
        if owner_mask.any():
            sig = onto.FlowSpike(f"sig_flowspike_{name}")
            instance.hasSignal.append(sig)

        # ZeroWithdrawBlock: any withdraw action with amount_eth == 0
        withdraw_mask = df["action"].str.contains("withdraw", case=False, na=False)
        zero_withdraw = df[withdraw_mask & (df["amount_eth"].astype(float) == 0)]
        if len(zero_withdraw) > 0:
            sig = onto.ZeroWithdrawBlock(f"sig_zerowithdraw_{name}")
            instance.hasSignal.append(sig)

        # InflowStop: last deposit in first 70% of lifespan AND balance remains
        deposit_mask = df["action"].str.contains("deposit|stake|fund", case=False, na=False)
        deposits = df[deposit_mask]
        if len(deposits) > 0:
            last_dep_blk  = int(deposits["block"].max())
            first_blk     = int(df["block"].min())
            last_blk      = int(df["block"].max())
            span           = max(last_blk - first_blk, 1)
            stop_ratio     = (last_blk - last_dep_blk) / span
            after_stop_bal = df[df["block"].astype(int) > last_dep_blk]["contract_balance_eth"]
            has_bal_after  = (after_stop_bal.astype(float) > 0).any()
            if stop_ratio >= 0.30 and has_bal_after:
                sig = onto.InflowStop(f"sig_inflowstop_{name}")
                instance.hasSignal.append(sig)

        # ── Pattern detection ──────────────────────────────────────────────────

        # OwnerWithdrawAll / CollectorIsDepositor:
        # Largest withdrawal recipient — is it in the depositor list?
        all_withdrawals = df[df["action"].str.contains("withdraw|unstake", case=False, na=False)].copy()
        all_withdrawals["amount_eth_f"] = all_withdrawals["amount_eth"].astype(float)
        pos_withdrawals = all_withdrawals[all_withdrawals["amount_eth_f"] > 0]

        depositor_addrs = set(deposits["from"].str.lower().dropna())

        if len(pos_withdrawals) > 0:
            # Largest withdrawal row
            max_idx       = pos_withdrawals["amount_eth_f"].idxmax()
            largest_to    = str(pos_withdrawals.loc[max_idx, "to"]).lower()
            collector_is_depositor = largest_to in depositor_addrs

            if collector_is_depositor:
                pat = onto.CollectorIsDepositor(f"pat_collector_{name}")
                instance.hasPattern.append(pat)
            else:
                pat = onto.OwnerWithdrawAll(f"pat_ownerwithdraw_{name}")
                instance.hasPattern.append(pat)

        # SingleLargeOutflow: largest positive withdrawal >= 70% of peak
        peak_bal = float(balances.max())
        if peak_bal > 0 and len(pos_withdrawals) > 0:
            max_w = float(pos_withdrawals["amount_eth_f"].max())
            if max_w >= peak_bal * 0.70:
                pat = onto.SingleLargeOutflow(f"pat_singleoutflow_{name}")
                instance.hasPattern.append(pat)

        # ParticipantMidExit: non-owner withdraw with amount > 0 before last block
        last_block = int(df["block"].max())
        non_owner_wd = df[
            df["action"].str.match(r"^(withdraw|unstake)$", case=False, na=False) &
            (df["amount_eth"].astype(float) > 0) &
            (df["block"].astype(int) < last_block)
        ]
        if len(non_owner_wd) > 0:
            pat = onto.ParticipantMidExit(f"pat_midexit_{name}")
            instance.hasPattern.append(pat)

        # DistributedInflow: >= 5 unique deposit FROM addresses
        if deposits["from"].nunique() >= 5:
            pat = onto.DistributedInflow(f"pat_distrib_{name}")
            instance.hasPattern.append(pat)

        # InsiderExitSuccess: any withdraw with amount > 0 (some insiders got out)
        if len(pos_withdrawals) > 0:
            pat = onto.InsiderExitSuccess(f"pat_insiderexit_{name}")
            instance.hasPattern.append(pat)

        # WithdrawAttemptFail: any withdraw row with amount == 0 (some were blocked)
        if len(zero_withdraw) > 0:
            pat = onto.WithdrawAttemptFail(f"pat_wdfail_{name}")
            instance.hasPattern.append(pat)

        # InflowContinues: deposits happen after the first withdrawal attempt
        if len(all_withdrawals) > 0 and len(deposits) > 0:
            first_wd_blk = int(all_withdrawals["block"].min())
            if (deposits["block"].astype(int) > first_wd_blk).any():
                pat = onto.InflowContinues(f"pat_inflowcont_{name}")
                instance.hasPattern.append(pat)

        # ── Report ─────────────────────────────────────────────────────────────
        print(f"\nCreated: contract_{name}  ({class_name})")
        print(f"  peakBalance  = {instance.peakBalance:.4f} ETH")
        print(f"  finalBalance = {instance.finalBalance:.4f} ETH")
        print(f"  Signals  : {[s.name for s in instance.hasSignal]}")
        print(f"  Patterns : {[p.name for p in instance.hasPattern]}")

onto.save(file="ontology/fraud_with_instances.owl", format="rdfxml")
size = os.path.getsize("ontology/fraud_with_instances.owl")
print(f"\nfraud_with_instances.owl saved  ({size:,} bytes)")
