// 시연 API 클라이언트. 개발 서버는 /api를 시연 API(npm run demo:server)로 프록시한다.

export class ApiError extends Error {
  constructor(message, { status = null, code = null, network = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.network = network;
  }
}

async function request(path, options) {
  let res;
  try {
    res = await fetch(`/api${path}`, options);
  } catch {
    throw new ApiError("서버에 연결할 수 없습니다.", { network: true });
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    // 프록시 대상이 꺼져 있으면 오류 코드 없는 5xx가 온다
    const network = res.status >= 500 && !body?.code;
    throw new ApiError(network ? "서버에 연결할 수 없습니다." : body?.error ?? `HTTP ${res.status}`,
      { status: res.status, code: body?.code ?? null, network });
  }
  return body;
}

export const api = {
  health:     () => request("/health"),
  scenarios:  () => request("/scenarios"),
  glossary:   () => request("/glossary"),
  analyze:    (scenario, mode) => request("/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, mode })
  }),
  job:        id => request(`/jobs/${encodeURIComponent(id)}`),
  report:     id => request(`/report/${encodeURIComponent(id)}`),
  timeseries: id => request(`/report/${encodeURIComponent(id)}/timeseries`),
  ontology:   id => request(`/report/${encodeURIComponent(id)}/ontology`),
  canonical:  id => request(`/report/${encodeURIComponent(id)}/canonical`)
};
