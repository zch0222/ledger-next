# Ledger Next · 个人与家庭账本

版本：0.4（首批实现）｜日期：2026-10-02｜时区：Asia/Hong_Kong

已开始按 v0.3 UI 原型实现：Next.js 应用、MySQL 数据库、Session 登录、创建 / 切换账本及成员权限。Docker Compose 提供 Web、迁移、MySQL、Redis 和 worker 基础进程；Playwright 在本机 Docker 中验证真实 API 和浏览器流程。资金记账、订阅、汇率、通知和 MCP 仍按后续里程碑推进，当前不是完整首发版本。

## 本机 Docker 启动

本机只需要 Docker Engine / Docker Desktop（Compose ≥2.24.4），不需要 Node.js 或 pnpm：依赖安装、镜像构建、质量检查和测试编排都在容器里完成。

```powershell
docker compose -f compose.tools.yaml run --rm setup-env
docker compose up -d --build --wait
```

第一条命令在容器里运行 [scripts/setup-env.sh](scripts/setup-env.sh)，按 [.env.example](.env.example) 生成带随机密钥的 `.env`（有 sh 的环境也可直接 `sh scripts/setup-env.sh`），各变量见[环境变量](#环境变量)。访问 http://localhost:3000 创建账号和账本。详见[实现状态与运行说明](docs/IMPLEMENTATION.md)。

```powershell
docker build --target verify .
docker compose -f compose.tools.yaml run --rm e2e
```

`verify` 构建阶段执行 lint、格式检查、typecheck、单元测试、契约检查与进度校验，任一失败即构建失败；代码格式不合规时运行 `docker compose -f compose.tools.yaml run --rm format` 自动修正；`e2e` 等同 `pnpm test:e2e`，自动创建独立 Docker 项目 / MySQL 测试卷，生成报告后清理测试栈；不会覆盖开发数据。本机装有 Node 24 与 pnpm 11.19.0 时，`pnpm lint`、`pnpm test:e2e` 等命令照常可用。

## 服务器部署

生产主机同样只需要 Docker：Linux，4 vCPU / 8 GB 起，Docker Engine + Compose ≥2.24.4，开启时间同步（chrony）。监控、备份、恢复和常见事件处理见[运行手册](docs/RUNBOOK.md)。

1. 获取代码并切到要发布的版本：

   ```bash
   git clone <仓库地址> ledger-next && cd ledger-next
   git checkout <发布标签或提交>
   ```

2. 生成 `.env`，同时写入对外 HTTPS 地址（密钥随机生成且不输出，权限 600，已存在时拒绝覆盖）：

   ```bash
   sh scripts/setup-env.sh --app-url https://ledger.example
   ```

   主机上没有 sh 时用 `docker compose -f compose.tools.yaml run --rm setup-env --app-url https://ledger.example`。再按[环境变量](#环境变量)按需配置汇率、邮件等第三方服务；`BETTER_AUTH_SECRET` 和 `LEDGER_ENCRYPTION_KEYS` 要与数据库备份分开保存：主密钥丢失后渠道凭据无法解密。

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

## 环境变量

配置写在仓库根目录的 `.env`，由 Docker Compose 读取。模板是 [.env.example](.env.example)，不要手工复制，用 [scripts/setup-env.sh](scripts/setup-env.sh) 生成：

```bash
sh scripts/setup-env.sh [--app-url https://ledger.example] [--output .env]
```

只有 Docker 时：`docker compose -f compose.tools.yaml run --rm setup-env [同样的参数]`。脚本行为：

- 从 `/dev/urandom` 生成 `MYSQL_PASSWORD`、`MYSQL_ROOT_PASSWORD`、`BETTER_AUTH_SECRET`（各 32 字节，64 位十六进制，可直接放进连接 URL）和 `LEDGER_ENCRYPTION_KEYS`（`k1:` + 32 字节 base64），每次运行都不同。
- 密钥不输出到终端；文件以 `umask 077` 独占创建，权限 600。
- 目标文件已存在时拒绝执行、不做任何修改。重新生成会使已初始化的 MySQL 账号和已加密的渠道凭据失效；确需重建时先备份并移走旧文件，或用 `--output` 生成到新文件后手工合并。
- 其余变量原样取自模板。

安全要求：`.env` 已被 `.gitignore` 排除，不要提交，也不要贴到聊天或工单里。`BETTER_AUTH_SECRET`、`LEDGER_ENCRYPTION_KEYS` 与数据库备份分开保存（例如密码管理器 + 对象存储）。修改 `.env` 后执行 `docker compose up -d --wait`，变更的容器会重建。模板里以 `# KEY=默认值` 注释的是可选项：取消注释即生效；不用时删除整行，不要留成空的 `KEY=`。

**数据库**（MySQL 容器；账号密码在数据卷首次初始化时写入，之后改 `.env` 需同步在 MySQL 中 `ALTER USER`）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MYSQL_DATABASE` | `ledger` | 库名 |
| `MYSQL_USER` | `ledger` | 应用账号 |
| `MYSQL_PASSWORD` | 必填，脚本生成 | 应用账号密码 |
| `MYSQL_ROOT_PASSWORD` | 必填，脚本生成 | root 密码，备份 / 恢复命令使用 |

**Web 与密钥**

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_URL` | `http://localhost:3000` | 对外访问地址，生产必须是 `https://`。Cookie Secure、CSRF Origin、审批链接和 MCP Host 校验都以它为准 |
| `WEB_PORT` | `3000` | 宿主机端口，只绑定 `127.0.0.1`，由反向代理对外 |
| `WEB_CONCURRENCY` | CPU 数，最多 4 | web 进程数（Node cluster 共享端口）；MySQL / worker 同机时可设为 CPU 数 − 1 |
| `BETTER_AUTH_SECRET` | 必填，脚本生成 | 会话签名密钥；更换会使全部会话失效 |
| `LEDGER_ENCRYPTION_KEYS` | 必填，脚本生成 | 渠道凭据主密钥环 `id:base64(32 字节)`，逗号分隔，第一个用于加密。轮换：新密钥放到第一位、保留旧密钥，重启后执行 `docker compose run --rm migrate node --import tsx scripts/rewrap-channel-keys.ts`，确认后再移除旧密钥。丢失则渠道凭据不可恢复 |

**汇率**

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FX_PROVIDER_URL` | 空（不抓取） | Fixer 兼容汇率接口地址 |
| `FX_PROVIDER_KEY` | 空 | 汇率接口密钥 |
| `FX_PROVIDER` | `fixer` | 供应商名称，记录在汇率批次上 |
| `FX_POLL_SECONDS` | `60` | worker 抓取最新汇率的间隔（秒） |
| `LEDGER_ADMIN_EMAILS` | 空 | 可手动触发汇率刷新的管理员邮箱，逗号分隔 |

**提醒与通知渠道**

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SMTP_URL` | 空（停用邮件渠道） | 发信服务器，例如 `smtps://user:password@smtp.example.com:465` |
| `SMTP_FROM` | `Ledger Next <no-reply@example.com>` | 发件人，改成自己的域名 |
| `WEBHOOK_ALLOWLIST` | 空（只允许公网 HTTPS） | 允许的内网 Webhook 接收方，`host` 或 `host:port`，逗号分隔 |
| `NOTIFY_TICK_SECONDS` | `10` | 提醒调度间隔（秒） |
| `SUBSCRIPTION_TICK_SECONDS` | `600` | 订阅续期维护间隔（秒） |
| `CHANNEL_TIMEOUT_MS` | `10000` | 调用通知渠道（含 SMTP）的超时（毫秒） |

**Agent、MCP 与限流**（限额均为每分钟次数）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AGENT_APPROVAL_AMOUNT` | `10000` | Agent 单笔写入达到该金额（基准币）时需所有者在网页批准 |
| `MCP_ALLOWED_HOSTS` | 空 | 反向代理改写 Host 时追加允许的 Host，逗号分隔 |
| `MCP_ALLOWED_ORIGINS` | 空 | 浏览器内 MCP 客户端的 Origin，逗号分隔 |
| `API_RATE_LIMIT` | `600` | 每个会话或令牌的请求数 |
| `API_WRITE_RATE_LIMIT` | `120` | 资金写入，每账本（网页会话） |
| `AGENT_WRITE_RATE_LIMIT` | `30` | 资金写入，每账本（Agent 令牌） |
| `API_AUTH_FAILURE_LIMIT` | `30` | 认证失败，每个来源地址 |

**仅本机开发**（在宿主机直接运行 `pnpm dev` / `pnpm test:integration` 时使用；Compose 内的服务使用自己的内部地址）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 脚本生成 | `mysql://<用户>:<密码>@localhost:3306/<库名>`，与上面的 MySQL 账号一致 |
| `REDIS_URL` | `redis://localhost:6379` | Redis 地址 |

构建与测试用的 `LEDGER_BUILD_CA`、`LEDGER_HOST_DIR`、`LEDGER_DOCKER`、`PERF_*` 是执行命令时的 shell 环境变量，不写入 `.env`，见[运行说明](docs/IMPLEMENTATION.md)。`pnpm test:e2e` / `test:perf` / `test:ops` 的独立测试栈不读取 `.env`，本机配置不会影响测试。

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
