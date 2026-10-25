// 백엔드 오류: code로 구분한다. 메시지에는 키·RPC 주소를 넣지 않는다(넣더라도 서버가 redact로 가린다).
export class BackendError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// 서버 응답 상태 코드
export const BACKEND_ERROR_STATUS = {
  backend_read_only: 409,
  insufficient_funds: 409,
  schema_not_registered: 409,
  chain_mismatch: 409,
  contract_not_found: 409,
  tx_reverted: 502,
  tx_failed: 502,
  tx_unconfirmed: 504,
  rpc_unavailable: 503
};
