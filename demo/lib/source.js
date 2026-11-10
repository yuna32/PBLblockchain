// 컨트랙트 소스(원자료 화면용): envelope.input.sol.file → contracts/<파일>을 읽어 정규화한 본문과 해시.
// 정적 스냅샷(demo/export.js의 <시나리오>/source.json)과 서버(GET /api/report/:id/source)가 같이 쓴다. 읽기 전용.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeSol, sha256Hex, SOL_NORMALIZATION } from "./canonical.js";

export const CONTRACTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts");

// 반환: { file, normalization, sha256, matchesEnvelope, text }. matchesEnvelope는 분석 시점 해시(envelope)와 같은지.
export function contractSource(envelope, { contractsDir = CONTRACTS_DIR } = {}) {
  const file = path.basename(String(envelope?.input?.sol?.file ?? ""));
  if (!/^[A-Za-z0-9_]+\.sol$/.test(file)) throw new Error(`컨트랙트 파일 이름이 올바르지 않습니다: ${file || "(없음)"}`);
  const text = normalizeSol(fs.readFileSync(path.join(contractsDir, file), "utf8"));
  const sha256 = sha256Hex(text);
  return { file, normalization: SOL_NORMALIZATION, sha256, matchesEnvelope: sha256 === envelope.input.sol.sha256, text };
}
