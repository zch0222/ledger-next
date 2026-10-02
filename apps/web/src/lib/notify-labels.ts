// Display labels for reminders and channels (P07 / P08). Personal WeChat and WeCom are always separate channels.
export const CHANNEL_TYPES = {
  telegram: { name: 'Telegram', icon: 'T', desc: 'Bot 发到个人聊天或群：先向 Bot 发送 /start，或把 Bot 拉进群。' },
  feishu: { name: '飞书', icon: '飞', desc: '群自定义机器人；建议启用“签名校验”。' },
  wecom_bot: { name: '企业微信群机器人', icon: '企', desc: '企业微信群里的机器人 Webhook。' },
  wecom_app: { name: '企业微信应用消息', icon: '应', desc: '企业自建应用发给成员；需要 CorpID、AgentId、Secret 与可信 IP。' },
  pushplus_wechat: { name: '个人微信（pushplus）', icon: '微', desc: '经 pushplus 公众号转发到你的个人微信；默认只推标题、日期与链接。' },
  email: { name: '邮件', icon: '✉', desc: '服务器发信；填写测试邮件里的验证码确认收件。' },
  webhook: { name: 'Webhook', icon: '↗', desc: 'HTTPS POST，HMAC-SHA256 签名，带 event id 供接收方去重。' },
  in_app: { name: '站内通知', icon: '♧', desc: '始终可用；其他渠道失败时的兜底。' },
} as const;
export type ChannelTypeId = keyof typeof CHANNEL_TYPES;
export const CHANNEL_STATUS: Record<string, string> = { unconfigured: '未配置', verifying: '待验证', active: '已启用', degraded: '降级', disabled: '已停用' };
export const DELIVERY_STATUS: Record<string, string> = { queued: '排队中', sending: '发送中', accepted: '平台已受理', delivered: '已送达接收端', failed: '失败', delivery_unknown: '结果未知', expired: '已过期', cancelled: '已取消' };
export const RESPONSE_CLASS: Record<string, string> = { ok: '成功', rate_limited: '被限流', server_error: '服务端错误', client_error: '请求被拒绝', credential_error: '凭据无效', timeout: '超时', network: '网络错误' };
export const EVENT_LABELS: Record<string, string> = {
  bill_due: '订阅到期', trial_end: '试用结束', cancel_deadline: '取消截止', overdue: '账单逾期', budget_threshold: '预算阈值', daily_entry: '每日记账',
  weekly_summary: '每周小结', monthly_summary: '每月小结', fx_threshold: '汇率阈值', delivery_failed: '投递失败', test: '测试消息',
};
export const DATED_EVENTS = ['bill_due', 'trial_end', 'cancel_deadline'];
export type ChannelView = { id: string; type: ChannelTypeId; name: string; enabled: boolean; status: string; configSummary: Record<string, string>; lastVerifiedAt: string | null; lastError: string | null; version: number };
