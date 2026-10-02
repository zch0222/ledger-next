# Ledger Next · 个人与家庭账本

版本：0.4（首批实现）｜日期：2026-10-02｜时区：Asia/Hong_Kong

已开始按 v0.3 UI 原型实现：Next.js 应用、MySQL 数据库、Session 登录、创建 / 切换账本及成员权限。Docker Compose 提供 Web、迁移、MySQL、Redis 和 worker 基础进程；Playwright 在本机 Docker 中验证真实 API 和浏览器流程。资金记账、订阅、汇率、通知和 MCP 仍按后续里程碑推进，当前不是完整首发版本。

## 本机 Docker 启动

```powershell
pnpm install --frozen-lockfile
node scripts/setup-env.mjs
docker compose up -d --build --wait
```

访问 http://localhost:3000 创建账号和账本。需要 Node 24、pnpm 11.19.0 和 Docker Compose ≥2.24.4。详见[实现状态与运行说明](docs/IMPLEMENTATION.md)。

```powershell
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm contract:check
pnpm test:e2e
```

端到端测试自动创建独立 Docker 项目 / MySQL 测试卷，生成报告后清理测试栈；不会覆盖开发数据。

## 从这里开始

| 文档 / 工具 | 用途 |
| --- | --- |
| [技术方案](docs/TECHNICAL_DESIGN.md) | 范围、Next.js 全栈架构、账务模型、多币种、汇率、提醒、SSR、部署与质量目标 |
| [UI 设计规范](docs/UI_SPEC.md) | 信息架构、桌面 / 移动端页面、字段、组件、交互、异常状态、主题色与深浅模式、验收标准 |
| [可点击 UI 原型](docs/ui/index.html) | 离线打开；ECharts 动画图表、数据钻取、页面、记账、币种切换，以及外观设置：浅色 / 深色 / 跟随系统、7 个预设主题色和自定义色；所有数据均为演示数据 |
| [操作逻辑图](docs/USER_FLOWS.md) | 记账、转账、订阅、汇率、提醒、Agent 写入的 Mermaid 流程与状态图 |
| [REST / MCP / Skill 契约](docs/API_AGENT_CONTRACT.md) | API 规范、工具映射、Codex / Claude Code / dsh / Qoder 配置与联调矩阵 |
| [OpenAPI 3.1](packages/contracts/openapi.json) | 由 Zod 契约生成的全部 REST 资源（stable 已实现 / planned 计划中），类型化 SDK 在 `packages/api-client` |
| [里程碑与执行手册](docs/DELIVERY_PLAN.md) | 开发顺序、前置门禁、交付方式、排期假设、更新命令 |
| [实时进度文档](docs/MILESTONES.md) | 根据任务数据生成的完成率、依赖、阻塞、任务步骤与验收清单 |
| [进度唯一数据源](docs/milestones.json) | 可更新任务状态、负责人、证据、估算和变更历史 |
| [设计评审记录](docs/reviews/DESIGN_REVIEW.md) | UI 基线与本轮用户实施授权记录 |
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

**开发基线：v0.3 原型 + 本轮明确要求的 MySQL / Docker / 测试变更。** 用户于 2026-10-02 指示按方案开始实现；授权原文记录在 G0 文档，不代签额外的人工验收。技术完成和待用户验收事项分别保留证据。

需求补充已纳入：微信包括企业微信和个人微信；dsh 指 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。
