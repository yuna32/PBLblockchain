// 첫 진입과 딥링크 처리: #/trade?scenario=ponzi 처럼 열면 그 시나리오의 사전 생성본(fixture)을 자동 로드한다.
// 딥링크가 없으면 저장된 선택 시나리오, 그것도 없으면 rugpull(기본 예시)을 fixture로 로드해 빈 화면이 없게 한다.
// 주소의 ?scenario=가 바뀌면(정적 모드의 패널 클릭·히어로 예시 버튼) 새 예시를 연다. 규칙은 lib/scenarioNav.js.
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useApp } from "./AppContext.jsx";
import { bootstrapTarget } from "../lib/scenarioNav.js";

export default function Bootstrap() {
  const { scenarios, selected, selectScenario, analyze, handledScenario } = useApp();
  const [params] = useSearchParams();
  const linked = params.get("scenario");

  useEffect(() => {
    if (!scenarios.length) return;
    const target = bootstrapTarget({ linked, selected, handled: handledScenario.current, ids: scenarios.map(s => s.id) });
    if (!target) return;
    selectScenario(target);
    analyze(target, "fixture");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, scenarios]);

  return null;
}
