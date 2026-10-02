export type Role = 'owner' | 'editor' | 'viewer';
export type FieldError = { path: string; message: string; code?: string };
export class DomainError extends Error {
  /** `extra` adds documented problem+json members (e.g. the approval to wait for). */
  constructor(public status: number, public code: string, message: string, public headers: Record<string, string> = {}, public errors?: FieldError[], public extra?: Record<string, unknown>) { super(message); }
}
export function requireRole(role: Role | undefined, required: Role = 'viewer') {
  if (!role) throw new DomainError(404, 'NOT_FOUND', '账本不存在或你没有访问权限');
  const rank = { viewer: 0, editor: 1, owner: 2 };
  if (rank[role] < rank[required]) throw new DomainError(403, 'FORBIDDEN', '你没有执行此操作的权限');
}
export function requireVersion(header: string | null, version: number) {
  if (!header) throw new DomainError(428, 'PRECONDITION_REQUIRED', '请先读取最新版本');
  if (header !== `"v${version}"`) throw new DomainError(412, 'VERSION_CONFLICT', '内容已经更新，请刷新后重试');
}
export function protectLastOwner(current: Role, next: Role | null, owners: number) {
  if (current === 'owner' && next !== 'owner' && owners <= 1) throw new DomainError(409, 'LAST_OWNER', '账本至少需要保留一位所有者');
}
export function requireOrigin(origin: string | null, expected: string) {
  if (origin !== new URL(expected).origin) throw new DomainError(403, 'INVALID_ORIGIN', '请求来源验证失败');
}
