// localStorage는 편의 기능(선택 시나리오 복원 등)에만 쓴다. 비공개 창·차단 환경에서도 앱이 동작하도록 모두 try/catch.
export function readStored(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 저장 실패는 무시한다 (편의 기능)
  }
}
