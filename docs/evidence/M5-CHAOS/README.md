# M5-CHAOS · 提醒跨通道故障与恢复验收 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估）· 分支 `claude/loving-planck-dvzfpc`。故障均由本地 mock 注入（D21），不连接真实服务器。

## 故障与预期状态

| 故障 | 预期 | 证据 |
| --- | --- | --- |
| 429（Retry-After 2 s） | 等待后第 2 次受理，不提前重试 | `notify.api.ts` 限流用例（≥1.9 s、attempts=2）；`notifications.test.ts`「429 honours Retry-After」 |
| 5xx 持续 | 指数退避 5 次 → failed + 死信；站内告知；恢复后人工重放成功 | `notify.api.ts`「faults…」：Telegram 死信，同一规则的飞书仅 1 条、站内正常；重放后 Telegram 1 条、飞书仍 1 条；`notifications.test.ts` 退避区间断言 |
| 应答丢失（供应商已收、连接断开） | delivery_unknown，不自动重发；供应商收件 1 次 | `notify.api.ts` 与 `notifications.test.ts`「a lost answer…」 |
| 凭据失效 | failed、渠道停用、排队任务取消、站内告知 | `notify.api.ts`、`notifications.test.ts`「a credential error…」 |
| 到期后暂停 / 支付 / 改期 | 排队提醒取消，不再催缴 | `notifications.test.ts`（AC05、暂停订阅、规则修改） |
| worker 发送途中 SIGKILL + Redis 重启 + 停机 15 s | 在途 → unknown（供应商收 1 次、不重发）；停机期间到期 → 恢复后补发 1 次；停机期间过期 → expired 不迟发 | Docker 演练 [notify-restart.ts](../../../tests/chaos/notify-restart.ts)：`PASS: worker SIGKILL + Redis restart — in-flight: unknown (received once, not resent); due during outage: sent once; expired: not sent` |
| 两个 worker 抢同一次尝试 | 只发 1 次 | `notifications.test.ts`「two workers cannot send the same claimed attempt」 |

## 统计与延迟

`GET /notification-stats`：按状态计数、死信、unknown 与调度延迟（计划时间 → worker 开始发送）。`notify.api.ts` 断言 p95 ≤ 60 s；按分钟排程的“今天到期”提醒实测在计划分钟内送达 Telegram mock（延迟 ≤ 60 s）。P07 页面显示同一统计。

## 留给人工审查

- 生产规模下的调度延迟分布（M7-PERF）；真实渠道限流行为。
