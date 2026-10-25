// 온톨로지 그래프(/api/report/:id/ontology) 표시용 순수 함수: 노드 상태, 강조 경로, 재생 순서.

// 노드 상태 다섯 가지. 조건·근거·회피 기법은 status(met/unmet/no_data)가 있고, 나머지는 active로만 구분한다.
export const STATE_LABELS = {
  met:      "충족",
  active:   "활성",
  unmet:    "미충족",
  no_data:  "근거 데이터 없음",
  inactive: "비활성"
};

export const KIND_LABELS = {
  parent:    "상위 클래스",
  class:     "분류 클래스",
  condition: "조건",
  evidence:  "근거",
  evasion:   "회피",
  role:      "역할",
  patch:     "권고 조치"
};

export function nodeState(node) {
  if (node.status === "met" || node.status === "unmet" || node.status === "no_data") return node.status;
  return node.active ? "active" : "inactive";
}

// 화면 범례·상세에 쓰는 세 가지 상태 묶음: 충족/활성, 미충족, 근거 데이터 없음 (+ 그 밖의 비활성)
export function stateGroup(node) {
  const s = nodeState(node);
  if (s === "met" || s === "active") return "on";
  return s;
}

export const edgeKey = (a, b) => [a, b].sort().join("|");

export function pathEdges(path) {
  const edges = [];
  for (let i = 0; i + 1 < path.length; i++) edges.push([path[i], path[i + 1]]);
  return edges;
}

// highlight.path(분류 추론, 기본 강조)와 highlight.evasionPath(회피 기법, 보조 강조)의 링크·노드 집합
export function highlightSets(highlight) {
  const primary = new Set(), secondary = new Set(), primaryNodes = new Set(), secondaryNodes = new Set();
  for (const p of highlight?.path ?? []) {
    p.forEach(id => primaryNodes.add(id));
    pathEdges(p).forEach(([a, b]) => primary.add(edgeKey(a, b)));
  }
  for (const p of highlight?.evasionPath ?? []) {
    p.forEach(id => secondaryNodes.add(id));
    pathEdges(p).forEach(([a, b]) => secondary.add(edgeKey(a, b)));
  }
  return { primary, secondary, primaryNodes, secondaryNodes };
}

// 재생 순서: path의 링크를 순서대로, 이어서 evasionPath
export function playbackSteps(highlight) {
  const steps = [];
  for (const p of highlight?.path ?? []) pathEdges(p).forEach(edge => steps.push({ kind: "primary", edge, nodes: edge }));
  for (const p of highlight?.evasionPath ?? []) pathEdges(p).forEach(edge => steps.push({ kind: "secondary", edge, nodes: edge }));
  return steps;
}

// 재생 k단계까지 켜진 링크·노드
export function visibleAtStep(steps, k) {
  const out = { primary: new Set(), secondary: new Set(), primaryNodes: new Set(), secondaryNodes: new Set() };
  for (const s of steps.slice(0, k)) {
    const [a, b] = s.edge;
    out[s.kind].add(edgeKey(a, b));
    out[`${s.kind}Nodes`].add(a);
    out[`${s.kind}Nodes`].add(b);
  }
  return out;
}

export function countGraph(graph) {
  return {
    nodes: graph.nodes.length,
    activeNodes: graph.nodes.filter(n => n.active).length,
    links: graph.links.length,
    activeLinks: graph.links.filter(l => l.active).length
  };
}
