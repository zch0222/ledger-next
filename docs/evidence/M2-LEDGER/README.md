# M2-LEDGER · 收支、转账、退款与更正 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 版本见 [M1-BASE 版本清单](../M1-BASE/VERSIONS.md) · 执行：Claude Code（实现者自检，非独立评审）· 分支 `claude/m1-foundation`。

## 交付

| 步骤 | 实现 |
| --- | --- |
| 预览、事务写入、同键重放和版本控制 | 迁移 [0004_previews.sql](../../../packages/db/migrations/0004_previews.sql)（write_previews、transaction_links，附回滚脚本）。[transactions.ts](../../../packages/domain/src/transactions.ts)：预览保存规范化输入、计算结果、账户版本，10 分钟有效、单次消费；提交时在账户锁内重算并比对，不一致 409 PREVIEW_STALE。创建 / 退款要求 Idempotency-Key，更正可选，同键重试回放首个结果。账户、分类、标签、交易的修改与作废都要求 If-Match |
| 双账户转账、费用、退款、冲正和作废 | 转账两条 posting、不计收支，转入基准币账户时以双方金额推算汇率；手续费为关联的独立支出；退款只针对有效支出、同币种、沿用原分类与锁定汇率，累计上限在原交易行锁内判断；更正 = 同事务冲正旧 posting + 新版本（replacesId）；作废追加反向 posting，重复作废不变；有有效退款的支出不能作废 / 更正。账户 / 分类（两级）/ 标签 CRUD 与归档在 [accounts.ts](../../../packages/domain/src/accounts.ts)、[catalog.ts](../../../packages/domain/src/catalog.ts) |
| 并发余额一致，审计与 outbox 同事务 | 所有写入在一个 DB 事务内完成成员共享锁 → 预览 / 原交易行锁 → 账户按 ID 加锁 → posting 与余额缓存 → 审计 → outbox；资金相关读取均为加锁读，避免 REPEATABLE READ 快照读到过期退款总额 |

REST：20 个 M2-LEDGER 操作由 planned 转为 stable（共 30 个），`contract:check --base-ref HEAD` 无破坏性变更。

## 验收标准对照

| 验收标准 | 结果 | 证据 |
| --- | --- | --- |
| 重复提交仅影响一次余额 | 通过 | `ledger.api.ts`：同 key 重放返回同一交易并带 `Idempotent-Replayed`，换 key 重交同一预览 409 PREVIEW_CONSUMED，6 个并发同 key 请求后余额只变一次；`transactions.test.ts`：外层事务失败时交易、审计、outbox、余额全部不留痕 |
| 转账本金不计收支，退款不记收入；并发与冲正测试通过 | 通过 | 转账无分类、kind=transfer，手续费为独立支出并随转账作废；退款 kind=refund、关联原支出与分类；两个并发退款争抢余量恰好一个成功；更正后旧版本 voided、新版本 replacesId，posting 为原始 + 冲正 + 新值；12 个并发提交余额精确；`verifyBalance` 每步核对缓存 = 期初 + SUM(posting) |

## 运行记录

本机：lint、typecheck 通过；`pnpm test:unit` 10 文件 125 测试通过；`pnpm contract:check --base-ref HEAD`：30 个 stable 操作，无破坏性变更。

最终一次 `pnpm test:e2e`（2026-10-02）：0001–0004 应用 → `Rolled back 0004_previews.sql` → 重新应用 → 重启持久化 PASS → MySQL 集成 **24 passed**（ledger-core 13 + transactions 11）→ `Rollback with ledger data refused as expected`（transaction_links 有数据）→ Playwright **19 passed**（api 13：contract 5、identity 5、ledger 3；desktop 3；mobile 3）→ web 143 / worker 0 停机，测试项目与卷已清理。

调试中契约测试发现并修正：预览可能返回 409 REFUND_EXCEEDS_PAID、作废可能返回 409 HAS_REFUNDS、标签改名可能 409 TAG_EXISTS，这些状态码原先未在 OpenAPI 中声明；已补入相应操作。

## 已知限制

- 汇率：M3-FX 之前没有自动报价，外币结算需人工汇率；跨币种退款随 M3-FX 支持。
- 新账本没有预置分类，Web 记账页面与默认分类属于 M4-CORE；交易 `source` 目前固定为 web（PAT / Agent 来源随 M6）。
- 报表口径（收支统计排除转账本金、退款冲减支出）由 M3-REPORTS 实现，本任务只保证数据模型与 kind 区分。
