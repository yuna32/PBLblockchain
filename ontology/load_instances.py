"""
Task 3: Load CSV logs as OWL instances with signals and patterns.
Reads analysis/logs/*.csv and populates fraud_with_instances.owl.
"""
import os
import re
import pandas as pd
from owlready2 import *

onto = get_ontology("ontology/fraud.owl").load()

# ── HoneyPot 코드축 서브클래스 정적 탐지 (2026-09 신규) ─────────────────────────
# analysis/analysis/prevention_reasoner.js의 detectHiddenStateUpdate/
# detectStrawManContract와 동일 로직을 Python으로 독립 재구현 — JS/OWL 두 레이어가
# 같은 .sol 원본에서 각자 재계산해 교차검산하도록 한다(balanceAtFailure 등
# SelectiveTrap 수정 때와 동일한 설계 원칙). 신뢰도 점수가 아닌 순수 boolean.

SOL_SOURCE_MAP = {
    "honeypot":           "analysis/contracts/Honeypot.sol",
    # honeypot_selective_log.csv는 별도 .sol 없이 동일 Honeypot.sol의 다른 실행
    # 시나리오를 시뮬레이션한 CSV — 코드 자체는 honeypot과 동일 소스를 공유한다.
    "honeypot_selective":  "analysis/contracts/Honeypot.sol",
}


def _find_write_lines(var_name, lines, exclude_line_no):
    pat = re.compile(r"\b" + re.escape(var_name) + r"\s*=(?!=)")
    return [i + 1 for i, line in enumerate(lines)
            if i + 1 != exclude_line_no and pat.search(line)]


def detect_hidden_state_update(lines):
    guard_re = re.compile(
        r"\b(\w+)\s*==\s*(?:keccak256|sha3)\s*\(|"
        r"(?:keccak256|sha3)\s*\([^;]*\)\s*==\s*(\w+)\b"
    )
    guard_line, guard_var = None, None
    for i, line in enumerate(lines):
        m = guard_re.search(line)
        if m:
            guard_var = m.group(1) or m.group(2)
            guard_line = i + 1
            break
    if not guard_var:
        return False
    write_lines = _find_write_lines(guard_var, lines, guard_line)
    return len(write_lines) >= 2


def _extract_constructor_injected_vars(src, lines):
    ctor_start = next((i for i, l in enumerate(lines) if re.search(r"constructor\s*\(", l)), None)
    ctor_pattern = r"constructor\s*\(([^)]*)\)"

    # HoneyBadger 실데이터(straw_man_contract 34건)는 전부 Solidity ^0.4.18~
    # 시절 코드라 `constructor` 키워드가 없다 — 컨트랙트명과 동일한 이름의
    # 함수가 생성자 역할을 하는 구버전 문법도 지원해야 한다.
    if ctor_start is None:
        contract_name_match = re.search(r"\bcontract\s+(\w+)", src)
        if contract_name_match:
            name = contract_name_match.group(1)
            old_ctor_re = re.compile(r"function\s+" + re.escape(name) + r"\s*\(")
            ctor_start = next((i for i, l in enumerate(lines) if old_ctor_re.search(l)), None)
            ctor_pattern = r"function\s+" + re.escape(name) + r"\s*\(([^)]*)\)"
    if ctor_start is None:
        return []

    sig, i = "", ctor_start
    while i < len(lines) and ")" not in sig:
        sig += lines[i]
        i += 1
    sig_match = re.search(ctor_pattern, sig)
    if not sig_match or not sig_match.group(1).strip():
        return []
    param_names = [p.strip().split()[-1] for p in sig_match.group(1).split(",") if p.strip()]

    depth, body_start, body_end = 0, -1, -1
    for j in range(ctor_start, len(lines)):
        for ch in lines[j]:
            if ch == "{":
                if depth == 0:
                    body_start = j
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    body_end = j
                    break
        if body_end != -1:
            break
    if body_start == -1 or body_end == -1:
        return []

    escaped   = [re.escape(p) for p in param_names]
    assign_re = re.compile(r"\b(\w+)\s*=\s*(?:\w+\s*\(\s*)?(" + "|".join(escaped) + r")\s*\)?\s*;")
    injected = []
    for j in range(body_start, body_end + 1):
        m = assign_re.search(lines[j])
        if m:
            injected.append({"state_var": m.group(1), "line": j + 1})
    return injected


def _is_var_owner_settable(var_name, src):
    """varName에 대입하는 함수가 owner 전용 가드(onlyOwner 모디파이어 또는
    require(msg.sender==...owner...) 형태의 인라인 가드)를 갖는지 확인한다.
    HoneyBadger 실데이터는 대부분 onlyOwner 모디파이어 없이 인라인 require만 쓴다."""
    assign_re = re.compile(r"\b" + re.escape(var_name) + r"\s*=\s*\w+\s*;")
    for m in re.finditer(r"function\s+\w+\s*\([^)]*\)[^{;]*\{", src):
        brace_idx = src.index("{", m.start())
        depth, end_idx = 0, -1
        for k in range(brace_idx, len(src)):
            if src[k] == "{":
                depth += 1
            elif src[k] == "}":
                depth -= 1
                if depth == 0:
                    end_idx = k
                    break
        if end_idx == -1:
            continue
        sig  = src[m.start():brace_idx]
        body = src[brace_idx:end_idx]
        if assign_re.search(body) and (
            re.search(r"onlyOwner", sig, re.IGNORECASE) or
            re.search(r"require\s*\(\s*msg\.sender\s*==\s*\w*[Oo]wner\w*", body)
        ):
            return True
    return False


def detect_straw_man_contract(src, lines):
    injected = _extract_constructor_injected_vars(src, lines)
    send_re = re.compile(
        r"(?:payable\([^)]*msg\.sender[^)]*\)|\bmsg\.sender)\s*\.\s*"
        r"(?:call\s*(?:\{\s*value\s*:|\.value\s*\()|send\s*\()"
    )
    send_lines = [i + 1 for i, line in enumerate(lines) if send_re.search(line)]
    if not send_lines:
        return False

    # 일반형(고수준 호출)은 생성자 주입 변수가 있을 때만 해당 — delegatecall
    # 변종은 주입 여부와 무관하게 독립적으로 판정한다(아래).
    low_level = {"call", "delegatecall", "staticcall", "send", "transfer"}
    for inj in injected:
        call_re = re.compile(r"\b" + re.escape(inj["state_var"]) + r"\s*\.\s*(\w+)\s*\(")
        for i, line in enumerate(lines):
            m = call_re.search(line)
            if not m or m.group(1) in low_level:
                continue
            call_line = i + 1
            if any(call_line > sl for sl in send_lines):
                return True

    delegate_re = re.compile(r"(\w+)\s*\.\s*delegatecall\s*\(")
    for i, line in enumerate(lines):
        m = delegate_re.search(line)
        if not m:
            continue
        delegate_line = i + 1
        if not any(abs(sl - delegate_line) <= 1 for sl in send_lines):
            continue
        if _is_var_owner_settable(m.group(1), src):
            return True

    return False

CSV_MAP = {
    "ponzi":               ("analysis/logs/ponzi_log.csv",               "PonziScheme"),
    "rugpull":             ("analysis/logs/rugpull_log.csv",              "RugPull"),
    "laundering":          ("analysis/logs/laundering_log.csv",           "MoneyLaundering"),
    "pumpdump":            ("analysis/logs/pumpdump_log.csv",             "PumpAndDump"),
    "honeypot":            ("analysis/logs/honeypot_log.csv",             "HoneyPot"),
    "normal":              ("analysis/logs/normal_log.csv",               "NormalContract"),
    # 2026-09, SelectiveTrap 오분류 수정 동반작업 — JS 쪽 회귀 테스트에 쓴 신규
    # 고정 fixture(analysis/logs/honeypot_selective_log.csv)와 동일한 인스턴스.
    # 기존 6개 중에는 SelectiveTrap 조건을 만족하는 사례가 없어(모두
    # withdrawSuccessRate=0인 UniversalTrap이거나 해당 패턴 자체가 없음) 신규
    # 규칙이 실제로 발동하는지 검증하려면 이 인스턴스가 필요하다.
    "honeypot_selective":  ("analysis/logs/honeypot_selective_log.csv",   "HoneyPot_SelectiveTrap"),
}

# dynamic_analyzer.js hintFraudType()의 OWNER_ADDRESS와 동일한 고정값(1안).
OWNER_ADDRESS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"

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

        # ── SelectiveTrap 데이터 속성 3종 (JS dynamic_analyzer.js hintFraudType()와
        # 동일한 정의를 CSV에서 직접 재계산 — 값을 복사해오지 않고 같은 원본에서
        # 같은 방식으로 다시 계산해 JS/OWL 두 레이어가 서로 검산되도록 한다) ──────
        if len(all_withdrawals) > 0:
            withdraw_success_rate = float((all_withdrawals["amount_eth_f"] > 0).sum()) / len(all_withdrawals)
        else:
            withdraw_success_rate = 0.0

        non_priv_withdrawals = all_withdrawals[
            all_withdrawals["to"].astype(str).str.lower() != OWNER_ADDRESS
        ]
        if len(non_priv_withdrawals) > 0:
            non_privileged_success_rate = (
                float((non_priv_withdrawals["amount_eth_f"] > 0).sum()) / len(non_priv_withdrawals)
            )
        else:
            non_privileged_success_rate = 0.0

        failed_withdrawals = all_withdrawals[all_withdrawals["amount_eth_f"] == 0]
        if len(failed_withdrawals) > 0:
            balance_at_failure = float(failed_withdrawals["contract_balance_eth"].astype(float).max())
        else:
            balance_at_failure = 0.0

        instance.withdrawSuccessRate       = withdraw_success_rate
        instance.nonPrivilegedSuccessRate  = non_privileged_success_rate
        instance.balanceAtFailure          = balance_at_failure

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

        # ── HoneyPot 코드축 서브클래스 (정적 소스코드, boolean, 2026-09 신규) ───
        code_patterns_found = []
        sol_path = SOL_SOURCE_MAP.get(name)
        if sol_path and os.path.exists(sol_path):
            with open(sol_path, "r", encoding="utf-8") as f:
                sol_src = f.read()
            sol_lines = sol_src.split("\n")

            if detect_hidden_state_update(sol_lines):
                cp = onto.HiddenStateUpdatePattern(f"cp_hiddenstateupdate_{name}")
                instance.hasCodePattern.append(cp)
                code_patterns_found.append("HiddenStateUpdatePattern")

            if detect_straw_man_contract(sol_src, sol_lines):
                cp = onto.StrawManContractPattern(f"cp_strawmancontract_{name}")
                instance.hasCodePattern.append(cp)
                code_patterns_found.append("StrawManContractPattern")

        # ── Report ─────────────────────────────────────────────────────────────
        print(f"\nCreated: contract_{name}  ({class_name})")
        print(f"  peakBalance  = {instance.peakBalance:.4f} ETH")
        print(f"  finalBalance = {instance.finalBalance:.4f} ETH")
        print(f"  withdrawSuccessRate      = {instance.withdrawSuccessRate:.4f}")
        print(f"  nonPrivilegedSuccessRate = {instance.nonPrivilegedSuccessRate:.4f}")
        print(f"  balanceAtFailure         = {instance.balanceAtFailure:.4f} ETH")
        print(f"  Signals  : {[s.name for s in instance.hasSignal]}")
        print(f"  Patterns : {[p.name for p in instance.hasPattern]}")
        if sol_path:
            print(f"  CodePatterns : {code_patterns_found} (source: {sol_path})")

onto.save(file="ontology/fraud_with_instances.owl", format="rdfxml")
size = os.path.getsize("ontology/fraud_with_instances.owl")
print(f"\nfraud_with_instances.owl saved  ({size:,} bytes)")
