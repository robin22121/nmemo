// `/api/*` 로그인 정보(기기에 저장) + 앱 안 로그인 칸을 여는 신호.
// 저장 형식: localStorage `kk.auth` = base64("아이디:비밀번호", UTF-8). 요청마다 `Authorization: Basic ...`로 붙인다.

export const AUTH_KEY = 'kk.auth';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // 사파리 개인 정보 보호 모드 등
  }
}

/** "아이디:비밀번호"를 UTF-8 base64로(미들웨어가 TextDecoder로 푼다) */
export function encodeCredentials(id: string, pw: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(`${id}:${pw}`)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function saveCredentials(id: string, pw: string, store: Store | null = defaultStore()): void {
  store?.setItem(AUTH_KEY, encodeCredentials(id, pw));
}

export function clearCredentials(store: Store | null = defaultStore()): void {
  store?.removeItem(AUTH_KEY);
}

export function hasCredentials(store: Store | null = defaultStore()): boolean {
  return !!store?.getItem(AUTH_KEY);
}

/** 저장된 로그인 정보가 있으면 `{authorization}` 헤더, 없으면 빈 객체 */
export function authHeaders(store: Store | null = defaultStore()): Record<string, string> {
  const v = store?.getItem(AUTH_KEY);
  return v ? { authorization: `Basic ${v}` } : {};
}

// ── 로그인 칸 열기 신호: "나중에"를 누르면 다음 실행 전까지 다시 열지 않는다 ──
let dismissed = false;
const listeners = new Set<() => void>();

export function requestLogin(): void {
  if (dismissed) return;
  for (const l of listeners) l();
}

export function onLoginRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function dismissLogin(): void {
  dismissed = true;
}
