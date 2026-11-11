// 리포트 변조 확인(브라우저 무결성 검증) 훅: 개요 요약 박스와 판정 조건 하단 띠가 같이 쓴다.
// 배포된 리포트를 브라우저에서 다시 해시해 분석 시점 해시(envelope)와 비교한다(lib/verifyBrowser.js verifyIntegrity).
// 시나리오가 바뀌면 이전 검사는 취소되어 결과가 섞이지 않는다(lib/overview.js startIntegrityCheck).
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { verifyIntegrity } from "../lib/verifyBrowser.js";
import { integrityStatus, startIntegrityCheck } from "../lib/overview.js";

export function useIntegrity(data, reportId) {
  const [state, setState] = useState({ status: "checking" });
  useEffect(() => startIntegrityCheck({
    snapshot: { report: data.report, envelope: data.envelope },
    loadCanonical: () => api.canonical(reportId),
    verify: verifyIntegrity,
    onState: setState
  }), [data, reportId]);
  return integrityStatus(state);
}
