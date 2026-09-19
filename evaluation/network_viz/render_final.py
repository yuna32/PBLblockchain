# -*- coding: utf-8 -*-
"""
render_final.py

Phase 3: graph_data.json + layout_coords.json(Phase 2 산출물)을 이용해
참고 이미지(Fig. 3) 스타일의 최종 정적 네트워크 이미지를 렌더링한다.

1. 고립 컨트랙트(허브에 연결되지 않아 바깥 고리를 이루는 노드)에 지터를 추가해
   기계적인 완전 동심원처럼 보이지 않게 다듬는다 (Phase 2 좌표 파일 자체는
   건드리지 않고, 이 스크립트 안에서만 사본에 적용).
2. matplotlib으로 흰 배경 네트워크를 그리고, 증거가 가장 풍부한 대표 컨트랙트
   1건을 원형 확대 인셋으로 보여준다.
3. 좌측 하단 범례 + 하단 캡션을 추가해 300dpi PNG와 벡터 SVG로 저장한다.

원본 파이프라인 파일은 참조하지 않으며 evaluation/network_viz/ 안에서만 작업한다.
"""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import networkx as nx
import numpy as np
from matplotlib.lines import Line2D
from matplotlib.patches import Circle, ConnectionPatch, Patch
from mpl_toolkits.axes_grid1.inset_locator import inset_axes

# 한글 라벨: 시스템에 Noto Sans/Serif CJK KR이 없어 나눔고딕으로 대체한다
# (fc-list 확인 결과 Noto CJK 계열 미설치, 나눔고딕은 설치되어 있음 — Phase 2와 동일).
matplotlib.rcParams["font.family"] = "NanumGothic"
matplotlib.rcParams["axes.unicode_minus"] = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GRAPH_DATA_PATH = os.path.join(BASE_DIR, "graph_data.json")
LAYOUT_PATH = os.path.join(BASE_DIR, "layout_coords.json")
PNG_OUT = os.path.join(BASE_DIR, "fraud_network.png")
SVG_OUT = os.path.join(BASE_DIR, "fraud_network.svg")

GRADE_COLOR = {
    "Legitime": "#8fb8e8",
    "Suspect": "#f0a860",
    "Frauduleux": "#d9534f",
}
GRADE_LABEL_KO = {
    "Legitime": "Legitime (정상)",
    "Suspect": "Suspect (경계)",
    "Frauduleux": "Frauduleux (사기)",
}
TYPE_COLOR = {
    "signal": "#5cb85c",
    "pattern": "#5b8fd6",
    "evasion": "#d97eb0",
}
RELATION_COLOR = {
    "hasSignal": "#5cb85c",
    "hasPattern": "#5b8fd6",
    "usesEvasion": "#d97eb0",
    "classifiedAs": "#d9534f",
    "triggers": "#e0932c",
    "implies": "#e0932c",
}
RELATION_ORDER = ["hasSignal", "hasPattern", "usesEvasion", "classifiedAs", "triggers"]


def build_graph(data):
    G = nx.Graph()
    for n in data["nodes"]:
        G.add_node(n["id"], **n)
    for e in data["edges"]:
        if G.has_edge(e["source"], e["target"]):
            G[e["source"]][e["target"]]["relations"].append(e["relation"])
        else:
            G.add_edge(e["source"], e["target"], relations=[e["relation"]])
    return G


def find_isolated_components(G, hub_ids):
    """classifiedAs로 어떤 fraudtype 허브에도 연결되지 않은 컨트랙트 집합을 찾는다."""
    detail_nodes = [n for n in G.nodes if n not in hub_ids]
    G_detail = G.subgraph(detail_nodes)
    components = list(nx.connected_components(G_detail))

    hub_neighbors = set()
    for hub in hub_ids:
        hub_neighbors.update(G.neighbors(hub))

    comp_members = {}
    isolated_reps = set()
    for comp in components:
        rep = next(n for n in comp if G.nodes[n]["type"] == "contract")
        comp_members[rep] = list(comp)
        if rep not in hub_neighbors:
            isolated_reps.add(rep)
    return comp_members, isolated_reps


def apply_jitter(pos, comp_members, isolated_reps, seed=42):
    """고립 컨트랙트 요소 전체를 반경 ±10~15%, 각도 소량 무작위로 이동한다.

    요소 내부의 신호/패턴/증거 노드는 컨트랙트와 함께 통째로 평행이동해
    (Phase 2에서 만든) 내부 방사형 배치가 흐트러지지 않게 한다.
    """
    rng = np.random.default_rng(seed)
    all_xy = np.array(list(pos.values()))
    centroid = all_xy.mean(axis=0)

    jittered = dict(pos)
    for rep in isolated_reps:
        cx, cy = pos[rep]
        vec = np.array([cx, cy]) - centroid
        r = np.linalg.norm(vec)
        theta = np.arctan2(vec[1], vec[0])

        r_jitter = rng.uniform(-0.15, 0.15)
        theta_jitter = rng.uniform(-0.12, 0.12)  # 라디안, 소량
        new_r = r * (1 + r_jitter)
        new_theta = theta + theta_jitter
        new_center = centroid + new_r * np.array([np.cos(new_theta), np.sin(new_theta)])
        delta = new_center - np.array([cx, cy])

        for nid in comp_members[rep]:
            x, y = jittered[nid]
            jittered[nid] = [x + delta[0], y + delta[1]]
    return jittered


def pick_showcase(data):
    """신호+패턴+증거 노드 총합이 가장 많은 컨트랙트를 대표 사례로 선정."""
    owned_count = {}
    for n in data["nodes"]:
        if n["type"] in ("signal", "pattern", "evasion"):
            owned_count[n["owner"]] = owned_count.get(n["owner"], 0) + 1
    return max(owned_count, key=owned_count.get)


def draw_edges(ax, G, pos, alpha_scale=1.0, linewidth_scale=1.0):
    # classifiedAs는 "어떤 컨트랙트가 어느 fraudtype에 속하는가"라는 구조적
    # 정보(허브-리프 연결)는 유지하되, 시각적으로는 개별 클러스터를 이루는
    # hasSignal/hasPattern/usesEvasion/triggers 쪽이 주인공이 되도록 거의
    # 안 보이는 배경 텍스처 수준으로 낮춘다. 나머지 관계는 기존 값 유지.
    for relation in RELATION_ORDER:
        color = RELATION_COLOR[relation]
        if relation == "classifiedAs":
            alpha, linewidth = 0.06, 0.15
        else:
            alpha, linewidth = 0.35, 0.35
        xs, ys = [], []
        for u, v, d in G.edges(data=True):
            if relation not in d["relations"]:
                continue
            xs += [pos[u][0], pos[v][0], None]
            ys += [pos[u][1], pos[v][1], None]
        if not xs:
            continue
        ax.plot(xs, ys, color=color, linewidth=linewidth * linewidth_scale,
                 alpha=alpha * alpha_scale, zorder=1, solid_capstyle="round")


def draw_nodes(ax, G, pos, node_meta, size_scale=1.0):
    xs_small, ys_small, colors_small, sizes_small = [], [], [], []
    xs_c, ys_c, colors_c = [], [], []
    xs_hub, ys_hub, labels_hub = [], [], []

    for nid, (x, y) in pos.items():
        meta = node_meta[nid]
        if meta["type"] == "contract":
            xs_c.append(x); ys_c.append(y); colors_c.append(GRADE_COLOR[meta["grade"]])
        elif meta["type"] == "fraudtype":
            xs_hub.append(x); ys_hub.append(y); labels_hub.append(meta["fraud_class"])
        else:
            xs_small.append(x); ys_small.append(y)
            colors_small.append(TYPE_COLOR[meta["type"]])
            sizes_small.append(3.5 * size_scale)

    ax.scatter(xs_small, ys_small, c=colors_small, s=sizes_small,
               alpha=0.55, zorder=2, linewidths=0)
    ax.scatter(xs_c, ys_c, c=colors_c, s=22 * size_scale, alpha=0.92,
               zorder=3, edgecolors="white", linewidths=0.3)
    ax.scatter(xs_hub, ys_hub, c="#2b2b2b", s=140 * size_scale, alpha=0.9,
               zorder=3, edgecolors="white", linewidths=0.6, marker="o")
    # 허브 이름(PonziScheme 등)은 작은 원 안에 다 안 들어가므로, 흰 배경 라벨을
    # 마커 아래쪽에 붙여 표시한다(원 안에 흰 글씨로 넣으면 삐져나온 부분이
    # 흰 배경과 겹쳐 안 보이는 문제가 있었음).
    for (x, y, label) in zip(xs_hub, ys_hub, labels_hub):
        ax.annotate(label, (x, y), xytext=(0, -14), textcoords="offset points",
                    fontsize=10 * size_scale, color="#2b2b2b", ha="center", va="top",
                    zorder=4, fontweight="bold",
                    bbox=dict(boxstyle="round,pad=0.2", fc="white", ec="#2b2b2b", linewidth=0.6, alpha=0.9))


def draw_legend(fig, ax):
    node_handles = [
        Patch(facecolor=GRADE_COLOR[g], edgecolor="white", label=GRADE_LABEL_KO[g])
        for g in ["Legitime", "Suspect", "Frauduleux"]
    ]
    edge_handles = [
        Line2D([0], [0], color=RELATION_COLOR[r], linewidth=2, label=r)
        for r in RELATION_ORDER
    ]
    legend1 = ax.legend(handles=node_handles, title="컨트랙트 판정 등급",
                         loc="lower left", bbox_to_anchor=(0.0, 0.0),
                         fontsize=8, title_fontsize=8, frameon=True, framealpha=0.9)
    ax.add_artist(legend1)
    ax.legend(handles=edge_handles, title="관계(엣지) 유형",
              loc="lower left", bbox_to_anchor=(0.0, 0.17),
              fontsize=8, title_fontsize=8, frameon=True, framealpha=0.9)


def draw_showcase_inset(fig, ax_main, G, pos, node_meta, showcase_id):
    """대표 컨트랙트 1건을 원형 확대 인셋(우측 상단)으로 그린다."""
    # fraudtype 허브는 다른 다수 컨트랙트와도 공유되는 노드라 인셋에서는 제외하고
    # (classifiedAs 자체는 범례로 설명), 이 컨트랙트 고유의 signal/pattern/evasion만 표시.
    owned = [n for n in G.neighbors(showcase_id) if node_meta[n]["type"] != "fraudtype"]
    local_nodes = [showcase_id] + owned
    xs = [pos[n][0] for n in local_nodes]
    ys = [pos[n][1] for n in local_nodes]
    cx, cy = pos[showcase_id]
    span = max(max(np.abs(np.array(xs) - cx)), max(np.abs(np.array(ys) - cy)), 1e-6)
    pad = span * 1.35

    # 메인 플롯에 돋보기 원 표시
    lens = Circle((cx, cy), pad, fill=False, edgecolor="#555555",
                  linewidth=0.8, linestyle="--", zorder=5)
    ax_main.add_patch(lens)

    inset = inset_axes(ax_main, width="34%", height="34%", loc="upper right",
                        borderpad=1.2)
    inset.set_xlim(cx - pad, cx + pad)
    inset.set_ylim(cy - pad, cy + pad)
    inset.set_aspect("equal")

    # 인셋 ↔ 돋보기 원 연결선
    con = ConnectionPatch(
        xyA=(cx + pad * 0.7, cy + pad * 0.7), coordsA=ax_main.transData,
        xyB=(0, 0), coordsB=inset.transAxes,
        color="#999999", linewidth=0.6, zorder=5,
    )
    fig.add_artist(con)

    for u, v, d in G.subgraph(local_nodes).edges(data=True):
        relation = d["relations"][0]
        inset.plot([pos[u][0], pos[v][0]], [pos[u][1], pos[v][1]],
                   color=RELATION_COLOR[relation], linewidth=1.1, alpha=0.8, zorder=1)
        mx, my = (pos[u][0] + pos[v][0]) / 2, (pos[u][1] + pos[v][1]) / 2
        inset.annotate(relation, (mx, my), fontsize=5, color=RELATION_COLOR[relation],
                        ha="center", va="center", zorder=4,
                        bbox=dict(boxstyle="round,pad=0.1", fc="white", ec="none", alpha=0.7))

    for nid in local_nodes:
        x, y = pos[nid]
        meta = node_meta[nid]
        if meta["type"] == "contract":
            inset.scatter([x], [y], c=GRADE_COLOR[meta["grade"]], s=140,
                          edgecolors="white", linewidths=0.6, zorder=3)
            short_addr = nid[:8] + "…"
            inset.annotate(short_addr, (x, y), fontsize=6, ha="center", va="center",
                            zorder=4, fontweight="bold")
        else:
            label = meta.get("signal_class") or meta.get("pattern_class") or meta.get("evasion_class")
            inset.scatter([x], [y], c=TYPE_COLOR[meta["type"]], s=40,
                          edgecolors="white", linewidths=0.4, zorder=3)
            inset.annotate(label, (x, y), fontsize=5.5, ha="center", va="bottom", zorder=4)

    r = node_meta[showcase_id]
    title = (f"대표 사례: {showcase_id[:10]}…\n"
             f"등급={r['grade']}  힌트={r['fraud_type_hint']}  위험도={r['dynamic_risk_score']}")
    inset.set_title(title, fontsize=6.5)
    for spine in inset.spines.values():
        spine.set_edgecolor("#888888")
        spine.set_linewidth(0.8)
    inset.set_xticks([]); inset.set_yticks([])


def main():
    with open(GRAPH_DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)
    with open(LAYOUT_PATH, encoding="utf-8") as f:
        pos = json.load(f)

    G = build_graph(data)
    node_meta = {n["id"]: n for n in data["nodes"]}
    hub_ids = {n["id"] for n in data["nodes"] if n["type"] == "fraudtype"}

    comp_members, isolated_reps = find_isolated_components(G, hub_ids)
    print(f"고립 컨트랙트(허브 미연결) {len(isolated_reps)}개에 지터 적용")
    pos = apply_jitter(pos, comp_members, isolated_reps, seed=42)

    showcase_id = pick_showcase(data)
    print(f"대표 사례 컨트랙트: {showcase_id}")

    fig, ax = plt.subplots(figsize=(16, 16), dpi=100)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    draw_edges(ax, G, pos)
    draw_nodes(ax, G, pos, node_meta)
    draw_showcase_inset(fig, ax, G, pos, node_meta, showcase_id)
    draw_legend(fig, ax)

    ax.set_aspect("equal")
    ax.axis("off")
    fig.suptitle("", fontsize=1)  # 여백 확보용 (제목 없음)
    fig.text(0.5, 0.02, "Fig. X. Visualization of OntoTrace Fraud Detection Network",
              ha="center", fontsize=13)
    fig.subplots_adjust(left=0.02, right=0.98, top=0.98, bottom=0.06)

    fig.savefig(PNG_OUT, dpi=300, facecolor="white")
    fig.savefig(SVG_OUT, facecolor="white")
    print(f"저장 완료: {PNG_OUT}, {SVG_OUT}")


if __name__ == "__main__":
    main()
