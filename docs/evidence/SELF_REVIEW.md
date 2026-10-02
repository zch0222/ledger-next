# 自评估记录

依据 [AUTONOMOUS_DELIVERY](../reviews/AUTONOMOUS_DELIVERY.md)：需要评审的任务由实现者（Claude Code）逐条对照验收标准，以本机 Docker 端到端测试为依据自评估；结论不等同独立人工验收，全部列入 [MILESTONES.md](../MILESTONES.md) 的“最终人工审查清单”。

每条记录写明：验收标准 → 结论 → 证据（测试名称 / 命令）→ 留给人工审查的事项。

## 2026-10-02 · M1-AUTH、M1-API、M2-MODEL、M2-LEDGER

环境：云端 Linux 容器，Docker Engine 29.6.2，Compose v5.3.1，Node 24.21.0，pnpm 11.19.0；分支 `claude/loving-planck-dvzfpc`，基线 commit `c049221`（main）。镜像构建经 `LEDGER_BUILD_CA` 信任出站代理 CA（见 `compose.build-ca.yaml`）。

命令与结果：

- `pnpm lint`、`pnpm typecheck`：通过。
- `pnpm test:unit`：10 文件 125 测试通过；覆盖率（纯模块范围，见 vitest.config.ts）语句 99.42%、分支 96.72%、函数 99.25%、行 100%。
- `LEDGER_BUILD_CA=/root/.ccr/ca-bundle.crt pnpm test:e2e`（两次，第二次在修复测试脚本后）：迁移 0001–0004 → 回滚 0004（空表）→ 重放 → 重启持久化 PASS → MySQL 集成 24 passed → 有数据时回滚被拒绝 → Playwright 19 passed（api 13、desktop 3、mobile 3）→ web 143 / worker 0 优雅停机。

本轮发现并修正的测试设施问题：`scripts/docker-test.mjs` 在 Playwright 结束后的步骤（停机检查等）失败时仍返回 0；现已在 catch 中置失败。构建 CA 叠加文件改写到系统临时目录（Playwright 启动时会清空 `test-results/`）。

| 任务 | 验收标准 | 结论 | 证据 |
| --- | --- | --- | --- |
| M1-AUTH | 未经授权无法读取或修改另一账本任何资源 | 通过 | `identity.api.ts`「tenant isolation, CSRF, validation, ETag…」「viewer/editor permissions … cross-ledger membership and immediate revocation」；`ledger.api.ts` 外部用户读账户 404 |
| M1-AUTH | 登录 / 退出 / 会话撤销、最后 owner 保护 | 通过 | `identity.api.ts`「session login/logout revocation…」「concurrent owner demotions cannot remove the last owner」；`ui.spec.ts` 最后 owner UI |
| M1-API | 全部计划资源含 schema、scope 和错误响应 | 通过 | `pnpm contract:check`；`tests/unit/contract.test.ts`；OpenAPI 83 个操作均有 security / x-ledger-role / 错误响应 |
| M1-API | 状态码、cursor 篡改、412、重复提交契约测试 | 通过 | `contract.api.ts` 5 个用例（错误状态、游标绑定与篡改、Idempotency-Key 重放、SDK） |
| M2-MODEL | JPY / 三位小数 / 大额 / 0.1+0.2 无精度错误 | 通过 | `tests/unit/money.test.ts`；`ledger-core.test.ts`「stores boundary amounts…」「keeps 0.1 + 0.2 exact…」 |
| M2-MODEL | 跨账本外键拒绝，迁移可应用并有恢复方案 | 通过 | `ledger-core.test.ts`「rejects cross-ledger …」；E2E 回滚演练（空表回滚、重放、有数据拒绝） |
| M2-LEDGER | 重复提交仅影响一次余额 | 通过 | `ledger.api.ts`「a duplicated submission moves money once…」（6 并发同键）；`transactions.test.ts` 事务失败无残留 |
| M2-LEDGER | 转账本金不计收支，退款不记收入；并发与冲正测试通过 | 通过 | `ledger.api.ts`「transfers, refunds, corrections and voids…」；`transactions.test.ts` 转账手续费、并发退款上限、更正、作废、12 并发提交 |

留给人工审查：远程 GitHub Actions 结果（本轮只在本机 Docker 执行）；按 M1-AUTH 证据文档人工抽查登录、成员 UI。
