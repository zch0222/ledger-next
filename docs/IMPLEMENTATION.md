# 实现状态与本地运行

2026-10-02 · M1 工程、身份与 REST 契约；M2 账务模型、记账 API、CSV 导入导出；M3 分钟汇率（本地 mock 供应商）与报表 / 预算；M4 全部业务页面、订阅、外观同步与响应式 / 无障碍验收；M5 提醒调度与七类通知渠道（全部经本地协议 mock 验证）；M6 个人访问令牌、网页审批、MCP 服务（HTTP / stdio）与 ledger-service Skill；M7 安全加固、性能 / 恢复演练脚本与运行手册。UI 基线为 `docs/ui/index.html` v0.3。进度以 [MILESTONES.md](MILESTONES.md) 为准；按用户授权，门禁改为实现者自评估 + Docker E2E，汇总在其“最终人工审查清单”。

## 本批范围

- pnpm workspace、Next.js 16 App Router、React、TypeScript strict、MySQL 8.4 LTS / Drizzle。
- Better Auth 数据库 Session：邮箱密码注册、登录、退出和会话撤销。密码至少 12 位；没有默认管理员、演示密码或自动植入的账目。
- 新建 / 切换账本、SSR 读取、owner/editor/viewer 权限、添加已注册成员、修改角色、移除成员、最后 owner 保护、审计。
- 原型 CSS 令牌、224px 侧栏、82px 顶栏、KPI / 两列内容、移动底栏（总览、账目、记一笔、订阅、更多）。
- 页面（M4-CORE / M4-DASH，路由 `/ledgers/{id}/…`）：P01 总览（KPI 服务端渲染、周趋势、分类排行、最近账目、30 天账单）、P02 账目（URL 筛选与 chips、签名游标分页、日期分组、详情抽屉 `?tx=`）、P03 记一笔 / 更正 / 退款 / 作废（服务端预览后提交同一 previewId，412 时并排展示服务器当前版本与本地输入，不自动覆盖；有有效退款的支出锁定更正 / 作废）、P04 订阅（卡片 / 账单列表 / 日历、新增 / 编辑 / 暂停 / 取消、确认已付 / 跳过）、P05 预算与分析（预算进度、支出构成、6 个月趋势、历史 / 当前估值口径）、P06 账户（原币余额、估值、转账、改名、归档提示余额）、P09 币种与汇率、P11 导入向导 / 导出、P12 账本与成员 / 分类标签、P13 外观、P00 登录 / 引导（建账本 → 首个账户，可跳过）。旧链接 `/?ledger=&view=` 307 到新路由。
- 图表（M4-DASH）：`echarts/core` 按需注册 SVG 渲染，动态 import 独立 chunk（首屏不加载）；每个容器一个实例，数据 / 主题 / 减少动画变化都在同一实例 `setOption`，ResizeObserver 跟随容器，卸载时 dispose。每个图表下有数据表 / 列表替代，键盘与触摸都可钻取；分类钻取到同期间、同展示币的账目，明细合计等于分类净额（含退款）。
- 外观（M4-THEME，迁移 0008）：`user_preferences` + `GET/PATCH /api/v1/me/preferences`（If-Match）；登录后 SSR 首帧读取账号偏好；即时应用并写 `ln_appearance` Cookie，500 ms 防抖同步账号，关闭面板立即同步；未同步（保存失败或刷新早于同步）时 Cookie 带当前用户 id 的 pending 标记，本设备继续显示该选择并在下次页面加载后补同步，别的用户登录同一设备不受影响。
- 订阅（M4-SUBS，迁移 0009）：日 / 周 / 月 / 年 × 整数间隔，月末取当月最后一天且锚点保留，2/29 年费平年取 2/28；`bill_occurrences` 以（订阅、计划版本、日期）唯一，物化今天起 90 天（至少 3 期）；到期 / 逾期由日期派生，绝不自动记为已支付；确认支付 = 预览 + 提交（source=subscription）或关联已有支出，每期至多一笔；修改金额 / 周期 / 锚点生成新计划版本并取消未付旧期，已付保留；暂停可设恢复日，取消可立即或本周期末。新建订阅不回补锚点之前的历史账单。
- Docker 多阶段构建、自动迁移、MySQL / Redis 持久卷（镜像按摘要锁定）、web / worker 健康检查与优雅停机、独立 Docker Playwright 测试环境。
- REST 契约（M1-API）：`packages/contracts` 用 Zod 定义全部计划资源，生成 OpenAPI 3.1（`packages/contracts/openapi.json`，83 个操作）与类型化 SDK（`packages/api-client`，openapi-typescript + openapi-fetch）。`/api/v1` 路由由同一注册表驱动：未知路径 404、方法不符 405 + Allow、格式错误 ID 404、planned 操作 501。
- 列表统一 `{data, page:{nextCursor, hasMore}, meta}`，keyset 分页游标经 HMAC 签名并绑定用户 / 操作 / 账本 / 筛选；新增 owner 可读的 `GET L/audit-events`。
- Idempotency-Key：记录与业务写入同一事务（`idempotency_records`，迁移 0002），并发同 key 串行化后回放首个结果，不同请求体 409；worker 每小时清理过期记录。Web 新建账本 / 添加成员按“同一内容同一 key”发送。
- 账务核心（M2-MODEL，迁移 0003）：currencies（含 0 / 2 / 3 位小数，KWD 仅用于精度测试未启用）、accounts、categories、tags、transactions、transaction_tags、transaction_amounts、account_postings、fx_snapshots、outbox_events。账本内引用全部为 `(ledger_id, id)` 复合外键；posting 以 `(ledger_id, account_id, currency)` 外键强制与账户币种一致；CHECK 约束覆盖正金额、非零 posting、转账无分类、退款必须关联原交易、外币基准金额必须有汇率快照等。金额运算集中在 `packages/domain/src/money.ts`（decimal.js，HALF_EVEN，按币种精度拒绝多余小数不截断）；`appendPostings` 按账户 ID 顺序逐个加锁并在同事务更新余额缓存，`verifyBalance` 用 MySQL DECIMAL 重算核对。
- 记账 API（M2-LEDGER，迁移 0004）：账户 / 分类 / 标签 CRUD 与归档；交易“预览 → 带 Idempotency-Key 提交”，预览单次有效、提交时在账户锁内重算；支出 / 收入 / 转账（含关联手续费）/ 退款（累计上限）/ 更正（冲正 + 新版本）/ 作废（反向 posting）；审计与 outbox 同事务。外币结算自 M3-FX 起使用锁定的参考汇率（也可人工汇率）。
- CSV 导入导出（M2-IMPORT，迁移 0006）：上传 multipart CSV（≤5 MB、≤10,000 行）+ 列映射 → Worker 异步校验（行号 / 列 / 错误码）→ 提交（每 100 行一个事务，可续跑）→ owner 撤销（作废该批次交易，已退款的跳过并报告）。行指纹（账本 + 日期 + 类型 + 账户 + 金额 + 分类 + 商家 + 备注 + 同文件序号）由 `import_rows.committed_fingerprint` 唯一键保证同一行只入账一次，撤销后释放。导出由 Worker 生成 UTF-8 BOM CSV，金额恒为正并带类型列，`= + - @ TAB CR` 开头的单元格加撇号防公式注入；下载地址 1 小时有效，仅创建者可下载。
- 异步任务（M2-IMPORT 起）：业务事务写 outbox → Worker 每秒以 SKIP LOCKED 认领并发布到 BullMQ（jobId = 事件 ID）→ 幂等处理器；每分钟补扫停滞任务。
- 汇率（M3-FX，迁移 0005）：Fixer 协议适配器，Worker 每 60 秒以 Redis 租约单批拉取；新鲜度按源时间（≤120 s fresh / ≤15 min delayed / 更久或连续失败 stale）；交叉率取同一批次；跳变批次待核验；预览锁定汇率；回溯交易用当时批次或当日历史日率，缺失时排队补录；人工汇率记录；管理员刷新任务（`LEDGER_ADMIN_EMAILS`）。**供应商为本地 mock**（`apps/mock-services`，`compose.mock.yaml`），真实套餐待人工审查。
- 报表与预算（M3-REPORTS，迁移 0007）：summary / cash-flow / category-breakdown / account-balances / budget-progress 与预算 CRUD。只汇总有效版本（posted），转账不计收支，退款冲减支出并计入退款发生期；历史口径用入账时的基准金额，其他币种逐笔按当日交叉率（缺失计入 excludedCount 并标记 partial，可用人工汇率补齐）；当前估值按最新参考汇率。Redis 缓存 30 秒，键含账本、数据版本（每次资金写入同事务递增）、FX 版本（当前估值）与全部查询参数。
- 提醒（M5，迁移 0010）：规则（订阅到期 / 逾期 / 试用结束 / 取消截止 / 预算阈值 / 每日记账 / 周与月小结 / 汇率阈值 / 投递失败）按“账本 + 属主”保存，预览给出下三次时间与免打扰影响；Worker 每 `NOTIFY_TICK_SECONDS`（默认 10 秒）物化 48 小时内的提醒、认领到期投递并经 BullMQ 发送；投递日志以去重键保证唯一，发送前复核规则版本、账单与订阅状态、渠道状态和免打扰；429 / 5xx / 网络错误退避重试 5 次后死信，无应答记 unknown 不自动重发，P07 可人工重放。渠道：Telegram、飞书、企业微信群机器人、企业微信应用消息、个人微信（pushplus）、邮件（SMTP + 验证码）、Webhook（HMAC、SSRF 防护）、站内；凭据以 `LEDGER_ENCRYPTION_KEYS` 信封加密，`pnpm channels:rewrap` 轮换主密钥。测试 / 演示栈（compose.mock.yaml）把官方域名改写到 `mock-services`，SMTP 指向其内置 SMTP；生产需配置真实 `SMTP_URL`，不设置改写变量。
- Agent 接入（M6，迁移 0011）：个人访问令牌（`lnp_…`，只存 SHA-256，作用域 + 账本限制，撤销下一次请求生效，签发需 15 分钟内登录）；高影响写入（作废、撤销导入、归档账户、成员变更、单笔 ≥ `AGENT_APPROVAL_AMOUNT`）返回 `APPROVAL_REQUIRED` 并生成绑定方法 / 路径 / 请求体哈希 / 发起人的审批，只能由所有者在 P10 批准，`X-Approval-Id` 一次性消费；`GET …/operations/{Idempotency-Key}` 查询超时写入的结果。MCP：`/mcp`（无状态 Streamable HTTP，Host / Origin / Bearer / 64 KB 检查）与 `apps/mcp` stdio（`pnpm mcp:build` 打包单文件），15 个工具 + 2 个资源只经 REST、使用调用者令牌。Skill：`packages/skill/ledger-service` 单一来源，`pnpm skill:build` 校验并生成 Codex / Claude Code / dsh / Qoder 四个包，`pnpm skill:install` 带同名保护。
- 安全（M7-SEC）：API 分层限流（Redis 一分钟窗口：会话 / 令牌 600、认证失败按来源地址 30、资金写入按账本会话 120 / 令牌 30，429 + Retry-After，Redis 不可用时放行）；CSP 基线、Permissions-Policy、COOP；`/api/health/live`、`/api/health/ready`（数据库与迁移版本；Redis 只报告）；`pnpm test:e2e` 结束时扫描 web / worker 日志中的凭据与备注文本。
- web 进程（M7-PERF，D37）：镜像以 `apps/web/cluster.mjs` 启动 `WEB_CONCURRENCY` 个 Next standalone 进程共享端口（默认 CPU 数、最多 4），SIGTERM 时逐个排空后退出；进程内不保存请求状态，认证限流也经 Redis 共享。
- 性能与运维（M7-PERF / M7-OPS）：`pnpm test:perf`（1,000 用户 + 10 万笔账本、100 并发用户模型与无思考压力两种 80/20 负载、冷热聚合与总览 TTFB、FX 新鲜度、提醒调度延迟、移动端实验室 Web Vitals、图表实例释放）；`pnpm test:ops`（全量备份、流复制备库、停掉 web 时 worker 仍发送、销毁主库后分别从备份与备库恢复并对账，测 RTO / RPO）；运维步骤见 [RUNBOOK.md](RUNBOOK.md)。
- 认证限流沿用 Better Auth 默认（sign-in / sign-up 每客户端 10 秒 3 次），客户端地址取 `X-Forwarded-For`；生产反向代理须覆盖该头为真实客户端地址。

## 运行

前置：本机 Docker Engine / Docker Desktop（Linux 容器）、Compose ≥2.24.4；执行本机质量命令还需要 Node 24 与 pnpm 11.19.0。Compose 的 `!override` 用于清除测试栈的端口映射。

```powershell
pnpm install --frozen-lockfile
node scripts/setup-env.mjs
docker compose up -d --build --wait
# 本地演示汇率等第三方功能（全部为本地 mock，不连接真实服务）：
docker compose -f compose.yaml -f compose.mock.yaml up -d --build --wait
```

打开 http://localhost:3000，创建账号后创建首个账本。`setup-env` 生成随机本地密钥，不输出秘密，已有 `.env` 时拒绝覆盖。连接 URL 的密码应使用 URL 安全字符（生成值为十六进制）。MySQL / Redis 默认只开放给容器网络。

```powershell
docker compose ps
docker compose logs --tail 100 web worker migrate
docker compose down
```

普通 `down` 保留数据库。不要对需要保留的数据使用 `down --volumes`。Worker 负责心跳、过期数据清理、汇率抓取（配置 `FX_PROVIDER_URL` 后）、提醒调度与渠道投递，以及 outbox → BullMQ 异步任务。升级到 M5 的已有部署需在 `.env` 增加 `LEDGER_ENCRYPTION_KEYS`（`node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64'))"`）。

在 TLS 被代理重签的网络里构建镜像时，设置 `LEDGER_BUILD_CA=<CA 文件>` 并叠加 `compose.build-ca.yaml`（CA 以 BuildKit secret 传入，不进入镜像层）；`pnpm test:e2e` 会自动叠加。

生产部署沿用 Compose；设置真实 HTTPS `APP_URL`、独立随机密钥和反向代理，Cookie 会按 HTTPS 自动启用 Secure。数据库不暴露公网。部署、备份、恢复与常见事件处理见 [RUNBOOK.md](RUNBOOK.md)。

## 质量命令

```powershell
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm contract:check            # 生成的 OpenAPI / SDK 必须最新；CI 另加 --base-ref 做破坏性变更比较
pnpm test:e2e
node scripts/progress.mjs validate
```

修改 `packages/contracts/src` 后运行 `pnpm contract:generate` 并提交生成的 `openapi.json` 与 `packages/api-client/src/schema.d.ts`。

`test:e2e` 检查 Docker context 必须指向本机，创建 `ledger-e2e-{pid}` 独立项目及随机凭据，构建真实生产 Web 镜像；MySQL 迁移与 worker 就绪后先重放迁移，创建持久化样本，重启 MySQL / Redis / Web / worker 并验证账号、认证和账本保留，再在 Playwright 容器内执行 API 集成和浏览器测试，最后仅清理本次测试项目与卷。不会使用本机开发数据库，也不会用 mock / SQLite 替代 MySQL；第三方供应商（汇率、后续通知渠道）一律由测试栈内的 `mock-services` 按公开协议模拟，可注入故障。失败返回非零退出码；trace、截图、JSON 和 HTML 报告在 `test-results/`、`playwright-report/`。

`pnpm test:integration` 运行真实 MySQL 集成套件（需要 `DATABASE_URL`，`test:e2e` 在隔离 Docker 栈内自动执行）；`pnpm test:api` 是针对已有运行环境的 Playwright API 测试入口；完整验证以 `test:e2e` 为准。单元测试覆盖权限 / 版本 / Origin 规则、输入校验、主题算法、分页游标签名、幂等指纹、OpenAPI 生成与路由匹配、破坏性变更检测；端到端契约测试用 ajv 按 openapi.json 校验真实响应（状态码必须在该操作中声明），并用生成的 SDK 访问真实服务；数据库事务和认证库通过真实 MySQL API 集成验证，不用 mock 的单元覆盖率冒充系统覆盖率。

Windows 不在 PATH 的 Docker 可以通过 `LEDGER_DOCKER` 指定可执行文件；脚本也识别用户目录中的 Docker Desktop。CI 执行相同 lint/typecheck/unit/Docker E2E 并上传证据；仓库工作流配置不等于已经取得远程 CI 结果。

## 迁移和并发

迁移是顺序 SQL 文件，Drizzle schema 负责运行时映射；不是 `push` 自动改表。迁移器使用 MySQL `GET_LOCK` 防止双实例并行迁移，记录换行统一为 LF 后的 SHA-256（Windows CRLF 与 Linux 检出一致），已应用文件变更立即报错。MySQL DDL 隐式提交，CREATE IF NOT EXISTS 迁移可重入，ALTER 迁移必须写恢复指引，不能声称 DDL 可整体回滚。从 0003 起每个迁移附 `migrations/down/` 恢复脚本：`LEDGER_ROLLBACK_CONFIRM=<文件名> pnpm db:rollback <文件名>` 只能回滚最近一个迁移，且所列账务表有任何数据时拒绝执行（有数据时应从备份恢复）。`test:e2e` 每次演练“空表回滚 → 重新应用 → 写入数据后回滚被拒绝”。

所有成员变更先锁账本行，再读并锁定当前权限与成员集；最后 owner 校验、写入和审计同一事务。PATCH / DELETE 要求准确 `If-Match: "vN"`；会话 Cookie 缓存关闭，退出后旧 Cookie 不能访问，移除成员后下一次请求立即失效。

## 尚未实现

真实第三方联调（汇率供应商套餐、各通知渠道的真实接收、四个真实 Agent 客户端与模型）、生产主机 / 域名 / HTTPS、远程 MCP OAuth、带 nonce 的完整 CSP，以及发布签署 G1 都留待最终人工审查（见 MILESTONES.md 文末清单）。注册目前用于受控自托管环境；邮件验证、找回密码和 OIDC 尚未接入，UI 不显示不可用入口。添加成员仅支持已注册邮箱，没有发送邀请邮件。
