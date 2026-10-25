// 진행 표시(입력 → 분석 → 온체인 기록 → 시각화)와 작업 단계(시뮬레이션 → 분석 → 해시). 순수 함수.

// state: done | current | running | pending | disabled | error
export function flowSteps({ scenario, job, hasReport }) {
  const running = job && (job.status === "queued" || job.status === "running");
  const failed = job && job.status === "error";
  return [
    { key: "input", label: "입력", sub: "시나리오", state: scenario ? "done" : "current" },
    { key: "analysis", label: "분석", sub: "정적·동적·예방·신뢰",
      state: running ? "running" : failed ? "error" : hasReport ? "done" : "pending" },
    { key: "onchain", label: "온체인 기록", sub: "다음 단계에서 연결", state: "disabled" },
    { key: "visualize", label: "시각화", sub: "대시보드",
      state: hasReport && !running ? "done" : "pending" }
  ];
}

const STAGES = [
  { key: "simulate", label: "시뮬레이션" },
  { key: "analyze", label: "분석" },
  { key: "hash", label: "해시" }
];

// job: /api/jobs/:id 응답. fixture 모드는 시뮬레이션을 건너뛴다.
export function stageSteps(job) {
  if (!job) return STAGES.map(s => ({ ...s, state: "pending" }));
  const seen = new Set(job.stages ?? []);
  return STAGES.map(s => {
    if (s.key === "simulate" && job.mode === "fixture") return { ...s, state: "skipped" };
    if (job.status === "done") return { ...s, state: seen.has(s.key) ? "done" : "skipped" };
    if (job.stage === s.key) return { ...s, state: job.status === "error" ? "error" : "running" };
    if (seen.has(s.key)) return { ...s, state: "done" };
    return { ...s, state: job.status === "error" ? "error" : "pending" };
  });
}
