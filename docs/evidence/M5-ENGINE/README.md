# M5-ENGINE · 提醒调度、Outbox 与可靠投递 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估，见 [AUTONOMOUS_DELIVERY](../../reviews/AUTONOMOUS_DELIVERY.md)）· 分支 `claude/loving-planck-dvzfpc`。第三方渠道全部为本地协议 mock（D21）。

## 交付

| 步骤 | 实现 |
| --- | --- |
| 规则、持久化 job、outbox、稳定去重键 | 迁移 [0010_notifications.sql](../../../packages/db/migrations/0010_notifications.sql)：`reminder_rules`（属主 + 账本，版本号）、`notification_deliveries`（投递日志即 job 存储，`dedupe_key` 唯一 = 账本 / 事件 / 对象 / 规则 / 规则版本 / 渠道 / 接收人 / 模板版本）、`notification_attempts`（（投递、轮次、序号）唯一，防两个 worker 同时发送同一次尝试）、`notifications`（站内）。[reminders.ts](../../../packages/domain/src/reminders.ts)：预览 → 规则；48 小时视野物化，订阅 / 账单变化经 outbox 触发重排，预算与汇率阈值为事件触发；[deliveries.ts](../../../packages/domain/src/deliveries.ts)：认领（SKIP LOCKED）→ BullMQ（固定 job id）→ 发送前复核 → 结果分类 |
| 免打扰、时区、过期、退避、DLQ 与 unknown | [reminder-schedule.ts](../../../packages/domain/src/reminder-schedule.ts)（接收人时区、DST、跨午夜免打扰顺延、提前量的有效期止于下一档）；429 遵守 Retry-After，5xx / 网络错误指数退避 + 抖动、最多 5 次后死信并站内告知；请求已发出但无应答 → `delivery_unknown`，绝不自动重发；超过有效期 → `expired` 记录原因；凭据错误暂停渠道并取消其排队任务；worker 中断后 `sweepStuck` 区分“未发出（重新排队）”与“发送中断（unknown）” |
| P07 / P08 与可读反馈 | [reminders 页面](../../../apps/web/src/app/ledgers/[ledgerId]/reminders/page.tsx)（规则含下三次时间、投递记录按状态筛选与重试、站内通知与顶栏未读角标、7 天统计含调度延迟 p95）、[channels 页面](../../../apps/web/src/app/ledgers/[ledgerId]/settings/channels/page.tsx) |

已付 / 跳过 / 改期 / 暂停在同一事务里取消该账单的排队提醒（AC05）；规则修改为新版本：取消旧版本排队任务后重排，已发送的同一事件不再重复。

## 验收标准对照

| 验收标准 | 结论 | 证据 |
| --- | --- | --- |
| worker / Redis 重启可恢复，不重复入账 | 通过 | Docker 演练 [notify-restart.ts](../../../tests/chaos/notify-restart.ts)：发送途中 SIGKILL worker 并重启 Redis，停机 15 秒：在途请求 → unknown，供应商收件箱恰好 1 条且不重发；停机期间到期的 → 恢复后补发 1 次；停机期间过期的 → expired、不迟发。集成：`notifications.test.ts`「expires instead of sending late, and recovers…」「two workers cannot send the same claimed attempt」 |
| 已付 / 取消 / 规则版本变化使旧提醒失效 | 通过 | `notifications.test.ts`「sends at the slot, then cancels … once it is paid (AC05)」「a rule edit cancels queued deliveries of the old version and never repeats a sent one」（含暂停订阅、删除规则）；`notify.api.ts` 规则修改 / 删除后 Telegram 收件箱仍只有 1 条 |

## 运行记录

- 单元：`notify-pure.test.ts`（信封加密与轮换、SSRF 地址段、免打扰 / DST / 提前量有效期、汇率阈值回滞与冷却）。
- 集成：`notifications.test.ts` 15 个用例（未来时间钉住，Docker 中与 worker 共存互不干扰）。
- E2E：`notify.api.ts` 4 个、`notify.spec.ts` 2 × 2（桌面 / 移动）；Docker 混沌演练见 M5-CHAOS。

## 留给人工审查

- 生产环境 `LEDGER_ENCRYPTION_KEYS` 的保管与轮换流程（`pnpm channels:rewrap`）。
- 48 小时视野 / 10 秒 tick 在目标规模下的数据库负载（M7-PERF）。
