// API 오류 (서버 모드·정적 모드 공통)
export class ApiError extends Error {
  constructor(message, { status = null, code = null, network = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.network = network;
  }
}
