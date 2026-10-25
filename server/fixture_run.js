// mode: "fixture" — 시뮬레이션 없이 demo/fixtures/<scenario>/의 CSV로 분석한다.
// demo/run.js runScenario의 폴백 경로와 같은 순서·같은 결과 형태다(run.js는 onStage 외에 바꾸지 않기로 해서 여기 둔다).
import fs from "fs";
import path from "path";
import { SCENARIOS, FIXTURES_DIR } from "../demo/run.js";
import { buildReport } from "../analysis/pipeline.js";
import { buildEnvelope } from "../demo/lib/canonical.js";
import { parseCsv } from "../demo/lib/csv.js";
import { computeOnset } from "../demo/lib/onset.js";

export async function runFixture(name, outDir, options = {}) {
  const spec = SCENARIOS[name];
  if (!spec) throw new Error(`알 수 없는 시나리오: ${name} (가능한 값: ${Object.keys(SCENARIOS).join(", ")})`);
  const { onStage = () => {} } = options;

  const fixtureDir = path.join(FIXTURES_DIR, name);
  const fixtureCsv = path.join(fixtureDir, spec.csv);
  if (!fs.existsSync(fixtureCsv)) throw new Error(`[${name}] fixture 없음: ${fixtureCsv}`);

  outDir = path.resolve(outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, spec.csv);
  fs.copyFileSync(fixtureCsv, csvPath);
  const fixtureEnvelope = path.join(fixtureDir, "envelope.json");
  const seed = fs.existsSync(fixtureEnvelope)
    ? JSON.parse(fs.readFileSync(fixtureEnvelope, "utf8")).input?.seed ?? null
    : null;

  onStage("analyze", { source: "fixture" });
  const { report, solPath } = await buildReport(spec.contract, { csvPath });
  const csvText = fs.readFileSync(csvPath, "utf8");
  const solText = fs.readFileSync(solPath, "utf8");
  onStage("hash", { source: "fixture" });
  const envelope = buildEnvelope({
    scenario: name,
    contract: spec.contract,
    source: "fixture",
    report,
    csvText,
    csvFile: spec.csv,
    solText,
    solFile: path.basename(solPath),
    seed
  });
  const onset = computeOnset(parseCsv(csvText), report.dynamic);

  const files = {
    csv:      csvPath,
    report:   path.join(outDir, "report.json"),
    envelope: path.join(outDir, "envelope.json")
  };
  fs.writeFileSync(files.report, JSON.stringify(report, null, 2));
  fs.writeFileSync(files.envelope, JSON.stringify(envelope, null, 2));

  return {
    scenario: name,
    contract: spec.contract,
    source: "fixture",
    fallback_reason: null,
    node: null,
    outDir,
    files,
    envelope,
    report,
    onset
  };
}
