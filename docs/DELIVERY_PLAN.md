# 里程碑与可执行交付计划

版本 0.2 · 2026-10-02。用户已明确授权按现有方案与 UI 原型开始实现；新增 MySQL、Docker 部署、本机 Docker 端到端验证要求。首批范围与证据见 IMPLEMENTATION.md。

## 1. 数据与职责

[milestones.json](milestones.json) 是任务状态、依赖、估算、执行步骤、验收标准和证据的唯一数据源；[MILESTONES.md](MILESTONES.md) 由脚本生成便于阅读。每个任务都有稳定 ID，讨论、PR、截图和测试报告均引用 ID。

当前有 35 项任务，共 57.5 估算人日，包含设计。估算是规划基线，不是交期承诺：一名全栈开发、产品定期评审及 QA 参与，按每周 5 工作日加约 20% 缓冲，建议预留 13–15 周；两名开发加产品 / QA 可交错推进，建议 7–9 周。外部账号、渠道审核或设计反复会延长日历周期。这里的角色是建议分工，不代表已经指派人员或启动其他 Agent。

## 2. 里程碑验收出口

| 里程碑 | 核心交付 | 出口条件 |
| --- | --- | --- |
| M0 | 详细设计、UI 原型、操作图、接口与 Skill 草案 | UI 和技术评审记录完成；G0 签署 |
| M1 | Next 全栈工程、认证与授权、OpenAPI / SDK | 空环境可启动、CI 通过、跨账本隔离 |
| M2 | 账户、资金写入、退款转账、导入导出 | 金额不变量和幂等并发验证通过 |
| M3 | 分钟 FX、历史快照、聚合口径 | 正常新鲜度与降级实测，明细与汇总一致 |
| M4 | 订阅、总览、账目、分析、全部响应式 UI | 各断点与主要业务操作完整通过 |
| M5 | 调度和所有提醒通道 | TG / 飞书 / 企微 / 个人微信分别实测，故障恢复 |
| M6 | MCP 双入口、Skill、四客户端适配 | 四客户端验收矩阵全部有证据 |
| M7 | 安全、性能、回归、恢复、发布手册 | G1 发布评审签署；不存在未完成的必需项 |

每个执行卡的前置任务、逐步操作与详细验收见自动生成文档。不可为了提前发布把用户指定通道或客户端移到“未来版本”而宣称首发完成。

## 3. 依赖与推荐执行顺序

~~~mermaid
flowchart LR
  A[M0 需求 / UI / 契约] --> G[G0 用户和技术评审]
  G --> B[M1 工程 / 权限 / API]
  B --> C[M2 账务模型 / 资金]
  C --> D[M3 汇率 / 报表]
  C --> E[M4 核心 UI]
  D --> F[M4 订阅 / 可视化]
  F --> N[M5 提醒引擎与渠道]
  F --> M[M6 MCP / Skill]
  N --> M
  E --> Q[M7 性能 / 回归 / 安全]
  N --> Q
  M --> Q
  Q --> O[M7 恢复 / 发布 G1]
~~~

图只表达阶段关系，任务级依赖以 JSON 为准。可以在依赖满足后同时推进互不影响的任务；例如 M2 导入导出与 M3 FX，但不能跳过 G0。开发时 UI 发生重大变化，应先更新批准设计并记录变更。

## 4. 更新进度

脚本使用 Node.js ≥22，无第三方依赖；在根目录执行。脚本只写任务 JSON 和生成文档，不会安装依赖或调用远程服务。没有 Node 命令时使用系统实际 Node 可执行文件替代命令首项；本机未安装 Node 时在命令前加 `docker compose -f compose.tools.yaml run --rm tools`（只需 Docker）。

~~~powershell
# 看当前状态、下一步和单个执行卡
node scripts/progress.mjs status
node scripts/progress.mjs next
node scripts/progress.mjs show M0-UI

# 校验依赖、证据和生成文档是否一致
node scripts/progress.mjs validate

# 手工编辑 JSON 的步骤、估算、验收后重新生成
node scripts/progress.mjs render
~~~

以下示例只在实际评审 / 实施完成后执行；张三、李四是示例人员：

~~~powershell
# 真实 UI 评审通过后
node scripts/progress.mjs update M0-UI --status done --owner "张三" --reviewer "李四" --evidence docs/reviews/DESIGN_REVIEW.md --actor "张三" --note "按记录完成桌面移动端和流程评审"

# 技术契约也通过后再签署 G0
node scripts/progress.mjs update M0-CONTRACT --status done --owner "张三" --reviewer "李四" --evidence docs/reviews/DESIGN_REVIEW.md --actor "张三" --note "账务与接口契约已审阅"
node scripts/progress.mjs update G0 --status done --owner "李四" --reviewer "李四" --evidence docs/reviews/DESIGN_REVIEW.md --actor "李四" --note "已填写正式设计验收结论"

# G0 完成后才可开始基础工程
node scripts/progress.mjs update M1-BASE --status in_progress --owner "张三" --actor "张三" --note "按批准设计开始工程初始化"

# 外部条件阻塞示例
node scripts/progress.mjs update M3-FX --status blocked --owner "张三" --reason "等待分钟更新测试套餐" --next "获得测试凭据后验证源时间" --actor "张三" --note "已记录供应商依赖"
~~~

支持状态：todo / ready / in_progress / in_review / blocked / done。ready、in_progress、in_review、done 均要求所有前置 done；blocked 必須有原因。done 要实际负责人、证据，需评审任务还要 reviewer。进入 done 后，若把其前置降级而后续仍活跃，脚本拒绝更新，需先处理受影响后续任务。

脚本检查本地证据存在、依赖无环、门禁与状态一致，并记录每次命令的操作者 / 原状态 / 新状态 / 说明。它不能验证人是否真正看过截图，也不代替评审签署；读写该仓库的人仍负验收责任。远程证据只允许 HTTP(S) 链接，真实性由评审核实。

进度只把 done 的估算人日计入分子，in_review 不算部分完成；单独展示业务开发进度，避免文档产出让人误以为产品已开发。需要更细进度时拆分任务，不手填百分比。

更新应由一个写入者串行执行；每次命令对单文件原子替换，JSON / Markdown 两文件不是数据库事务。若进程在两次写入之间中断，运行 render 恢复生成文档，再 validate。使用 Git diff 审阅变更，不直接覆盖并行编辑者的数据。

## 5. 开发任务执行规范

开始前读取任务 steps / acceptance、对应页面与契约，确认依赖和 owner。一个任务对应可验收的提交或 PR；提交说明引用 ID。遇到设计歧义先形成具体示例并更新决策，不能由前端、API、MCP 各自解释。

完成时提交：实现入口、验证命令、实际结果、必要截图 / 日志、已知问题。建议证据目录 docs/evidence/{task-id}/，报告首部写日期、commit、环境和版本；真实凭据、个人账单不入 Git。PR 链接可作为 evidence，但必须补清楚测试结论。

最小完成定义：

- 页面 / REST / MCP 对应行为与批准设计一致。
- 所需验证通过，真实渠道 / 客户端联调没有用 mock 替代。
- 错误、权限、加载和重试状态已处理。
- 契约、用户 / 运维说明、任务证据与状态同步。
- reviewer 按验收标准判断完成，未通过保持 in_review 或 blocked。

## 6. 实施阶段验证命令约定

下列为分阶段建立的命令契约；lint、typecheck、unit、integration、contract、e2e、build 已建立。perf 随 M7 实现，不能把尚未建立的命令报告为通过。`test:contract`（= `contract:check`）检查生成的 OpenAPI / SDK 与破坏性变更；针对真实服务的 REST / SDK 契约用例在 `tests/e2e/contract.api.ts`，随 `test:e2e` 在 Docker 中执行：

~~~text
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:contract
pnpm test:e2e
pnpm test:perf
pnpm build
~~~

金额 / 日历纯逻辑用 unit；资金事务 / 授权 / outbox 用真实 MySQL/Redis integration；REST/SDK/MCP 用 contract；用户主要流程和移动端用 e2e。用户要求端到端验证基于本机 Docker，因此 `pnpm test:e2e` 负责生产镜像构建、独立 MySQL 测试卷、迁移、健康检查及 Playwright 容器。单元覆盖率须注明文件范围，不能用纯函数覆盖率宣称全仓覆盖。性能按照技术方案固定环境执行。

## 7. 当前下一步

G0 的实施授权来自用户 2026-10-02 当前会话，原文存于 DESIGN_REVIEW。按 M1-BASE → M1-AUTH → M1-API 顺序提交验证证据（见 docs/evidence/）。M1 三项的实现与本机验证已完成，状态以 milestones.json 为准：依赖任务未经评审签署前，后续任务不能进入 in_review。资金域从 M2-MODEL 开始。技术验证可由 Codex 记录自检结论，但不冒充独立人工签署或远程 CI 结果。
