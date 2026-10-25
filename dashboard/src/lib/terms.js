// 용어집(/api/glossary) 조회 (순수). 화면에는 한글 라벨을, 원래 이름과 설명은 툴팁에 쓴다.
export function term(glossary, id) {
  const entry = glossary?.[id];
  return { id, label: entry?.ko ?? id, desc: entry?.desc ?? "", known: Boolean(entry) };
}

export const TONE_LABELS = { danger: "위험", caution: "주의", safe: "안전" };

export const PAGES = [
  { key: "overview", path: "/overview", label: "개요" },
  { key: "trade", path: "/trade", label: "거래 분석" },
  { key: "trust", path: "/trust", label: "신뢰 시트" },
  { key: "ontology", path: "/ontology", label: "온톨로지" },
  { key: "report", path: "/report", label: "온체인 리포트" }
];

export function pagePath(page) {
  return PAGES.find(p => p.key === page)?.path ?? "/overview";
}
