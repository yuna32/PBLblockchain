// 완화 레이어 문구 시험: 히어로 완화 문구(사후 분석과 맞는 표현), 추론 그래프 권고 조치 노드 라벨(개발자용).
import { describe, it, expect } from "vitest";
import { VALUE_LINES } from "./hero.js";
import { KIND_LABELS } from "./ontology.js";

describe("완화 문구", () => {
  it("히어로 완화 문구에 사후 분석과 맞지 않는 표현이 없다", () => {
    const m = VALUE_LINES.find(v => v.key === "mitigate");
    expect(m.text).toBe("판단 근거와 이상이 처음 보인 시점을 보여 줘, 어떤 경고 신호를 확인해야 하는지 알 수 있게 돕습니다");
    expect(m.text).not.toMatch(/피해가 커지기 전에|실시간|미리 막/);
  });

  it("추론 그래프 권고 조치 노드 라벨은 개발자용 코드 수정 권고로 분명히", () => {
    expect(KIND_LABELS.patch).toBe("개발자용 코드 수정 권고");
  });
});
