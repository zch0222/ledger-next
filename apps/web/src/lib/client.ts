export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (response.status === 204) return undefined as T;
  const value = await response.json();
  const authErrors: Record<string, string> = {
    INVALID_EMAIL_OR_PASSWORD: '邮箱或密码不正确',
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: '该邮箱已注册，请直接登录',
    USER_ALREADY_EXISTS: '该邮箱已注册，请直接登录',
    PASSWORD_TOO_SHORT: '密码至少需要 12 位',
    TOO_MANY_REQUESTS: '尝试次数过多，请稍后再试',
  };
  // The auth throttle answers 429 without an error code.
  if (!response.ok) throw new Error(value.title || authErrors[response.status === 429 ? 'TOO_MANY_REQUESTS' : value.code] || (url.startsWith('/api/auth/') ? '验证失败，请检查输入后重试' : '操作失败，请重试'));
  return (value.data ?? value) as T;
}

// One Idempotency-Key per user intent: resubmitting the same payload (e.g. after a lost response) reuses the key,
// so the server replays the first result instead of creating a duplicate. getRandomValues also works on plain-HTTP origins.
export function intent() {
  let current: { key: string; payload: string } | null = null;
  return {
    key(payload: string) {
      if (current?.payload !== payload) current = { key: Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''), payload };
      return current.key;
    },
    done() { current = null; },
  };
}
