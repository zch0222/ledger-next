# Ledger Next · 个人与家庭账本

版本：0.4（首批实现）｜日期：2026-10-02｜时区：Asia/Hong_Kong

已开始按 v0.3 UI 原型实现：Next.js 应用、MySQL 数据库、Session 登录、创建 / 切换账本及成员权限。Docker Compose 提供 Web、迁移、MySQL、Redis 和 worker 基础进程；Playwright 在本机 Docker 中验证真实 API 和浏览器流程。资金记账、订阅、汇率、通知和 MCP 仍按后续里程碑推进，当前不是完整首发版本。

## 本机 Docker 启动

本机只需要 Docker Engine / Docker Desktop（Compose ≥2.24.4），不需要 Node.js 或 pnpm：依赖安装、镜像构建、质量检查和测试编排都在容器里完成。

```powershell
docker compose -f compose.tools.yaml run --rm setup-env
docker compose up -d --build --wait
```

第一条命令在容器里生成 `.env`（随机本地密钥）。访问 http://localhost:3000 创建账号和账本。详见[实现状态与运行说明](docs/IMPLEMENTATION.md)。

```powershell
docker build --target verify .
docker compose -f compose.tools.yaml run --rm e2e
```

`verify` 构建阶段执行 lint、typecheck、单元测试、契约检查与进度校验，任一失败即构建失败；`e2e` 等同 `pnpm test:e2e`，自动创建独立 Docker 项目 / MySQL 测试卷，生成报告后清理测试栈；不会覆盖开发数据。本机装有 Node 24 与 pnpm 11.19.0 时，`pnpm lint`、`pnpm test:e2e` 等命令照常可用。

## 服务器部署

生产主机同样只需要 Docker：Linux，4 vCPU / 8 GB 起，Docker Engine + Compose ≥2.24.4，开启时间同步（chrony）。监控、备份、恢复和常见事件处理见[运行手册](docs/RUNBOOK.md)。

1. 获取代码并切到要发布的版本：

   ```bash
   git clone <仓库地址> ledger-next && cd ledger-next
   git checkout <发布标签或提交>
   ```

2. 生成 `.env`（随机密钥，权限 600，已存在时拒绝覆盖），再按[运行手册 §2](docs/RUNBOOK.md#2-首次部署)填写：

   ```bash
   docker compose -f compose.tools.yaml run --rm setup-env
   ```

   至少把 `APP_URL` 改成对外 HTTPS 地址（例如 `https://ledger.example`），Cookie Secure、CSRF 和 MCP Host 校验都以它为准；按需配置 `FX_PROVIDER_URL` / `FX_PROVIDER_KEY`、`SMTP_URL`、`LEDGER_ADMIN_EMAILS`。`LEDGER_ENCRYPTION_KEYS` 和 `BETTER_AUTH_SECRET` 要与数据库备份分开保存：主密钥丢失后渠道凭据无法解密。

3. 构建镜像并启动。依赖安装和构建都在镜像内完成；`migrate` 先执行迁移，成功后才启动 web / worker：

   ```bash
   docker compose up -d --build --wait
   ```

   生产只用 `compose.yaml`；`compose.mock.yaml`、`compose.test.yaml`、`compose.perf.yaml`、`compose.ops.yaml` 仅用于本地演示和测试。

4. 反向代理（Caddy / Nginx）终止 HTTPS，转发到 `127.0.0.1:${WEB_PORT}`（默认 3000，只监听本机）：保留 `Host`，用真实客户端地址覆盖 `X-Forwarded-For`（限流按它计数），并加 `Strict-Transport-Security: max-age=31536000`。MySQL / Redis 只在容器网络内可达，不要暴露到公网。

5. 检查服务状态和就绪接口：

   ```bash
   docker compose ps
   curl -fsS https://ledger.example/api/health/ready
   ```

   首个用户注册后，在「账本设置」确认时区与基准币，在「提醒渠道」逐个发送测试消息并确认真实收到。

6. 配置每日全量备份（命令见[运行手册 §4](docs/RUNBOOK.md#4-备份)），备份文件与 `.env` 中的密钥分开存放。

升级时先做一次全量备份并校验，再拉取新版本、重新构建并滚动启动：

```bash
git pull
docker compose up -d --build --wait
```

迁移只做向后兼容的新增，应用回滚只需切回上一个版本并重新构建；数据库回滚与从备份恢复见[运行手册 §5–6](docs/RUNBOOK.md#5-恢复)。构建机处在 TLS 被代理重签的网络里时，用 `LEDGER_BUILD_CA` 叠加 `compose.build-ca.yaml`，见[运行说明](docs/IMPLEMENTATION.md#运行)。

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

需 Node.js 22 或更高版本，无需安装 npm 依赖；本机没有 Node 时在命令前加 `docker compose -f compose.tools.yaml run --rm tools`。在仓库根目录执行：

~~~powershell
node scripts/progress.mjs status
node scripts/progress.mjs next
node scripts/progress.mjs show M0-UI
node scripts/progress.mjs validate
~~~

后续修改状态时使用 update 子命令，完整示例见[执行手册](docs/DELIVERY_PLAN.md)。脚本检查任务依赖、完成证据和评审门禁，并重新生成进度文档；不会自动开发、部署或发送消息。

**开发基线：v0.3 原型 + 本轮明确要求的 MySQL / Docker / 测试变更。** 用户于 2026-10-02 指示按方案开始实现；授权原文记录在 G0 文档，不代签额外的人工验收。技术完成和待用户验收事项分别保留证据。

需求补充已纳入：微信包括企业微信和个人微信；dsh 指 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。
