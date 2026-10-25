// analyzerVersion: "<git short HEAD>+jcs-rfc8785/pbl-demo-v1". git을 못 쓰면 "unknown+...".
// root가 git 작업 트리의 최상위일 때만 HEAD를 쓴다(상위 디렉터리의 다른 저장소를 잘못 읽지 않게).
import { execFileSync } from "child_process";
import fs from "fs";
import { ANALYZER_SUFFIX } from "./schema.js";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function analyzerVersion(root) {
  let head = "unknown";
  try {
    const top = git(root, ["rev-parse", "--show-toplevel"]);
    if (fs.realpathSync(top) === fs.realpathSync(root)) head = git(root, ["rev-parse", "--short", "HEAD"]);
  } catch {
    head = "unknown";
  }
  return `${head}+${ANALYZER_SUFFIX}`;
}
