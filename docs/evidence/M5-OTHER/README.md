# M5-OTHER · 站内、邮件与 Webhook · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估）· 分支 `claude/loving-planck-dvzfpc`。

> 邮件经测试栈内的本地 SMTP mock 投递，Webhook 发往本地接收端 mock（D21）。真实邮箱收件与真实接收服务是最终人工审查项。

## 实现

- 站内：每个用户自动拥有“站内通知”渠道（不可删除），作为兜底；其他渠道最终失败时另写一条站内失败通知；顶栏角标显示未读数，P07“站内通知”可标记已读 / 未读。
- 邮件：系统 SMTP（`SMTP_URL`，nodemailer 8.0.11），250 只表示服务器已受理；测试邮件带 6 位验证码，用户回填后渠道才启用（错误 5 次或 30 分钟后失效）；4xx 重试、5xx 永久失败、DATA 之后断线记为 unknown。
- Webhook：固定 JSON（`id` = event id、`type`、`createdAt`、`data`），头 `X-Ledger-Event-Id`、`X-Ledger-Timestamp`、`X-Ledger-Signature: v1=HMAC-SHA256(secret, "timestamp.body")`；只允许 HTTPS、拒绝 URL 内账号密码、不跟随重定向；连接时校验 DNS 解析出的每个地址（拒绝回环 / 私网 / 链路本地 / 云元数据 / 保留段，含 IPv4 映射与 NAT64），自托管内网接收端需管理员 `WEBHOOK_ALLOWLIST`（[net-guard.ts](../../../packages/domain/src/net-guard.ts)）。2xx = 接收端已收到（delivered）；401 / 403 / 410 → 停用渠道。

## 验收标准对照

| 验收标准 | 结论 | 证据 |
| --- | --- | --- |
| 有独立接收证据，不用其他渠道结果替代 | 通过（mock） | `notify.api.ts`：SMTP mock 收件箱按收件地址找到邮件并取出验证码完成验证；Webhook mock 记录的签名与按密钥重新计算的 HMAC 一致、事件 id 与正文一致；站内通知经 API 列表与页面角标验证 |
| 密钥不回显，平台受理不误报用户已读 | 通过 | 列表不含 Webhook 密钥；邮件被 SMTP 受理后渠道仍是“待验证”，必须回填验证码；SSRF：`169.254.169.254`、`localhost`、`http://`、仿冒飞书域名均 422 且不落库（`notify.api.ts`、`notify-pure.test.ts` 覆盖 IPv4 / IPv6 / 映射地址与 DNS 解析） |

## 留给人工审查

- 真实 SMTP（含 TLS / 认证、退信处理）与真实收件箱；真实 Webhook 接收端的验签实现。
