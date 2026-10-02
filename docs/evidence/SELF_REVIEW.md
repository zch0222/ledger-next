# 自评估记录

依据 [AUTONOMOUS_DELIVERY](../reviews/AUTONOMOUS_DELIVERY.md)：需要评审的任务由实现者（Claude Code）逐条对照验收标准，以本机 Docker 端到端测试为依据自评估；结论不等同独立人工验收，全部列入 [MILESTONES.md](../MILESTONES.md) 的“最终人工审查清单”。

每条记录写明：验收标准 → 结论 → 证据（测试名称 / 命令）→ 留给人工审查的事项。

## 2026-10-02 · M1-AUTH、M1-API、M2-MODEL、M2-LEDGER

环境：云端 Linux 容器，Docker Engine 29.6.2，Compose v5.3.1，Node 24.21.0，pnpm 11.19.0；分支 `claude/loving-planck-dvzfpc`，基线 commit `c049221`（main）。镜像构建经 `LEDGER_BUILD_CA` 信任出站代理 CA（见 `compose.build-ca.yaml`）。

命令与结果：

- `pnpm lint`、`pnpm typecheck`：通过。
- `pnpm test:unit`：10 文件 125 测试通过；覆盖率（纯模块范围，见 vitest.config.ts）语句 99.42%、分支 96.72%、函数 99.25%、行 100%。
- `LEDGER_BUILD_CA=/root/.ccr/ca-bundle.crt pnpm test:e2e`（两次，第二次在修复测试脚本后）：迁移 0001–0004 → 回滚 0004（空表）→ 重放 → 重启持久化 PASS → MySQL 集成 24 passed → 有数据时回滚被拒绝 → Playwright 19 passed（api 13、desktop 3、mobile 3）→ web 143 / worker 0 优雅停机。

本轮发现并修正的测试设施问题：`scripts/docker-test.mjs` 在 Playwright 结束后的步骤（停机检查等）失败时仍返回 0；现已在 catch 中置失败。构建 CA 叠加文件改写到系统临时目录（Playwright 启动时会清空 `test-results/`）。

| 任务 | 验收标准 | 结论 | 证据 |
| --- | --- | --- | --- |
| M1-AUTH | 未经授权无法读取或修改另一账本任何资源 | 通过 | `identity.api.ts`「tenant isolation, CSRF, validation, ETag…」「viewer/editor permissions … cross-ledger membership and immediate revocation」；`ledger.api.ts` 外部用户读账户 404 |
| M1-AUTH | 登录 / 退出 / 会话撤销、最后 owner 保护 | 通过 | `identity.api.ts`「session login/logout revocation…」「concurrent owner demotions cannot remove the last owner」；`ui.spec.ts` 最后 owner UI |
| M1-API | 全部计划资源含 schema、scope 和错误响应 | 通过 | `pnpm contract:check`；`tests/unit/contract.test.ts`；OpenAPI 83 个操作均有 security / x-ledger-role / 错误响应 |
| M1-API | 状态码、cursor 篡改、412、重复提交契约测试 | 通过 | `contract.api.ts` 5 个用例（错误状态、游标绑定与篡改、Idempotency-Key 重放、SDK） |
| M2-MODEL | JPY / 三位小数 / 大额 / 0.1+0.2 无精度错误 | 通过 | `tests/unit/money.test.ts`；`ledger-core.test.ts`「stores boundary amounts…」「keeps 0.1 + 0.2 exact…」 |
| M2-MODEL | 跨账本外键拒绝，迁移可应用并有恢复方案 | 通过 | `ledger-core.test.ts`「rejects cross-ledger …」；E2E 回滚演练（空表回滚、重放、有数据拒绝） |
| M2-LEDGER | 重复提交仅影响一次余额 | 通过 | `ledger.api.ts`「a duplicated submission moves money once…」（6 并发同键）；`transactions.test.ts` 事务失败无残留 |
| M2-LEDGER | 转账本金不计收支，退款不记收入；并发与冲正测试通过 | 通过 | `ledger.api.ts`「transfers, refunds, corrections and voids…」；`transactions.test.ts` 转账手续费、并发退款上限、更正、作废、12 并发提交 |

留给人工审查：远程 GitHub Actions 结果（本轮只在本机 Docker 执行）；按 M1-AUTH 证据文档人工抽查登录、成员 UI。

## 2026-10-02 · M4-THEME、M4-CORE、M4-SUBS、M4-DASH、M4-RESP

命令与结果（同一工作树）：

- `pnpm lint`、`pnpm typecheck`、`pnpm contract:check`：通过（交易资源新增只读字段 `replacedById`，增量变更）。
- `pnpm test:unit`：15 文件 154 测试通过；覆盖范围新增 schedule.ts、format.ts、period.ts、time.ts，语句 / 行 100%、分支 97.82%。
- `LEDGER_BUILD_CA=/root/.ccr/ca-bundle.crt pnpm test:e2e`：迁移 0001–0009 → 回滚 0009（空表）→ 重放 → 重启持久化 PASS → MySQL 集成 60 passed → 有数据回滚被拒绝 → Playwright 49 passed、1 skipped（JS 预算只在桌面测一次）→ web 143 / worker 0 优雅停机。首屏脚本 gzip 152.4 KiB（10 个脚本，含 React / Next 运行时），ECharts chunk 194.7 KiB 延迟加载。

本轮 E2E 发现并修复：根 `loading.tsx` 让 `/` 的旧链接跳转变成流式软跳转（移入账本外壳）；外观保存防抖期间刷新会丢失选择（pending Cookie）；浏览器后退后搜索框把旧文本重新推入 URL；有退款的支出仍显示“更正 / 作废”（服务端 409）；分类钻取只列支出导致明细合计 ≠ 分类净额；订阅日历 ARIA 结构错误；移动端触摸目标小于 44px；Docker 无环境变量构建时根布局先读会话（改为先读 Cookie）。

| 任务 | 验收标准 | 结论 | 证据 |
| --- | --- | --- | --- |
| M4-THEME | 6 组合首帧、跟随系统即时更新 | 通过 | `visual.spec.ts` appearance |
| M4-THEME | 对比度 ≥4.5:1、非法颜色 422 不落库 | 通过 | `theme.test.ts`、`visual.spec.ts`、axe |
| M4-THEME | 跨设备同步、失败仅本设备、语义色不变 | 通过 | `ui.spec.ts`、`visual.spec.ts` |
| M4-CORE | 无需图表 JS 可读首屏 | 通过 | `visual.spec.ts` 无 JS 上下文 |
| M4-CORE | 记账、更正、退款、账户归档 E2E | 通过 | `flows.spec.ts`、`settings.spec.ts`（桌面 + 移动） |
| M4-SUBS | 到期不自动支付、已付唯一 | 通过 | `flows.spec.ts` subscriptions、`subscriptions.test.ts` |
| M4-SUBS | 改期取消旧计划、保留历史 | 通过 | 同上 |
| M4-DASH | 合计与明细一致、缺率 / 预测标注 | 通过 | `visual.spec.ts` dashboard / analytics |
| M4-DASH | 键盘 / 触摸钻取、JS 预算 | 通过 | 同上 + first-screen JS 用例 |
| M4-DASH | 同实例更新、换色、清理 | 通过 | `data-chart-instance / -renders` 断言 |
| M4-RESP | 无溢出、触摸目标、对比度 | 通过 | responsive 矩阵（axe-core 4.13.0） |
| M4-RESP | 手机独立完成记账 / 查询 / 订阅 | 通过 | 移动项目全部用例 |
| M4-RESP | 缩放不重播入场、不裁剪金额、减少动画等价 | 通过 | responsive 用例末段 |

留给人工审查：见各任务 finalChecks（真机、屏幕阅读器、视觉品味、D22 取舍）。

## 2026-10-02 · M5-ENGINE、M5-TG、M5-FEISHU、M5-WECOM、M5-WX、M5-OTHER、M5-CHAOS

命令与结果（commit `7c69245`）：

- `pnpm lint`、`pnpm typecheck`、`pnpm contract:check`：通过。
- `pnpm test:unit`：16 文件 166 测试通过（含 `notify-pure.test.ts`：信封加密、SSRF 判定、提醒时间与免打扰、FX 阈值滞回）。
- `LEDGER_BUILD_CA=/root/.ccr/ca-bundle.crt pnpm test:e2e`：迁移 0001–0011 → 回滚 0011（空表）→ 重放 → 重启持久化 PASS → MySQL 集成 79 passed → 有数据回滚被拒绝 → 混沌演练 PASS → Playwright 59 passed → web 143 / worker 0 优雅停机。

上一轮 Docker 运行发现并已修复：纯 HTTP 来源下 `crypto.randomUUID` 不可用（改为 `getRandomValues`）；预览请求乱序时旧输入的结果覆盖新输入（加入过期守卫并补回归用例）；水合前选好的 CSV 文件被忽略。

第三方服务全部为本地协议级 mock（`apps/mock-services`），没有连接真实 Telegram、飞书、企业微信、pushplus、SMTP 或外部 Webhook。

| 任务 | 验收标准 | 结论 | 证据 |
| --- | --- | --- | --- |
| M5-ENGINE | worker / Redis 重启可恢复，不重复入账 | 通过 | `tests/chaos/notify-restart.ts`（SIGKILL worker + 重启 Redis + 15 s 停机）；`notifications.test.ts` 去重键与认领 |
| M5-ENGINE | 已付 / 取消 / 规则版本变化使旧提醒失效 | 通过 | `notifications.test.ts`（stillValid、规则改版、订阅支付 / 跳过 / 取消） |
| M5-TG ~ M5-OTHER | 各渠道独立接收证据 | 部分（mock） | `notify.api.ts`「every channel type…」：每种渠道的请求到达各自 mock 收件箱；真实接收列入 finalChecks |
| M5-TG ~ M5-OTHER | 密钥不回显，受理不误报已读 | 通过 | `notify.spec.ts` channels（页面不含明文、只显示末四位）；状态文案“平台已受理 / 受理不代表已读” |
| M5-CHAOS | 每种故障有预期状态与恢复证据 | 通过 | `notify.api.ts` faults：429 等待、5xx 死信且健康渠道不重发、丢失应答为 unknown、凭据错误暂停；人工重放 |
| M5-CHAOS | 调度延迟符合预算，重复风险可见 | 通过（测试规模） | `notification-stats` 7 日统计与调度延迟；unknown 状态在投递记录中显式标注 |

留给人工审查：各渠道真实接收截图、SMTP 送达率、预生产混沌演练与长时延迟分布（见各任务 finalChecks）。

## 2026-10-02 · M6-SERVER、M6-SKILL、M6-CODEX、M6-CLAUDE、M6-DSH、M6-QODER

命令与结果（commit `515beb9`）：

- `pnpm lint`、`pnpm typecheck`、`pnpm contract:check`：通过（令牌持有 `reminders:read` 时可列出本人渠道，增量变更）。
- `pnpm test:unit`：18 文件 185 测试通过；覆盖范围新增 `packages/mcp/src/*.ts`（MCP 工具经内存传输对脚本化 REST 全量覆盖）与 M5 的纯模块。
- `LEDGER_BUILD_CA=/root/.ccr/ca-bundle.crt pnpm test:e2e`：迁移 0001–0011 → 回滚 / 重放 → 重启持久化 PASS → MySQL 集成 79 passed → 有数据回滚被拒绝 → 混沌演练 PASS → Playwright 69 passed（新增 agents.api 4、clients.api 4、agents.spec 2）→ web 143 / worker 0 优雅停机。

本轮发现并修复：历史时点的汇率被工具文案标成“实时（2 分钟内）”（改为“当时的历史报价”，并补单元与端到端断言）；P10 工具表在手机宽度横向滚动但不可聚焦（axe）；Skill 安装备份放在 skills 目录内会被客户端当成第二个同名 Skill（移到 `.ledger-skill-backup/`）。

不连接任何模型服务（D21）：四客户端为协议级模拟（D32），每个客户端 11 项中 8 项模拟通过，3 项（Skill 按需加载、缺字段先追问、不执行恶意备注）依赖模型本身，列入最终人工审查。

| 任务 | 验收标准 | 结论 | 证据 |
| --- | --- | --- | --- |
| M6-SERVER | MCP 不直连数据库、不另写资金逻辑 | 通过 | `packages/mcp` 只用 REST；`/mcp` 进程内调用同一 REST 处理器 |
| M6-SERVER | 只读不可写、撤销立即生效、幂等跨入口一致 | 通过 | `agents.api.ts`、`clients.api.ts`、`agents.spec.ts` |
| M6-SKILL | 不虚构工具、权限、金额或成功状态 | 通过 | `skill.test.ts` lint；工具参考由 tools/list 生成 |
| M6-SKILL | 安装说明无真实 secret，四包一致 | 通过 | `skill.test.ts`（同一 SKILL.md、校验和、凭据扫描） |
| M6-CODEX / CLAUDE / DSH / QODER | 读、预览写入、幂等、权限撤销、Skill 发现 | 模拟通过（Skill 加载待人工） | `docs/evidence/M6-*/README.md` 逐项结果与 requestId |
| M6-CODEX / CLAUDE / DSH / QODER | 记录实际 transport、协议、版本 | 部分 | transport / 协议 / SDK 版本已记录；客户端版本需真实安装后记录 |

留给人工审查：真实客户端（版本号）复测 11 项；MCP Inspector 人工探查；反向代理 Host / Origin 设置。
