# M7-E2E · 完整业务回归与导入导出 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估）。回归以一次完整的 `pnpm test:e2e`（Docker：迁移演练、持久化、MySQL 集成、混沌演练、Playwright api / desktop / mobile、日志脱敏扫描、优雅停机）为准，结果见文末“运行记录”。

## 关键场景（TECHNICAL_DESIGN §9）

| ID | 场景 | 结论 | 证据 |
| --- | --- | --- | --- |
| AC01 | 手机连续重复提交同一支出 | 通过 | `ledger.api.ts`「a duplicated submission moves money once…」（6 并发同键）；`contract.api.ts` 幂等重放；`flows.spec.ts`（mobile）保存中不重复；`transactions.test.ts` 12 并发 |
| AC02 | USD 支出后次日汇率变化：历史 CNY 不变，估值可变 | 通过 | `fx.test.ts`「locks the previewed rate; a newer batch never changes what is booked」；`reports.test.ts`「values in current mode at the latest rate, separately from historical amounts」；`fx.api.ts` 锁定汇率 |
| AC03 | 跨币种转账并收手续费 | 通过 | `transactions.test.ts`「cross-currency transfer with a linked fee; principal is neither income nor expense」；`fx.test.ts`「values a transfer between two foreign accounts」；`ledger.api.ts` transfers |
| AC04 | 1 月 31 日月订阅：2 月末出账，3 月回到 31 日 | 通过 | `schedule.test.ts`「keeps the 31st anchor across short months (AC04)」；`subscriptions.test.ts`「materializes unique bills…; due is not paid (AC04, D14)」 |
| AC05 | 已支付后旧提醒任务启动 → 取消 / 跳过 | 通过 | `notifications.test.ts`「sends at the slot, then cancels the remaining reminders of a bill once it is paid (AC05)」 |
| AC06 | 供应商超时 / Redis 重启 | 通过 | 混沌演练（SIGKILL worker + 重启 Redis）；`fx.api.ts` 源故障如实降级；`notify.api.ts` faults |
| AC07 | 另一用户枚举交易 ID | 通过 | `security.api.ts`「another user cannot tell whether any of my resources exist (AC07)」 |
| AC08 | 图表筛选分类 → 明细 URL 同步、可返回、金额对齐 | 通过 | `visual.spec.ts` dashboard / analytics 钻取（桌面 + 移动） |
| AC09 | 四个 Agent 读写同一账本 | 通过（协议级模拟） | `clients.api.ts`「AC09: four clients on one ledger…」：同一账本四种配置 / 传输、MCP 与 REST 同键幂等、撤销只影响一个客户端；真实客户端见 M6 |
| AC10 | 个人微信与企业微信真实接收 | 未在本轮实测（mock） | `notify.api.ts` pushplus / 企业微信 mock 各自收件；**真实接收列入最终人工审查**（D21） |

## 页面（UI_SPEC §4）

| 页面 | 证据（桌面 + 移动，axe WCAG A/AA，6 种宽度 × 4 组外观无横向溢出） |
| --- | --- |
| P00 登录 / 引导 | `ui.spec.ts` registration → ledger → sign out；`identity.api.ts` |
| P01 总览 | `visual.spec.ts` dashboard（SSR 数值、合计与钻取一致、图表同实例更新） |
| P02 / P03 明细与记账 | `flows.spec.ts` 记账 / 更正 / 退款 / 作废、筛选入 URL、412 不覆盖、慢预览不串值、键盘与软键盘 |
| P04 订阅 | `flows.spec.ts` subscriptions；`subscriptions.test.ts` |
| P05 分析 / 预算 | `visual.spec.ts` analytics；`reports.api.ts` |
| P06 账户 | `flows.spec.ts` accounts（转账、信用卡负债、归档） |
| P07 提醒中心 | `notify.spec.ts` reminders |
| P08 提醒渠道 | `notify.spec.ts` channels |
| P09 币种与汇率 | `settings.spec.ts` currencies |
| P10 Agent 接入 | `agents.spec.ts` |
| P11 导入导出 | `settings.spec.ts` CSV import wizard；`imports.api.ts` |
| P12 账本设置 | `ui.spec.ts` members；`settings.spec.ts` viewer |
| P13 外观 | `visual.spec.ts` appearance；`settings.spec.ts` |

全部页面同时进入 `visual.spec.ts`「responsive and accessible」矩阵（含 P10 的已填充状态）。

## 币种边界与其他

- 精度与边界：`money.test.ts`、`ledger-core.test.ts`（JPY 0 位、KWD 3 位未启用、大额、0.1 + 0.2）；`imports.api.ts` 超精度行报错。
- 两种微信：pushplus（个人微信，默认不含金额备注）与企业微信机器人 / 应用消息为不同渠道，各自 mock 收件（M5-WX / M5-WECOM）。
- 跨月订阅：月末锚点、暂停到期自动恢复、改期取消旧计划（`subscriptions.test.ts`）。
- 导入导出：去重、行级错误、批次撤销（含已退款支出）、导出公式转义、仅创建者 1 小时内可下载。

## 缺陷清单（本轮回归发现）

| 编号 | 等级 | 问题 | 状态 |
| --- | --- | --- | --- |
| E2E-1 | P1 | 纯 HTTP 来源下 `crypto.randomUUID` 不可用，记账按钮报错 | 已修复（M5 轮） |
| E2E-2 | P1 | 预览应答乱序时保存了旧输入的预览 | 已修复并加回归用例 |
| E2E-3 | P2 | 水合前选择的 CSV 文件被忽略 | 已修复 |
| E2E-4 | P2 | 历史时点汇率在 MCP 文案中标为“实时” | 已修复 |
| E2E-5 | P2 | P10 工具表手机宽度不可聚焦滚动（axe） | 已修复 |
| SEC-1 ~ 4 | 见 M7-SEC | 限流、nodemailer、SMTP 超时、CSP | 已修复 |

无未关闭的 P0 / P1。

## 留给人工审查

- AC10：真实个人微信（pushplus）与企业微信接收截图（脱敏时间 / event_id）。
- 真实客户端联调（M6）、真机浏览器（iOS Safari / Android Chrome）抽查。
