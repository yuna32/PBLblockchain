// 시험 전용: demo/fixtures 5개를 서버 응답과 같은 형태로 읽는다 (앱 번들에는 들어가지 않는다).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { toTimeseries } from "../../../demo/lib/timeseries.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const SCENARIO_IDS = ["normal", "ponzi", "rugpull", "laundering", "pumpdump"];
const CSV = { normal: "normal_log.csv", ponzi: "ponzi_log.csv", rugpull: "rugpull_log.csv", laundering: "laundering_log.csv", pumpdump: "pumpdump_log.csv" };

export function loadFixture(name) {
  const dir = path.join(ROOT, "demo", "fixtures", name);
  return {
    report: JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")),
    envelope: JSON.parse(fs.readFileSync(path.join(dir, "envelope.json"), "utf8")),
    rows: toTimeseries(fs.readFileSync(path.join(dir, CSV[name]), "utf8"))
  };
}
