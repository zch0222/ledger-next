# M2-IMPORT · CSV 导入导出与可撤销批次 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估，见 [AUTONOMOUS_DELIVERY](../../reviews/AUTONOMOUS_DELIVERY.md)）· 分支 `claude/loving-planck-dvzfpc`。

## 交付

| 步骤 | 实现 |
| --- | --- |
| 列映射、预览、行校验和文件 / 行指纹去重 | 迁移 [0006_imports.sql](../../../packages/db/migrations/0006_imports.sql)：`import_jobs`、`import_rows`（生成列 `committed_fingerprint` + 唯一键）、`export_jobs`。[csv.ts](../../../packages/domain/src/csv.ts) 为 RFC 4180 解析 / 写出（BOM、CRLF、引号转义、行号错误、行数上限）；[imports.ts](../../../packages/domain/src/imports.ts) 的 `ImportMapping`：表头名映射 date / amount / account / kind / currency / category / merchant / note，日期格式四选一，按符号或 `defaultKind` 判断收支。每行在同一事务内校验：日期、账户（未归档、唯一）、币种一致、金额精度、分类（同类型、唯一）、外币按当日历史汇率折算（缺失则 FX_RATE_MISSING 并排队补录）；行指纹 = 账本 + 日期 + 类型 + 账户 + 金额 + 分类 + 商家 + 备注 + 同文件内序号 |
| 异步提交与导出任务、下载鉴权、公式注入转义 | 上传后 202，Worker 经 outbox → BullMQ 异步校验 / 提交 / 撤销 / 导出（[outbox.ts](../../../packages/domain/src/outbox.ts)、[queue.ts](../../../apps/worker/src/queue.ts)，jobId = outbox id；每分钟补扫停滞任务）。提交每 100 行一个事务（savepoint 处理重复行），崩溃后续跑剩余 valid 行。导出为 UTF-8 BOM CSV，金额恒为正、带类型列，`= + - @ TAB CR` 开头单元格加撇号；仅创建者可查询 / 下载，1 小时过期，过期后由 Worker 清除文件内容 |
| 批次撤销与大文件限制 | owner 撤销：逐行作废该批次入账的交易（反向 posting），已有退款的支出跳过并以 HAS_REFUNDS 报告；撤销后指纹释放，可重新导入。上传 ≤5 MB / ≤10,000 行；导出 ≤100,000 行 |

REST：9 个操作转为 stable（新增 `GET …/export-jobs/{id}/file`，text/csv）。

## 验收标准对照

| 验收标准 | 结论 | 证据 |
| --- | --- | --- |
| 重复导入不重复记账，错误行有行号与原因 | 通过 | `imports.test.ts`「validates with row-level errors, books valid rows once and dedupes a re-upload」（8 行 → 4 有效、4 条带行号 / 列 / 错误码；同文件重传 4 行 DUPLICATE_ROW）、「books a line once even when two batches with it commit at the same time」；`imports.api.ts`：HTTP multipart、幂等重放、重传后 duplicateRows=3 |
| 导出合计一致、无越权下载，撤销可追踪 | 通过 | `imports.test.ts` 导出：交易 ID 集合与数据库期间有效交易一致，支出基准金额合计等于数据库合计；非创建者 404；过期 404 EXPORT_EXPIRED；`imports.api.ts`：下载头 `attachment` + `private, no-store`，成员不可见他人导出；撤销后余额恢复且审计含 import.reversal_requested / import.reverted |

## 运行记录

- 单元：`csv.test.ts` 6 个用例（含公式转义往返、表头读取）；全部单元 144 通过。
- 集成（Docker，与在线 Worker 并发消费同一 outbox）：53 passed（imports 6）。
- `pnpm test:e2e`：0001–0007 迁移 → 回滚演练 → 重启持久化 → 集成 53 → 有数据时回滚被拒 → Playwright 26 passed（`imports.api.ts` 2 个用例）→ web 143 / worker 0 停机。

调试中发现并修复：BullMQ 不会关闭外部传入的 Redis 连接，导致 Worker 收到 SIGTERM 后无法退出（Docker 以 137 强杀）；现已在关闭时显式 quit。

## 已知限制

- 导入只支持收入 / 支出；转账与退款需在应用内登记（UNSUPPORTED_KIND）。
- Web 导入向导（P11）属于 M4-CORE。
