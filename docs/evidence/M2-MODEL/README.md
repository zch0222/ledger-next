# M2-MODEL · 账务 schema 与金额运算 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 版本见 [M1-BASE 版本清单](../M1-BASE/VERSIONS.md)（decimal.js 10.6.0）· 执行：Claude Code（实现者自检，非独立评审）· 分支 `claude/m1-foundation`。

## 交付

| 步骤 | 实现 |
| --- | --- |
| 账户、交易、posting、快照、审计、outbox 迁移与约束 | [0003_ledger_core.sql](../../../packages/db/migrations/0003_ledger_core.sql)：currencies、accounts、categories、tags、transactions、transaction_tags、transaction_amounts、account_postings、fx_snapshots、outbox_events（审计沿用 0001 的 audit_logs）。所有账本内引用为 `(ledger_id, id)` 复合外键；posting 的 `(ledger_id, account_id, currency)` 外键强制与账户币种一致；账务表 RESTRICT 账本删除；CHECK 覆盖正金额、非零 posting、非转账必须有账户、转账无账户 / 分类、退款 ⇔ 关联原交易、作废 ⇔ voided_at、外币基准金额必须有快照、快照汇率 > 0 且币对不同、人工汇率必须有理由；`posting_reverses_uq` 保证每行只能被冲正一次 |
| decimal、币种精度、舍入与余额计算 | [money.ts](../../../packages/domain/src/money.ts)：私有 64 位精度 Decimal，HALF_EVEN；按 ISO minor units 校验并规范化金额（多余小数拒绝、不截断；拒绝科学计数、前导零、空格、+ 号）；DECIMAL(24,6) / (38,18) 范围检查；同批交叉汇率 R(C)/R(U) 取 18 位；按 kind 决定 posting 符号；余额 = 期初 + posting。[postings.ts](../../../packages/domain/src/postings.ts)：`appendPostings` 按账户 ID 逐个 `FOR UPDATE`，同事务写 posting 与余额缓存；`verifyBalance` 用 MySQL 精确 SUM 重算核对 |
| 多币种边界 fixtures | [tests/fixtures/money.ts](../../../tests/fixtures/money.ts)：JPY（0 位）、KWD（3 位，仅测试不启用）、18 位整数大额、HALF_EVEN 半值、极小汇率、交叉汇率；单元测试与 MySQL 集成测试共用 |
| 迁移恢复方案 | [down/0003_ledger_core.sql](../../../packages/db/migrations/down/0003_ledger_core.sql) + [rollback.ts](../../../packages/db/src/rollback.ts)：需 `LEDGER_ROLLBACK_CONFIRM`，只回滚最近一个迁移，`requires-empty` 所列表有数据即拒绝；迁移校验和先统一 LF，Windows / Linux 检出一致 |

## 验收标准对照

| 验收标准 | 结果 | 证据 |
| --- | --- | --- |
| JPY / 三位小数 / 大额 / 0.1+0.2 不产生精度错误 | 通过 | `tests/unit/money.test.ts`（45 项）；`tests/integration/ledger-core.test.ts`：边界金额与汇率在 DECIMAL 中无损往返，0.10 + 0.20 在 posting 与 SQL 重算中均为 0.30，JPY 1500.5 / KWD 0.0005 被拒绝 |
| 跨账本外键拒绝，迁移可应用并有恢复方案 | 通过 | 集成测试对账户、分类父级、退款原交易、posting 的交易 / 账户 / 币种、标签、汇率快照逐一验证跨账本引用得到 `ER_NO_REFERENCED_ROW_2`；有账务数据的账本不可删除；`test:e2e` 演练空表回滚 → 重新应用 → 有数据时回滚被拒绝 |

另：25 个并发写入同一账户无丢失更新；30 个反向并发转账无死锁、总额守恒；人为改动余额缓存可被 `verifyBalance` 发现。

## 运行记录

本机：`pnpm lint`、`pnpm typecheck` 通过；`pnpm test:unit` 9 文件 124 测试通过（覆盖范围新增 money.ts、migrate-files.ts：语句 99.41%、分支 97.14%、行 100%）；`pnpm contract:check` 通过（币种表重构后 OpenAPI 未变）。

最终一次 `pnpm test:e2e`（2026-10-02）：迁移 0001–0003 应用 → `Rolled back 0003_ledger_core.sql` → `Applied 0003_ledger_core.sql` → 重启持久化 PASS → MySQL 集成 **13 passed** → `Rollback with ledger data refused as expected` → Playwright **16 passed** → web 143 / worker 0 停机，测试项目与卷已清理。

调试中发现并修复：`verifyBalance` 最初用相关子查询，Drizzle 对单表查询输出不带表名的列，子查询中的 `ledger_id` / `id` 被绑定到 account_postings 自身，重算值恒为期初余额（5 项集成测试因此失败）；改为独立聚合查询后通过。

## 已知限制

- posting 只追加、不改写由领域代码保证；数据库层触发器需要 SUPER 或 `log_bin_trust_function_creators`，自托管 MySQL 未必允许，留待 M7-SEC 评估独立迁移账号 / 权限方案。
- fx_batches / fx_rates、write_previews 属于 M3-FX、M2-LEDGER；收支 / 转账 / 退款 API 尚未开放。
