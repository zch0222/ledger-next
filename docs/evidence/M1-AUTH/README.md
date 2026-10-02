# M1-AUTH · 身份、账本与权限 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 环境与版本见 [M1-BASE 版本清单](../M1-BASE/VERSIONS.md) · 执行：Codex 实现、Claude Code 修复与复验（实现者自检，非独立评审）· 代码未提交，工作区即被验证版本。

## 实现入口

| 能力 | 位置 |
| --- | --- |
| Better Auth 数据库 Session（邮箱密码、12–128 位密码、Cookie 缓存关闭以保证撤销、认证限流） | `apps/web/src/lib/auth.ts` |
| AuthContext、owner / editor / viewer 授权、最后 owner 保护、ETag 版本、Origin 校验 | `packages/domain/src/policy.ts` |
| 账本 / 成员用例：先锁账本行再校验权限，成员变更、校验与审计同事务 | `packages/domain/src/identity.ts` |
| 迁移（GET_LOCK 串行、SHA-256 校验） | `packages/db/src/migrate.ts`、`packages/db/migrations/0001_identity.sql` |
| UI：登录 / 注册、首次建账本、切换账本、成员管理、退出 | `apps/web/src/app/`、`apps/web/src/components/` |

## 验收标准对照

| 验收标准 | 证据（Docker 端到端，真实 MySQL + 生产镜像） |
| --- | --- |
| 未经授权无法读取或修改另一账本任何资源 | `identity.api.ts`「tenant isolation…」：外部用户读取账本 / 成员 / 修改均 404，列表为空；「viewer/editor permissions…」：viewer 不能读成员或加人（403），editor 不能改账本设置（403），跨账本删除成员 404，移除后下一次请求立即 404；`contract.api.ts`：格式错误 ID 与他人账本审计均 404，响应不区分“不存在”与“无权” |
| 登录 / 退出 / 会话撤销、最后 owner 保护通过 | `identity.api.ts`「session login/logout revocation…」：退出后旧 Cookie 401，错误密码 401，重新登录成功；「concurrent owner demotions…」：两名 owner 并发互降，结果恰为 200 + 409 且保留 1 名 owner；`ui.spec.ts`「member UI enforces last-owner…」桌面 / 移动端显示 409 提示；新增「auth attempts are throttled per client…」 |

运行命令与结果见 [M1-API 记录](../M1-API/README.md#docker-端到端) 的同一次 `pnpm test:e2e`。

## 已知限制

- 注册面向受控自托管；邮件验证、找回密码、OIDC 未接入，UI 不显示不可用入口；添加成员仅限已注册邮箱。
- PAT / Bearer 与作用域执行属于 M6-SERVER；当前 `/api/v1` 只接受 Web Session。
