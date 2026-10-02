# 业务工作流

下面的参数都是真实工具的输入格式；id 用 `ledger_get_context`、`ledger_list_accounts` 等返回的真实值替换。时间用 RFC 3339 UTC，`timezone` 用账本时区。

## 记一笔

> “记一笔 28 港币午餐，现金账户”

1. `ledger_get_context` → 账本时区 `Asia/Hong_Kong`，分类里有「餐饮」。
2. `ledger_list_accounts` → 找到名为「现金」的账户并看它的币种。
   - 现金账户是 HKD：`settlement` 就是 `{"amount": "28.00", "currency": "HKD"}`。
   - 现金账户是 CNY，或有多个“现金”账户：先问用户（实际扣了多少人民币？用哪个账户？），不要猜。
3. 预览：

```json
{"ledgerId": "<ledgerId>", "transaction": {"kind": "expense", "accountId": "<现金账户>", "categoryId": "<餐饮>",
 "settlement": {"amount": "28.00", "currency": "HKD"}, "merchant": "午餐",
 "occurredAt": "2026-10-02T04:30:00Z", "timezone": "Asia/Hong_Kong"}}
```

4. 用户原话已明确金额、币种、账户 → 直接提交：`ledger_create_transaction` `{"ledgerId", "previewId", "idempotencyKey": "<新 UUID>"}`。
5. 回复（数值仅为示例，以工具返回为准）：“已记入现金账户：午餐 28.00 HKD（折合 25.70 CNY，汇率 2 分钟内），交易 id …”。

缺字段时的问法：只说“午饭 30”→ 问币种和账户；只说“昨天打车”→ 问金额。

## 转账

源 / 目标账户和两边的实际金额都要有；跨币种时不要自己算点差，问用户到账多少。手续费单独填 `fee`。

```json
{"ledgerId": "<ledgerId>", "transaction": {"kind": "transfer", "sourceAccountId": "<招行 CNY>", "targetAccountId": "<汇丰 HKD>",
 "sourceAmount": {"amount": "1000.00", "currency": "CNY"}, "targetAmount": {"amount": "1086.50", "currency": "HKD"},
 "fee": {"amount": {"amount": "15.00", "currency": "CNY"}}, "occurredAt": "2026-10-02T02:00:00Z", "timezone": "Asia/Hong_Kong"}}
```

## 退款

先用 `ledger_list_transactions` 找到原支出（交易 id），再预览退款，提交时传 `refundOf`：

```json
{"ledgerId": "<ledgerId>", "transaction": {"kind": "refund", "originalTransactionId": "<原支出>", "accountId": "<到账账户>",
 "settlement": {"amount": "50.00", "currency": "CNY"}, "occurredAt": "2026-10-02T06:00:00Z", "timezone": "Asia/Hong_Kong"}}
```

`ledger_create_transaction` `{"ledgerId", "previewId", "idempotencyKey", "refundOf": "<原支出>"}`。累计退款不能超过原支付；退款冲减支出，不新建收入。

## 更正

用新的内容预览（同记一笔），再调用 `ledger_update_transaction`，`expectedVersion` 取原交易的 `version`。原记录作废并生成新版本，审计保留。已有退款的交易不能更正。

## 查询

> “上个月花了多少钱？按历史汇率”

今天 2026-10-02：`ledger_get_summary` `{"ledgerId", "dateFrom": "2026-09-01", "dateTo": "2026-10-01", "valuationMode": "historical"}`。回答写明“9 月支出 X CNY（历史汇率口径）”；`partial: true` 时补一句“有 N 笔因缺少汇率未计入”。

> “下周有哪些订阅到期？”

本周一 2026-09-28 时，下周是 `dueFrom: "2026-10-05"`、`dueTo: "2026-10-12"`：`ledger_list_subscriptions` 的 `bills` 列出到期账单（`status` 为 `scheduled` / `due`），不要说成已支付。

> “美元兑人民币现在多少？”

`ledger_get_exchange_rates` `{"base": "USD", "quotes": ["CNY"]}`。`freshness` 不是 `fresh` 时说“这是 X 时的报价，不是实时汇率”。

## 新增订阅并提醒

> “新增一个每月 20 美元的订阅并提前一天提醒”

1. 名称、扣款日、账户不明确就问（例如“哪个服务？每月几号扣？从哪个账户付？”）。
2. `ledger_preview_subscription`：

```json
{"ledgerId": "<ledgerId>", "name": "视频会员", "amount": {"amount": "20.00", "currency": "USD"}, "accountId": "<信用卡>",
 "cycle": {"unit": "month", "count": 1}, "anchorDate": "2026-10-15", "timezone": "Asia/Hong_Kong"}
```

3. 把接下来三次日期告诉用户，确认后 `ledger_create_subscription`。
4. `ledger_list_reminders` 取可用渠道（`channels`）。用户指定了渠道（例如“发到 Telegram”）就用那个；个人微信与企业微信是不同渠道，不能互相替代。
5. `ledger_preview_reminder`：

```json
{"ledgerId": "<ledgerId>", "eventType": "bill_due", "subscriptionId": "<新订阅>", "leadDays": [1], "localTime": "09:00",
 "timezone": "Asia/Hong_Kong", "channelIds": ["<渠道>"]}
```

6. 确认后 `ledger_create_reminder`。

## 超时与重试

```
ledger_create_transaction(previewId=P, idempotencyKey=K)  → 失败：TIMEOUT
ledger_get_operation(operationId=K)                     → succeeded：已入账，告诉用户结果，不再提交
                                                        → not_found：没有写入，用同一个 K 重试
```

绝不为同一笔换新的键重试。

## 需要审批

单笔金额达到门槛、作废等操作会返回 `APPROVAL_REQUIRED` 和审批链接。把链接交给用户：“这笔需要你在网页上批准：<链接>”。用户确认已批准后，用同一个 `idempotencyKey` 和返回的 `approvalId` 再提交一次。
