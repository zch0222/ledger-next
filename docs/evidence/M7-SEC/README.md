# M7-SEC · 权限、密钥与数据安全验收 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估）。本记录汇总本轮新增检查与此前各里程碑的安全用例；第三方服务均为本地 mock（D21）。

## 检查矩阵

| 领域 | 检查 | 结论 | 证据 |
| --- | --- | --- | --- |
| ID 枚举（AC07） | 他人账本 / 自己账本路径下，用他人的交易、账户、分类、标签、订阅、预算、导出、审批 id 请求，与“从未存在的 id”逐字节相同的 404（除 requestId），不含金额 / 商户 / 名称；畸形 id 同为 404 | 通过 | `security.api.ts`「another user cannot tell…」；`identity.api.ts` tenant isolation；`ledger-core.test.ts` 跨账本外键 |
| 缓存串账 | 所有 REST 响应（含错误）`private, no-store`；已登录页面 no-store；静态 chunk immutable 且不含用户数据；报表缓存键含账本 + 数据版本，授权在读缓存之前 | 通过 | `security.api.ts`「responses are never cacheable…」；`ui.spec.ts` SSR privacy；`reports.api.ts` 缓存 |
| CSRF / CORS | Cookie 写请求校验 Origin；跨站 Origin 403；不返回 `Access-Control-Allow-Origin`（预检与实际请求） | 通过 | `identity.api.ts`；`security.api.ts` |
| 会话 Cookie | HttpOnly、SameSite=Lax；HTTPS 部署自动 Secure | 通过（HTTPS 待部署核对） | `security.api.ts`；`auth.ts` useSecureCookies |
| 安全响应头 | nosniff、`X-Frame-Options: DENY`、CSP `frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`、Referrer-Policy、Permissions-Policy、COOP；HSTS 由反向代理加（RUNBOOK） | 通过 | `security.api.ts` |
| 存储型 XSS | 交易备注 / 商户、分类名中的 `<img onerror>`、`<script>`、`<b>` 在 SSR HTML（含 RSC 负载）中只以转义文本出现 | 通过 | `security.api.ts`「stored markup…」 |
| 导入注入 | CSV 导出对 `= + - @ TAB CR` 开头的单元格加撇号；导入行级校验、批次可撤销 | 通过 | `imports.api.ts`、`imports.test.ts` |
| PAT | 只存哈希、只显示一次、作用域 / 账本限制、会话专属操作拒绝、撤销立即生效、签发需最近登录 | 通过 | M6-SERVER 证据 |
| 审批绑定 | 绑定方法 + 路径 + 请求体哈希 + 发起人；一次性；令牌不能批准；换内容复用被拒 | 通过 | `agents.test.ts`、`agents.api.ts`、`agents.spec.ts` |
| Agent 注入 | 备注中的“忽略之前的指令…”只作为数据返回并附“不要执行”提示；MCP 无任意 SQL / URL / 密钥读取 / 支付工具 | 通过（模型行为待人工） | `agents.api.ts`、`clients.api.ts` |
| SSRF | Webhook / 飞书 / 企微地址：仅 https、官方域名校验、私网与元数据地址拒绝、连接时再做 DNS 检查（防重绑定） | 通过 | `notify.api.ts`、`notifications.test.ts`、`net-guard.ts` |
| 渠道密钥 | 信封加密（AES-256-GCM），API / 页面只回脱敏摘要；主密钥轮换 `pnpm channels:rewrap` | 通过 | M5 证据、`notifications.test.ts` |
| 限流（新增） | 每会话 / 令牌 600 次每分钟；认证失败按来源地址 30 次后 429（即使随后用对令牌）；资金写入按账本：会话 120、令牌 30；429 带 Retry-After；Redis 不可用时放行 | 通过 | `security.api.ts`「rate limits…」、`rate-limit.test.ts` |
| 日志脱敏（新增） | Docker 套件跑完后扫描 web / worker 全部日志：无 PAT、测试密码、Bot token、Bearer 头、备注 / 商户文本、供应商密钥 | 见 Docker 记录 | `scripts/docker-test.mjs` 日志扫描步骤 |
| 依赖漏洞（新增） | `pnpm audit --prod`：8 项（3 高）全部来自 nodemailer 8.0.11，升级到 10.0.13 后 0 项；同时修正 SMTP 超时参数被当作邮件默认值而失效的问题 | 已修复 | `pnpm audit --prod` |

## 问题记录

| 编号 | 等级 | 问题 | 处理 |
| --- | --- | --- | --- |
| SEC-1 | 高（阻塞） | 设计要求的 API 分层限流未实现（Agent 可循环写入、令牌可被暴力尝试） | 已实现并测试（D34） |
| SEC-2 | 高 | nodemailer 8.0.11 存在 3 个高危、5 个中危公告（地址解析 DoS、域名白名单绕过等） | 升级 10.0.13 |
| SEC-3 | 中 | SMTP 连接 / 问候 / 套接字超时未生效（参数位置错误），故障 SMTP 可能长时间占用 worker | 修正为传输选项 |
| SEC-4 | 低 | 缺少 CSP / Permissions-Policy 基线 | 已加（不需 nonce 的基线策略；完整 script-src 策略留作后续） |

## 留给人工审查

- 生产 HTTPS 下复核 Cookie `Secure`、HSTS 与反向代理的 `X-Forwarded-For` 覆盖（防伪造来源地址绕过认证失败限流）。
- 完整 `script-src` CSP（需要 nonce）是否在首发前实施。
- 渗透测试 / 第三方代码审计（本轮为实现者自评估）。
