// 첫 진입과 딥링크 처리: #/trade?scenario=ponzi 처럼 열면 그 시나리오의 사전 생성본(fixture)을 자동 로드한다.
// 딥링크가 없으면 저장된 선택 시나리오, 그것도 없으면 normal을 fixture로 로드해 빈 화면이 없게 한다.
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useApp } from "./AppContext.jsx";

export default function Bootstrap() {
  const { scenarios, selected, selectScenario, analyze, handledScenario } = useApp();
  const [params] = useSearchParams();
  const linked = params.get("scenario");

  useEffect(() => {
    if (!scenarios.length) return;
    const valid = id => scenarios.some(s => s.id === id);
    let target = null;
    if (valid(linked)) target = linked;
    else if (handledScenario.current === null) target = valid(selected) ? selected : "normal";
    if (!target || target === handledScenario.current) return;
    selectScenario(target);
    analyze(target, "fixture");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, scenarios]);

  return null;
}
