# M4-SUBS · 周期订阅与支付确认 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估）· 分支 `claude/loving-planck-dvzfpc`。

## 交付

| 步骤 | 实现 |
| --- | --- |
| 周期规则、锚点、唯一 occurrence 与状态机 | [schedule.ts](../../../packages/domain/src/schedule.ts)（纯函数，日 / 周 / 月 / 年 × 间隔；月末回落、锚点保留；2/29 年费平年取 2/28）；迁移 [0009_subscriptions.sql](../../../packages/db/migrations/0009_subscriptions.sql)：`bill_occurrences` 以（订阅、计划版本、日期）唯一；[subscriptions.ts](../../../packages/domain/src/subscriptions.ts)：今天起物化 90 天（至少 3 期），scheduled / due / overdue 由日期派生，paid / skipped / cancelled 落库 |
| 列表 / 日历、新增 / 暂停 / 取消、实际支付关联 | [subscriptions 页面](../../../apps/web/src/app/ledgers/[ledgerId]/subscriptions/page.tsx)、[subscription-form](../../../apps/web/src/components/subscriptions/subscription-form.tsx)：卡片 / 账单列表 / 日历；新增时显示未来三次与月均预测（不计入实际支出）；编辑生成新计划版本；暂停可设恢复日；取消可立即或本周期末；确认已付打开预填的记账抽屉（source=subscription），或 API 关联已有支出 |
| 31 日、闰年、DST、提前支付、重复确认 | `tests/unit/schedule.test.ts`、`tests/integration/subscriptions.test.ts`（6 个用例：月末与闰年、到期 / 逾期派生、提前支付、重复确认 409、计划版本切换、暂停恢复不补发）、`format.test.ts` DST 缺口顺延 |

新建订阅不回补锚点之前的历史账单（D22）；逾期只由真实经过的日期产生，因此 E2E 覆盖“今天到期”，逾期由注入时钟的集成测试覆盖。

## 验收标准对照

| 验收标准 | 结论 | 证据 |
| --- | --- | --- |
| 到期不自动成为已支付，已付记录唯一 | 通过 | `flows.spec.ts`「subscriptions: due is not paid until confirmed…」：两个今天到期的订阅余额不变；确认已付后余额 −20、列表出现“支付记录”、按钮消失；同一账单再次支付 409；`subscriptions.test.ts` 重复确认 / 并发 |
| 周期编辑取消未来旧版本任务且保留历史 | 通过 | 同一用例：改金额后计划版本 v2，已付的 v1 账单保留、未付 v1 账单变为 cancelled、v2 生成新账单；随后暂停、取消状态正确；`subscriptions.test.ts` 版本切换 |

## 留给人工审查

- 订阅提醒（M5）接入后再走一次完整“提醒 → 确认已付”流程。
- “不回补历史账单”的产品取舍（D22）。
