# M7-PERF · SSR、REST 与队列性能验收 · 方法

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估）。**实测数字见 [RESULTS.md](RESULTS.md)**（由脚本生成，不手写）。

## 可复现的命令

```
LEDGER_BUILD_CA=… pnpm test:perf            # 默认：1,000 用户、10 万笔、100 并发、600 s
PERF_USERS=200 PERF_BIG_TX=20000 PERF_SECONDS=120 pnpm test:perf   # 缩小规模的快速版本
node scripts/perf-report.mjs                 # test-results/perf/*.json → RESULTS.md
```

`scripts/perf-test.mjs` 建立独立 Compose 项目（生产镜像、生产默认的 worker 节奏、本地 mock 供应商），依次运行：

1. **数据**（`tests/perf/seed.ts`）：经公开 API 注册用户；大账本经 CSV 导入（每批 1 万行，与生产同一校验 / 提交路径，余额、posting、审计不变量全部成立），时间跨度两年；普通账本各有若干笔经“预览 → 提交”的交易。
2. **负载**（`tests/perf/load.ts`）：
   - 12 个月聚合（summary / cash-flow / category-breakdown）在 10 万笔账本上冷 / 热各 N 次；
   - 总览页（已登录 SSR）冷 / 热：TTFB（响应头）与完整 HTML（流式渲染全部完成）分别记录；
   - 混合负载：N 个虚拟用户闭环无思考时间，每次随机选一个种子用户：总览页 25 %、明细页 10 %、明细 API 20 %、当月汇总 15 %、账户 10 %、记账（预览 + 提交）20 %；
   - 期间每 10 s 采样汇率源时间年龄；每 10 个用户创建一条 2–8 分钟后到期的每日提醒，测 `scheduled_at → 首次尝试` 的调度延迟；
   - MySQL `performance_schema` 语句摘要（按总耗时前 15）、数据库大小。
3. **浏览器**（`tests/perf/vitals.ts`）：Pixel 7、slow 4G（150 ms RTT、1.6 Mbps / 750 kbps）、CPU ×4，每页 N 次全新上下文：LCP / CLS 取浏览器条目，INP 取一次真实交互（总览“记一笔”、明细搜索输入）的最慢事件；首屏 JS 为 load 之前的传输字节，load 之后（含 ECharts）单独计量；总览 ↔ 分析 20 次客户端切换检查 ECharts 实例数与 GC 后堆大小；打开“减少动态效果”后检查图表动画关闭。
4. **备份规模**：同一数据库全量导出与导入到空库的耗时（M7-OPS 的 RTO 外推）。

## 口径说明（D36）

- “冷缓存”= 清空 Redis 报表缓存后的首次请求；MySQL 缓冲池保持热。完全冷启动（重启 MySQL）未单独测。
- 压测进程、浏览器与全部服务在同一台 4 vCPU 主机上，结果偏保守；与 §7.3 的“同区域独立 MySQL / Redis”环境不同。
- Web Vitals 是实验室数据（每页 20 次），不是 RUM；上线后需 7 天 RUM 复核。
- 首屏 JS 实测包含 React / Next 运行时；§7.3 的“自有 JS ≤180 KB”只计自有代码，实测值偏大时并不直接等于超标，RESULTS.md 中按保守口径判定。
- 汇率年龄来自本地 mock 供应商（按 60 s 节奏拉取），只能说明拉取与新鲜度计算链路，不代表真实供应商。

## 结论（2026-10-02 全规模运行）

数据：1,000 用户 + 10 万笔大账本（压测后库 919 MB、交易 124,121 笔）；4 vCPU / 15.7 GiB 单机，压测进程、浏览器与全部服务同机。全部请求 0 错误。详细数字见 [RESULTS.md](RESULTS.md)。

**达标**

- 用户模型（100 个并发用户，每次操作后思考约 2 s，≈59 次/秒）：总览 TTFB p95 68 ms（完整 HTML 87 ms）；REST 查询 p95 31–39 ms；预览 / 入账 p95 41 / 76 ms。
- 单独测量：10 万笔账本总览 TTFB 热 p95 36 ms / 冷 56 ms；12 个月聚合热 p95 14–31 ms、冷 886–989 ms（目标 500 ms / 1.5 s）。
- 移动端实验室 Web Vitals（20 次 / 页）：LCP p75 616 / 1004 ms，INP p75 32 / <16 ms，CLS 0；首屏 JS 160 KB（含框架，ECharts 196 KB 在 load 之后单独加载）。
- 图表：20 次切页每页始终 2 个实例（不累积），堆 6–9 MB 趋稳；减少动态时动画属性为 false。
- 提醒调度延迟 p95 4 s（100 / 100 条，负载期间）；汇率源时间年龄 p95 112 s（mock 源，60 s 拉取）。

**未达标（如实记录为未通过）**

- 压力场景（100 个请求始终在途、无思考时间）：吞吐 161 次/秒时，总览 TTFB p95 1,420 ms、REST 查询 p95 482–667 ms、入账 p95 1,059 ms，均超过目标。原因是整机 CPU 饱和（web 多进程、MySQL、worker、压测进程与浏览器共用 4 核），不是数据库慢查询（单条语句平均 ≤2 ms）。
- 本轮已做的改进：web 改为 Node cluster（D37），同一场景吞吐从 80 提升到 161 次/秒，总览 TTFB p95 从 2,960 ms 降到 1,420 ms。
- 进一步达标需要：MySQL 与 web 分机（§7.3 的基准环境本就是“同区域独立 MySQL / Redis”）、按需增加 web 实例，或确认“100 并发”指 100 个在线用户（用户模型，已达标）而非 100 个始终在途的请求。此口径与目标环境由人工审查决定。
