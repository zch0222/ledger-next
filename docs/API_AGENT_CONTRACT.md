# REST API、MCP 与配套 Skill 契约

版本 0.3 · 2026-10-02 · 可执行契约。下表全部资源已转换为 OpenAPI 3.1：[packages/contracts/openapi.json](../packages/contracts/openapi.json)（由 `packages/contracts/src` 的 Zod 定义生成，`pnpm contract:generate`），类型化 REST SDK 位于 `packages/api-client`。每个操作带 `x-stability`：`stable` 为已实现并受 CI 破坏性变更门禁保护（M1 身份 / 账本 / 成员 / 审计，M2 账户、分类、标签、交易、导入导出，M3 汇率、报表与预算；具体清单见 openapi.json 与 `tests/unit/contract.test.ts`）；`planned` 为已发布、尚未实现的契约，返回 501 并标注 `x-milestone`，实现时可调整。认证库协议为 `/api/auth/*`。下列远程域名是示例，MCP 配置不表示现在可以连接。

## 1. 公共 REST 规则

业务根路径 /api/v1，账本内资源前缀 L = /api/v1/ledgers/{ledgerId}。资源使用复数名词；POST 创建、GET 查询、PATCH 局部修改、DELETE 作废 / 归档。长任务创建资源返回 202 + Location，再 GET 任务状态；不提供 /doX、/getX、/sendNow 风格业务动作接口。

内容类型 application/json；错误 application/problem+json。金额、汇率均为十进制字符串，ISO 币种大写；时间为 RFC3339 UTC，业务日期另传 YYYY-MM-DD + IANA timezone。ID 示例是示意；正式 schema 使用 UUID。日期筛选 dateFrom 含、dateTo 不含，在账本时区转换边界。

认证：Web Session Cookie；外部 REST / MCP 使用 Bearer PAT。Token 绑定用户、允许账本、scopes 和有效期。服务端不得直接信任客户端传来的 userId / role；membership 再次核验。

| 项目 | 约定 |
| --- | --- |
| 成功包体 | 单条 {data, meta:{requestId}}；列表 {data:[], page:{nextCursor,hasMore}, meta} |
| 分页 | cursor opaque（HMAC 签名，绑定用户、操作、账本与筛选条件；篡改或换筛选返回 400 INVALID_CURSOR），limit 默认 50、上限 100；keyset 稳定排序，交易按 local_date DESC、id DESC |
| 筛选 | dateFrom/dateTo、accountId、categoryId、kind、q；sort 白名单；cursor 与筛选摘要绑定 |
| 幂等 | 创建交易、退款、订阅、账单支付、测试投递、导入等必须 Idempotency-Key（缺失 400）；其余创建可选。作用域 actor + method + 路径；同 key 同请求体返回原状态码与正文并带 `Idempotent-Replayed: true`，不同请求体 409 IDEMPOTENCY_KEY_REUSED；记录与业务写入同事务，失败请求不留记录，保留 7 天 |
| 并发 | 可修改资源返回 ETag；PATCH / DELETE 必须 If-Match；缺少返回 428，冲突返回 412 |
| 响应码 | 200/201/202/204；400 格式、401 未认证、403 作用域 / Origin、404 不存在/不可见（含格式错误的 ID）、405 方法不支持（带 Allow）、409 业务冲突、412 版本、413 过大、415 类型、422 字段（含查询参数）、428 缺 If-Match、429 限流、501 契约已发布未实现、503 暂不可用；每个操作在 OpenAPI 中列出其可能的错误码 |
| 追踪 | 每次响应 X-Request-Id；错误可显示 requestId；日志不含令牌与完整备注 |
| 速率 | 通过配置确定；响应带 Retry-After；MCP 遵循相同额度，不能绕过 |
| 版本 | v1 内仅兼容添加；破坏变更开 v2，OpenAPI diff 作为 CI 门禁 |

OpenAPI 3.1 是可执行契约：下表每一行都已转换为 paths、schemas、security（Session / PAT 作用域）、`x-ledger-role` 与错误响应，并生成 SDK。CI 执行 `pnpm contract:check --base-ref <基线>`：生成文件必须最新，stable 操作不得出现删除操作 / 参数、新增必填字段、收紧输入、删除或放宽响应字段、提高角色或作用域等破坏性变更。端到端测试用 ajv 按该文件校验真实响应。

## 2. 资源清单

| 方法 / 路径 | 作用 / 返回 | 最低权限 |
| --- | --- | --- |
| GET /api/v1/me | 身份、账本列表、默认账本、有效 scopes | 已认证 |
| GET/PATCH /api/v1/me/preferences | 本人外观偏好：themeMode（system / light / dark）、accent（预设 ID 或 #RRGGBB）；响应附服务端生成的浅 / 深色板与 paletteVersion；PATCH 同时刷新 ln_appearance Cookie | 本人 Web Session；PAT / MCP 不开放 |
| GET/POST /api/v1/ledgers | 账本列表 / 新建 | 已认证 |
| GET/PATCH L | 账本详情 / 设置 | viewer / owner |
| GET/POST L/memberships | 成员 / 邀请关系 | owner |
| PATCH/DELETE L/memberships/{id} | 角色 / 移除成员，保护最后 owner | owner |
| GET/POST L/accounts | 账户列表 / 新建 | viewer / editor |
| GET/PATCH/DELETE L/accounts/{id} | 详情 / 修改名称等 / 归档 | viewer / editor |
| GET/POST L/categories、L/tags | 分类 / 标签维护 | viewer / editor |
| PATCH/DELETE L/categories/{id}、L/tags/{id} | 修改 / 归档 | editor |
| GET L/transactions | 明细 / 筛选 / 分页 | transactions:read |
| POST L/transaction-previews | 规范化金额、余额影响、汇率快照、预览有效期 | transactions:write |
| POST L/transactions | 新建收支或转账；201 | transactions:write |
| GET/PATCH/DELETE L/transactions/{id} | 详情 / 更正 / 作废，审计保留 | read / write |
| POST L/transactions/{id}/refunds | 创建关联退款；201，返回新交易 | transactions:write |
| GET/POST L/subscriptions | 列表 / 创建周期订阅 | subscriptions:read/write |
| POST L/subscription-previews | 校验周期，展示未来三次 occurrence | subscriptions:write |
| GET/PATCH L/subscriptions/{id} | 修改、暂停、取消通过状态字段表达 | subscriptions:read/write |
| GET L/bill-occurrences | 日期范围账单列表 / 日历 | subscriptions:read |
| GET/PATCH L/bill-occurrences/{id} | 详情 / 跳过、关闭 | subscriptions:read/write |
| POST L/bill-occurrences/{id}/payments | 记录实际支付，唯一关联交易；不是银行扣款 | transactions:write |
| GET/POST L/budgets、PATCH/DELETE L/budgets/{id} | 周期 / 分类预算配置 | viewer / editor |
| GET L/reports/summary | KPI，附 valuationMode、partial、excludedCount | reports:read |
| GET L/reports/cash-flow、/category-breakdown、/account-balances | 趋势 / 分类 / 资产估值 | reports:read |
| GET /api/v1/exchange-rates | base/quotes/asOf，返回 sourceAt、freshness | fx:read |
| POST L/manual-rate-records | 有理由的人工汇率记录 | editor |
| POST /api/v1/exchange-rate-refresh-jobs | 去重刷新任务；202，严格限流 | 系统管理员 |
| GET/POST L/reminder-rules | 规则列表 / 创建 | reminders:read/write |
| POST L/reminder-previews | 提醒未来三次时间、免打扰影响 | reminders:write |
| PATCH/DELETE L/reminder-rules/{id} | 修改 / 停用规则 | reminders:write |
| GET/POST /api/v1/notification-channels | 本人的渠道 / 配置加密保存 | channel owner |
| PATCH/DELETE /api/v1/notification-channels/{id} | 修改 / 停用，不返回明文凭据 | channel owner |
| POST /api/v1/notification-channels/{id}/test-deliveries | 创建测试投递；202 | channel owner |
| GET L/notification-deliveries、GET /{id} | 投递记录和平台状态 | reminders:read |
| GET/PATCH L/notifications/{id} | 站内通知 / 标已读 | recipient |
| POST/GET L/import-jobs、GET L/import-jobs/{id} | CSV 校验预览 / 任务状态 | editor |
| POST L/import-jobs/{id}/commits | 提交已验证导入批次；202 | editor |
| POST L/import-jobs/{id}/reversals | 撤销该批次生成账务的任务 | owner |
| POST/GET L/export-jobs、GET L/export-jobs/{id} | 导出任务 / 状态 / 短期下载 | exports:read |
| POST/GET /api/v1/api-tokens、DELETE /{id} | 签发 / 元信息 / 撤销 | 用户本人，敏感操作重新认证 |
| GET L/audit-events | 审计分页，不包含密钥 | owner |
| POST/GET L/approval-requests、GET/PATCH /{id} | 高影响操作审批；批准只能由 Web 用户 | owner |
| GET L/operations/{id} | Agent 写入结果 / 异步操作状态 | 原 actor |

外观偏好示例（色值由服务端生成器计算，客户端预览值仅供参考）：

~~~http
PATCH /api/v1/me/preferences
If-Match: "pref-v3"
Content-Type: application/json

{"appearance": {"themeMode": "system", "accent": {"type": "custom", "value": "#6B4EFF"}}}
~~~

~~~json
{
  "data": {
    "appearance": {
      "themeMode": "system",
      "accent": {"type": "custom", "value": "#6B4EFF"},
      "palette": {
        "version": 1,
        "light": {"accent": "#684AFB", "onAccent": "#FFFFFF", "minContrast": "4.53", "adjusted": true},
        "dark": {"accent": "#9896FF", "onAccent": "#0F1F22", "minContrast": "4.75", "adjusted": true}
      }
    }
  },
  "meta": {"requestId": "req-example"}
}
~~~

非法颜色或未知预设返回 422，不写入。沿用 ETag / If-Match，412 时客户端重新读取，再按用户最后一次选择重试。偏好不属于账本资源，不进入账务审计；未保存过偏好时 GET 返回默认值 system + teal。

通知 webhook 回调、OIDC 回调、MCP 传输不纳入 REST 业务资源命名约束，因为必须匹配对方协议。相关入口仍必须鉴权 / 验签、限流和验证 schema。

## 3. 金额与预览示例

以下 ID 为可读占位符；实际字段使用 UUID。

~~~http
POST /api/v1/ledgers/{ledgerId}/transaction-previews
Content-Type: application/json

{
  "kind": "expense",
  "accountId": "account-usd",
  "settlement": {"amount": "12.00", "currency": "USD"},
  "original": {"amount": "12.00", "currency": "USD"},
  "categoryId": "software",
  "occurredAt": "2026-10-02T02:00:00Z",
  "timezone": "Asia/Hong_Kong",
  "merchant": "示例软件",
  "fxPolicy": "fresh-only"
}
~~~

~~~json
{
  "data": {
    "previewId": "preview-example",
    "expiresAt": "2026-10-02T02:05:00Z",
    "normalizedInputHash": "sha256:example",
    "settlement": {"amount": "12.00", "currency": "USD"},
    "base": {"amount": "86.40", "currency": "CNY"},
    "exchangeRate": {
      "value": "7.200000000000000000",
      "sourceAt": "2026-10-02T01:59:00Z",
      "freshness": "fresh",
      "source": "demo-only"
    },
    "accountDeltas": [{"accountId": "account-usd", "delta": "-12.00", "currency": "USD"}],
    "warnings": []
  },
  "meta": {"requestId": "request-example"}
}
~~~

创建交易提交 previewId + 同一规范化输入（或只引用服务端保存的输入）；服务端绑定 actor / ledger / scope，检验未过期及账户版本。预览锁定实际将入账的汇率，不允许提交时悄悄用新价格替换。账户版本变化需要重新预览；幂等重放先查询既有结果，避免已成功写入后被预览过期拦截。

~~~http
POST /api/v1/ledgers/{ledgerId}/transactions
Idempotency-Key: <uuid-for-this-intent>
Content-Type: application/json

{"previewId":"preview-example"}
~~~

转账 preview 输入改为 kind=transfer、sourceAccountId、targetAccountId、sourceAmount、targetAmount、各自 currency 和 fee（可选）。退款 preview 增加 originalTransactionId，再向 refunds 资源提交。所有账户均需属于同一账本；多笔 / 批量 API 不能靠未受限 JSON 透传。

M2-LEDGER 已实现的规则（以 OpenAPI 与 `tests/e2e/ledger.api.ts` 为准）：

- 预览保存规范化输入、计算结果与所用账户版本，10 分钟有效、只能提交一次（重复提交 409 PREVIEW_CONSUMED，过期 422 PREVIEW_EXPIRED，他人预览 422 PREVIEW_NOT_FOUND）。提交时在账户锁内重新计算，账户被改名 / 归档或分类 / 标签失效则 409 PREVIEW_STALE；余额变化本身不使预览失效。同一 Idempotency-Key 的重试先回放原结果，不受预览已消费影响。
- 结算币须与账户币种一致，金额按币种精度校验；结算币不是账本基准币时，需 `fxPolicy: "manual"` + `manualRate`（M3-FX 接入报价前没有自动汇率，返回 422 FX_RATE_MISSING）。转账若转入基准币账户，以双方金额推算汇率（source: transfer）。
- 转账写转出 / 转入两条 posting，不带分类，不计收支；手续费是关联的独立支出（`transfer.feeTransactionId`），作废转账时一并作废。
- 退款只针对有效支出，退回同币种账户，沿用原支出的分类与锁定汇率；累计超过原支付金额 409 REFUND_EXCEEDS_PAID（并发退款在原交易行锁内串行判断）。有有效退款的支出不能作废或更正（409 HAS_REFUNDS）。
- 更正（PATCH + If-Match + 新预览）在同一事务内冲正旧版本 posting、把旧版本标为 voided，并写入 `replacesId` 指向旧版本的新交易；作废（DELETE + If-Match）追加反向 posting，重复作废不再变化。posting 只追加不改写。
- 列表默认只返回有效交易（`status=posted`），可用 `voided` / `all` 查看历史版本；`accountId` 同时匹配转账两端；按业务日期或基准金额 keyset 分页。
- 每次写入的审计记录与 outbox 事件与资金变化同一事务提交。

M2-IMPORT / M3 已实现的规则：

- 导入：`POST L/import-jobs`（multipart：`file` + `mapping` JSON，需 Idempotency-Key，按文件摘要指纹）→ 202，Worker 异步校验；`GET` 轮询 `validated` 后 `POST …/commits` 入账，owner 可 `POST …/reversals` 撤销。错误行带行号、列名与错误码（INVALID_DATE、ACCOUNT_NOT_FOUND、AMOUNT_PRECISION、CATEGORY_NOT_FOUND、UNSUPPORTED_KIND、FX_RATE_MISSING、DUPLICATE_ROW…），已入账的行再次上传记为 DUPLICATE_ROW。
- 导出：`POST L/export-jobs` → 202；`ready` 后 `downloadUrl` 指向 `GET …/export-jobs/{id}/file`（text/csv，仅创建者，1 小时内）。
- 汇率：`GET /exchange-rates?base=&quotes=&asOf=` 返回每个币种的 value / sourceAt / fetchedAt / freshness / source；新鲜度按源时间。交易预览默认 fresh-only：delayed 附 `FX_DELAYED` 警告，stale 返回 422 FX_RATE_STALE（需 `accept-stale`），无报价 422 FX_RATE_MISSING（需人工汇率；回溯日期会排队补录）。提交复用预览锁定的汇率。跨币种退款需 `originalAmount`（原支付币种的退款额）。
- 报表：summary / cash-flow / category-breakdown / account-balances / budget-progress 均带 currency、valuationMode、partial、excludedCount、dataVersion、sourceAt。dataVersion 随每次资金写入递增，可用于判断统计是否已追上写入。

~~~json
{
  "type": "https://ledger.example/problems/fx-rate-stale",
  "title": "汇率已过期",
  "status": 422,
  "code": "FX_RATE_STALE",
  "detail": "请选择沿用旧率、输入人工汇率或保存草稿。",
  "requestId": "request-example",
  "errors": [{"path": "fxPolicy", "code": "choice_required"}]
}
~~~

HTTP 错误状态必须真实，不能全部返回 200。原型中的报价只是示例，不来自线上 FX。

## 4. MCP 服务

### 4.1 协议与边界

远程入口 /mcp，使用 Streamable HTTP；本地入口 ledger-mcp stdio。二者共享工具 schema 和 REST SDK。MCP 请求为 JSON-RPC，业务服务仍是 RESTful，参考 [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。

实施时锁定官方 SDK 支持的稳定协议，协商能力而不是硬编码单一版本；至少测试 2025-11-25 兼容配置与当时四个客户端的协商结果。无必要不实现旧 HTTP+SSE 专用端点。HTTP 服务校验 Origin、Host、Bearer 和请求大小；stdio stdout 只输出协议消息，日志写 stderr。

MCP 只转换参数、错误、资源和权限上下文，不访问数据库，不持有系统级超级 token。每个调用使用当前用户令牌访问 REST。令牌不可在客户端日志、MCP resources 或返回正文中暴露。

首发受控自托管使用 PAT；远程 OAuth 授权能力另列后续工作。未实现 discovery / PKCE / protected resource metadata 时，不宣传“完整 MCP OAuth 兼容”。只支持 OAuth 的宿主应使用 stdio 桥接或等待该扩展。

### 4.2 首发工具

| Tool 原始名 | 输入重点 | REST 映射 | scope / 副作用 |
| --- | --- | --- | --- |
| ledger_get_context | ledgerId 可选 | GET me + ledger | 基础只读；返回币种、时区、权限 |
| ledger_list_accounts | ledgerId | GET accounts | accounts:read |
| ledger_list_transactions | ledgerId、期间、筛选、cursor | GET transactions | transactions:read |
| ledger_get_summary | ledgerId、期间、valuationMode、currency | GET reports/summary | reports:read |
| ledger_get_exchange_rates | base、quotes、asOf | GET exchange-rates | fx:read |
| ledger_list_subscriptions | ledgerId、status | GET subscriptions | subscriptions:read |
| ledger_list_reminders | ledgerId、日期 | GET reminder-rules / deliveries | reminders:read |
| ledger_preview_transaction | ledgerId、typed transaction input | POST transaction-previews | transactions:write；无资金变更 |
| ledger_create_transaction | ledgerId、previewId、idempotencyKey | POST transactions / refunds | transactions:write |
| ledger_update_transaction | id、previewId、expectedVersion、idempotencyKey | PATCH transaction | transactions:write；有修改影响 |
| ledger_preview_subscription | 周期、币种、账户、提醒 | POST subscription-previews | subscriptions:write |
| ledger_create_subscription | previewId、idempotencyKey | POST subscriptions | subscriptions:write |
| ledger_preview_reminder | 事件、接收渠道、时间与免打扰 | POST reminder-previews | reminders:write |
| ledger_create_reminder | previewId、idempotencyKey | POST reminder-rules | reminders:write |
| ledger_get_operation | operationId | GET operations | 原 actor；查重试结果 |

工具使用 JSON Schema：additionalProperties=false，必填和枚举显式声明，字符串长度 / 日期跨度 / limit 设上限。readOnlyHint、destructiveHint、idempotentHint 正确标注；annotations 只是客户端提示，服务端权限才是控制。幂等写工具需要稳定 idempotencyKey 才可标 idempotent。

查询结果返回 structuredContent 与简短 text 摘要：currency、valuationMode、sourceAt、partial、excludedCount、nextCursor、resourceUrl。错误保留 REST code / requestId，设置 isError；不把出错结果包装成已完成。大明细分页，大导出返回任务 ID。

resources 可提供 ledger://{id}/context 和 ledger://{id}/categories（读权限校验）；不依赖 prompts 能力。尤其 dsh 当前官方 MCP client 文档注明未支持 MCP prompt templates，因此业务流程放在 Skill 内。

### 4.3 Agent 写入控制

默认令牌只有读权限；写权限按用户选择授予并限制账本。单笔、明确授权且字段齐全的请求可完成预览后直接提交，不为已明确授权的每一步重复询问。金额 / 币种 / 账户含糊时必须先澄清；不能把“最近账户”当作未授权资金归属。

批量作废、超配置金额 / 笔数阈值、跨多账本更改创建 approval-request，返回 Web 审批链接；审批由登录用户完成且绑定请求哈希、actor、范围、到期时间。模型不能自己批准，也不能更换数据复用批准。首发 MCP 不暴露任意 SQL、任意 URL 请求、密钥读取、银行支付等工具。

## 5. 四客户端适配

以下文件只是样例，实施人员根据实际域名替换 ledger.example，并配置本地 secret；本次未修改用户全局配置。每个客户端都要有版本号 + 实测证据，配置存在不等于联调成功。

### 5.1 Codex

在本地 Codex 配置加入：

~~~toml
[mcp_servers.ledger]
url = "https://ledger.example/mcp"
bearer_token_env_var = "LEDGER_API_TOKEN"
~~~

运行 Codex 的进程需要可读取该环境变量。正式 Skill 安装到项目 .agents/skills/ledger-service/SKILL.md 或官方支持的用户技能目录。依据 [OpenAI MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)、[Build skills](https://learn.chatgpt.com/docs/build-skills)，只给本集成必要配置。

### 5.2 Claude Code

项目 .mcp.json 示例，环境变量在本地设置，文件中不落真实凭据：

~~~json
{
  "mcpServers": {
    "ledger": {
      "type": "http",
      "url": "https://ledger.example/mcp",
      "headers": {"Authorization": "Bearer <ENV_TOKEN>"}
    }
  }
}
~~~

将示例 <ENV_TOKEN> 替换为客户端支持的环境变量引用（实施时核对当前版本），或通过本地配置安全注入。Skill 放 .claude/skills/ledger-service/SKILL.md。执行 /mcp 查看连接，进行只读探针，再测试写权限与撤销。官方参考：[MCP](https://code.claude.com/docs/en/mcp)、[Skills](https://code.claude.com/docs/en/skills)。

### 5.3 DeepSeek Harness（dsh）

官方项目处于开发预览，M6 固定 release / commit 并记录。向实际使用的 profile / overlay 添加一条 MCP client 插件配置；不要把下面 YAML 粘贴到 Claude 的 JSON：

~~~yaml
- id: mcp-ledger
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: ledger
    transport: streamable-http
    url: https://ledger.example/mcp
    headers:
      Authorization: !!js "'Bearer ' + process.env.LEDGER_API_TOKEN"
~~~

!!js 是 dsh 配置表达式，不能作为普通 YAML 随意交给其他客户端。按[官方 MCP client README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md)选择当前 profile 装载方式；本例仅定义插件行，不虚构稳定的安装 CLI 命令。

Skill 优先放 .dsh/skills/ledger-service/SKILL.md；当前官方实现还识别 .agents/skills。依据[官方 Skills 子系统](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/skills)，发布时核对目录发现、重名优先级和重载行为。stdio 模式下显式传 LEDGER_API_TOKEN，不能假定环境中名字含 TOKEN 的变量自动继承。

### 5.4 Qoder

Qoder IDE 的 MCP 设置可配置远程 URL；当前[官方文档](https://docs.qoder.com/user-guide/chat/model-context-protocol)说明 Streamable HTTP 可沿用 SSE 端点配置并自动识别。需要验证版本对应的 headers / secret 注入能力；若无法安全配置 Bearer，采用 stdio 桥接作为首发兜底。

~~~json
{
  "mcpServers": {
    "ledger": {
      "command": "node",
      "args": ["/absolute/path/ledger-mcp/dist/stdio.js"],
      "env": {
        "LEDGER_API_URL": "https://ledger.example/api/v1",
        "LEDGER_API_TOKEN": "<inject-local-secret>"
      }
    }
  }
}
~~~

上面 JS 文件是计划构建产物，当前不存在；不能使用未发布包名 npx 自动安装。Windows args 应替换为实际绝对路径。每次配置只选择 HTTP 或 stdio 一个入口，避免工具重复注册。

Qoder CLI 的 Skill 路径为 .qoder/skills/ledger-service/SKILL.md 或 ~/.qoder/skills；新会话加载，当前文档支持 /skills reload。参考 [Qoder CLI Skills](https://docs.qoder.com/cli/Skills)。IDE / CLI / 其他 Qoder 产品分别记录版本，不混用产品能力声明。

## 6. Skill 包设计

草案保存在 [skill-draft/ledger-service](skill-draft/ledger-service/SKILL.md)。它的职责是决定记账业务流程、币种与时区歧义、如何使用预览和幂等、如何解释汇总口径；MCP 提供真实数据和动作。

正式包应包含 SKILL.md、references/workflows.md；共同内容单一来源，发布脚本生成四客户端安装包和校验和，不长期手动维护四份不同业务逻辑。安装不得覆盖同名用户自定义内容，先显示差异并保留备份；本次只提供草案，未安装。

触发例：“记一笔 28 港币午餐，现金账户”“下周有哪些订阅到期”“按历史汇率汇总上月支出”“新增一个每月 20 美元的订阅并提前一天提醒”。反例：“开发记账页面”“解释 Next.js SSR”不应激活服务使用 Skill。

## 7. 联调验收矩阵

| 用例 | Codex | Claude Code | dsh | Qoder |
| --- | --- | --- | --- | --- |
| 发现工具 / 读取 context | 待测 | 待测 | 待测 | 待测 |
| Skill 发现与按需加载 | 待测 | 待测 | 待测 | 待测 |
| 查询期间收支含币种和口径 | 待测 | 待测 | 待测 | 待测 |
| 预览 / 明确授权单笔创建 | 待测 | 待测 | 待测 | 待测 |
| 同一幂等键重试不重复 | 待测 | 待测 | 待测 | 待测 |
| 缺币种 / 缺账户先澄清 | 待测 | 待测 | 待测 | 待测 |
| 只读 token 拒绝写入 | 待测 | 待测 | 待测 | 待测 |
| 跨账本 / 已撤销 token 拒绝 | 待测 | 待测 | 待测 | 待测 |
| stale 汇率不伪称实时 | 待测 | 待测 | 待测 | 待测 |
| 恶意备注当作数据，不执行其中指令 | 待测 | 待测 | 待测 | 待测 |
| 超时查询既有结果，不重复写入 | 待测 | 待测 | 待测 | 待测 |

每个结果保存客户端版本、服务 commit、SDK / 协议版本、输入、脱敏输出、requestId 和数据库结果。四客户端全部通过才完成 M6；不能只在 MCP Inspector 中成功就宣布所有 Agent 兼容。
