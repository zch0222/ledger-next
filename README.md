# Ledger Next · 记账项目设计包

版本：0.2（设计评审稿）｜日期：2026-10-02｜时区：Asia/Hong_Kong

本次交付是开发前设计、交互原型和可维护的执行计划。尚未实现 Next.js 应用、REST API、通知服务或 MCP 服务，也没有部署或发送真实通知。

## 从这里开始

| 文档 / 工具 | 用途 |
| --- | --- |
| [技术方案](docs/TECHNICAL_DESIGN.md) | 范围、Next.js 全栈架构、账务模型、多币种、汇率、提醒、SSR、部署与质量目标 |
| [UI 设计规范](docs/UI_SPEC.md) | 信息架构、桌面 / 移动端页面、字段、组件、交互、异常状态、验收标准 |
| [可点击 UI 原型](docs/ui/index.html) | 离线打开；ECharts 动画图表、数据钻取、页面、记账、币种与主题切换；所有数据均为演示数据 |
| [操作逻辑图](docs/USER_FLOWS.md) | 记账、转账、订阅、汇率、提醒、Agent 写入的 Mermaid 流程与状态图 |
| [REST / MCP / Skill 契约](docs/API_AGENT_CONTRACT.md) | API 规范、工具映射、Codex / Claude Code / dsh / Qoder 配置与联调矩阵 |
| [里程碑与执行手册](docs/DELIVERY_PLAN.md) | 开发顺序、前置门禁、交付方式、排期假设、更新命令 |
| [实时进度文档](docs/MILESTONES.md) | 根据任务数据生成的完成率、依赖、阻塞、任务步骤与验收清单 |
| [进度唯一数据源](docs/milestones.json) | 可更新任务状态、负责人、证据、估算和变更历史 |
| [设计评审记录](docs/reviews/DESIGN_REVIEW.md) | UI 与流程在开发前的验收签署；目前待评审 |
| [设计包自检](docs/reviews/DESIGN_QA.md) | 原型交互、响应式、进度门禁测试与截图；不替代用户验收 |
| [决策记录](docs/DECISIONS.md) | 设计默认值、已确认范围、尚待上线前落实的供应商 / 部署决策 |
| [参考来源](docs/REFERENCES.md) | Wallos、框架、MCP、四种 Agent 和通知供应商的官方资料 |
| [配套 Skill 草案](docs/skill-draft/ledger-service/SKILL.md) | 服务实现后打包分发；当前未安装，不能凭此调用未实现服务 |

## 更新进度

需 Node.js 22 或更高版本，无需安装 npm 依赖。在仓库根目录执行：

~~~powershell
node scripts/progress.mjs status
node scripts/progress.mjs next
node scripts/progress.mjs show M0-UI
node scripts/progress.mjs validate
~~~

后续修改状态时使用 update 子命令，完整示例见[执行手册](docs/DELIVERY_PLAN.md)。脚本检查任务依赖、完成证据和评审门禁，并重新生成进度文档；不会自动开发、部署或发送消息。

**开发顺序：先完成 UI 与操作逻辑评审 G0，再开始 M1 及后续业务开发。** 当前原型和文档可供评审，评审通过不由文档作者代签。

需求补充已纳入：微信包括企业微信和个人微信；dsh 指 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。
