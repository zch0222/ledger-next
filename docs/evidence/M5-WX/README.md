# M5-WX · 个人微信（pushplus） · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估）· 分支 `claude/loving-planck-dvzfpc`。

> 按用户要求与 D21，本轮不连接真实服务器：渠道请求发往 `apps/mock-services` 中按公开协议实现的本地 mock，生产域名经 `CHANNEL_ENDPOINT_OVERRIDES` 只在测试栈中改写。**真实接收（手机 / 群里确实收到）是最终人工审查项**，不得以本记录替代。

## 实现

- 协议：POST www.pushplus.plus/send（token、title、content、template=txt、channel=wechat）。适配器见 [channels.ts](../../../packages/domain/src/channels.ts)，mock 见 [channels mock](../../../apps/mock-services/src/channels.ts)。
- 响应分类：code 200 → 受理；401 / 403 / 903 / 905 → 凭据错误；500 / 999 → 重试；其余（如 900 账号受限、888 额度）→ 永久失败。错误码映射依据公开文档整理，需在人工审查时对照官方最新文档复核（D25）。
- 配置：信封加密（AES-256-GCM 数据密钥 + 主密钥版本，[secrets.ts](../../../packages/domain/src/secrets.ts)），API / 页面只返回脱敏摘要；错误文本先剔除凭据再存储。默认只推标题、日期与链接，金额与备注需用户在渠道设置中开启（经第三方转发）；与企业微信分别命名、分别验收。
- 状态：新建为“待验证”；测试消息被平台受理后才“已启用”，页面写明“受理不代表已读”；凭据错误 → “已停用”并站内告知；连续 3 次可重试失败 → “降级”。

## 验收标准对照

| 验收标准 | 结论 | 证据 |
| --- | --- | --- |
| 有独立接收证据，不用其他渠道结果替代 | 通过（mock 收件箱） | `notify.api.ts`「every channel type…」：经 REST → worker → 本渠道 mock，mock 收件箱里按本渠道唯一标识（chat id / hook / key / 用户 / token / 地址）找到恰好 1 条；「a budget alert fans out…」每个渠道各收到 1 次、不重复 |
| 密钥不回显，平台受理不误报用户已读 | 通过 | 同上：列表响应不含任何密钥字段值；状态只到“平台已受理”；`notifications.test.ts` 数据库密文不含明文、轮换主密钥后仍可解密；`notify.spec.ts` 页面不显示 token、测试结果文案为“平台已受理，请确认确实收到” |

## 留给人工审查

- 用真实凭据在真实客户端确认收到测试消息（个人微信（pushplus））。
- 对照官方文档复核限流数值与错误码映射。
