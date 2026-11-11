// 예시(시나리오) 전환 규칙 (순수 함수). 주소의 ?scenario=가 기준이다.
//   정적 모드: 패널 클릭은 ?scenario=만 바꾸는 이동이고, Bootstrap이 주소 변화를 보고 스냅샷을 연다.
//   서버 모드: 예전과 같이 선택만 표시하고(Bootstrap이 자동 실행하지 않음) 사용자가 "분석 실행"을 누른다.

export const DEFAULT_SCENARIO = "rugpull";

// 패널에서 예시를 눌렀을 때: 이동할 주소와, 이동 전에 선택을 직접 표시할지(서버 모드만)
// 다른 쿼리(예: 거래 분석의 block=)는 버려서 이전 예시의 재생 위치가 남지 않게 한다.
export function pickNavigation({ staticMode, pathname, id }) {
  return { to: `${pathname}?scenario=${encodeURIComponent(id)}`, markSelected: !staticMode };
}

// Bootstrap: 주소(linked)·저장된 선택(selected)·이미 처리한 예시(handled) → 새로 열 예시 (없으면 null)
export function bootstrapTarget({ linked, selected, handled, ids, fallback = DEFAULT_SCENARIO }) {
  const valid = id => ids.includes(id);
  let target = null;
  if (valid(linked)) target = linked;
  else if (handled === null) target = valid(selected) ? selected : fallback;
  if (!target || target === handled) return null;
  return target;
}
