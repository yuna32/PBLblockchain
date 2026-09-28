"""
블록체인 사기 탐지 Framework — 시각화 스크립트
6가지 사기 유형 vs 정상 스테이킹 시계열 패턴 비교
"""

import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.gridspec as gridspec
import numpy as np
import os
import sys

# ── 한글 폰트 설정 (Mac/Linux/Windows 자동 대응) ──────
plt.rcParams["font.family"] = "NanumGothic"
plt.rcParams["axes.unicode_minus"] = False


# ── 데이터 로드 ────────────────────────────────────────
LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")

FRAUD_CONFIGS = {
    "ponzi":      {"label": "폰지 사기",    "color": "#e74c3c", "file": "ponzi_log.csv"},
    "normal":     {"label": "정상 스테이킹","color": "#2ecc71", "file": "normal_log.csv"},
    "rugpull":    {"label": "러그풀",        "color": "#e67e22", "file": "rugpull_log.csv"},
    "laundering": {"label": "자금세탁",      "color": "#9b59b6", "file": "laundering_log.csv"},
    "pumpdump":   {"label": "펌프앤덤프",    "color": "#e91e63", "file": "pumpdump_log.csv"},
    "flashloan":  {"label": "플래시론",      "color": "#00bcd4", "file": "flashloan_log.csv"},
}

ALPHA = 0.85
DEPOSIT_ACTIONS  = {"deposit", "stake", "fund_reward_pool"}
WITHDRAW_ACTIONS = {"withdraw", "unstake", "owner_withdraw_all"}


# ── 지표 계산 함수 ─────────────────────────────────────
def compute_metrics(df):
    df = df.copy()
    df["amount_eth"] = pd.to_numeric(df["amount_eth"], errors="coerce").fillna(0)
    df["contract_balance_eth"] = pd.to_numeric(df["contract_balance_eth"], errors="coerce").fillna(0)

    df["is_deposit"]  = df["action"].isin(DEPOSIT_ACTIONS)
    df["is_withdraw"] = df["action"].isin(WITHDRAW_ACTIONS)

    blocks = sorted(df["block"].unique())
    metrics = []

    for b in blocks:
        sub = df[df["block"] == b]
        total_in  = sub.loc[sub["is_deposit"],  "amount_eth"].sum()
        total_out = sub.loc[sub["is_withdraw"], "amount_eth"].sum()
        net_flow  = total_in - total_out
        balance   = float(sub["contract_balance_eth"].iloc[-1])
        unique_p  = sub["from"].nunique() + sub["to"].nunique()
        max_tx    = float(sub["amount_eth"].max())

        metrics.append({
            "block":              b,
            "total_in":           total_in,
            "total_out":          total_out,
            "net_flow":           net_flow,
            "cumulative_balance": balance,
            "unique_participants":unique_p,
            "max_single_tx":      max_tx
        })

    return pd.DataFrame(metrics)


# ── 각 유형 데이터 로드 ────────────────────────────────
datasets = {}
missing  = []

for key, cfg in FRAUD_CONFIGS.items():
    fpath = os.path.join(LOG_DIR, cfg["file"])
    if os.path.exists(fpath):
        df = pd.read_csv(fpath)
        datasets[key] = {"df": df, "metrics": compute_metrics(df), **cfg}
        print(f"✅ 로드: {cfg['file']} ({len(df)}행)")
    else:
        missing.append(cfg["file"])
        print(f"⚠ 미발견: {cfg['file']} — 시뮬레이션 실행 후 재시도")

if not datasets:
    print("\n❌ 로드 가능한 CSV가 없습니다. 먼저 시뮬레이션을 실행하세요.")
    sys.exit(1)

print(f"\n로드 완료: {len(datasets)}개 유형 / 미발견: {len(missing)}개\n")

# ── 공통 메트릭 출력 ───────────────────────────────────
for key, d in datasets.items():
    print(f"=== {d['label']} 지표 ===")
    print(d["metrics"].to_string(index=False))
    print()


# ══════════════════════════════════════════════════════════
# 그래프 A: 전체 비교 (4 x 2 그리드)
# ══════════════════════════════════════════════════════════
n = len(datasets)
COLS = 2
ROWS = 4

fig_a, axes_a = plt.subplots(ROWS, COLS, figsize=(14, 5 * ROWS))
fig_a.suptitle("블록체인 사기 탐지 Framework\n6가지 패턴 시계열 비교",
               fontsize=15, fontweight="bold", y=1.01)

METRIC_TITLES = [
    ("cumulative_balance", "누적 잔고 (ETH)", "line"),
    ("net_flow",           "순입금 흐름 net_flow (ETH)", "bar"),
    ("max_single_tx",      "최대 단일 TX (ETH)", "scatter"),
    ("unique_participants","고유 참여자 수", "line"),
]

keys  = list(datasets.keys())
items = list(datasets.values())

for row_i, (metric, title, plot_type) in enumerate(METRIC_TITLES):
    ax_l = axes_a[row_i, 0]
    ax_r = axes_a[row_i, 1]

    for ax, subset_keys in [(ax_l, keys[:3]), (ax_r, keys[3:])]:
        for key in subset_keys:
            if key not in datasets:
                continue
            d = datasets[key]
            m = d["metrics"]
            col = d["color"]
            lbl = d["label"]

            if plot_type == "line":
                ax.plot(m["block"], m[metric], color=col, linewidth=2,
                        marker="o", markersize=4, label=lbl, alpha=ALPHA)
            elif plot_type == "bar":
                ax.bar(m["block"], m[metric], color=col, alpha=0.6, label=lbl, width=0.8)
            elif plot_type == "scatter":
                ax.scatter(m["block"], m[metric], color=col, s=50, label=lbl, alpha=ALPHA)

        ax.axhline(y=0, color="white", linewidth=0.5, linestyle="--", alpha=0.3)
        ax.set_title(title, fontsize=10)
        ax.set_xlabel("블록 번호", fontsize=8)
        ax.legend(fontsize=7)
        ax.grid(alpha=0.2)
        ax.tick_params(labelsize=8)

plt.tight_layout()
out_a = os.path.join(LOG_DIR, "comparison_all.png")
plt.savefig(out_a, dpi=150, bbox_inches="tight")
print(f"✅ 전체 비교 그래프 저장: {out_a}")


# ══════════════════════════════════════════════════════════
# 그래프 B: 유형별 개별 PNG
# ══════════════════════════════════════════════════════════
for key, d in datasets.items():
    m   = d["metrics"]
    col = d["color"]
    lbl = d["label"]

    fig, axes = plt.subplots(2, 2, figsize=(12, 8))
    fig.suptitle(f"{lbl} — 블록체인 사기 탐지 Framework",
                 fontsize=13, fontweight="bold")

    # ① 누적 잔고
    ax = axes[0, 0]
    ax.plot(m["block"], m["cumulative_balance"], color=col, marker="o", linewidth=2)
    zero_blocks = m.loc[m["cumulative_balance"] == 0, "block"]
    if not zero_blocks.empty:
        ax.axvline(x=zero_blocks.iloc[0], color=col, linestyle="--",
                   linewidth=1.5, alpha=0.7)
        ax.annotate("잔고→0", xy=(zero_blocks.iloc[0], 0),
                    xytext=(zero_blocks.iloc[0] + 0.5, m["cumulative_balance"].max() * 0.1),
                    fontsize=8, color=col,
                    arrowprops=dict(arrowstyle="->", color=col))
    ax.set_title("① 누적 잔고 (ETH)")
    ax.set_xlabel("블록"); ax.set_ylabel("ETH"); ax.grid(alpha=0.3)

    # ② 순입금 흐름
    ax = axes[0, 1]
    colors_bar = [col if v >= 0 else "#888888" for v in m["net_flow"]]
    ax.bar(m["block"], m["net_flow"], color=colors_bar, alpha=ALPHA)
    ax.axhline(y=0, color="white", linewidth=0.8)
    ax.set_title("② 순입금 흐름 (net_flow = 입금 − 출금)")
    ax.set_xlabel("블록"); ax.set_ylabel("ETH"); ax.grid(alpha=0.3, axis="y")

    # ③ 최대 단일 TX
    ax = axes[1, 0]
    ax.scatter(m["block"], m["max_single_tx"], color=col, s=60, zorder=3)
    ax.plot(m["block"], m["max_single_tx"], color=col, linewidth=1.5, alpha=0.5)
    peak = m.loc[m["max_single_tx"].idxmax()]
    ax.annotate(f"{peak['max_single_tx']:.2f} ETH",
                xy=(peak["block"], peak["max_single_tx"]),
                xytext=(peak["block"] + 0.5, peak["max_single_tx"] * 0.9),
                fontsize=8, color=col,
                arrowprops=dict(arrowstyle="->", color=col))
    ax.set_title("③ 최대 단일 트랜잭션 (ETH)")
    ax.set_xlabel("블록"); ax.set_ylabel("ETH"); ax.grid(alpha=0.3)

    # ④ 입금 / 출금 막대
    ax = axes[1, 1]
    bw = 0.35
    blocks_arr = m["block"].values
    ax.bar(blocks_arr - bw/2, m["total_in"],  width=bw, color=col,      alpha=ALPHA, label="입금")
    ax.bar(blocks_arr + bw/2, m["total_out"], width=bw, color="#888888", alpha=ALPHA, label="출금", hatch="//")
    ax.set_title("④ 블록별 입금 / 출금 (ETH)")
    ax.set_xlabel("블록"); ax.set_ylabel("ETH"); ax.legend(fontsize=8); ax.grid(alpha=0.3, axis="y")

    plt.tight_layout()
    out_path = os.path.join(LOG_DIR, f"{key}_analysis.png")
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"✅ {lbl} 분석 저장: {out_path}")


# ══════════════════════════════════════════════════════════
# 그래프 C: 폰지 vs 정상 — 기존 호환 그래프 유지
# ══════════════════════════════════════════════════════════
if "ponzi" in datasets and "normal" in datasets:
    ponzi_m  = datasets["ponzi"]["metrics"]
    normal_m = datasets["normal"]["metrics"]
    PONZI_COLOR  = "#e74c3c"
    NORMAL_COLOR = "#2ecc71"

    fig_c, axes_c = plt.subplots(2, 2, figsize=(14, 9))
    fig_c.suptitle("블록체인 사기 탐지 Framework\n폰지 사기 vs 정상 스테이킹 시계열 패턴 비교",
                   fontsize=14, fontweight="bold", y=1.02)

    ax1 = axes_c[0, 0]
    ax1.bar(ponzi_m["block"]-0.3,  ponzi_m["total_in"],   width=0.25, color=PONZI_COLOR,  alpha=ALPHA,  label="폰지 입금")
    ax1.bar(ponzi_m["block"]-0.05, ponzi_m["total_out"],  width=0.25, color=PONZI_COLOR,  alpha=0.4,   label="폰지 출금",  hatch="//")
    ax1.bar(normal_m["block"]+0.05,normal_m["total_in"],  width=0.25, color=NORMAL_COLOR, alpha=ALPHA,  label="정상 입금")
    ax1.bar(normal_m["block"]+0.3, normal_m["total_out"], width=0.25, color=NORMAL_COLOR, alpha=0.4,   label="정상 출금",  hatch="//")
    ax1.set_title("① 블록별 입금 / 출금 금액 (ETH)"); ax1.set_xlabel("블록 번호"); ax1.set_ylabel("ETH")
    ax1.legend(fontsize=7); ax1.grid(axis="y", alpha=0.3)

    ax2 = axes_c[0, 1]
    ax2.plot(ponzi_m["block"],  ponzi_m["cumulative_balance"],  color=PONZI_COLOR,  marker="o", linewidth=2, label="폰지 잔고")
    ax2.plot(normal_m["block"], normal_m["cumulative_balance"], color=NORMAL_COLOR, marker="s", linewidth=2, label="정상 잔고")
    rp = ponzi_m.loc[ponzi_m["cumulative_balance"]==0, "block"]
    if not rp.empty:
        ax2.axvline(x=rp.iloc[0], color=PONZI_COLOR, linestyle="--", linewidth=1.5, alpha=0.7)
        ax2.annotate("러그풀\n잔고→0", xy=(rp.iloc[0], 0),
                     xytext=(rp.iloc[0]-3, 2), fontsize=8, color=PONZI_COLOR,
                     arrowprops=dict(arrowstyle="->", color=PONZI_COLOR))
    ax2.set_title("② 누적 잔고 변화 (ETH)\n핵심 탐지 지표"); ax2.set_xlabel("블록 번호"); ax2.set_ylabel("ETH")
    ax2.legend(); ax2.grid(alpha=0.3)

    ax3 = axes_c[1, 0]
    pc = [PONZI_COLOR  if v>=0 else "#c0392b" for v in ponzi_m["net_flow"]]
    nc = [NORMAL_COLOR if v>=0 else "#27ae60"  for v in normal_m["net_flow"]]
    ax3.bar(ponzi_m["block"]-0.2,  ponzi_m["net_flow"],  width=0.35, color=pc, alpha=ALPHA, label="폰지 net_flow")
    ax3.bar(normal_m["block"]+0.2, normal_m["net_flow"], width=0.35, color=nc, alpha=ALPHA, label="정상 net_flow")
    ax3.axhline(y=0, color="black", linewidth=0.8)
    ax3.set_title("③ 순입금 흐름 (net_flow = 입금 − 출금)\n음수 = 자금 유출"); ax3.set_xlabel("블록 번호"); ax3.set_ylabel("ETH")
    ax3.legend(); ax3.grid(axis="y", alpha=0.3)

    ax4 = axes_c[1, 1]
    ax4.plot(ponzi_m["block"],  ponzi_m["max_single_tx"],  color=PONZI_COLOR,  marker="^", markersize=8, linewidth=2, label="폰지 최대 단일 TX")
    ax4.plot(normal_m["block"], normal_m["max_single_tx"], color=NORMAL_COLOR, marker="v", markersize=8, linewidth=2, label="정상 최대 단일 TX")
    pp = ponzi_m.loc[ponzi_m["max_single_tx"].idxmax()]
    ax4.annotate(f"관리자 전액\n{pp['max_single_tx']:.1f} ETH",
                 xy=(pp["block"], pp["max_single_tx"]),
                 xytext=(pp["block"]-4, pp["max_single_tx"]*0.85),
                 fontsize=8, color=PONZI_COLOR,
                 arrowprops=dict(arrowstyle="->", color=PONZI_COLOR))
    ax4.set_title("④ 블록별 최대 단일 트랜잭션 (ETH)\n대액 출금 탐지"); ax4.set_xlabel("블록 번호"); ax4.set_ylabel("ETH")
    ax4.legend(); ax4.grid(alpha=0.3)

    ponzi_summary  = "🔴 폰지 패턴\n• 잔고 점진 증가 후 수직 급락\n• net_flow 마지막 블록 대형 음수\n• 최대 단일 TX = 전체 잔고"
    normal_summary = "🟢 정상 패턴\n• 잔고 완만한 감소\n• net_flow 소폭 변동\n• 최대 단일 TX 균등 분산"
    fig_c.text(0.01, -0.04, ponzi_summary,  fontsize=9, bbox=dict(boxstyle="round", facecolor="#fdecea", alpha=0.8))
    fig_c.text(0.52, -0.04, normal_summary, fontsize=9, bbox=dict(boxstyle="round", facecolor="#eafaf1", alpha=0.8))

    plt.tight_layout()
    out_c = os.path.join(LOG_DIR, "pattern_comparison.png")
    plt.savefig(out_c, dpi=150, bbox_inches="tight")
    print(f"\n✅ 폰지 vs 정상 비교 그래프 저장: {out_c}")


print("\n=== 시각화 완료 ===")
print(f"저장 위치: {LOG_DIR}")
print("생성 파일 목록:")
for f in sorted(os.listdir(LOG_DIR)):
    if f.endswith(".png"):
        fpath = os.path.join(LOG_DIR, f)
        print(f"  • {f} ({os.path.getsize(fpath)//1024} KB)")
