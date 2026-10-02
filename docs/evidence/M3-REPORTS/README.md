# M3-REPORTS · 报表口径、聚合与缓存 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估）· 分支 `claude/loving-planck-dvzfpc`。

## 交付

| 步骤 | 实现 |
| --- | --- |
| 历史收支、净资产估值、分类、趋势与预算聚合 | [reports.ts](../../../packages/domain/src/reports.ts)：`reports/summary`、`reports/cash-flow`（日 / 周一起的周 / 月，≤366 点）、`reports/category-breakdown`、`reports/account-balances`、新增 `reports/budget-progress`；预算 CRUD（迁移 [0007_reports.sql](../../../packages/db/migrations/0007_reports.sql)，金额须为账本基准币）。口径：只计有效版本（posted），转账不计收支，退款冲减支出并计入退款发生期；分类排行中退款冲减原分类；父分类筛选包含子分类 |
| 版本化缓存、缺率排除计数和退款期间规则 | `ledger_data_versions` 在每次资金写入（交易 / 退款 / 账户 / 预算 / 人工汇率）同事务递增；Redis 键 = 账本 + 数据版本 + FX 版本（当前估值）+ 报表 + 全部参数，TTL 30 秒，授权先于读缓存。其他币种历史口径逐笔按当日交叉率并逐笔舍入；缺率计入 excludedCount、partial=true，可用人工汇率记录补齐；当前估值按最新参考汇率 |
| 对账明细和聚合并记录 SQL 查询计划 | 集成测试用交易列表接口重建期间收支并与 summary 比对；EXPLAIN 记录见下 |

查询计划（Docker 测试库，小数据量）：`[{"table":"t","type":"ref","key":"transaction_ledger_uq"},{"table":"a","type":"eq_ref","key":"PRIMARY"}]`。无全表扫描；小表上优化器选择 (ledger_id, id) 而非 (ledger_id, status, local_date)，目标数据量下的计划在 M7-PERF 复测。

## 验收标准对照

| 验收标准 | 结论 | 证据 |
| --- | --- | --- |
| 报表与有效明细合计一致；转账不计支出 | 通过 | `reports.test.ts`「counts effective income and expense, never transfers, and refunds in their own period」（作废与被更正版本不计，跨月退款计入 10 月）、「filters by account and by a parent category…」、`cashFlow` 日 / 周 / 月点数与汇总一致；`reports.api.ts` HTTP 口径 |
| 不同用户、币种、口径缓存不混用；写后统计版本可追踪 | 通过 | 缓存键含账本、数据版本、币种与口径；`reports.test.ts`「serves cached aggregates until a write bumps the data version」；`reports.api.ts` 写入后 dataVersion 增大且结果立即更新；外部用户 404；人工汇率补齐后 partial 消失 |

## 运行记录

- 单元：`report-periods.test.ts` 3 个用例；全部单元 144 通过。
- 集成（Docker）：53 passed（reports 11）。Playwright 26 passed（`reports.api.ts`）。

## 已知限制

- `upcomingBills` 在 M4-SUBS 前恒为 0（已预留注册点 `registerUpcomingBills`）。
- 性能目标（12 个月聚合 p95）在 M7-PERF 按目标数据量测量。
