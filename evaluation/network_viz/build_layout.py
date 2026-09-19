# -*- coding: utf-8 -*-
"""
build_layout.py

Phase 2: graph_data.json을 networkx 그래프로 구성하고, 2단계(클러스터 중심 배치 →
클러스터 내부 방사형 배치) 방식으로 전역 좌표를 계산한다.

1단계: fraudtype 허브 3개를 뺀 나머지 그래프에서 연결 요소(컨트랙트 1개 + 그
       소유 signal/pattern/evasion 노드)를 구하고, 각 요소를 하나의 메타 노드로
       축약한 뒤 fraudtype 허브와의 classifiedAs 관계를 메타 엣지로 반영해
       spring_layout으로 클러스터 중심 좌표를 계산한다.
2단계: 각 요소 내부에서는 컨트랙트 노드를 (0,0)에 두고 소유 노드들을 반지름 r의
       원 위에 각도 균등 분배로 배치한 뒤, 1단계 중심 좌표만큼 평행이동한다.

산출물: layout_coords.json (노드 id → [x, y]), preview_low_res.png (저해상도 미리보기)
"""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import networkx as nx
import numpy as np

# 한글 라벨 깨짐 방지 (시스템에 설치된 나눔고딕 사용, 설계서 표기 그대로 표시)
matplotlib.rcParams["font.family"] = "NanumGothic"
matplotlib.rcParams["axes.unicode_minus"] = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GRAPH_DATA_PATH = os.path.join(BASE_DIR, "graph_data.json")
LAYOUT_OUT_PATH = os.path.join(BASE_DIR, "layout_coords.json")
PREVIEW_OUT_PATH = os.path.join(BASE_DIR, "preview_low_res.png")

GRADE_COLOR = {
    "Legitime": "#8fb8e8",    # 연한 파랑 — Agent légitime
    "Suspect": "#f0a860",     # 주황 — Agent suspect
    "Frauduleux": "#d9534f",  # 빨강 — Agent frauduleux
}
TYPE_COLOR = {
    "signal": "#5cb85c",   # 초록
    "pattern": "#5b8fd6",  # 파랑
    "evasion": "#d97eb0",  # 분홍
    "fraudtype": "#333333",
}


def build_graph(data):
    G = nx.Graph()
    for n in data["nodes"]:
        G.add_node(n["id"], **n)
    for e in data["edges"]:
        # 동일 (source,target) 쌍에 엣지가 여러 개일 수 있으므로(예: triggers 여러 건)
        # relation 리스트로 누적한다.
        if G.has_edge(e["source"], e["target"]):
            G[e["source"]][e["target"]]["relations"].append(e["relation"])
        else:
            G.add_edge(e["source"], e["target"], relations=[e["relation"]])
    return G


def main():
    with open(GRAPH_DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)

    G = build_graph(data)
    print(f"전체 그래프: 노드 {G.number_of_nodes()}개, 엣지 {G.number_of_edges()}개")

    hub_ids = {n["id"] for n in data["nodes"] if n["type"] == "fraudtype"}
    contract_ids = [n["id"] for n in data["nodes"] if n["type"] == "contract"]

    # ── 1단계: 연결 요소 → 메타 그래프 ──────────────────────────────────────────
    detail_nodes = [nid for nid in G.nodes if nid not in hub_ids]
    G_detail = G.subgraph(detail_nodes)
    components = list(nx.connected_components(G_detail))
    print(f"연결 요소(컨트랙트 서브그래프) 개수: {len(components)}")

    # 각 요소를 대표하는 컨트랙트 주소 찾기 + 요소 내부 노드 목록 저장
    comp_of_node = {}       # node_id -> 대표 contract_id (메타 노드 키)
    comp_members = {}       # contract_id -> 요소 내 전체 노드 id 리스트
    for comp in components:
        contracts_in_comp = [nid for nid in comp if G.nodes[nid]["type"] == "contract"]
        assert len(contracts_in_comp) == 1, f"요소당 컨트랙트 1개 가정 위반: {contracts_in_comp}"
        rep = contracts_in_comp[0]
        comp_members[rep] = list(comp)
        for nid in comp:
            comp_of_node[nid] = rep

    meta = nx.Graph()
    meta.add_nodes_from(comp_members.keys())
    meta.add_nodes_from(hub_ids)

    for u, v, d in G.edges(data=True):
        if "classifiedAs" in d["relations"] and (u in hub_ids or v in hub_ids):
            contract_node = u if v in hub_ids else v
            hub_node = v if v in hub_ids else u
            # 같은 fraudtype으로 묶인 컨트랙트끼리 허브를 통해 약하게 끌리도록
            # 낮은 weight의 메타 엣지를 둔다.
            if meta.has_edge(contract_node, hub_node):
                meta[contract_node][hub_node]["weight"] += 0.12
            else:
                meta.add_edge(contract_node, hub_node, weight=0.12)

    n_meta = meta.number_of_nodes()
    # 허브 하나에 붙는 leaf(컨트랙트)가 100개를 넘는 경우가 있어(PonziScheme 등),
    # 기본 k로는 한 점 주변으로 뭉쳐 겹친다. 반발력 범위(k)를 크게 키우고 허브
    # 인력(weight)은 약하게 둬 "느슨하게 끌리되 서로 밀어내며 퍼지는" 형태로 조정.
    k_val = 9.0 / np.sqrt(n_meta)
    meta_pos = nx.spring_layout(meta, k=k_val, iterations=200, weight="weight", seed=42)
    print(f"메타 그래프: 노드 {n_meta}개 (컨트랙트 {len(comp_members)} + 허브 {len(hub_ids)}), k={k_val:.4f}")

    # 클러스터 중심 간 최근접 거리 — 전역 중앙값이 아니라 노드별로 계산해서 쓴다.
    # (허브 주변은 조밀하고 바깥 고립 노드는 성긴, 밀도가 크게 다른 그래프이므로
    #  전역 값 하나를 쓰면 조밀한 곳에서 내부 원끼리 겹친다.)
    ids = list(meta_pos.keys())
    centers = np.array([meta_pos[i] for i in ids])
    nn_dist = {}
    for i, nid in enumerate(ids):
        d = np.linalg.norm(centers - centers[i], axis=1)
        d[i] = np.inf
        nn_dist[nid] = float(d.min())
    print(f"클러스터 중심 최근접 거리: 중앙값 {np.median(list(nn_dist.values())):.4f}, "
          f"최소 {min(nn_dist.values()):.4f}")

    # ── 2단계: 요소 내부 방사형 배치 ────────────────────────────────────────────
    final_pos = {}
    for hub_id in hub_ids:
        final_pos[hub_id] = meta_pos[hub_id].tolist()

    for rep, members in comp_members.items():
        cx, cy = meta_pos[rep]
        owned = [nid for nid in members if nid != rep]
        final_pos[rep] = [float(cx), float(cy)]

        if not owned:
            continue  # 신호/패턴 없는 정상 컨트랙트 — 점 하나로 축소

        # 이 클러스터의 최근접 이웃 거리를 기준으로 내부 반지름 상한을 정해
        # 옆 클러스터의 원과 겹치지 않도록 한다. 요소 크기(신호/패턴 개수)가
        # 클수록 반지름을 키우되 상한(이웃 거리의 40%)은 넘지 않는다.
        n = len(owned)
        local_cap = nn_dist[rep] * 0.40
        r = min(local_cap, local_cap * (0.4 + 0.08 * n))
        for i, nid in enumerate(owned):
            angle = 2 * np.pi * i / n
            final_pos[nid] = [float(cx + r * np.cos(angle)), float(cy + r * np.sin(angle))]

    with open(LAYOUT_OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(final_pos, f, ensure_ascii=False, indent=2)
    print(f"레이아웃 좌표 저장 → {LAYOUT_OUT_PATH} ({len(final_pos)}개 노드)")

    render_preview(G, data, final_pos, hub_ids)


def render_preview(G, data, pos, hub_ids):
    """저해상도 미리보기: 색상 구분만으로 클러스터 분산/겹침 여부를 빠르게 확인."""
    node_meta = {n["id"]: n for n in data["nodes"]}

    fig, ax = plt.subplots(figsize=(12, 12), dpi=100)

    for u, v, d in G.edges(data=True):
        x = [pos[u][0], pos[v][0]]
        y = [pos[u][1], pos[v][1]]
        color = "#cccccc"
        if "classifiedAs" in d["relations"]:
            color = "#e08080"
        ax.plot(x, y, color=color, linewidth=0.3, alpha=0.4, zorder=1)

    xs_c, ys_c, colors_c = [], [], []
    xs_o, ys_o, colors_o, sizes_o = [], [], [], []

    for nid, (x, y) in pos.items():
        meta = node_meta[nid]
        if meta["type"] == "contract":
            xs_c.append(x); ys_c.append(y)
            colors_c.append(GRADE_COLOR[meta["grade"]])
        elif meta["type"] == "fraudtype":
            xs_o.append(x); ys_o.append(y)
            colors_o.append(TYPE_COLOR["fraudtype"]); sizes_o.append(120)
        else:
            xs_o.append(x); ys_o.append(y)
            colors_o.append(TYPE_COLOR[meta["type"]]); sizes_o.append(4)

    ax.scatter(xs_o, ys_o, c=colors_o, s=sizes_o, alpha=0.6, zorder=2, linewidths=0)
    ax.scatter(xs_c, ys_c, c=colors_c, s=25, alpha=0.9, zorder=3, edgecolors="white", linewidths=0.3)

    for hub_id in hub_ids:
        x, y = pos[hub_id]
        ax.annotate(node_meta[hub_id]["fraud_class"], (x, y), fontsize=8, color="black",
                    ha="center", va="center", zorder=4)

    ax.set_title("Phase 2 미리보기 — 클러스터 분산 확인 (저해상도)")
    ax.set_aspect("equal")
    ax.axis("off")
    fig.tight_layout()
    fig.savefig(PREVIEW_OUT_PATH)
    print(f"미리보기 저장 → {PREVIEW_OUT_PATH}")


if __name__ == "__main__":
    main()
