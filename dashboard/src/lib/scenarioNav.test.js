import { describe, it, expect } from "vitest";
import { bootstrapTarget, pickNavigation, DEFAULT_SCENARIO } from "./scenarioNav.js";

const ids = ["normal", "ponzi", "rugpull", "laundering", "pumpdump"];

// Bootstrap + 패널을 흉내 내는 작은 상태 기계: 열린 예시 기록
function simulate(staticMode) {
  const state = { handled: null, selected: null, opened: [], url: "/overview" };
  const linked = () => new URLSearchParams(state.url.split("?")[1] ?? "").get("scenario");
  const bootstrap = () => {
    const target = bootstrapTarget({ linked: linked(), selected: state.selected, handled: state.handled, ids });
    if (target) { state.handled = target; state.selected = target; state.opened.push(target); }
  };
  const pick = id => {
    const { to, markSelected } = pickNavigation({ staticMode, pathname: state.url.split("?")[0], id });
    if (markSelected) { state.handled = id; state.selected = id; }
    state.url = to;
    bootstrap(); // 주소가 바뀌면 Bootstrap effect가 다시 돈다
  };
  return { state, bootstrap, pick };
}

describe("예시 전환 (주소의 ?scenario= 기준)", () => {
  it("정적 모드: 패널 클릭 → ?scenario= 변경 → 새 예시를 연다 (5개 모두, 어느 페이지에서나)", () => {
    const s = simulate(true);
    s.state.url = "/trade?scenario=rugpull&block=31";
    s.bootstrap();
    expect(s.state.opened).toEqual(["rugpull"]);
    for (const id of ["ponzi", "laundering", "pumpdump", "normal", "rugpull"]) s.pick(id);
    expect(s.state.opened).toEqual(["rugpull", "ponzi", "laundering", "pumpdump", "normal", "rugpull"]);
    expect(s.state.selected).toBe("rugpull");
    expect(s.state.url).toBe("/trade?scenario=rugpull"); // 이전 예시의 block= 재생 위치는 버린다
    s.pick("rugpull");
    expect(s.state.opened.length).toBe(6); // 같은 예시를 다시 누르면 다시 열지 않는다
  });

  it("서버 모드: 예전처럼 선택만 표시하고 자동 실행하지 않는다 (분석 실행은 버튼)", () => {
    const s = simulate(false);
    s.state.url = "/overview?scenario=rugpull";
    s.bootstrap();
    s.pick("ponzi");
    expect(s.state.selected).toBe("ponzi");
    expect(s.state.opened).toEqual(["rugpull"]);
    expect(s.state.url).toBe("/overview?scenario=ponzi");
  });

  it("첫 진입: 주소 > 저장된 선택 > 기본 예시, 잘못된 값은 무시", () => {
    expect(bootstrapTarget({ linked: "ponzi", selected: "normal", handled: null, ids })).toBe("ponzi");
    expect(bootstrapTarget({ linked: null, selected: "normal", handled: null, ids })).toBe("normal");
    expect(bootstrapTarget({ linked: "nope", selected: null, handled: null, ids })).toBe(DEFAULT_SCENARIO);
    expect(bootstrapTarget({ linked: null, selected: null, handled: "ponzi", ids })).toBe(null);
    expect(pickNavigation({ staticMode: true, pathname: "/detail/graph", id: "ponzi" }).to).toBe("/detail/graph?scenario=ponzi");
  });
});
