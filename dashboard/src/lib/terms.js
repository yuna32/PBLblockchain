// 용어집(/api/glossary) 조회 (순수). 화면에는 한글 라벨을, 원래 이름과 설명은 툴팁에 쓴다.
export function term(glossary, id) {
  const entry = glossary?.[id];
  return { id, label: entry?.ko ?? id, desc: entry?.desc ?? "", known: Boolean(entry) };
}

export const TONE_LABELS = { danger: "위험", caution: "주의", safe: "안전" };

// 상단 탭. 배포자 위험도(pages/Deployer.jsx)는 예전 신뢰 시트 자리라 경로(/trust)와 key는 그대로 둔다.
export const PAGES = [
  { key: "overview", path: "/overview", label: "개요" },
  { key: "trade", path: "/trade", label: "거래 분석" },
  { key: "trust", path: "/trust", label: "배포자 위험도" },
  { key: "detail", path: "/detail", label: "상세 분석" }
];

// 상세 분석 하위 메뉴 (왼쪽 세로 메뉴)
export const DETAIL_PAGES = [
  { key: "conditions", path: "/detail/conditions", label: "판정 조건" },
  { key: "graph", path: "/detail/graph", label: "추론 그래프" },
  { key: "report", path: "/detail/report", label: "리포트 변조 확인" },
  { key: "raw", path: "/detail/raw", label: "원자료" }
];

// 예전 페이지 키(viewmodel headline.reasons[].page 등) → 새 위치
const PAGE_ALIASES = { ontology: "graph" };

export function pagePath(page) {
  const key = PAGE_ALIASES[page] ?? page;
  return PAGES.find(p => p.key === key)?.path ?? DETAIL_PAGES.find(p => p.key === key)?.path ?? "/overview";
}
