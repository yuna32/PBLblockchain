"""
러그풀 교차공리 (2026-11) — OWL 레이어용 재계산.

기준값은 analysis/dynamic_analyzer.js의 RUGPULL_AXIOM 한 곳에서만 정한다. 이 모듈은 그 블록을
읽어 쓰고(값을 복사해 두지 않음), CSV 원본에서 JS computeRugPullAxiom()과 같은 정의로 다시
계산한다. JS·OWL 두 레이어가 같은 원본에서 각자 계산해 서로 검산되게 하는 기존 원칙
(withdrawSuccessRate 등)과 같다. 금액은 Decimal로 정확히 비교한다(경계 70%·105%).

  NetDrain     : Σ max(0, received − deposited) ≥ netDrain × peak
  SharedProfit : |{a : deposited > 0 ∧ received ≥ profitRatio × deposited}| ≥ profitSharers
  T(반복 중계)  : 성공 출금 ≥ passThroughMinWithdrawals건, 그중 직전 입금과 같은 금액
                 (차이 ≤ passThroughAmountToleranceEth)인 건의 비율 > passThroughMatchShare
"""
import csv
import os
import re
from decimal import Decimal, InvalidOperation

_ANALYZER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "analysis", "dynamic_analyzer.js")

DEPOSIT_ACTIONS = {"deposit", "stake", "fund_reward_pool"}
WITHDRAW_ACTIONS = {"withdraw", "unstake", "owner_withdraw_all"}


def load_params():
    with open(_ANALYZER, encoding="utf-8") as f:
        src = f.read()
    m = re.search(r"export const RUGPULL_AXIOM = Object\.freeze\(\{(.*?)\}\);", src, re.S)
    if not m:
        raise RuntimeError("RUGPULL_AXIOM 블록을 찾지 못함: " + _ANALYZER)
    params = {k: v for k, v in re.findall(r"(\w+)\s*:\s*([0-9.eE+-]+)", m.group(1))}
    need = ["netDrain", "profitRatio", "profitSharers", "passThroughMinWithdrawals",
            "passThroughMatchShare", "passThroughAmountToleranceEth"]
    missing = [k for k in need if k not in params]
    if missing:
        raise RuntimeError(f"RUGPULL_AXIOM 항목 누락: {missing}")
    return {k: Decimal(params[k]) for k in need}


PARAMS = load_params()


def _dec(x):
    # JS parseFloat(x) || 0 과 같게: 읽을 수 없으면 0
    try:
        d = Decimal(str(x).strip())
        return d if d.is_finite() else Decimal(0)
    except (InvalidOperation, ValueError):
        return Decimal(0)


def compute(csv_path):
    """CSV(8열 per-tx 로그) → {hasFlow, passThrough, netDrainRatio, profitSharerCount, verdict, inScope}"""
    p = PARAMS
    with open(csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    dep, rec = {}, {}
    peak = Decimal(0)
    n_dep = n_wd = matched = 0
    last_dep = None
    for r in rows:
        amt, bal = _dec(r.get("amount_eth")), _dec(r.get("contract_balance_eth"))
        if bal > peak:
            peak = bal
        action = r.get("action")
        if action in DEPOSIT_ACTIONS:
            a = (r.get("from") or "").lower()
            dep[a] = dep.get(a, Decimal(0)) + amt
            rec.setdefault(a, Decimal(0))
            if amt > 0:
                n_dep += 1
                last_dep = amt
        elif action in WITHDRAW_ACTIONS:
            a = (r.get("to") or "").lower()
            rec[a] = rec.get(a, Decimal(0)) + amt
            dep.setdefault(a, Decimal(0))
            if amt > 0:
                n_wd += 1
                if last_dep is not None and abs(amt - last_dep) <= p["passThroughAmountToleranceEth"]:
                    matched += 1
    has_flow = n_dep > 0 and n_wd > 0
    pass_through = n_wd >= p["passThroughMinWithdrawals"] and Decimal(matched) > Decimal(n_wd) * p["passThroughMatchShare"]
    net_out = sum((max(Decimal(0), rec[a] - dep[a]) for a in dep), Decimal(0))
    sharers = sum(1 for a in dep if dep[a] > 0 and rec[a] >= dep[a] * p["profitRatio"])
    nd_met = peak > 0 and net_out >= peak * p["netDrain"]
    in_scope = has_flow and not pass_through   # 시뮬레이션 로그: 컨트랙트·지갑별 장부로 간주
    return {
        "hasFlow": has_flow,
        "passThrough": pass_through,
        "netDrainRatio": float(net_out / peak) if peak > 0 else 0.0,
        "netDrainMet": nd_met,
        "profitSharerCount": sharers,
        "inScope": in_scope,
        "verdict": in_scope and nd_met and sharers < p["profitSharers"],
    }
