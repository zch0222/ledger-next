# Ledger Next · 可更新里程碑

> 自动生成：请更新 milestones.json 或运行 scripts/progress.mjs；不要直接修改本文件。

数据版本：1 · 最近更新：2026-10-02T08:59:41.878Z

完成率按原始估算人日加权，只有 done 计入；in_review 不计完成。文档完成不代表业务开发完成。

**全部工作：36.5%（21/57.5 人日） · 业务开发：31.8% · G0：完成**

其中 7 项为实现者自评估完成（用户授权跳过逐项人工审查），统一列入文末“最终人工审查清单”；G1 发布签署仍需真实评审人。

| 里程碑 | 状态分布 | 完成人日 / 估算人日 | 完成率 |
| --- | --- | --- | --- |
| M0 开发前设计与验收 | 完成 4 | 4 / 4 | 100.0% |
| M1 工程、身份与 REST 契约 | 完成 3 | 5.5 / 5.5 | 100.0% |
| M2 记账核心与数据 | 完成 3 | 7 / 7 | 100.0% |
| M3 多币种汇率与报表 | 完成 2 | 4.5 / 4.5 | 100.0% |
| M4 现代响应式产品 UI | 待开始 2，进行中 3 | 0 / 11.5 | 0.0% |
| M5 提醒与全部通道 | 待开始 7 | 0 / 11 | 0.0% |
| M6 MCP、Skill 与四 Agent | 待开始 6 | 0 / 6.5 | 0.0% |
| M7 质量、运维与发布 | 待开始 5 | 0 / 7.5 | 0.0% |

## 下一步

- **M4-CORE** 认证、账目、账户与设置 UI（进行中；前端 / 全栈）：实现中
- **M4-SUBS** 周期订阅与支付确认（进行中；全栈开发）：实现中
- **M4-THEME** 外观：主题色与深浅模式（进行中；前端 / 全栈）：实现中

## 任务总览

| ID | 任务 | 状态 | 负责人 / 角色 | 依赖 | 人日 |
| --- | --- | --- | --- | --- | --- |
| M0-RESEARCH | 需求与官方资料核查 | 完成 | Codex / 产品 / 架构 | — | 0.5 |
| M0-UI | 详细 UI、原型与操作流程评审 | 完成 | Codex（设计记录） / 产品 / 设计 | M0-RESEARCH | 2 |
| M0-CONTRACT | 架构、资金口径与服务契约评审 | 完成 | Codex（设计记录） / 架构 / 技术负责人 | M0-RESEARCH | 1 |
| G0 | 设计验收门禁：通过后才允许业务开发 | 完成 | 用户（实施授权） / 产品负责人 / 用户 | M0-UI, M0-CONTRACT | 0.5 |
| M1-BASE | 工程骨架与版本锁定 | 完成 | Codex、Claude Code / 全栈开发 | G0 | 1.5 |
| M1-AUTH | 身份、账本与权限 | 完成 | Codex、Claude Code / 全栈开发 | M1-BASE | 2 |
| M1-API | OpenAPI、错误模型与 REST SDK | 完成 | Claude Code / 全栈开发 | M1-AUTH | 2 |
| M2-MODEL | 账务 schema 与金额运算 | 完成 | Claude Code / 后端 / 数据 | M1-API | 2 |
| M2-LEDGER | 收支、转账、退款与更正 | 完成 | Claude Code / 全栈开发 | M2-MODEL | 3 |
| M2-IMPORT | CSV 导入导出与可撤销批次 | 完成 | Claude Code / 全栈开发 | M2-LEDGER | 2 |
| M3-FX | 分钟汇率、历史补录和降级 | 完成 | Claude Code / 后端 / 集成 | M2-MODEL | 2.5 |
| M3-REPORTS | 报表口径、聚合与缓存 | 完成 | Claude Code / 后端 / 数据 | M2-LEDGER, M3-FX | 2 |
| M4-CORE | 认证、账目、账户与设置 UI | 进行中 | Claude Code / 前端 / 全栈 | M2-LEDGER | 3 |
| M4-SUBS | 周期订阅与支付确认 | 进行中 | Claude Code / 全栈开发 | M2-LEDGER, M3-FX | 3 |
| M4-DASH | 总览、分析与预算可视化 | 待开始 | 未分配 / 前端 | M3-REPORTS, M4-SUBS | 2 |
| M4-THEME | 外观：主题色与深浅模式 | 进行中 | Claude Code / 前端 / 全栈 | M1-API | 1.5 |
| M4-RESP | 全页面移动端与无障碍验收 | 待开始 | 未分配 / 前端 / QA | M4-CORE, M4-DASH, M4-THEME | 2 |
| M5-ENGINE | 提醒调度、Outbox 与可靠投递 | 待开始 | 未分配 / 后端 | M4-SUBS | 2.5 |
| M5-TG | Telegram 通道 | 待开始 | 未分配 / 集成开发 | M5-ENGINE | 1 |
| M5-FEISHU | 飞书通道 | 待开始 | 未分配 / 集成开发 | M5-ENGINE | 1 |
| M5-WECOM | 企业微信机器人与应用消息 | 待开始 | 未分配 / 集成开发 | M5-ENGINE | 1.5 |
| M5-WX | 个人微信通道 | 待开始 | 未分配 / 集成开发 | M5-ENGINE | 1.5 |
| M5-OTHER | 站内、邮件与 Webhook | 待开始 | 未分配 / 集成开发 | M5-ENGINE | 1.5 |
| M5-CHAOS | 提醒跨通道故障与恢复验收 | 待开始 | 未分配 / QA / 后端 | M5-TG, M5-FEISHU, M5-WECOM, M5-WX, M5-OTHER | 2 |
| M6-SERVER | MCP HTTP / stdio 服务与令牌 | 待开始 | 未分配 / 全栈 / Agent 集成 | M1-API, M3-REPORTS, M4-SUBS, M5-ENGINE | 2.5 |
| M6-SKILL | 正式 Skill 与配置包 | 待开始 | 未分配 / Agent 集成 | M6-SERVER | 1 |
| M6-CODEX | Codex 联调 | 待开始 | 未分配 / Agent 集成 / QA | M6-SKILL | 0.5 |
| M6-CLAUDE | Claude Code 联调 | 待开始 | 未分配 / Agent 集成 / QA | M6-SKILL | 0.5 |
| M6-DSH | DeepSeek Harness 联调 | 待开始 | 未分配 / Agent 集成 / QA | M6-SKILL | 1 |
| M6-QODER | Qoder IDE / CLI 联调 | 待开始 | 未分配 / Agent 集成 / QA | M6-SKILL | 1 |
| M7-SEC | 权限、密钥与数据安全验收 | 待开始 | 未分配 / QA / 技术负责人 | M4-RESP, M5-CHAOS, M6-CODEX, M6-CLAUDE, M6-DSH, M6-QODER | 1.5 |
| M7-PERF | SSR、REST 与队列性能验收 | 待开始 | 未分配 / 性能 / 全栈 | M4-RESP, M5-CHAOS | 2 |
| M7-E2E | 完整业务回归与导入导出 | 待开始 | 未分配 / QA | M2-IMPORT, M7-SEC | 2 |
| M7-OPS | 部署、备份恢复与运行手册 | 待开始 | 未分配 / 运维 / 全栈 | M7-SEC | 1.5 |
| G1 | 发布验收与交接 | 待开始 | 未分配 / 产品 / 技术负责人 | M7-PERF, M7-E2E, M7-OPS | 0.5 |

## 执行卡

### M0-RESEARCH · 需求与官方资料核查

- 状态：完成；负责人：Codex；建议角色：产品 / 架构
- 依赖：无；未完成依赖：无
- 估算：0.5 人日；更新：2026-10-02
- 下一动作：审阅需求追踪与默认决策。

**执行步骤**

1. 核对 Wallos、Next.js、MCP 和四客户端官方资料。
2. 记录用户已确认的两种微信及 dsh 产品身份，分开设计事实与假设。

**验收标准**

- [x] 八项需求全部有对应设计入口。
- [x] 来源、未核实限制和待落实决策已记录。

**证据**

- [docs/TECHNICAL_DESIGN.md](../docs/TECHNICAL_DESIGN.md)
- [docs/REFERENCES.md](../docs/REFERENCES.md)
- [docs/DECISIONS.md](../docs/DECISIONS.md)

### M0-UI · 详细 UI、原型与操作流程评审

- 状态：完成；负责人：Codex（设计记录）；建议角色：产品 / 设计
- 依赖：M0-RESEARCH；未完成依赖：无
- 估算：2 人日；更新：2026-10-01T18:34:24.657Z
- 下一动作：实现时保持 v0.3 原型布局与令牌，按业务里程碑验收
- 评审人：用户（当前会话实施授权）

**执行步骤**

1. 审阅 P00–P13 页面、桌面和移动断点、所有字段与异常状态。
2. 运行原型演练记账、账目筛选、订阅和渠道设置；审阅 F01–F09 图。
3. 记录修改意见并更新设计版本。
4. 评审 ECharts 折线、柱形、环图及错峰入场，切换币种保持实例；验证减少动画偏好。
5. 审阅外观：浅色 / 深色 / 跟随系统切换，7 个预设与自定义主题色、对比度提示、语义色不随主题变化，以及图表换肤。

**验收标准**

- [x] 主要页面和流程得到真实评审者认可。
- [x] 360/390/768/1440px 检查无页面溢出，记账与错误状态可执行。
- [x] 图表采用 ECharts，动画不遮挡数值、不阻塞操作；移动端与减少动画模式可用。
- [x] 三种显示模式与全部预设主题色可用；每个主题色在浅色 / 深色下关键对比度 ≥4.5:1；切换外观不重建图表、不改变账务数据。

**证据**

- [docs/UI_SPEC.md](../docs/UI_SPEC.md)
- [docs/USER_FLOWS.md](../docs/USER_FLOWS.md)
- [docs/ui/index.html](../docs/ui/index.html)
- [docs/reviews/DESIGN_QA.md](../docs/reviews/DESIGN_QA.md)
- [docs/ui/theme.js](../docs/ui/theme.js)
- [docs/reviews/DESIGN_REVIEW.md](../docs/reviews/DESIGN_REVIEW.md)

### M0-CONTRACT · 架构、资金口径与服务契约评审

- 状态：完成；负责人：Codex（设计记录）；建议角色：架构 / 技术负责人
- 依赖：M0-RESEARCH；未完成依赖：无
- 估算：1 人日；更新：2026-10-01T18:34:24.850Z
- 下一动作：按 MySQL 方案实现与验证
- 评审人：用户（当前会话实施授权）

**执行步骤**

1. 审阅基准币与汇率快照、posting、更正与退款模型。
2. 确认 REST、SSR、Worker 与 MCP 的边界和四客户端接入。
3. 核对性能目标、个人微信方案和外部依赖。

**验收标准**

- [x] 契约没有资金口径歧义，接口有权限与错误语义。
- [x] 技术负责人记录架构与验收范围结论。

**证据**

- [docs/TECHNICAL_DESIGN.md](../docs/TECHNICAL_DESIGN.md)
- [docs/API_AGENT_CONTRACT.md](../docs/API_AGENT_CONTRACT.md)
- [docs/skill-draft/ledger-service/SKILL.md](../docs/skill-draft/ledger-service/SKILL.md)
- [docs/reviews/DESIGN_REVIEW.md](../docs/reviews/DESIGN_REVIEW.md)

### G0 · 设计验收门禁：通过后才允许业务开发

- 状态：完成；负责人：用户（实施授权）；建议角色：产品负责人 / 用户
- 依赖：M0-UI, M0-CONTRACT；未完成依赖：无
- 估算：0.5 人日；更新：2026-10-01T18:34:25.017Z
- 下一动作：按任务依赖推进，发布 G1 保持待验收
- 评审人：用户（当前会话实施授权）

**执行步骤**

1. 逐项检查 DESIGN_REVIEW 清单。
2. 填写真实评审人、设计版本、时间、结论及遗留问题；不由作者代签。
3. 完成 G0 并把批准版本作为开发基线。

**验收标准**

- [x] UI、流程和架构评审完成，没有阻塞业务语义的问题。
- [x] 真实签署记录存在，G0 有 reviewer 与 evidence。

**证据**

- [docs/reviews/DESIGN_REVIEW.md](../docs/reviews/DESIGN_REVIEW.md)

### M1-BASE · 工程骨架与版本锁定

- 状态：完成；负责人：Codex、Claude Code；建议角色：全栈开发
- 依赖：G0；未完成依赖：无
- 估算：1.5 人日；更新：2026-10-02T07:19:37.634Z
- 下一动作：无；远程 CI 结果在推送后补记
- 评审人：用户（当前会话验收）

**执行步骤**

1. 建立 pnpm workspace，创建 Next.js App Router、worker 与共享包。
2. 锁定稳定依赖、Node LTS 和镜像版本，建立 lint/typecheck/build CI。
3. 配置本地 MySQL/Redis 与环境变量示例，任何 secret 不入库。

**验收标准**

- [x] 干净克隆后可启动 Web 与 worker。
- [x] CI lint、typecheck、build 通过且有版本清单。

**证据**

- [docs/IMPLEMENTATION.md](../docs/IMPLEMENTATION.md)
- [docs/evidence/M1-BASE/README.md](../docs/evidence/M1-BASE/README.md)
- [docs/evidence/M1-BASE/VERSIONS.md](../docs/evidence/M1-BASE/VERSIONS.md)
- [docs/evidence/M1-API/README.md](../docs/evidence/M1-API/README.md)

### M1-AUTH · 身份、账本与权限

- 状态：完成；负责人：Codex、Claude Code；建议角色：全栈开发
- 依赖：M1-BASE；未完成依赖：无
- 估算：2 人日；更新：2026-10-02T08:19:14.765Z
- 下一动作：最终人工审查时抽查登录 / 成员 UI
- 评审人：Claude Code 自评估（用户授权，见 docs/reviews/AUTONOMOUS_DELIVERY.md）（自评估，待最终人工审查）

**执行步骤**

1. 实现认证、账本、membership 与 AuthContext。
2. 提供 owner/editor/viewer 授权和 Session 写入保护。
3. 建立跨用户、跨账本隔离集成测试。

**验收标准**

- [x] 未经授权无法读取或修改另一账本任何资源。
- [x] 登录/退出/会话撤销、最后 owner 保护通过。

**证据**

- [docs/evidence/M1-AUTH/README.md](../docs/evidence/M1-AUTH/README.md)
- [docs/evidence/SELF_REVIEW.md](../docs/evidence/SELF_REVIEW.md)

**待最终人工审查**

- [ ] 人工抽查登录、退出、成员角色变更与最后 owner 提示

### M1-API · OpenAPI、错误模型与 REST SDK

- 状态：完成；负责人：Claude Code；建议角色：全栈开发
- 依赖：M1-AUTH；未完成依赖：无
- 估算：2 人日；更新：2026-10-02T08:19:14.809Z
- 下一动作：无；远程 CI 结果待推送后核对
- 评审人：Claude Code 自评估（用户授权，见 docs/reviews/AUTONOMOUS_DELIVERY.md）（自评估，待最终人工审查）

**执行步骤**

1. 将契约资源表转换为完整 OpenAPI 3.1。
2. 实现 validation、分页、ETag、幂等中间层和 problem+json。
3. 生成 SDK 并接入 breaking-change diff CI。

**验收标准**

- [x] 全部计划资源含 schema、scope 和错误响应。
- [x] 状态码、cursor 篡改、412、重复提交契约测试通过。

**证据**

- [docs/evidence/M1-API/README.md](../docs/evidence/M1-API/README.md)
- [packages/contracts/openapi.json](../packages/contracts/openapi.json)
- [docs/evidence/SELF_REVIEW.md](../docs/evidence/SELF_REVIEW.md)

**待最终人工审查**

- [ ] 核对远程 GitHub Actions 的 contract:check 与 Docker E2E 结果

### M2-MODEL · 账务 schema 与金额运算

- 状态：完成；负责人：Claude Code；建议角色：后端 / 数据
- 依赖：M1-API；未完成依赖：无
- 估算：2 人日；更新：2026-10-02T08:19:14.856Z
- 下一动作：无
- 评审人：Claude Code 自评估（用户授权，见 docs/reviews/AUTONOMOUS_DELIVERY.md）（自评估，待最终人工审查）

**执行步骤**

1. 创建账户、交易、posting、快照、审计、outbox 迁移与约束。
2. 实现 decimal、币种精度、舍入与账户余额计算。
3. 构造多币种边界 fixtures。

**验收标准**

- [x] JPY/三位小数/大额/0.1+0.2 不产生精度错误。
- [x] 跨账本外键拒绝，迁移可应用并有恢复方案。

**证据**

- [docs/evidence/M2-MODEL/README.md](../docs/evidence/M2-MODEL/README.md)
- [packages/db/migrations/0003_ledger_core.sql](../packages/db/migrations/0003_ledger_core.sql)
- [docs/evidence/SELF_REVIEW.md](../docs/evidence/SELF_REVIEW.md)

### M2-LEDGER · 收支、转账、退款与更正

- 状态：完成；负责人：Claude Code；建议角色：全栈开发
- 依赖：M2-MODEL；未完成依赖：无
- 估算：3 人日；更新：2026-10-02T08:19:14.934Z
- 下一动作：无
- 评审人：Claude Code 自评估（用户授权，见 docs/reviews/AUTONOMOUS_DELIVERY.md）（自评估，待最终人工审查）

**执行步骤**

1. 实现预览、事务写入、同键重放和版本控制。
2. 实现双账户转账、费用、退款、冲正和作废。
3. 验证并发余额一致，审计与 outbox 同事务。

**验收标准**

- [x] 重复提交仅影响一次余额。
- [x] 转账本金不计收支，退款不记收入；并发与冲正测试通过。

**证据**

- [docs/evidence/M2-LEDGER/README.md](../docs/evidence/M2-LEDGER/README.md)
- [packages/db/migrations/0004_previews.sql](../packages/db/migrations/0004_previews.sql)
- [docs/evidence/SELF_REVIEW.md](../docs/evidence/SELF_REVIEW.md)

### M2-IMPORT · CSV 导入导出与可撤销批次

- 状态：完成；负责人：Claude Code；建议角色：全栈开发
- 依赖：M2-LEDGER；未完成依赖：无
- 估算：2 人日；更新：2026-10-02T08:58:35.485Z
- 下一动作：Web 导入向导随 M4-CORE
- 评审人：Claude Code 自评估（用户授权，见 docs/reviews/AUTONOMOUS_DELIVERY.md）（自评估，待最终人工审查）

**执行步骤**

1. 实现列映射、预览、行校验和文件/行指纹去重。
2. 实现异步提交与导出任务、下载鉴权、公式注入转义。
3. 提供批次撤销与大文件限制。

**验收标准**

- [x] 重复导入不重复记账，错误行有行号与原因。
- [x] 导出合计一致、无越权下载，撤销可追踪。

**证据**

- [docs/evidence/M2-IMPORT/README.md](../docs/evidence/M2-IMPORT/README.md)
- [packages/db/migrations/0006_imports.sql](../packages/db/migrations/0006_imports.sql)

**待最终人工审查**

- [ ] 人工用真实银行导出 CSV 走一遍映射、校验、提交与撤销

### M3-FX · 分钟汇率、历史补录和降级

- 状态：完成；负责人：Claude Code；建议角色：后端 / 集成
- 依赖：M2-MODEL；未完成依赖：无
- 估算：2.5 人日；更新：2026-10-02T08:39:21.733Z
- 下一动作：最终人工审查：真实供应商套餐与源时间延迟
- 评审人：Claude Code 自评估（用户授权，见 docs/reviews/AUTONOMOUS_DELIVERY.md）（自评估，待最终人工审查）

**执行步骤**

1. 确认主源套餐、配额、历史覆盖与展示许可。
2. 实现单批拉取、同批交叉率、快照、人工率和 fresh/stale/missing。
3. 记录真实 sourceAt 延迟与限流/断网测试。

**验收标准**

- [x] 正常源更新年龄目标达成或清楚记录差距。
- [x] 休市、过期、补录不改写历史；源故障不阻塞 SSR。

**证据**

- [docs/evidence/M3-FX/README.md](../docs/evidence/M3-FX/README.md)
- [packages/db/migrations/0005_fx.sql](../packages/db/migrations/0005_fx.sql)

**待最终人工审查**

- [ ] 用真实 FX 供应商凭据核实 60 秒更新、配额、历史覆盖与展示许可，并测量 source age
- [ ] 核对 P09 汇率页的 stale / suspect 提示文案

### M3-REPORTS · 报表口径、聚合与缓存

- 状态：完成；负责人：Claude Code；建议角色：后端 / 数据
- 依赖：M2-LEDGER, M3-FX；未完成依赖：无
- 估算：2 人日；更新：2026-10-02T08:58:35.541Z
- 下一动作：upcomingBills 随 M4-SUBS 接入；规模化查询计划随 M7-PERF
- 评审人：Claude Code 自评估（用户授权，见 docs/reviews/AUTONOMOUS_DELIVERY.md）（自评估，待最终人工审查）

**执行步骤**

1. 实现历史收支、净资产估值、分类、趋势与预算聚合。
2. 实现版本化缓存、缺率排除计数和退款期间规则。
3. 对账明细和聚合并记录 SQL 查询计划。

**验收标准**

- [x] 报表与有效明细合计一致；转账不计支出。
- [x] 不同用户、币种、口径缓存不混用；写后统计版本可追踪。

**证据**

- [docs/evidence/M3-REPORTS/README.md](../docs/evidence/M3-REPORTS/README.md)
- [packages/db/migrations/0007_reports.sql](../packages/db/migrations/0007_reports.sql)

**待最终人工审查**

- [ ] 抽查 12 个月真实数据的报表与明细对账

### M4-CORE · 认证、账目、账户与设置 UI

- 状态：进行中；负责人：Claude Code；建议角色：前端 / 全栈
- 依赖：M2-LEDGER；未完成依赖：无
- 估算：3 人日；更新：2026-10-02T08:59:41.805Z
- 下一动作：实现中

**执行步骤**

1. 按批准 UI 实现 P00/P02/P03/P06/P09/P11/P12。
2. 首屏 SSR，表单 REST 写入，完整空/错/冲突状态。
3. 补齐 keyboard/focus 与 URL 筛选。

**验收标准**

- [ ] 无需等待图表 JS 可读首屏信息。
- [ ] 记账、更正、退款、账户归档端到端通过。

**证据**

尚无完成证据。

### M4-SUBS · 周期订阅与支付确认

- 状态：进行中；负责人：Claude Code；建议角色：全栈开发
- 依赖：M2-LEDGER, M3-FX；未完成依赖：无
- 估算：3 人日；更新：2026-10-02T08:59:41.878Z
- 下一动作：实现中

**执行步骤**

1. 实现周期规则、锚点、唯一 occurrence 和状态机。
2. 实现列表/日历、新增/暂停/取消及实际支付关联。
3. 覆盖 31 日、闰年、DST、提前支付和重复确认。

**验收标准**

- [ ] 到期不自动成为已支付，已付记录唯一。
- [ ] 周期编辑取消未来旧版本任务且保留历史。

**证据**

尚无完成证据。

### M4-DASH · 总览、分析与预算可视化

- 状态：待开始；负责人：未分配；建议角色：前端
- 依赖：M3-REPORTS, M4-SUBS；未完成依赖：M4-SUBS
- 估算：2 人日；更新：2026-10-01T17:27:06.037Z
- 下一动作：按统一报表响应实现图表与钻取。

**执行步骤**

1. 实现 P01/P05 的 KPI、趋势、分类、预算和近期账单。
2. 图表懒加载；SSR 数值与数据表替代。
3. 钻取携带同一期间/口径并可返回。
4. 使用 echarts/core 按需注册 SVG 图表，以稳定 series.id / data.name 和 setOption 实现更新过渡；ResizeObserver / dispose 管理生命周期。

**验收标准**

- [ ] 图表合计与明细一致，缺率和预测清楚标注。
- [ ] 键盘/触摸均可钻取，JS 预算符合目标。
- [ ] ECharts 动画、同实例更新、深浅模式与主题色切换（同实例 setOption，数据语义色不变）、数据表替代、离屏/卸载资源清理通过；不计入首屏同步包。

**证据**

尚无完成证据。

### M4-THEME · 外观：主题色与深浅模式

- 状态：进行中；负责人：Claude Code；建议角色：前端 / 全栈
- 依赖：M1-API；未完成依赖：无
- 估算：1.5 人日；更新：2026-10-02T08:59:41.750Z
- 下一动作：实现中

**执行步骤**

1. 在 packages/ui 建立浅 / 深两套 CSS 变量令牌与固定语义色；Tailwind / shadcn 组件只引用令牌，不硬编码颜色。
2. 实现服务端与客户端共用的主题色生成器（OKLCH 调整、WCAG 对比度校验、palette_version）并编写单元测试。
3. 实现 user_preferences、GET/PATCH /api/v1/me/preferences 与 ln_appearance Cookie；根 layout SSR 输出 data-theme 与内联主题变量。
4. 实现顶栏外观浮层、移动 sheet 与 P13 页面；跟随系统监听 matchMedia；ECharts 同实例换色。

**验收标准**

- [ ] 浅色 / 深色 / 跟随系统 × 系统浅深共 6 种组合首帧即正确、无主题闪烁；跟随系统时切换系统外观，页面与图表即时更新。
- [ ] 全部预设与极端自定义色在两种模式下关键对比度 ≥4.5:1；非法颜色或未知预设返回 422 且不落库。
- [ ] 偏好跨设备同步、刷新保持；保存失败时仅本设备生效并提示；收支 / 警告 / 错误与图表数据色不随主题色变化。

**证据**

尚无完成证据。

### M4-RESP · 全页面移动端与无障碍验收

- 状态：待开始；负责人：未分配；建议角色：前端 / QA
- 依赖：M4-CORE, M4-DASH, M4-THEME；未完成依赖：M4-CORE, M4-DASH, M4-THEME
- 估算：2 人日；更新：2026-10-01T17:53:59.363Z
- 下一动作：按 P00–P13 覆盖矩阵逐页验收。

**执行步骤**

1. 检查 360/390/768/1440/1920px × 浅色 / 深色 / 跟随系统，并抽查非默认主题色。
2. 演练软键盘、底栏 safe-area、200% 缩放、弹层焦点。
3. 记录页面截图与键盘流程问题并修复。
4. 验证手机 ECharts 提示和钻取；prefers-reduced-motion 动态开启时禁用图表及 CSS 动画。

**验收标准**

- [ ] 页面无水平溢出，触摸目标/对比度通过。
- [ ] 手机可以独立完成记账、查询、订阅管理。
- [ ] 图表容器缩放不重播页面入场、不裁剪金额；减少动画时操作等价。

**证据**

尚无完成证据。

### M5-ENGINE · 提醒调度、Outbox 与可靠投递

- 状态：待开始；负责人：未分配；建议角色：后端
- 依赖：M4-SUBS；未完成依赖：M4-SUBS
- 估算：2.5 人日；更新：2026-10-02
- 下一动作：先用假供应商验证队列与任务状态机。

**执行步骤**

1. 实现规则、持久化 job、outbox、稳定去重键。
2. 实现免打扰、时区、过期、退避、DLQ 与 unknown 状态。
3. 实现 P07/P08 与日志可读反馈。

**验收标准**

- [ ] worker/Redis 重启可恢复，不重复入账。
- [ ] 已付/取消/规则版本变化使旧提醒失效。

**证据**

尚无完成证据。

### M5-TG · Telegram 通道

- 状态：待开始；负责人：未分配；建议角色：集成开发
- 依赖：M5-ENGINE；未完成依赖：M5-ENGINE
- 估算：1 人日；更新：2026-10-02
- 下一动作：准备该渠道测试接收人和凭据后实施。

**执行步骤**

1. 落实 Bot token/chat_id 与真实聊天接收。
2. 实现配置加密、测试投递、受理/失败状态和错误脱敏。
3. 通过真实接收验证与断网/凭据错误测试。

**验收标准**

- [ ] Telegram有独立接收证据，不用其他渠道结果替代。
- [ ] 密钥不回显，平台受理不误报用户已读。

**证据**

尚无完成证据。

### M5-FEISHU · 飞书通道

- 状态：待开始；负责人：未分配；建议角色：集成开发
- 依赖：M5-ENGINE；未完成依赖：M5-ENGINE
- 估算：1 人日；更新：2026-10-02
- 下一动作：准备该渠道测试接收人和凭据后实施。

**执行步骤**

1. 落实 复核官方签名/限流并使用真实测试群。
2. 实现配置加密、测试投递、受理/失败状态和错误脱敏。
3. 通过真实接收验证与断网/凭据错误测试。

**验收标准**

- [ ] 飞书有独立接收证据，不用其他渠道结果替代。
- [ ] 密钥不回显，平台受理不误报用户已读。

**证据**

尚无完成证据。

### M5-WECOM · 企业微信机器人与应用消息

- 状态：待开始；负责人：未分配；建议角色：集成开发
- 依赖：M5-ENGINE；未完成依赖：M5-ENGINE
- 估算：1.5 人日；更新：2026-10-02
- 下一动作：准备该渠道测试接收人和凭据后实施。

**执行步骤**

1. 落实 分别确认群机器人和应用消息权限/凭据。
2. 实现配置加密、测试投递、受理/失败状态和错误脱敏。
3. 通过真实接收验证与断网/凭据错误测试。

**验收标准**

- [ ] 企业微信有独立接收证据，不用其他渠道结果替代。
- [ ] 密钥不回显，平台受理不误报用户已读。

**证据**

尚无完成证据。

### M5-WX · 个人微信通道

- 状态：待开始；负责人：未分配；建议角色：集成开发
- 依赖：M5-ENGINE；未完成依赖：M5-ENGINE
- 估算：1.5 人日；更新：2026-10-02
- 下一动作：准备该渠道测试接收人和凭据后实施。

**执行步骤**

1. 落实 配置 pushplus wechat，用户绑定并核验额度/激活限制。
2. 实现配置加密、测试投递、受理/失败状态和错误脱敏。
3. 通过真实接收验证与断网/凭据错误测试。

**验收标准**

- [ ] 个人微信有独立接收证据，不用其他渠道结果替代。
- [ ] 密钥不回显，平台受理不误报用户已读。

**证据**

尚无完成证据。

### M5-OTHER · 站内、邮件与 Webhook

- 状态：待开始；负责人：未分配；建议角色：集成开发
- 依赖：M5-ENGINE；未完成依赖：M5-ENGINE
- 估算：1.5 人日；更新：2026-10-02
- 下一动作：准备该渠道测试接收人和凭据后实施。

**执行步骤**

1. 落实 实现站内兜底、SMTP、签名 Webhook 和 SSRF 校验。
2. 实现配置加密、测试投递、受理/失败状态和错误脱敏。
3. 通过真实接收验证与断网/凭据错误测试。

**验收标准**

- [ ] 其他有独立接收证据，不用其他渠道结果替代。
- [ ] 密钥不回显，平台受理不误报用户已读。

**证据**

尚无完成证据。

### M5-CHAOS · 提醒跨通道故障与恢复验收

- 状态：待开始；负责人：未分配；建议角色：QA / 后端
- 依赖：M5-TG, M5-FEISHU, M5-WECOM, M5-WX, M5-OTHER；未完成依赖：M5-TG, M5-FEISHU, M5-WECOM, M5-WX, M5-OTHER
- 估算：2 人日；更新：2026-10-02
- 下一动作：用故障注入演练完整通知链。

**执行步骤**

1. 模拟 429、5xx、响应丢失、重启和到期后暂停。
2. 验证个别渠道失败不重发成功渠道。
3. 检查漏发补扫、unknown、DLQ 重放和统计。

**验收标准**

- [ ] 每种故障有预期状态与恢复证据。
- [ ] 实测调度延迟符合预算，重复风险明确可见。

**证据**

尚无完成证据。

### M6-SERVER · MCP HTTP / stdio 服务与令牌

- 状态：待开始；负责人：未分配；建议角色：全栈 / Agent 集成
- 依赖：M1-API, M3-REPORTS, M4-SUBS, M5-ENGINE；未完成依赖：M4-SUBS, M5-ENGINE
- 估算：2.5 人日；更新：2026-10-02
- 下一动作：先实现只读 context/summary，再加入 preview/create。

**执行步骤**

1. 基于 REST SDK 实现工具 schemas、两个 transport 与查询 resources。
2. 实现 PAT scopes、账本隔离、撤销与审批资源。
3. 使用 MCP Inspector 和真实 API 校验错误/超时/重试。

**验收标准**

- [ ] MCP 不直连数据库、不另写资金逻辑。
- [ ] 只读令牌不可写，撤销立即生效，幂等跨入口一致。

**证据**

尚无完成证据。

### M6-SKILL · 正式 Skill 与配置包

- 状态：待开始；负责人：未分配；建议角色：Agent 集成
- 依赖：M6-SERVER；未完成依赖：M6-SERVER
- 估算：1 人日；更新：2026-10-02
- 下一动作：把设计草案升级为与已实现服务匹配的正式包。

**执行步骤**

1. 将草案对齐真实工具 schema，补少量真实用例。
2. 从单一来源生成四客户端分发包，保留同名覆盖保护。
3. 验证触发边界、缺字段澄清、stale、未知写入结果。

**验收标准**

- [ ] Skill 不虚构工具、权限、金额或成功状态。
- [ ] 安装说明不含真实 secret，四包内容口径一致。

**证据**

尚无完成证据。

### M6-CODEX · Codex 联调

- 状态：待开始；负责人：未分配；建议角色：Agent 集成 / QA
- 依赖：M6-SKILL；未完成依赖：M6-SKILL
- 估算：0.5 人日；更新：2026-10-02
- 下一动作：安装本项目正式包并在 Codex 中跑验收矩阵。

**执行步骤**

1. 锁定客户端版本，配置独立测试账本和只读/可写令牌。
2. 执行 API_AGENT_CONTRACT 的全部联调矩阵。
3. 保存脱敏工具输出、requestId 和数据库核对结果。

**验收标准**

- [ ] 该客户端读、预览写入、幂等、权限撤销和 Skill 发现通过。
- [ ] 记录实际 transport、协议、版本；配置存在不能代替实测。

**证据**

尚无完成证据。

### M6-CLAUDE · Claude Code 联调

- 状态：待开始；负责人：未分配；建议角色：Agent 集成 / QA
- 依赖：M6-SKILL；未完成依赖：M6-SKILL
- 估算：0.5 人日；更新：2026-10-02
- 下一动作：安装本项目正式包并在 Claude Code 中跑验收矩阵。

**执行步骤**

1. 锁定客户端版本，配置独立测试账本和只读/可写令牌。
2. 执行 API_AGENT_CONTRACT 的全部联调矩阵。
3. 保存脱敏工具输出、requestId 和数据库核对结果。

**验收标准**

- [ ] 该客户端读、预览写入、幂等、权限撤销和 Skill 发现通过。
- [ ] 记录实际 transport、协议、版本；配置存在不能代替实测。

**证据**

尚无完成证据。

### M6-DSH · DeepSeek Harness 联调

- 状态：待开始；负责人：未分配；建议角色：Agent 集成 / QA
- 依赖：M6-SKILL；未完成依赖：M6-SKILL
- 估算：1 人日；更新：2026-10-02
- 下一动作：安装本项目正式包并在 DeepSeek Harness 中跑验收矩阵。

**执行步骤**

1. 锁定客户端版本，配置独立测试账本和只读/可写令牌。
2. 执行 API_AGENT_CONTRACT 的全部联调矩阵。
3. 保存脱敏工具输出、requestId 和数据库核对结果。

**验收标准**

- [ ] 该客户端读、预览写入、幂等、权限撤销和 Skill 发现通过。
- [ ] 记录实际 transport、协议、版本；配置存在不能代替实测。

**证据**

尚无完成证据。

### M6-QODER · Qoder IDE / CLI 联调

- 状态：待开始；负责人：未分配；建议角色：Agent 集成 / QA
- 依赖：M6-SKILL；未完成依赖：M6-SKILL
- 估算：1 人日；更新：2026-10-02
- 下一动作：安装本项目正式包并在 Qoder IDE / CLI 中跑验收矩阵。

**执行步骤**

1. 锁定客户端版本，配置独立测试账本和只读/可写令牌。
2. 执行 API_AGENT_CONTRACT 的全部联调矩阵。
3. 保存脱敏工具输出、requestId 和数据库核对结果。

**验收标准**

- [ ] 该客户端读、预览写入、幂等、权限撤销和 Skill 发现通过。
- [ ] 记录实际 transport、协议、版本；配置存在不能代替实测。

**证据**

尚无完成证据。

### M7-SEC · 权限、密钥与数据安全验收

- 状态：待开始；负责人：未分配；建议角色：QA / 技术负责人
- 依赖：M4-RESP, M5-CHAOS, M6-CODEX, M6-CLAUDE, M6-DSH, M6-QODER；未完成依赖：M4-RESP, M5-CHAOS, M6-CODEX, M6-CLAUDE, M6-DSH, M6-QODER
- 估算：1.5 人日；更新：2026-10-02
- 下一动作：按安全验收矩阵执行并附报告。

**执行步骤**

1. 验证 ID 枚举、缓存串账、CSRF、PAT、SSRF、导入注入和日志脱敏。
2. 检查 Agent 注入样例与审批绑定请求哈希。
3. 记录问题等级并修复所有阻塞项。

**验收标准**

- [ ] 不存在跨账本读取/写入、明文密钥泄露。
- [ ] 高影响审批无法由模型自行批准或复用不同请求。

**证据**

尚无完成证据。

### M7-PERF · SSR、REST 与队列性能验收

- 状态：待开始；负责人：未分配；建议角色：性能 / 全栈
- 依赖：M4-RESP, M5-CHAOS；未完成依赖：M4-RESP, M5-CHAOS
- 估算：2 人日；更新：2026-10-01T17:27:06.037Z
- 下一动作：先建立可复现脚本再测量，不能用单次本地秒开替代。

**执行步骤**

1. 生成指定规模数据，记录硬件/网络/版本。
2. 运行 100 并发读写和冷热缓存场景，测 TTFB/API/SQL/队列。
3. 在代表性移动浏览器测 LCP/INP/CLS，检查 JS 包与响应缓存头。
4. 独立测量 ECharts 按需 chunk、首次交互、连续切换与动画帧表现，检查卸载后 observer / 实例释放。

**验收标准**

- [ ] 提交 p50/p95/p99、错误率和目标对比，未达项已解决或真实记录为未通过。
- [ ] 不同身份响应不串缓存，FX/通知故障不阻塞首屏。
- [ ] 图表懒加载不拖慢 SSR 指标；连续切页无图表实例累积，减弱动态模式不执行装饰动效。

**证据**

尚无完成证据。

### M7-E2E · 完整业务回归与导入导出

- 状态：待开始；负责人：未分配；建议角色：QA
- 依赖：M2-IMPORT, M7-SEC；未完成依赖：M7-SEC
- 估算：2 人日；更新：2026-10-02
- 下一动作：按测试环境和真实接收人执行最终回归。

**执行步骤**

1. 执行 AC01–AC10、P00–P13、四 Agent 矩阵和各币种边界。
2. 验证 mobile/desktop、两种微信及跨月订阅。
3. 整理缺陷清单、截图与数据库对账证据。

**验收标准**

- [ ] 所有 P0/P1 阻塞缺陷关闭，资金用例全部通过。
- [ ] 无 mock 代替真实必要渠道联调。

**证据**

尚无完成证据。

### M7-OPS · 部署、备份恢复与运行手册

- 状态：待开始；负责人：未分配；建议角色：运维 / 全栈
- 依赖：M7-SEC；未完成依赖：M7-SEC
- 估算：1.5 人日；更新：2026-10-02
- 下一动作：准备生产基础设施并先完成预生产恢复演练。

**执行步骤**

1. 确定生产环境、HTTPS、域名、队列进程与监控。
2. 配置备份/WAL/密钥恢复，在隔离环境实际恢复。
3. 演练应用升级、兼容迁移与回滚。

**验收标准**

- [ ] 恢复后的余额与审计对账一致，RPO/RTO 有测量结果。
- [ ] TG 与国内消息通道可达，worker 不依赖 Web 进程存活。

**证据**

尚无完成证据。

### G1 · 发布验收与交接

- 状态：待开始；负责人：未分配；建议角色：产品 / 技术负责人
- 依赖：M7-PERF, M7-E2E, M7-OPS；未完成依赖：M7-PERF, M7-E2E, M7-OPS
- 估算：0.5 人日；更新：2026-10-02
- 下一动作：准备发布记录，按部署权限实施发布与交接。

**执行步骤**

1. 汇总验收报告和遗留问题，确认所有 R1–R8 覆盖。
2. 按部署说明发布并执行最小 smoke。
3. 交付运维、用户、Agent 安装说明和回滚版本。

**验收标准**

- [ ] 性能/功能/渠道/Agent/恢复均有证据，不存在未完成必需项。
- [ ] 发布负责人签署，当前版本与回滚版本可追溯。

**证据**

尚无完成证据。

## 最终人工审查清单

以下任务由实现者按验收标准自评估并以本机 Docker 端到端测试为依据标记完成；第三方服务以本地 mock 验证。人工审查时逐项核对，未通过的任务应退回 in_review。

| ID | 任务 | 自评估依据 | 需人工确认 |
| --- | --- | --- | --- |
| M1-AUTH | 身份、账本与权限 | docs/evidence/M1-AUTH/README.md；docs/evidence/SELF_REVIEW.md | 人工抽查登录、退出、成员角色变更与最后 owner 提示 |
| M1-API | OpenAPI、错误模型与 REST SDK | docs/evidence/M1-API/README.md；packages/contracts/openapi.json；docs/evidence/SELF_REVIEW.md | 核对远程 GitHub Actions 的 contract:check 与 Docker E2E 结果 |
| M2-MODEL | 账务 schema 与金额运算 | docs/evidence/M2-MODEL/README.md；packages/db/migrations/0003_ledger_core.sql；docs/evidence/SELF_REVIEW.md | 按验收标准复核 |
| M2-LEDGER | 收支、转账、退款与更正 | docs/evidence/M2-LEDGER/README.md；packages/db/migrations/0004_previews.sql；docs/evidence/SELF_REVIEW.md | 按验收标准复核 |
| M2-IMPORT | CSV 导入导出与可撤销批次 | docs/evidence/M2-IMPORT/README.md；packages/db/migrations/0006_imports.sql | 人工用真实银行导出 CSV 走一遍映射、校验、提交与撤销 |
| M3-FX | 分钟汇率、历史补录和降级 | docs/evidence/M3-FX/README.md；packages/db/migrations/0005_fx.sql | 用真实 FX 供应商凭据核实 60 秒更新、配额、历史覆盖与展示许可，并测量 source age；核对 P09 汇率页的 stale / suspect 提示文案 |
| M3-REPORTS | 报表口径、聚合与缓存 | docs/evidence/M3-REPORTS/README.md；packages/db/migrations/0007_reports.sql | 抽查 12 个月真实数据的报表与明细对账 |

## 变更历史

| 时间 | 任务 | 变更 | 操作者 | 说明 |
| --- | --- | --- | --- | --- |
| 2026-10-02 | ALL | 未建立 → 设计评审稿 | Codex | 建立设计、执行步骤、验收与依赖；只有资料核查记为完成，UI/契约待评审，业务开发尚未开始。 |
| 2026-10-01T17:14:41.258Z | M0-UI | in_review → in_review | Codex | 原型响应式与主要交互自检完成，保存截图；等待用户设计验收 |
| 2026-10-01T17:27:06.037Z | M0-UI | in_review → in_review | Codex | 根据用户要求统一 ECharts 并增加图表动效与性能验收；状态保持不变。 |
| 2026-10-01T17:27:06.037Z | M4-DASH | todo → todo | Codex | 根据用户要求统一 ECharts 并增加图表动效与性能验收；状态保持不变。 |
| 2026-10-01T17:27:06.037Z | M4-RESP | todo → todo | Codex | 根据用户要求统一 ECharts 并增加图表动效与性能验收；状态保持不变。 |
| 2026-10-01T17:27:06.037Z | M7-PERF | todo → todo | Codex | 根据用户要求统一 ECharts 并增加图表动效与性能验收；状态保持不变。 |
| 2026-10-01T17:53:59.240Z | M0-UI | in_review → in_review | Claude Code | 根据用户要求增加可修改主题色，以及浅色 / 深色适配（手动切换与跟随系统）；原型与 UI 规范更新到 0.3，状态保持待验收。 |
| 2026-10-01T17:53:59.302Z | M4-THEME | todo → todo | Claude Code | 新增任务：实现主题色与深浅模式（令牌、生成器、偏好 API、SSR 首帧、外观设置），估算 1.5 人日。 |
| 2026-10-01T17:53:59.363Z | M4-RESP | todo → todo | Claude Code | 增加依赖 M4-THEME，响应式验收覆盖三种显示模式与非默认主题色；状态保持不变。 |
| 2026-10-01T18:34:24.657Z | M0-UI | in_review → done | Codex | 用户明确要求严格按现有 UI 原型开始实现；记录授权原文，不冒充逐项人工测试 |
| 2026-10-01T18:34:24.850Z | M0-CONTRACT | in_review → done | Codex | 按用户指示进入实现，数据库改为 MySQL 8.4 LTS 并同步方案 |
| 2026-10-01T18:34:25.017Z | G0 | todo → done | Codex | 当前会话明确授权按照方案开始实现，原文作为放行依据 |
| 2026-10-01T18:34:25.173Z | M1-BASE | todo → in_progress | Codex | 已建立工程、MySQL迁移、Docker栈和测试；正在本机 Docker 验证 |
| 2026-10-01T19:06:56.553Z | M1-BASE | in_progress → in_review | Claude Code | 修复认证限流导致的 E2E 失败与色块可访问名称；本机 Docker E2E 11/11 通过，干净检出启动通过，镜像摘要锁定并补版本清单；远程 CI 未运行 |
| 2026-10-01T19:33:00.221Z | M1-AUTH | todo → todo | Claude Code | 核对 Codex 已实现的身份 / 账本 / 权限：跨账本隔离、会话撤销、最后 owner 并发保护、认证限流在 Docker E2E 通过；按门禁规则前置未 done 前不改状态 |
| 2026-10-01T19:33:00.357Z | M1-API | todo → todo | Claude Code | 83 个操作的 OpenAPI 3.1 + SDK + 破坏性变更门禁；注册表驱动路由、签名游标、事务内幂等；单元 77 通过，Docker E2E 16 通过；按门禁规则前置未 done 前不改状态 |
| 2026-10-01T19:33:00.491Z | M1-BASE | in_review → in_review | Claude Code | 测试容器改为直接运行 Playwright；含 M1-API 的最终 Docker E2E 16/16 通过 |
| 2026-10-02T07:19:37.634Z | M1-BASE | in_review → done | Claude Code | 用户在会话中明确验收 M1-BASE；本机 Docker E2E 16/16 与干净检出启动为依据，远程 CI 尚未运行 |
| 2026-10-02T07:19:37.792Z | M1-AUTH | todo → in_review | Claude Code | 前置 M1-BASE 已完成，实现与 Docker 验证证据提交评审 |
| 2026-10-02T07:35:57.611Z | M2-MODEL | todo → todo | Claude Code | 账务核心迁移 0003（复合外键 / CHECK / 回滚脚本）、decimal 金额模块、appendPostings 与余额核对；单元 124、MySQL 集成 13、Playwright 16 通过；按门禁规则前置未 done 前不改状态 |
| 2026-10-02T07:58:36.219Z | M2-LEDGER | todo → todo | Claude Code | 20 个记账操作转为 stable：预览单次提交、幂等重放、转账含手续费、退款上限、更正冲正、作废；单元 125、MySQL 集成 24、Playwright 19 通过；按门禁规则前置未 done 前不改状态 |
| 2026-10-02T08:19:14.765Z | M1-AUTH | in_review → done | Claude Code | 按验收标准自评估：本机 Docker E2E（集成 24、Playwright 19）通过；用户授权跳过逐项人工审查 |
| 2026-10-02T08:19:14.809Z | M1-API | todo → done | Claude Code | 契约检查与 contract.api.ts 5 个用例通过，自评估完成 |
| 2026-10-02T08:19:14.856Z | M2-MODEL | todo → done | Claude Code | 精度单测、MySQL 集成与迁移回滚演练通过，自评估完成 |
| 2026-10-02T08:19:14.934Z | M2-LEDGER | todo → done | Claude Code | 幂等、转账、退款、更正、作废的集成与 API E2E 通过，自评估完成 |
| 2026-10-02T08:19:28.603Z | M3-FX | todo → in_progress | Claude Code | 开始实施；供应商按用户要求使用本地 mock，不连接真实服务 |
| 2026-10-02T08:39:21.733Z | M3-FX | in_progress → done | Claude Code | Fixer 协议适配 + 本地 mock；新鲜度 / 锁定汇率 / 历史补录 / 人工汇率 / 刷新任务；Docker E2E：集成 36、Playwright 23 通过 |
| 2026-10-02T08:39:26.875Z | M2-IMPORT | todo → in_progress | Claude Code | 开始实施：异步校验 / 提交 / 撤销（outbox → BullMQ）、行指纹去重、导出公式转义与创建者下载 |
| 2026-10-02T08:52:26.377Z | M3-REPORTS | todo → in_progress | Claude Code | 报表 5 个接口与预算 CRUD 实现；数据版本缓存键；集成 53 通过（本机 MySQL） |
| 2026-10-02T08:58:35.485Z | M2-IMPORT | in_progress → done | Claude Code | 异步校验 / 提交 / 撤销、行指纹去重、导出防公式注入与创建者下载；Docker E2E：集成 53、Playwright 26 通过 |
| 2026-10-02T08:58:35.541Z | M3-REPORTS | in_progress → done | Claude Code | summary / cash-flow / 分类 / 净资产 / 预算进度与预算 CRUD；数据版本缓存；Docker E2E 通过 |
| 2026-10-02T08:59:41.750Z | M4-THEME | todo → in_progress | Claude Code | 开始实施（按 v0.3 原型） |
| 2026-10-02T08:59:41.805Z | M4-CORE | todo → in_progress | Claude Code | 开始实施（按 v0.3 原型） |
| 2026-10-02T08:59:41.878Z | M4-SUBS | todo → in_progress | Claude Code | 开始实施（按 v0.3 原型） |
