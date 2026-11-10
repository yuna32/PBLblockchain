// 상세 분석: 왼쪽 세로 하위 메뉴(판정 조건 / 추론 그래프 / 리포트 변조 확인 / 원자료) + 오른쪽 내용.
// 좁은 화면에서는 하위 메뉴가 위쪽 가로 줄로 바뀐다.
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { FileText, GitFork, ListChecks, ShieldCheck } from "lucide-react";
import { useApp } from "../../state/AppContext.jsx";
import { DETAIL_PAGES } from "../../lib/terms.js";
import { ICON, StatusView } from "../../components/ui.jsx";

const DETAIL_ICONS = { conditions: ListChecks, graph: GitFork, report: ShieldCheck, raw: FileText };

export default function DetailLayout() {
  const { selected } = useApp();
  const { search } = useLocation();
  const query = selected ? `?scenario=${selected}` : search;
  return (
    <div className="detail">
      <nav className="detail-nav" aria-label="상세 분석">
        <div className="detail-nav-title">상세 분석</div>
        {DETAIL_PAGES.map(p => {
          const Icon = DETAIL_ICONS[p.key];
          return (
            <NavLink key={p.key} to={`${p.path}${query}`} className={({ isActive }) => `detail-nav-link ${isActive ? "on" : ""}`}>
              <Icon {...ICON} size={17} />
              <span>{p.label}</span>
            </NavLink>
          );
        })}
      </nav>
      <div className="detail-body">
        <Outlet />
      </div>
    </div>
  );
}

// 아직 만들지 않은 하위 화면 자리 (S7에서 채운다)
export function DetailPending({ title }) {
  return (
    <div className="page">
      <StatusView kind="empty" title={`${title} 화면은 준비 중입니다`} />
    </div>
  );
}
