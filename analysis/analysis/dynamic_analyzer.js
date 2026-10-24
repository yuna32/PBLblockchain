import fs from "fs";
import os from "os";
import path from "path";
import { analyzeDynamic as analyzeMain } from "../dynamic_analyzer.js";

// 중첩 흐름 ③의 9열 로그 action을 메인 8열 어휘로 맞춘다 (PROPOSAL S7 ②).
//   withdraw_attempt (from=사용자, to=컨트랙트, 금액 0) → withdraw (from=컨트랙트, to=사용자, 금액 0)
//   owner_collect → owner_withdraw_all
// withdraw_success 열은 읽는 코드가 없어 그대로 둔다.
function normalizeLines(lines) {
  const headers = lines[0].split(",");
  const iA = headers.indexOf("action"), iF = headers.indexOf("from"), iT = headers.indexOf("to");
  let changed = false;
  const out = [lines[0]];
  for (const line of lines.slice(1)) {
    const v = line.split(",");
    if (v[iA] === "withdraw_attempt") { [v[iF], v[iT]] = [v[iT], v[iF]]; v[iA] = "withdraw"; changed = true; }
    else if (v[iA] === "owner_collect") { v[iA] = "owner_withdraw_all"; changed = true; }
    out.push(v.join(","));
  }
  return { lines: out, changed };
}

export function analyzeDynamic(csvPath) {
  if (!fs.existsSync(csvPath)) return analyzeMain(csvPath);
  const lines = fs.readFileSync(csvPath, "utf8").trim().split("\n");
  const { lines: norm, changed } = normalizeLines(lines);
  if (!changed) return analyzeMain(csvPath);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nested-dyn-"));
  const tmp = path.join(dir, path.basename(csvPath));
  try {
    fs.writeFileSync(tmp, norm.join("\n") + "\n");
    return analyzeMain(tmp);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
