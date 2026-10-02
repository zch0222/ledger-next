# M3-FX · 分钟汇率、历史补录和降级 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估，见 [AUTONOMOUS_DELIVERY](../../reviews/AUTONOMOUS_DELIVERY.md)）· 分支 `claude/loving-planck-dvzfpc`。

**供应商为本地 mock**：按用户要求不连接真实服务。`apps/mock-services` 实现 Fixer 公开协议（`/latest`、`/{YYYY-MM-DD}`、`access_key` / `base` / `symbols`、HTTP 200 + `success:false` 错误码），并可注入 503、超时、429、无效 key、报文损坏、报价时间冻结和异常跳变。

## 交付

| 步骤 | 实现 |
| --- | --- |
| 主源套餐、配额、历史覆盖与展示许可 | 适配器按 Fixer 协议实现（[fx-provider.ts](../../../packages/domain/src/fx-provider.ts)），配置 `FX_PROVIDER_URL / FX_PROVIDER_KEY / FX_PIVOT`。真实套餐与许可**未核实**（D09 仍待落实），列入最终人工审查 |
| 单批拉取、同批交叉率、快照、人工率、fresh / stale / missing | 迁移 [0005_fx.sql](../../../packages/db/migrations/0005_fx.sql)：`fx_batches` 保留供应商原始 pivot 报价，`fx_rates`，`fx_fetch_status`，`manual_rate_records`，`fx_refresh_jobs`，`fx_history_requests`。Worker 每 60 秒用 Redis 租约选出一个实例单批拉取全部启用币种；交叉率只取同一批次（[fx-pure.ts](../../../packages/domain/src/fx-pure.ts)）；跳变超过阈值（默认 20%）的批次存为 suspect 不对外，连续三批一致才确认。新鲜度按 **源时间** 计算：≤120 s fresh，≤15 min delayed，更久或连续失败（默认 10 次）stale；无报价 missing。latest 指针缓存在 Redis（TTL 60 s，失效回落 MySQL） |
| 预览锁定与入账 | 交易预览按发生时刻取参考汇率并锁定：提交时复用预览中的汇率，不重新报价（新批次不会改变已预览的入账值）；`fx_snapshots.batch_id` 记录来源批次。fresh-only 默认接受 fresh / delayed（附 FX_DELAYED 警告），stale 需 `accept-stale`，missing 需人工汇率；错误体带 `errors: [{path: "fxPolicy", code: "choice_required"}]`。跨币种转账按报价估值；跨币种退款新增可选 `originalAmount`（按原支付币种计的退款额）参与累计上限并按原交易锁定汇率冲减 |
| 历史补录 | 回溯交易使用当时在用的批次；若最近批次早于 26 小时则使用该 UTC 日期的供应商历史日率；缺失时写 `fx_history_requests`（独立连接，失败的预览回滚后请求仍保留），Worker 每 5 秒补录，最多重试 5 次 |
| REST | `GET /exchange-rates`、`GET/POST L/manual-rate-records`、`POST /exchange-rate-refresh-jobs`（系统管理员 `LEDGER_ADMIN_EMAILS`，60 秒内去重）与新增 `GET /exchange-rate-refresh-jobs/{id}`；5 个操作 stable，`contract:check --base-ref HEAD` 无破坏性变更 |
| 不阻塞 SSR | 页面与 REST 读取只查本站 MySQL / Redis；供应商调用只在 Worker 中进行 |

`market_closed` 状态保留在契约中，但实现**不推断**休市（设计要求不能凭星期判断，Fixer 协议也不提供该信号）；休市期间数据会随源时间自然变为 delayed / stale。

## 验收标准对照

| 验收标准 | 结论 | 证据 |
| --- | --- | --- |
| 正常源更新年龄目标达成或清楚记录差距 | 通过（mock 环境） | `fx.api.ts`：Worker 启动后 30 s 内汇率 fresh；源时间冻结后约 2 分钟由 fresh 变 delayed（抓取仍成功）；恢复后回到 fresh。真实供应商的源时间延迟需在真实套餐下测量（最终人工审查） |
| 休市、过期、补录不改写历史；源故障不阻塞 SSR | 通过 | `fx.test.ts`「locks the previewed rate…」新批次不改变已锁定入账；`fx.api.ts` 预览后提交汇率不变；回溯补录使用当日历史率；503 / 超时期间 `/login` 3 秒内返回 200，汇率显示 stale，预览需显式选择 |

## 运行记录

- `pnpm test:unit`：12 文件 136 测试通过（新增 fx 8、dates 2）；覆盖范围新增 `fx-pure.ts`、`fx-provider.ts`。
- MySQL 集成（Docker）：36 passed，其中 fx 12。
- `LEDGER_BUILD_CA=… pnpm test:e2e`：迁移 0001–0005 → 回滚 0005（空表）→ 重放 → 重启持久化 PASS → 集成 36 passed → 有人工汇率数据时回滚被拒 → Playwright 23 passed（新增 `fx.api.ts` 4 个用例：故障降级与恢复 22 s、源时间冻结 1.1 min、历史补录 3 s、人工汇率与刷新任务 6 s）→ web 143 / worker 0 停机。

调试中发现并修复：历史补录请求原先写在预览事务内，预览以 FX_RATE_MISSING 失败回滚时请求一并丢失（e2e 发现，集成测试补充回归用例）。

## 已知限制 / 待人工审查

- 真实 Fixer（或备选）套餐的更新频率、配额、历史覆盖与展示许可未核实；需在真实凭据下测量源时间延迟。
- 备用供应商未实现（设计要求先完成主源）。
- suspect 批次目前只在 `fxStatus()` 中计数，P09 页面展示随 M4-CORE。
