/** A failed REST call with the problem+json details (status, stable code, field errors, request id). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string | undefined,
    public errors: { path: string; message: string; code?: string }[] = [],
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError('网络连接中断，请检查网络后重试', 0, 'NETWORK');
  }
  if (response.status === 204) return undefined as T;
  const value = await response.json().catch(() => ({}));
  const authErrors: Record<string, string> = {
    INVALID_EMAIL_OR_PASSWORD: '邮箱或密码不正确',
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: '该邮箱已注册，请直接登录',
    USER_ALREADY_EXISTS: '该邮箱已注册，请直接登录',
    PASSWORD_TOO_SHORT: '密码至少需要 12 位',
    TOO_MANY_REQUESTS: '尝试次数过多，请稍后再试',
  };
  // The auth throttle answers 429 without an error code.
  if (!response.ok) {
    throw new ApiError(
      value.title ||
        authErrors[response.status === 429 ? 'TOO_MANY_REQUESTS' : value.code] ||
        (url.startsWith('/api/auth/') ? '验证失败，请检查输入后重试' : '操作失败，请重试'),
      response.status,
      value.code,
      value.errors,
      value.requestId,
    );
  }
  return (value.data ?? value) as T;
}

/** Random hex key; getRandomValues also works on plain-HTTP origins, where crypto.randomUUID is unavailable. */
export const randomKey = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

// One Idempotency-Key per user intent: resubmitting the same payload (e.g. after a lost response) reuses the key,
// so the server replays the first result instead of creating a duplicate. getRandomValues also works on plain-HTTP origins.
export function intent() {
  let current: { key: string; payload: string } | null = null;
  return {
    key(payload: string) {
      if (current?.payload !== payload) current = { key: randomKey(), payload };
      return current.key;
    },
    done() {
      current = null;
    },
  };
}
