// 결론 배지 (위험 / 주의 / 근거 없음 / 판단 불가)
import { CONCLUSIONS } from "../lib/conclusion.js";
import { Badge } from "./ui.jsx";

export default function ConclusionBadge({ conclusion, title }) {
  const c = CONCLUSIONS[conclusion];
  if (!c) return null;
  return <Badge tone={c.tone} title={title ?? c.desc}>{c.label}</Badge>;
}
