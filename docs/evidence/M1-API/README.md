# M1-API · OpenAPI、错误模型与 REST SDK · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 环境与版本见 [M1-BASE 版本清单](../M1-BASE/VERSIONS.md)（新增 openapi-typescript 7.13.0、openapi-fetch 0.17.0、ajv 8.20.0、ajv-formats 3.0.1）· 执行：Claude Code（实现者自检，非独立评审）· 代码未提交。

## 交付

| 步骤 | 实现 |
| --- | --- |
| 契约资源表 → OpenAPI 3.1 | `packages/contracts/src/{common,identity,finance,planning,platform}.ts` 用 Zod 定义请求 / 响应组件；`operations.ts` 为 83 个操作的注册表（路径、方法、`x-ledger-role`、PAT 作用域或仅 Session、查询参数、请求体、成功状态与响应头、Idempotency-Key 要求、业务冲突码、`x-stability` / `x-milestone`）；`openapi.ts` 生成 [openapi.json](../../../packages/contracts/openapi.json)（53 路径、149 个 schema，每个操作自动带齐 401/403/404/409/412/413/415/422/428/429/501/503 中适用的 problem+json 响应） |
| validation、分页、ETag、幂等、problem+json | `apps/web/src/lib/api/router.ts` 由同一注册表路由：认证 → 匹配（404 / 405+Allow）→ 格式错误 ID 视同不存在 → Origin / 内容类型 → planned 返回 501 → 严格查询参数校验（422）→ 用例；`packages/domain/src/cursor.ts` HMAC 签名的 keyset 游标；`packages/domain/src/idempotent.ts` + 迁移 `0002_idempotency.sql`：键记录与业务写入同事务，并发同 key 串行化；`handlers.ts` 以 `Record<StableOperationId, Handler>` 编译期保证 stable 操作全部有实现 |
| SDK + 破坏性变更 CI | `packages/api-client`：openapi-typescript 生成 `schema.d.ts`，openapi-fetch 运行时；`pnpm contract:check --base-ref <基线>`（`compat.ts`）比较 stable 操作，已接入 `.github/workflows/ci.yml` |

stable（已实现）操作 10 个：getMe、listLedgers、createLedger、getLedger、updateLedger、listMemberships、createMembership、updateMembership、deleteMembership、listAuditEvents。其余 73 个为 planned，契约完整但返回 501，实现时随对应里程碑调整。

## 验收标准对照

| 验收标准 | 结果 | 证据 |
| --- | --- | --- |
| 全部计划资源含 schema、scope 和错误响应 | 通过（静态） | `tests/unit/contract.test.ts`：API_AGENT_CONTRACT §2 每一类路径存在；每个操作有 security、401/429/503、带参数路径有 404、PATCH/DELETE 有 412、幂等操作有 409、planned 有 501；全部 `$ref` 可解析；生成文件与提交一致 |
| 状态码、cursor 篡改、412、重复提交契约测试通过 | 通过（Docker） | `tests/e2e/contract.api.ts`，见下文；所有响应经 ajv 按 openapi.json 校验，状态码必须在该操作中声明 |

## 质量命令

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` | 通过 |
| `pnpm test:unit` | 7 文件 77 测试通过；覆盖范围 policy / cursor / idempotency / contracts / theme：语句 99.34%、分支 96.77%、函数 99.09%、行 100% |
| `pnpm contract:check` | `契约一致：53 个路径，10 个 stable 操作`；破坏性变更检测由 `tests/unit/compat.test.ts` 覆盖 18 类破坏性变更、可兼容的新增与 planned 豁免 |

## Docker 端到端

`pnpm test:e2e`：生产镜像、独立 MySQL 卷、迁移重放（含 0002）、持久化种子、重启 mysql/redis/web/worker 后校验，再运行 Playwright（api / desktop / mobile）。

新增 `contract.api.ts` 5 项：

1. 10 个 stable 操作的正常响应全部符合契约；审计事件新到旧排列。
2. 401、404（未知 / 格式错误 ID）、415、400（坏 JSON）、413、422（正文与 limit=0/101/abc、未知查询参数）、428、412、403（Origin）、501（planned 的 GET 与带幂等键的 POST）、405 + `Allow: GET, POST`、未知路径 problem+json。
3. 游标：limit=1 翻完 3 页且无重复；审计按 action 过滤翻页；篡改签名、换筛选、换账本、换列表、垃圾值、他人使用均 400 INVALID_CURSOR。
4. 幂等：同 key 同体重放（同 id、同 Location、`Idempotent-Replayed: true`、新的 requestId）；同 key 不同体 409；另一用户同 key 互不影响；非法 key 400；6 个并发同 key 请求只建 1 个账本且 5 个为重放；失败请求不留记录，可用同 key 提交更正；添加成员重试回放而非 409；审计只有一次创建。
5. 生成的 SDK 访问真实服务：读取身份、带幂等键创建、If-Match 修改、过期版本得到类型化 412 VERSION_CONFLICT、成员分页、重放、匿名 401。

## 运行记录

最终一次 `pnpm test:e2e`（2026-10-02，项目 `ledger-e2e-41228`）：

- 镜像构建通过；迁移 0001、0002 应用，重放输出 `MySQL migrations up to date`；重启后 `PASS: user, authentication and ledger persisted through Docker restart`。
- Playwright：**16 passed**（api 10：contract 5 + identity 5；desktop 3；mobile 3），0 failed。
- 停机：web 退出码 143（Next 排空连接后的设计值），worker 0；测试项目与卷已清理。

调试过程中的失败及处理：坏 JSON 用例最初以字符串发送，被 Playwright 编码为合法 JSON 字符串而得到 422（服务端行为正确），改为原始字节后通过；测试容器中的 `pnpm run` 每次因构建期 store 不存在而从 registry 重装依赖，改为直接运行 Playwright。

## 已知限制

- PAT / Bearer、作用域执行与 `x-ledger-role` 之外的 scope 校验属于 M6-SERVER；当前只接受 Web Session，PAT 请求得到 401。
- 远程 CI 尚未运行（代码未推送）。
- `about:blank` problem type 搭配本地化 title；机器处理以 `code` 为准。
