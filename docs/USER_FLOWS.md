# 操作逻辑图与状态契约

日期：2026-10-02。图中为完整目标流程；首批已实现登录、创建 / 切换账本与成员管理，资金 / 通知 / Agent 流程尚未实现。数据库按用户要求改为 MySQL。对应 [UI 规范](UI_SPEC.md)、[接口契约](API_AGENT_CONTRACT.md)。

## F01 首次使用

~~~mermaid
flowchart TD
  A[登录] --> B{已有可访问账本?}
  B -->|有| C[选择账本 / 总览]
  B -->|无| D[新建账本]
  D --> E[选择基准币 / 时区]
  E --> F[新建首个账户与期初余额]
  F --> G{绑定提醒?}
  G -->|是| H[选择渠道 / 测试接收]
  G -->|稍后| C
  H --> C
  C --> I[记第一笔 / 新建订阅]
~~~

期初余额不记收入。首笔已入账前可改基准币；之后 UI 只提供展示币切换。

## F02 普通记账与异常恢复

~~~mermaid
flowchart TD
  A[记一笔] --> B[输入结算金额 / 账户 / 分类 / 日期]
  B --> C{原币与结算币不同?}
  C -->|是| D[填写原币与实际结算金额]
  C -->|否| E[请求入账预览]
  D --> E
  E --> F{字段与权限有效?}
  F -->|否| B
  F -->|是| G{历史基准折算可用?}
  G -->|缺失 / 过期| H[选择手工率 / 沿用旧率 / 草稿]
  H -->|草稿| I[保存草稿 不影响余额]
  H -->|确定口径| E
  G -->|可用| J[显示入账结果]
  J --> K[REST POST 带幂等键]
  K --> L{响应}
  L -->|201 / 幂等重放| M[更新明细 / 余额 / 统计版本]
  L -->|422| B
  L -->|超时未知| N[按同一幂等键查询 / 重试]
  N --> L
  L -->|412 预览过期或冲突| E
~~~

预览无账务写入。重试必须保留相同键；用户改变内容则重新预览并生成新键。

## F03 跨币种转账

~~~sequenceDiagram
  actor U as 用户
  participant W as Web
  participant A as REST / Domain
  participant D as MySQL 8.4 LTS
  U->>W: 选 HKD 转出 / USD 转入、双金额、手续费
  W->>A: POST /transaction-previews
  A-->>W: 双账户变化 + 费用支出 + 基准折算
  U->>W: 保存
  W->>A: POST /transactions + Idempotency-Key + previewId
  A->>D: BEGIN / 锁定账户 / 验证 membership
  A->>D: 写交易、两条 posting、费用交易、审计、outbox
  A->>D: COMMIT
  A-->>W: 201 + transactionId + version
  W-->>U: 两账户余额、费用明细
~~~

不得先扣源账户再异步增加目标账户；任何一条失败整笔回滚。转账本金不计收入或支出。

## F04 更正、作废与退款

~~~mermaid
flowchart TD
  A[账目详情] --> B{操作}
  B -->|更正| C[编辑 / 展示余额影响]
  C --> D[PATCH + If-Match]
  D --> E{版本一致?}
  E -->|否| F[显示冲突 / 重新预览]
  E -->|是| G[同事务冲正旧 posting / 写新版本]
  B -->|作废| H[显示交易与影响 / 用户确认]
  H --> I[DELETE + If-Match / 写反向 posting]
  B -->|退款| J[填写退款金额 / 到账账户]
  J --> K[校验可退余额 / POST refunds]
  K --> L[退款交易关联原账目 / 抵减支出]
  G --> M[保留完整审计]
  I --> M
  L --> M
~~~

## F05 周期账单

~~~stateDiagram-v2
  [*] --> scheduled: 创建 occurrence
  scheduled --> due: 到期
  due --> overdue: 逾期且未支付
  scheduled --> paid: 提前确认支付
  due --> paid: 确认支付
  overdue --> paid: 补记支付
  scheduled --> skipped: 跳过本期
  due --> skipped: 跳过本期
  overdue --> skipped: 关闭本期
  scheduled --> cancelled: 订阅取消 / 周期版本变更
  paid --> [*]
  skipped --> [*]
  cancelled --> [*]
~~~

~~~mermaid
flowchart LR
  A[新增订阅] --> B[展示未来三次日期]
  B --> C[保存周期 / 提醒规则]
  C --> D[生成唯一 occurrence]
  D --> E[预生成提醒 job]
  E --> F{执行前账单是否仍需提醒?}
  F -->|已支付 / 已取消 / 旧版本| G[取消任务并记录]
  F -->|有效| H[执行通道投递]
  H --> I[用户打开账单]
  I --> J[确认支付 / 跳过 / 暂停订阅]
~~~

订阅暂停不改已支付账；恢复按原锚点生成未来计划，补发策略明确展示，默认不轰炸式补发历史提醒。

## F06 渠道绑定与提醒投递

~~~mermaid
flowchart TD
  A[配置 TG / 飞书 / 企微 / 个人微信] --> B[服务端加密保存凭据]
  B --> C[用户触发测试消息]
  C --> D[创建测试 delivery]
  D --> E[Worker 发到供应商]
  E --> F{结果}
  F -->|平台接受| G[显示平台已受理]
  G --> H[用户在接收端核验]
  H --> I[启用渠道 / 绑定规则]
  F -->|限流 / 可重试| J[退避重试 / 显示下次时间]
  J --> E
  F -->|凭据失效| K[停用渠道 / 站内提示]
  F -->|超时且结果不明| L[delivery_unknown / 查询状态]
~~~

~~~sequenceDiagram
  participant D as 数据库
  participant O as Outbox Dispatcher
  participant Q as 队列
  participant W as Worker
  participant P as 通知平台
  D->>O: 待派发事件
  O->>Q: 发布稳定 jobId
  Q->>W: 至少一次消费
  W->>D: 领取任务 / 核验版本、去重、免打扰
  W->>P: 发送 eventId 和模板消息
  alt 明确接受
    P-->>W: 平台消息 ID
    W->>D: accepted
  else 结果未知
    W->>D: delivery_unknown
  else 明确暂时失败
    W->>D: 记录尝试 / 下次重试
  end
~~~

HTTP 200 只表示平台请求结果之一，还要检查业务返回码。用户阅读状态不能凭 API 受理推断。

## F07 汇率更新与报表

~~~mermaid
flowchart TD
  A[60 秒调度 / 单批拉取] --> B{供应商返回有效报价?}
  B -->|是| C[存原始批次 / 源时间]
  C --> D[计算同批交叉率 / 更新 latest]
  B -->|否| E[保留最近成功 / 标记延迟]
  D --> F[前台读取本站接口]
  E --> F
  F --> G{用途}
  G -->|历史收支| H[使用交易固定快照]
  G -->|当前资产估值| I[使用最新有效率 / 显示时间]
  G -->|历史补录| J[查对应历史日期 / 无率则人工处理]
~~~

## F08 Agent 查询与写入

~~~mermaid
flowchart TD
  A[用户自然语言请求] --> B[Skill 读取当前账本 / 时区 / 作用域]
  B --> C{查询还是写入?}
  C -->|查询| D[MCP tool → REST GET]
  D --> E[返回金额 / 币种 / 期间 / 口径 / 新鲜度]
  C -->|写入| F[解析字段 / 缺失时询问必要项]
  F --> G[MCP preview → REST preview 资源]
  G --> H{用户授权充分且预览一致?}
  H -->|不足 / 存歧义| I[展示具体金额账户并澄清]
  I --> G
  H -->|是| J{高影响批量操作?}
  J -->|否| K[create / update + previewId + 幂等键]
  J -->|是| L[创建审批请求 / Web 用户批准]
  L --> K
  K --> M[同一 REST 权限 / 领域事务]
  M --> N[返回真实资源 ID 和链接 / 审计]
~~~

Skill 不能授予令牌没有的权限。批量删除 / 大规模导入的审批由已登录用户完成，不能把模型提供 confirmed=true 当成用户证明。当前 Skill 草案不能创建未实现的服务能力。

## F09 进度状态与开发门禁

~~~stateDiagram-v2
  [*] --> todo
  todo --> in_progress: 前置任务全部 done
  in_progress --> in_review: 提交证据
  in_review --> done: 验收记录与责任人
  in_progress --> blocked: 阻塞原因
  in_review --> in_progress: 返工
  blocked --> in_progress: 原因已解决且依赖完成
~~~

脚本还支持 ready，用于显式标记依赖已满足的待执行任务。G0 需要有效评审记录和 reviewer；所有业务开发通过 M1-BASE 依赖 G0。状态并不自动证明产品质量，验收证据仍由评审者判断。

## F10 外观：深浅模式与主题色

~~~mermaid
flowchart TD
  A[顶栏外观 / 更多 → 外观 / P13] --> B{修改什么}
  B -->|显示模式| C{跟随系统?}
  C -->|是| D[移除 data-theme，由 prefers-color-scheme 决定]
  C -->|否| E[data-theme = light 或 dark]
  B -->|预设主题色| F[读取预设浅 / 深色值]
  B -->|自定义颜色| G{#RRGGBB 有效?}
  G -->|否| H[内联错误，保持当前主题]
  G -->|是| I[OKLCH 调整明度，生成满足 AA 的浅 / 深色板]
  I --> J{接近错误 / 警告色?}
  J -->|是| K[非阻断提示，仍可使用]
  J -->|否| L
  K --> L
  F --> L[更新 html 变量，临时禁用过渡]
  D --> L
  E --> L
  L --> M[图表同实例 setOption 换色]
  M --> N[写 Cookie，防抖 PATCH /me/preferences]
  N --> O{保存成功?}
  O -->|是| P[账号同步，其他设备下次加载生效]
  O -->|否| Q[提示仅本设备生效，可重试]
~~~

~~~mermaid
stateDiagram-v2
  state "跟随系统（默认）" as system
  state "浅色（手动）" as light
  state "深色（手动）" as dark
  [*] --> system
  system --> light: 选择浅色
  system --> dark: 选择深色
  light --> dark: 选择深色
  dark --> light: 选择浅色
  light --> system: 选择跟随系统
  dark --> system: 选择跟随系统
  state system {
    [*] --> sys_light
    sys_light --> sys_dark: 系统切换为深色
    sys_dark --> sys_light: 系统切换为浅色
  }
~~~

解析顺序：手动选择 > 系统偏好 > 浅色。SSR 首帧按已保存偏好（未登录时读 Cookie）输出，跟随系统交由 CSS 媒体查询处理，因此不会先闪现另一种主题。外观不触发账务请求，收支、警告、错误和图表数据色不随主题色变化。
