# Ledger Next 技术方案

版本 0.3 · 2026-10-02 · 状态：待设计评审（0.3 增加主题色与深浅模式）。本文中的组件、接口、指标均为待实现设计。

## 1. 产品范围与需求追踪

用户应能在手机上快速记一笔，在桌面端理解支出结构，提前获知订阅扣费，并通过 Agent 安全查询和记录。V1 覆盖个人、家庭小规模共享账本；支持多用户隔离，暂不实现企业会计报表、银行自动扣款、投资交易、OCR 和离线自动同步。

Wallos 提供订阅、分类、多币种、统计和多个通知通道，适合作为功能参考；本项目采用独立的 Next.js 设计和实现。引用来源为 [Wallos 官方仓库](https://github.com/ellite/Wallos)，其中标示 GPL-3.0；本次不复制其源码或品牌资源。

| 需求 | 首发设计 | 设计入口 | 实施 / 验收 |
| --- | --- | --- | --- |
| R1 多币种、实时汇率 | 原币、账户结算币、历史基准币；分钟汇率、快照与降级 | 本文 §4–5 | M2、M3 |
| R2 直观可视化 | 收支趋势、分类排行、预算进度、周期扣款日历、可钻取明细 | UI_SPEC P01/P04/P05 | M4 |
| R3 多通道提醒 | TG、飞书、企业微信、个人微信、站内、邮件和通用 Webhook | 本文 §6 | M5，个人微信独立验收 |
| R4 现代 UI | 中性底色、可修改主题色（默认青绿）、浅色 / 深色完整适配且支持手动切换与跟随系统、克制卡片、完整状态反馈 | UI_SPEC §2、§2.2；本文 §7.4 | M0-UI、M4-THEME |
| R5 Next.js / REST / SSR | App Router、RSC、Route Handlers、统一领域层、流式 SSR | 本文 §2–3/§7 | M1、M7-PERF |
| R6 桌面 / 移动适配 | 360px–1920px；桌面侧栏、移动底栏与全屏表单 | UI_SPEC §3 | M4-UI、M7-E2E |
| R7 MCP + Skill | 标准 MCP 适配 REST；四客户端配置与同一 Skill 内容 | API_AGENT_CONTRACT | M6 |
| R8 先设计后开发 | 页面规范、可点原型、Mermaid 操作图、G0 评审门禁 | USER_FLOWS、评审记录 | G0 是 M1 前置 |

V1 必须覆盖：登录、账本 / 成员权限、账户、分类、收入 / 支出 / 退款 / 转账、订阅、预算、报表、提醒、导入导出、Agent 接入。多账本数据不能交叉访问；owner / editor / viewer 三个角色足够首发。

## 2. 技术栈与进程划分

| 层 | 选择 | 用途与约束 |
| --- | --- | --- |
| Web / HTTP API | Next.js 16 稳定系列 + App Router + React + TypeScript strict | 初始化时锁定最新经验证安全补丁和匹配 React 版本，不使用 canary |
| UI | Tailwind CSS、shadcn/ui / Radix、Lucide | 组件只引用 CSS 变量令牌（浅 / 深两套 + 主题色输入），不硬编码颜色；无必要不引入全局客户端状态 |
| 可视化 | Apache ECharts 6，使用 echarts/core 按需注册；按页面懒加载 | 统一折线、柱形、环图；SSR 输出摘要和数据表，图表点数上限 366 |
| 表单 / 契约 | React Hook Form + Zod；OpenAPI 3.1 | 服务端重新校验，生成 REST 客户端；UI 校验仅改善体验 |
| 数据 | PostgreSQL + Drizzle ORM / SQL migrations | decimal 运算和数据库约束是事实来源 |
| 金额计算 | decimal.js + ISO 币种精度表 | 禁止用 JS number 累加资金；JSON 金额传十进制字符串 |
| 异步任务 | Redis + BullMQ + Node.js TypeScript Worker | PostgreSQL outbox 持久化任务意图；Redis 不是账务存储 |
| 登录 | 成熟认证库的数据库 Session + 可选 OIDC | M1 锁定库版本、验证 Route Handler 集成；不自行实现密码学 |
| 服务集成 | MCP 官方 TypeScript SDK + OpenAPI 生成的 REST SDK | 只做工具映射；不在 MCP 中重新计算账务 |
| 测试 / 运维 | Vitest、Playwright、API 契约测试、k6、OpenTelemetry | 覆盖金额边界、多租户、消息故障和 SSR 性能 |
| 部署 | Docker Compose，Next standalone、worker、Postgres、Redis、反向代理 | Linux 自托管首发；Web 与 DB 同区，Web 水平扩展 |

版本策略：本文件不是锁文件。M1 生成版本清单、lockfile、镜像摘要和 Node LTS 兼容性记录；升级使用依赖 PR 并重跑相关契约测试。Next.js 的 Server / Client Component 和 Route Handler 语义参考[官方组件文档](https://nextjs.org/docs/app/getting-started/server-and-client-components)、[Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)。

### 2.1 部署与调用图

~~~mermaid
flowchart LR
  B[桌面 / 移动浏览器] -->|HTTPS 页面| W[Next.js App Router / RSC]
  B -->|REST /api/v1| R[Next.js Route Handlers]
  A[Codex / Claude Code / dsh / Qoder] -->|MCP JSON-RPC| M[MCP HTTP 服务 / stdio 适配器]
  M -->|生成的 REST SDK| R
  W -->|同进程函数调用 + AuthContext| C[领域服务 / 权限 / 校验]
  R --> C
  C --> D[(PostgreSQL)]
  C --> K[(Redis 聚合缓存)]
  D -->|事务 outbox| O[Outbox Dispatcher]
  O --> Q[BullMQ]
  Q --> J[TypeScript Worker]
  J --> C
  J --> X[汇率供应商]
  J --> N[TG / 飞书 / 企业微信 / 个人微信 / 邮件]
  J --> D
~~~

“Next.js 全栈”指全部 Web 和业务 HTTP API 由 Next.js 承载。Worker 是同一工程的后台任务进程，MCP 是协议入口；它们不是另建一套业务后端。业务规则在共享领域层中，禁止跨入口复制。

### 2.2 建议目录（尚未创建应用代码）

~~~text
apps/
  web/src/app/                 SSR 页面、loading/error、REST Route Handlers
  worker/src/                 汇率、调度、outbox、投递、导出
  mcp/src/                    Streamable HTTP / stdio 两种入口
packages/
  domain/                     AuthContext、用例、金额、周期规则
  db/                         schema、SQL、迁移、事务
  contracts/                  Zod、OpenAPI、公共错误模型
  api-client/                 从 OpenAPI 生成的 REST SDK
  ui/                         设计令牌、主题色生成器与复用组件
  notifications/              各供应商适配器
  agent-skill/                正式服务 Skill 及最小业务参考
tests/                        integration、contract、e2e、load
docs/                         本设计包、评审、决策、证据
~~~

## 3. REST 与 SSR 的边界

1. 浏览器和外部程序的所有业务 HTTP 请求走 /api/v1 的资源接口；不引入 GraphQL、tRPC 或业务 Server Actions。
2. SSR 服务端组件直接调用带 AuthContext 的领域查询。它不向本机 REST API 再发一次 HTTP 请求，避免额外跳转。此处是函数调用，不是非 REST 请求。Next.js 也建议服务端直接读取数据来源，见[Backend for Frontend](https://nextjs.org/docs/app/guides/backend-for-frontend)。
3. RSC 导航协议属于框架内部；MCP 必须使用其 JSON-RPC 协议。供应商 Webhook / OAuth 回调按第三方协议处理。以上明确列为边界协议，不能把 MCP 错称为 REST。
4. REST handler 顺序：解析认证 → 账本 membership 与 scope → schema 校验 → 用例事务 → DTO。每次查询与写入都校验，不依赖前端隐藏按钮。
5. DTO 不携带密钥、密码摘要、全量通知凭据或未经筛选的 ORM 对象。日期、金额和分页行为见 API_AGENT_CONTRACT。

## 4. 数据模型与记账规则

### 4.1 核心表

所有业务表的主键用 UUID；账本内实体带 ledger_id。引用采用 (ledger_id, id) 复合约束，防止同一用户不同账本之间误关联。存储时间用 timestamptz，业务日期用 date，时区单独保留 IANA 名称。

| 表 | 关键字段 / 约束 |
| --- | --- |
| users / sessions | 身份、登录会话；会话可撤销 |
| user_preferences | user_id 唯一、theme_mode（system / light / dark）、accent_type（preset / custom）、accent_value、palette_version、version、updated_at；纯展示偏好，不含账务数据 |
| ledgers / memberships | name、base_currency、timezone、user_id、role；唯一 ledger/user |
| currencies | ISO code、minor_units、enabled；首发 CNY/USD/HKD/EUR/JPY，涵盖 0/2/3 位精度测试 |
| accounts | ledger_id、type、currency、opening_balance、archived_at；一个账户一种结算币 |
| categories / tags | ledger_id、parent_id、kind、archived_at；已被引用的分类仅归档 |
| transactions | kind、occurred_at、local_date、timezone、category_id、status、version、source、note、replaces_id |
| transaction_amounts | transaction_id、original_amount/currency、settlement_amount/currency、base_amount/currency、fx_snapshot_id；费用可关联子交易 |
| account_postings | transaction_id、account_id、signed_amount、currency；已入账行不可原地改写 |
| fx_batches / fx_rates | provider、base、quote、rate numeric(38,18)、source_at、fetched_at、effective_date、quality |
| fx_snapshots | 使用的来源批次 / 原始币对、合成率、时点、舍入结果、manual_reason；不可变 |
| subscriptions | amount/currency、account_id、cycle_unit/count、anchor_day、timezone、status、version |
| bill_occurrences | subscription_id、scheduled_local_date、schedule_version、status、transaction_id；唯一周期 occurrence |
| budgets | ledger_id、category_id 或总预算、period、amount、base_currency；周期边界用账本时区 |
| notification_channels | owner、type、encrypted_config、enabled、verification_status |
| reminder_rules | event_type、lead_time、local_time、quiet_hours、channels、template_version |
| notification_jobs / attempts | 幂等键、scheduled_at、状态、provider_message_id、response_class、attempt_no |
| outbox_events | event_id、type、payload、available_at、dispatch_status；与业务修改同事务 |
| api_tokens / audit_logs | token_hash、scopes、ledger_ids、expires_at、actor、action、request_id、变更摘要 |
| write_previews | actor、ledger、body_hash、normalized_input、expires_at、resource_version；无账务副作用 |
| import_jobs / export_jobs | 文件摘要、映射、校验结果、状态、短期下载引用 |

### 4.2 金额语义

- 输入、输出使用如 "128.50" 的字符串。货币金额建议 numeric(24,6)，汇率 numeric(38,18)，服务端按币种 minor_units 拒绝多余精度；不悄悄截断。
- 原币是商家标价；结算币是账户实际扣款币；基准币是报表口径。默认记账时原币 = 账户币；外币消费要明确结算金额，用户可选择汇率估算并标识 estimated，到账后允许更正。
- 原币、结算币、基准币、使用汇率与来源全部落库。账本基准币在首笔已入账后固定；设置里的展示币切换只改变估值展示。
- 收入、支出、退款存正金额，由 kind 决定 posting 符号。收入 +，支出 −，退款 +；退款关联原交易且不记为收入。退款累计不得超过原已付金额，差额收益需单独收入。
- 转账同时写转出、转入两条 posting；目标和源金额分别用各自币种，不相加比较。手续费是单独支出。内部转账本金不进入收支和预算，资产结构会变化。
- 期初余额不算收入；账户余额 = 期初 + 所有已生效 posting。余额缓存可重建，与写入在事务内维护，不以汇总缓存为事实来源。
- 已入账交易更正采取同事务冲正 + 新版本；旧版本可审计。DELETE 语义为逻辑作废，创建反向 posting，重复作废无再次影响。报表只汇总有效业务版本，余额包含原始 posting 和冲正。
- 信用卡账户以负余额表示负债；刷卡是支出、还款是账户转账。V1 不做自动账单分期与利息摊销。
- rounding 默认 HALF_EVEN，按每笔基准金额舍入后求和；汇总展示与明细总和一致。年度订阅“月均费用”是预测指标，绝不混入当月已支付支出。

### 4.3 数据一致性

所有资金写入、账户余额更新、审计与 outbox 在一个数据库事务提交。锁账户按 ID 排序，防止跨账户转账死锁。版本号用于乐观并发，PATCH 必须 If-Match；旧版本返回 412，不覆盖他人修改。

所有创建写入支持 Idempotency-Key，作用域为 actor + ledger + method + canonical path。保存请求摘要和响应至少 7 天；相同 key / 相同体返回原响应，不同体返回 409。订阅 occurrence、导入行和通知 job 另有持久唯一业务键，不依赖 7 天窗口防重。

建议索引：

~~~text
transactions(ledger_id, local_date DESC, id DESC) WHERE status='posted'
transactions(ledger_id, category_id, local_date DESC)
account_postings(ledger_id, account_id, transaction_id)
bill_occurrences(subscription_id, schedule_version, scheduled_local_date) UNIQUE
notification_jobs(dedupe_key) UNIQUE
notification_jobs(status, scheduled_at)
fx_rates(provider, base, quote, source_at DESC)
audit_logs(ledger_id, created_at DESC)
~~~

列表使用 keyset cursor，默认 50、最多 100 条。大报表按日期 / 分类聚合，按页读取；导出走异步任务。数据库查询必须始终携带已授权 ledger_id。

## 5. 多币种与实时汇率

### 5.1 产品承诺

首发以“分钟更新的参考汇率”为目标：供应商提供 60 秒数据、Worker 每 60 秒单次批量拉取活跃币种，前台可见时每 60 秒读取本站汇率接口。正常网络 / 供应商更新时，源时间到展示的年龄目标 ≤120 秒。数据不是成交价格，账户真实扣款始终优先。

[Fixer 官方方案](https://fixer.io/)列有 60 秒更新档位；具体额度与授权在采购时确认。按整批每分钟一次，30 天约 43,200 次调用，再加历史查询与重试预算。切勿每个用户、每个页面或每个币对独立向供应商轮询。

### 5.2 汇率流程

1. 定时任务持有短租约，调用提供者并检查响应、币种覆盖、正值和 source_at；fetched_at 只记录抓取时间。
2. 保留原始基准币批次。若供应商给出 R(U)=U/P、R(C)=C/P，则 U→C = R(C)/R(U)，必须来自同一批次；同币转换恒为 1。
3. 写不可变 rates / batch；Redis 替换 latest 指针并增加版本号；不重写已入账的 fx_snapshot。
4. 写入当日交易采用当时可用参考率；补录历史交易使用业务日期的历史率。休市日取不晚于该日的最近可用报价，并展示实际日期。
5. 供应商不可用时可读最近成功数据，但显示 stale、sourceAt、原因；全无报价则允许原币草稿或手工汇率，不能悄悄按 1 折算。

| 状态 | 建议判定 | UI / 写入行为 |
| --- | --- | --- |
| fresh | 市场可更新时 source age ≤120 秒 | 正常标签；显示源时间 |
| delayed | >120 秒且 ≤15 分钟 | 橙色“更新延迟”；重试从本站缓存获取 |
| stale | >15 分钟，或提供者持续失败 | 显示年龄；入账预览要求选择沿用旧率 / 手填 / 草稿 |
| market_closed | 供应商 / 交易日历确认停止更新 | 显示“最近报价”，保留源时间；不标实时 |
| missing | 无该币对 / 历史记录 | 不汇总该部分；明确排除笔数，提供补率入口 |
| manual | 用户输入 | 记录操作者、理由；报表可识别人工汇率 |

“市场关闭”不能仅凭星期六猜测；无法确认时仍标 delayed/stale。异常跳变超配置阈值时保留待核验记录，继续展示旧率并提示，不自动接纳。备用供应商只在同一币对批次内替换，保留来源；首发必须先完成主源，备用源另做验证。

### 5.3 报表口径

历史收支使用入账时固定 base_amount；净资产按选定 asOf 的参考汇率估值。UI 明示“历史入账”与“当前估值”并默认历史收支。切换展示币不会改变原账；如展示历史期间的其他币种，逐笔使用该日交叉率，缺失显示部分可用，不用今日汇率伪造历史。

例（演示数值）：USD 10，入账 USD→CNY 7.20，历史支出固定 CNY 72；今日汇率 7.10 不会把它变成 CNY 71。USD 100 账户今日资产估值可以显示 CNY 710。

验收必须覆盖 JPY 零小数、三位小数币种、0.1+0.2、极小汇率、跨币种退款、补录、休市和源中断。

## 6. 周期账单与通知

### 6.1 订阅 / 提醒事件

订阅周期支持日、周、月、年及整数间隔。月末策略默认“当月最后一天”，锚点仍保留 31；1/31 → 2/28 → 3/31。闰年 2/29 年费在非闰年取 2/28。按订阅时区保存本地日期和提醒时间，换算 UTC 调度；DST 不存在时间顺延到第一个有效时间，重叠时间取第一次并以 occurrence 防重。

支持到期前 7/3/1 天、当天、试用结束、取消截止、逾期、预算阈值（默认 80%/100%）、每日记账提醒、周 / 月汇总、汇率阈值和投递失败通知。汇率阈值带冷却与回滞，避免价格抖动连发。各事件独立开关、接收渠道、免打扰和摘要合并。

订阅状态为 active / paused / cancelled；账单 occurrence 为 scheduled / due / paid / skipped / overdue。默认到期只生成账单，用户确认支付才产生交易。取消只阻止未来 occurrence；编辑周期增加 schedule_version，取消未发送旧 job，保留已付历史。

### 6.2 通道矩阵

| 通道 | 接入设计 | 开通与验收 |
| --- | --- | --- |
| 站内 | notifications 资源 + 未读计数 | 所有用户可用，作为故障兜底 |
| Telegram | Bot API，bot token + chat_id | 用户先向 Bot 发起会话 / 把 Bot 加入群；测试真实接收 |
| 飞书 | 自定义机器人 Webhook，签名配置 | 选定群，测试安全配置及消息格式 |
| 企业微信 | 群机器人；另支持企业应用消息适配 | 机器人用于群，应用消息需 corp / agent / secret / 成员授权 |
| 个人微信 | pushplus 微信公众号通道 | 用户按服务商流程绑定，配置独立消息 token，完成实际手机接收测试 |
| 邮件 | SMTP 或事务邮件供应商适配 | 地址验证、退信状态；不阻塞请求 |
| 通用 Webhook | 固定 schema + HMAC + event_id | HTTPS、目的地址校验、超时与重试、消费者自行去重 |

TG 行为基于 [Bot API](https://core.telegram.org/bots/api#sendmessage)；飞书接入以[官方自定义机器人文档](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)为入口。企业微信[官方文档](https://developer.work.weixin.qq.com/document/path/91770)在本次工具中无法完整读取，具体限流、签名与应用权限留作 M5 官方文档复核，不能硬编码猜测数值。

个人微信首发使用 [pushplus 的 wechat 渠道](https://www.pushplus.plus/doc/guide/api.html)。这意味着消息经过第三方；绑定页明确提示，默认只推标题 / 到期时间与登录后链接，金额和备注由用户开启。它不是直接向任意个人微信号发消息，也不使用个人号模拟登录方案。自有认证服务号可作为后续适配；第三方受理、微信送达、用户阅读是不同状态，不能混称成功。

### 6.3 可靠性

- DB 扫描到期规则并落唯一 job，outbox dispatcher 发队列；固定 jobId + DB 唯一键双层去重。调度重启从持久化水位补扫。
- dedupe_key = ledger/event/occurrence/rule/channel/recipient/template_version。任务执行前再次检查规则版本、支付状态和取消状态。
- 系统采用至少一次任务处理。供应商支持幂等时带同一 event_id；不支持时，对“请求超时但可能已经受理”标记 delivery_unknown，查询状态或人工决定重发。不能声称外部消息严格 exactly-once。
- 429 遵守 Retry-After；网络 / 5xx 使用指数退避与抖动，最多 5 次，超过提醒有效期直接 expired。凭据错误暂停渠道并站内提示；失败进入 dead-letter 可人工重放。
- 渠道状态 unconfigured / verifying / active / degraded / disabled；投递状态 queued / sending / accepted / delivered / failed / delivery_unknown / expired / cancelled。无可靠回执的渠道最多显示“平台已受理”。
- quiet hours 按接收人时区顺延；若已超过通知有效期则合并摘要或跳过并记录原因。严禁无条件在免打扰结束时重放大量过期提醒。
- 密钥信封加密，密钥版本可轮换，服务端脱敏日志。通用 Webhook 校验 DNS 解析与重定向目标，禁止内网 / metadata 地址，确有自托管需求用管理员明确 allowlist。

## 7. 高性能 SSR 设计与指标

### 7.1 页面渲染

页面壳、账本信息、KPI、首屏交易和可读报表摘要采用服务端渲染；日期筛选、金额输入、弹层与交互图表是小型 Client Components。图表在客户端加载，但关键数字和数据表无需等待图表 JS。不要在整个 layout 加 use client。

图表统一使用 ECharts。正式工程通过 echarts/core 注册 LineChart、BarChart、PieChart、Grid、Tooltip、Aria 和 SVGRenderer，避免导入完整包；在图表客户端边界内延迟加载。首发低点数图表使用 SVG renderer，长期大规模图表才单独基准测试 Canvas。首屏图表容器有固定高度，加载或资源失败时仍可读取 SSR 数字、数据表与明细链接。

实例生命周期：容器完成布局后 init，数据 / 展示币 / 主题变化使用同一实例 setOption；稳定 series.id 与 data.name 保留更新动画，禁止用随机 key 反复销毁重建。ResizeObserver 调用 resize，卸载时断开 observer、解绑事件并 dispose；只有客户端模块访问 window / document。

动效按照 UI_SPEC §2.1：初次 550–850ms、更新约 420ms、错峰最多 180ms；不循环播放、不对真实金额做弹跳或过冲。prefers-reduced-motion 同时关闭 ECharts 与 CSS 动效；页签或币种更新保留已读内容。动画和鼠标提示不得阻塞保存、导航或屏幕阅读。

ECharts 支持 setOption 数据过渡，参考[官方动画说明](https://echarts.apache.org/handbook/en/how-to/animation/transition/)。若后续需要首屏图形也由服务端输出，可评估[官方 SVG SSR](https://echarts.apache.org/handbook/en/how-to/cross-platform/server/)；这不是首发必需路径，不能把普通浏览器 SVG 图表宣称为已完成 SSR 图表。当前原型本地携带 ECharts 6.0.0 common 便于离线评审；正式构建须按需打包、锁定验证后的稳定补丁并独立测量图表 chunk。

独立查询并发执行；用 Suspense 把“近期待办”“趋势”分块，首屏关键数据有明确时间预算。外部 FX、TG 或微信不参与 SSR 请求链。头像和静态图标有尺寸，字体本地化，减少 CLS。

页面导航保留 URL 搜索参数（period、category、account、currency）；用户编辑后先等待服务器响应，再更新局部缓存及 router refresh，不乐观修改资金余额。后台汇总可最终一致，但返回 transaction_version，让 UI 知道统计何时追上写入。

### 7.2 缓存政策

| 数据 | 范围 / 失效 | 约束 |
| --- | --- | --- |
| 已登录 HTML、RSC、带个人数据 REST 响应 | private / no-store，禁止共享 CDN 缓存 | 匿名和另一用户必须取不到已登录数据 |
| 请求内重复领域读取 | 当前请求 memoization | AuthContext 是调用参数，不能持久化到全局 |
| 账本统计聚合 | Redis，key 含 ledger_id、权限维度、时间区间、口径、currency、data_version；TTL 30 秒 | 写入提交后增加 data_version，避免旧 job 回填覆盖新版本 |
| 汇率 | 按供应商 / 币对 / 批次共享，latest TTL 60 秒 | 可以共享市场数据，不能共享账户余额 |
| 分类、账本设置 | 首发请求内去重；必要时短缓存 | membership 变动立即撤销授权，不依赖缓存许可 |
| 静态资源 | 哈希资源 immutable | Service Worker 不缓存认证 API / 账务 HTML |

不依赖 Next.js 不同版本的隐式缓存默认值，M1 用真实请求检查响应头和用户间隔离；未授权之前不能读取共享统计缓存。

### 7.3 验收环境与目标

以下是首发性能预算，M7 必须提交实测。基准：Linux 4 vCPU / 8GB，同区域 Postgres / Redis；1,000 个模拟用户、每个账本最多 100k 笔测试交易；100 并发、80% 读 / 20% 写、运行 10 分钟。报告需记录数据库大小、网络延迟和冷 / 热缓存。

| 指标 | 目标 |
| --- | --- |
| 已登录总览 TTFB | 热缓存 p95 ≤500ms；冷缓存 p95 ≤1,000ms |
| 普通 REST 查询 / 写入 | p95 ≤300ms / ≤500ms（不含第三方服务） |
| 12 月聚合查询 | 热 p95 ≤500ms；冷 p95 ≤1.5s |
| Web Vitals | 移动端代表性 4G 场景 p75 LCP ≤2.5s，INP ≤200ms，CLS ≤0.1 |
| 主页面首屏 JS | 自有 JS gzip ≤180KB；图表 chunk 单独计量且延迟加载 |
| 提醒调度延迟 | 正常运行时 scheduled_at 到 worker 开始 p95 ≤60s |
| 汇率新鲜度 | 正常源更新时 source age p95 ≤120s；故障明确显示 |

发布前无足够真实 RUM 流量时，Web Vitals 用至少 20 次受控浏览器测试报告分布，并注明是实验数据；上线后再以 7 天 RUM 验证。低于目标时先检查查询与串行 IO，再谈扩容。

### 7.4 外观主题的渲染与缓存

交互规则见 UI_SPEC §2.2。实现约束如下：

- 令牌：packages/ui 定义浅 / 深两套中性令牌和固定语义色。主题色只有四个输入变量（--accent-l / --accent-d / --on-accent-l / --on-accent-d），soft、侧栏等派生值由 CSS color-mix 计算。Tailwind 主题引用 CSS 变量，组件中出现硬编码颜色视为缺陷。
- 生成器：主题色生成器是纯函数（OKLCH 调整 + WCAG 对比度校验 + palette_version），服务端与客户端共用同一实现。客户端结果只用于即时预览；PATCH 时服务端重新生成并校验，不信任客户端提交的色值。单元测试覆盖全部预设、极端颜色、色域裁剪和版本升级重算。
- SSR 首帧：根 layout 是服务端组件。已登录时，偏好随 session 一并读取 user_preferences，不额外发 HTTP 请求；未登录时读取 Cookie ln_appearance（只含模式和主题色，非敏感，SameSite=Lax、Secure、有效期 1 年）。手动模式输出 html data-theme，并以内联 style 输出四个主题色变量；跟随系统完全由 @media (prefers-color-scheme) 处理，因此首帧正确且无需阻塞脚本。Sec-CH-Prefers-Color-Scheme 浏览器支持不全，只可作为可选优化。
- 客户端：外观设置是小型 Client Component。切换时立即更新 html 属性和变量（纯展示，不涉及资金，可乐观更新），并写 Cookie；500ms 防抖后 PATCH /api/v1/me/preferences，失败时提示“仅本设备生效”并允许重试。跟随系统时监听 matchMedia('(prefers-color-scheme: dark)') 的 change 事件，并通知图表更新。
- 图表：ECharts 颜色从解析后的 CSS 令牌读取（color-mix 等表达式先解析为 sRGB 十六进制）。模式或主题色变化时对同一实例 setOption，禁止为换肤 dispose 重建；不使用 ECharts 内置 dark 主题，避免与产品令牌分叉。
- 缓存：已登录 HTML 本就 private / no-store，外观差异不改变该策略。登录页等公开页面若启用共享缓存，必须 Vary: Cookie，或改为客户端注入外观变量，不能把某个用户的主题缓存给其他人。静态 CSS 不含用户值，可 immutable 缓存。
- 性能：生成器单次计算 <1ms，不涉及 IO；内联变量 <300 字节，不影响 §7.3 的 JS 预算。

## 8. 权限、数据保护和运维

- Session Cookie 使用 HttpOnly、Secure、SameSite；Cookie 写请求检查 Origin 与 CSRF。跨站请求不允许任意带凭据 CORS。
- owner 管成员与令牌；editor 可记账；viewer 只读。每个 ID lookup、嵌套关系、导出文件、MCP 调用都验证账本权限。
- PAT 仅展示一次；数据库存哈希；默认只读、可选账本、到期时间、随时撤销。UI 不显示原 token，审计记录调用主体和客户端，不记录凭据。
- API 限流按 actor / ledger / IP 分层；金额写入另设速率，避免 Agent 循环创建。返回标准 429 与 Retry-After。
- CSV 导出防公式注入；导入先校验 / 预览 / 批量提交，保留行号错误和导入批次撤销路径。不接收任意 URL 作为附件来源。
- 日志使用 request_id / trace_id 串联 HTTP、outbox 与 worker；金额 / 备注默认脱敏。告警覆盖 DB、队列积压、FX age、投递失败率和备份失败。
- 备份：每日全量 + WAL 归档（部署具备条件时）；目标 RPO ≤15 分钟、RTO ≤2 小时，必须通过恢复演练证明。仅每日备份的部署标记 RPO ≤24 小时，不冒用前述目标。
- 迁移采用 expand/contract，先兼容代码再删列；上线前快照，失败回滚应用，数据库破坏性回滚必须有恢复步骤。加密密钥需独立备份，否则通知凭据不可恢复。
- /health/live 仅进程存活；/health/ready 检查 DB、必要 Redis 连接与迁移版本，不外呼供应商。优雅停机停止领新任务并释放租约。

## 9. 关键场景验收

| ID | 场景 | 可观察结果 |
| --- | --- | --- |
| AC01 | 手机连续重复提交同一支出 | 一笔交易、一份 posting、一次余额变化 |
| AC02 | USD 支出后次日汇率变化 | 历史 CNY 支出不变，资产估值可变 |
| AC03 | HKD 转 USD 并收手续费 | 两账户余额正确；收入为 0；支出仅手续费 |
| AC04 | 1 月 31 日月订阅 | 2 月末出账后 3 月回到 31 日 |
| AC05 | 已支付后旧提醒任务启动 | 任务记录取消 / 跳过，手机不再收到催缴 |
| AC06 | 供应商超时 / Redis 重启 | UI 给真实状态；outbox 恢复；无重复入账 |
| AC07 | 另一用户枚举交易 ID | 404 或权限错误，不泄露金额及存在性 |
| AC08 | 图表筛选分类 | 明细 URL 同步，可返回，金额与图表完全对齐 |
| AC09 | 四个 Agent 读写同一测试账本 | 相同权限与幂等语义；已撤销令牌立即失败 |
| AC10 | 个人微信和企业微信真实接收 | 分别有带脱敏时间 / event_id 的验收证据 |

后续任务、责任角色和验证命令见 [执行手册](DELIVERY_PLAN.md)；不得把本文指标当作已经通过的测试。
