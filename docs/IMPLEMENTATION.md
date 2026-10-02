# 实现状态与本地运行

2026-10-02 · M1 工程、身份与 REST 契约；M2-MODEL 账务 schema 与金额运算；M2-LEDGER 收支、转账、退款与更正 API。UI 基线为 `docs/ui/index.html` v0.3。

## 本批范围

- pnpm workspace、Next.js 16 App Router、React、TypeScript strict、MySQL 8.4 LTS / Drizzle。
- Better Auth 数据库 Session：邮箱密码注册、登录、退出和会话撤销。密码至少 12 位；没有默认管理员、演示密码或自动植入的账目。
- 新建 / 切换账本、SSR 读取、owner/editor/viewer 权限、添加已注册成员、修改角色、移除成员、最后 owner 保护、审计。
- 原型 CSS 令牌、224px 侧栏、82px 顶栏、KPI / 两列内容、移动底栏。总览使用无数据状态，业务写入尚未开放；不能把页面骨架视作 M4 完成。
- 本设备外观 Cookie：浅色 / 深色 / 跟随系统、7 个预设和自定义颜色；复用原型 OKLCH / AA 算法，SSR 首帧读取 Cookie。完整账号偏好同步和图表验收仍属于 M4-THEME。
- Docker 多阶段构建、自动迁移、MySQL / Redis 持久卷（镜像按摘要锁定）、web / worker 健康检查与优雅停机、独立 Docker Playwright 测试环境。
- REST 契约（M1-API）：`packages/contracts` 用 Zod 定义全部计划资源，生成 OpenAPI 3.1（`packages/contracts/openapi.json`，83 个操作）与类型化 SDK（`packages/api-client`，openapi-typescript + openapi-fetch）。`/api/v1` 路由由同一注册表驱动：未知路径 404、方法不符 405 + Allow、格式错误 ID 404、planned 操作 501。
- 列表统一 `{data, page:{nextCursor, hasMore}, meta}`，keyset 分页游标经 HMAC 签名并绑定用户 / 操作 / 账本 / 筛选；新增 owner 可读的 `GET L/audit-events`。
- Idempotency-Key：记录与业务写入同一事务（`idempotency_records`，迁移 0002），并发同 key 串行化后回放首个结果，不同请求体 409；worker 每小时清理过期记录。Web 新建账本 / 添加成员按“同一内容同一 key”发送。
- 账务核心（M2-MODEL，迁移 0003）：currencies（含 0 / 2 / 3 位小数，KWD 仅用于精度测试未启用）、accounts、categories、tags、transactions、transaction_tags、transaction_amounts、account_postings、fx_snapshots、outbox_events。账本内引用全部为 `(ledger_id, id)` 复合外键；posting 以 `(ledger_id, account_id, currency)` 外键强制与账户币种一致；CHECK 约束覆盖正金额、非零 posting、转账无分类、退款必须关联原交易、外币基准金额必须有汇率快照等。金额运算集中在 `packages/domain/src/money.ts`（decimal.js，HALF_EVEN，按币种精度拒绝多余小数不截断）；`appendPostings` 按账户 ID 顺序逐个加锁并在同事务更新余额缓存，`verifyBalance` 用 MySQL DECIMAL 重算核对。
- 记账 API（M2-LEDGER，迁移 0004）：账户 / 分类 / 标签 CRUD 与归档；交易“预览 → 带 Idempotency-Key 提交”，预览单次有效、提交时在账户锁内重算；支出 / 收入 / 转账（含关联手续费）/ 退款（累计上限）/ 更正（冲正 + 新版本）/ 作废（反向 posting）；审计与 outbox 同事务。外币结算暂需人工汇率（报价随 M3-FX）。Web 记账界面属于 M4-CORE，当前页面仍是无数据状态。
- 认证限流沿用 Better Auth 默认（sign-in / sign-up 每客户端 10 秒 3 次），客户端地址取 `X-Forwarded-For`；生产反向代理须覆盖该头为真实客户端地址。

## 运行

前置：本机 Docker Engine / Docker Desktop（Linux 容器）、Compose ≥2.24.4；执行本机质量命令还需要 Node 24 与 pnpm 11.19.0。Compose 的 `!override` 用于清除测试栈的端口映射。

```powershell
pnpm install --frozen-lockfile
node scripts/setup-env.mjs
docker compose up -d --build --wait
```

打开 http://localhost:3000，创建账号后创建首个账本。`setup-env` 生成随机本地密钥，不输出秘密，已有 `.env` 时拒绝覆盖。连接 URL 的密码应使用 URL 安全字符（生成值为十六进制）。MySQL / Redis 默认只开放给容器网络。

```powershell
docker compose ps
docker compose logs --tail 100 web worker migrate
docker compose down
```

普通 `down` 保留数据库。不要对需要保留的数据使用 `down --volumes`。Worker 当前只检查 MySQL / Redis 和写心跳；业务调度、BullMQ、汇率抓取与真实渠道投递尚未实现。

生产部署沿用 Compose；设置真实 HTTPS `APP_URL`、独立随机密钥和反向代理，Cookie 会按 HTTPS 自动启用 Secure。数据库不暴露公网。备份恢复、安全与性能验收尚属于 M7，当前版本不是完整首发发布。

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

`test:e2e` 检查 Docker context 必须指向本机，创建 `ledger-e2e-{pid}` 独立项目及随机凭据，构建真实生产 Web 镜像；MySQL 迁移与 worker 就绪后先重放迁移，创建持久化样本，重启 MySQL / Redis / Web / worker 并验证账号、认证和账本保留，再在 Playwright 容器内执行 API 集成和浏览器测试，最后仅清理本次测试项目与卷。不会使用本机开发数据库，也不会用 mock / SQLite 替代 MySQL。失败返回非零退出码；trace、截图、JSON 和 HTML 报告在 `test-results/`、`playwright-report/`。

`pnpm test:integration` 运行真实 MySQL 集成套件（需要 `DATABASE_URL`，`test:e2e` 在隔离 Docker 栈内自动执行）；`pnpm test:api` 是针对已有运行环境的 Playwright API 测试入口；完整验证以 `test:e2e` 为准。单元测试覆盖权限 / 版本 / Origin 规则、输入校验、主题算法、分页游标签名、幂等指纹、OpenAPI 生成与路由匹配、破坏性变更检测；端到端契约测试用 ajv 按 openapi.json 校验真实响应（状态码必须在该操作中声明），并用生成的 SDK 访问真实服务；数据库事务和认证库通过真实 MySQL API 集成验证，不用 mock 的单元覆盖率冒充系统覆盖率。

Windows 不在 PATH 的 Docker 可以通过 `LEDGER_DOCKER` 指定可执行文件；脚本也识别用户目录中的 Docker Desktop。CI 执行相同 lint/typecheck/unit/Docker E2E 并上传证据；仓库工作流配置不等于已经取得远程 CI 结果。

## 迁移和并发

迁移是顺序 SQL 文件，Drizzle schema 负责运行时映射；不是 `push` 自动改表。迁移器使用 MySQL `GET_LOCK` 防止双实例并行迁移，记录换行统一为 LF 后的 SHA-256（Windows CRLF 与 Linux 检出一致），已应用文件变更立即报错。MySQL DDL 隐式提交，CREATE IF NOT EXISTS 迁移可重入，ALTER 迁移必须写恢复指引，不能声称 DDL 可整体回滚。从 0003 起每个迁移附 `migrations/down/` 恢复脚本：`LEDGER_ROLLBACK_CONFIRM=<文件名> pnpm db:rollback <文件名>` 只能回滚最近一个迁移，且所列账务表有任何数据时拒绝执行（有数据时应从备份恢复）。`test:e2e` 每次演练“空表回滚 → 重新应用 → 写入数据后回滚被拒绝”。

所有成员变更先锁账本行，再读并锁定当前权限与成员集；最后 owner 校验、写入和审计同一事务。PATCH / DELETE 要求准确 `If-Match: "vN"`；会话 Cookie 缓存关闭，退出后旧 Cookie 不能访问，移除成员后下一次请求立即失效。

## 尚未实现

PAT / Bearer 认证与作用域执行（M6-SERVER，契约已定义）；M2 CSV 导入导出；M3 FX 与真实统计；M4 业务页面与订阅；M5 真实提醒渠道；M6 MCP 与四客户端；M7 完整回归、备份恢复与生产发布。注册目前用于受控自托管环境；邮件验证、找回密码和 OIDC 尚未接入，UI 不显示不可用入口。添加成员仅支持已注册邮箱，没有发送邀请邮件。
