// demo/fixtures/<scenario>/ 를 현재 코드로 다시 만든다 (CSV, report.json, envelope.json).
// 시뮬레이션이 실패하면 폴백하지 않고 멈춘다. laundering은 DEFAULT_SEED로 고정된다.
//
// 사용법: node demo/build_fixtures.js [출력 디렉터리 (기본 demo/fixtures)]

import path from "path";
import { SCENARIOS, FIXTURES_DIR, runScenario } from "./run.js";

const outRoot = path.resolve(process.argv[2] ?? FIXTURES_DIR);

for (const name of Object.keys(SCENARIOS)) {
  const r = await runScenario(name, path.join(outRoot, name), { allowFallback: false });
  console.log(`${name.padEnd(10)} ${r.source}  report_sha256=${r.envelope.report_sha256}  → ${r.outDir}`);
}
