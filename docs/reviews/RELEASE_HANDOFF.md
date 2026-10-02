# 发布验收与交接（G1 准备材料）

准备：Claude Code · 2026-10-02（Asia/Hong_Kong）· 分支 `claude/loving-planck-dvzfpc`。

> **G1 不能由实现者自评估**（AUTONOMOUS_DELIVERY 规则 3）。本文件只汇总证据与遗留项，供发布负责人审查并签署；签署前 G1 保持“待开始”。

## 1. 需求覆盖（TECHNICAL_DESIGN §1）

| 需求 | 交付 | 证据 | 仍需人工 |
| --- | --- | --- | --- |
| R1 多币种、实时汇率 | 原币 / 结算币 / 基准币；分钟汇率批次、锁定快照、历史补录、stale 降级、人工汇率 | M2-MODEL、M2-LEDGER、M3-FX | 真实 FX 供应商套餐、配额与 source age |
| R2 直观可视化 | 总览 KPI、趋势、分类排行、预算进度、订阅日历、可钻取明细（ECharts 懒加载） | M4-DASH、M4-SUBS、M7-PERF | 视觉品味复核 |
| R3 多通道提醒 | Telegram、飞书、企业微信（机器人 / 应用）、个人微信（pushplus）、邮件、Webhook、站内；可靠投递与混沌演练 | M5-* | 每个渠道的真实接收截图（AC10） |
| R4 现代 UI | 主题色、浅 / 深 / 跟随系统、跨设备同步、AA 对比度 | M4-THEME、M4-RESP | 真机观感 |
| R5 Next.js / REST / SSR | App Router SSR 直读领域层；REST `/api/v1` 由 OpenAPI 注册表驱动；性能实测 | M1-API、M7-PERF | 生产环境复测 |
| R6 桌面 / 移动 | 360–1920 px，axe 0 违规，触摸目标 ≥44 px | M4-RESP、M7-E2E | iOS Safari / Android Chrome 真机 |
| R7 MCP + Skill | `/mcp` + stdio，15 工具 2 资源；ledger-service Skill 与四客户端包 | M6-* | 四个真实客户端联调（版本记录） |
| R8 先设计后开发 | UI 原型、用户流程、G0 | G0、docs/reviews | — |

## 2. 验证汇总

| 类别 | 命令 | 最近结果 |
| --- | --- | --- |
| 静态检查 | `pnpm lint`、`pnpm typecheck`、`pnpm contract:check` | 通过 |
| 单元 | `pnpm test:unit` | 186 passed；纯模块覆盖率语句 97.97 %、分支 94.63 % |
| 完整回归 | `pnpm test:e2e`（Docker） | 迁移回滚演练、持久化、集成 83、混沌演练、Playwright 74、日志脱敏扫描、优雅停机，全部通过 |
| 恢复演练 | `pnpm test:ops` | 备份恢复 RTO 25.1 s、备库恢复 RTO 25.8 s（0 丢失），对账一致 |
| 性能 | `pnpm test:perf` → `scripts/perf-report.mjs` | 1,000 用户 + 10 万笔、0 错误：100 并发用户模型全部达标（总览 TTFB p95 68 ms、REST ≤76 ms）；Web Vitals、聚合、提醒、汇率达标；无思考压力场景（161 次/秒）p95 未达标——见 [RESULTS.md](../evidence/M7-PERF/RESULTS.md) |
| 依赖 | `pnpm audit --prod` | 0 项 |

每个任务的逐项结论在 [SELF_REVIEW.md](../evidence/SELF_REVIEW.md) 与 `docs/evidence/{任务}/README.md`。

## 3. 发布步骤（签署后执行）

1. 打标签：在要发布的提交上 `git tag v0.7.0`（回滚版本为上一个已发布标签；首发时回滚即“停止服务 + 从备份恢复”）。
2. 按 [RUNBOOK](../RUNBOOK.md) 第 2 节部署；第 4.1 节先做一次全量备份。
3. 最小 smoke：`/api/health/ready` 200；注册 → 建账本 → 记一笔 → 总览出现；「提醒渠道」逐个测试；「Agent 接入」签发只读令牌并用 Claude Code（或其他客户端）调用 `ledger_get_context`。
4. 交付物：RUNBOOK（运维）、IMPLEMENTATION（功能与运行）、P10 页面与 `pnpm skill:build` 产物（Agent 安装）、本文件与证据目录。

## 4. 遗留与风险（签署前需要决定）

- 全部“真实第三方”项（汇率供应商、七类渠道真实接收、四个真实 Agent 客户端与模型）均只做了本地 mock / 协议级模拟（D21、D32），见 MILESTONES.md 文末“最终人工审查清单”。
- 生产主机、域名、HTTPS、监控与异地备份尚未建立（M7-OPS 人工项）。
- 远程 MCP OAuth 未实现：远程只支持个人访问令牌（契约 §4.1）。
- 仅有每日全量备份时 RPO 按 ≤24 小时对外说明；需要 ≤15 分钟时部署第二台主机上的备库（D35）。
- 性能为单机实验室数据（D36）；无思考时间的 100 在途请求压力场景未达标（整机 CPU 饱和），需确认“100 并发”口径并在 MySQL / web 分机环境复测。

## 5. 签署

| 角色 | 姓名 | 日期 | 结论 |
| --- | --- | --- | --- |
| 发布负责人 |  |  |  |
| 技术负责人 |  |  |  |
