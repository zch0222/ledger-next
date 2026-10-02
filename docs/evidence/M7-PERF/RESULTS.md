# M7-PERF 实测结果

由 `node scripts/perf-report.mjs` 从 `pnpm test:perf` 的输出生成；方法与口径见 [README](README.md)。

运行时间：2026-10-02T15:23:04.923Z → 2026-10-02T15:38:54.713Z

## 环境

- 主机：4 vCPU，内存 15.7 GiB，Docker 29.6.2，内核 6.18.44-fc-v51；MySQL 8.4.11。压测进程、浏览器与全部服务在同一主机（load generator, browser and services share the same host）。
- 数据：1000 个用户（各一个账本、5 笔），一个 100000 笔的大账本（经 CSV 导入，1101 s）；压测后数据库 919.1 MB、交易 124121 笔。
- 负载：用户模型 100 并发用户、每次操作后思考 2000 ms 左右，运行 303 s，17880 次请求（59 次/秒）；压力场景 100 个请求始终在途、无思考时间，运行 601 s，96648 次请求（161 次/秒），读占 67%；冷 / 热各 20 次；异常 0 次。

## 与目标对比（TECHNICAL_DESIGN §7.3）

| 指标 | 实测 | 目标 | 结论 |
| --- | --- | --- | --- |
| 已登录总览 TTFB（热，10 万笔账本） | p95 36 ms | p95 ≤500 ms | 达标 |
| 已登录总览 TTFB（冷，10 万笔账本） | p95 56 ms | p95 ≤1,000 ms | 达标 |
| 已登录总览 TTFB（热，普通账本） | p95 38 ms | p95 ≤500 ms | 达标 |
| 已登录总览 TTFB（冷，普通账本） | p95 42 ms | p95 ≤1,000 ms | 达标 |
| 总览完整 HTML（热，10 万笔账本；参考） | p95 48 ms | （TTFB 目标 ≤500 ms） | 达标 |
| 总览完整 HTML（冷，10 万笔账本；参考） | p95 65 ms | （TTFB 目标 ≤1,000 ms） | 达标 |
| 总览 TTFB（用户模型：100 并发用户、思考约 2 s） | p95 68 ms | p95 ≤500 ms（热） | 达标 |
| 总览完整 HTML（用户模型：100 并发用户、思考约 2 s；参考） | p95 87 ms | （TTFB 目标 ≤500 ms） | 达标 |
| REST 查询 明细查询（用户模型：100 并发用户、思考约 2 s） | p95 39 ms | p95 ≤300 ms | 达标 |
| REST 查询 当月汇总（用户模型：100 并发用户、思考约 2 s） | p95 37 ms | p95 ≤300 ms | 达标 |
| REST 查询 账户列表（用户模型：100 并发用户、思考约 2 s） | p95 31 ms | p95 ≤300 ms | 达标 |
| REST 写入 交易预览（用户模型：100 并发用户、思考约 2 s） | p95 41 ms | p95 ≤500 ms | 达标 |
| REST 写入 提交入账（用户模型：100 并发用户、思考约 2 s） | p95 76 ms | p95 ≤500 ms | 达标 |
| 总览 TTFB（压力：100 个请求始终在途、无思考时间） | p95 1420 ms | p95 ≤500 ms（热） | **未达标** |
| 总览完整 HTML（压力：100 个请求始终在途、无思考时间；参考） | p95 2138 ms | （TTFB 目标 ≤500 ms） | **未达标** |
| REST 查询 明细查询（压力：100 个请求始终在途、无思考时间） | p95 667 ms | p95 ≤300 ms | **未达标** |
| REST 查询 当月汇总（压力：100 个请求始终在途、无思考时间） | p95 583 ms | p95 ≤300 ms | **未达标** |
| REST 查询 账户列表（压力：100 个请求始终在途、无思考时间） | p95 482 ms | p95 ≤300 ms | **未达标** |
| REST 写入 交易预览（压力：100 个请求始终在途、无思考时间） | p95 545 ms | p95 ≤500 ms | **未达标** |
| REST 写入 提交入账（压力：100 个请求始终在途、无思考时间） | p95 1059 ms | p95 ≤500 ms | **未达标** |
| 12 月聚合 summary（热） | p95 28 ms | p95 ≤500 ms | 达标 |
| 12 月聚合 summary（冷） | p95 950 ms | p95 ≤1,500 ms | 达标 |
| 12 月聚合 cashFlow（热） | p95 31 ms | p95 ≤500 ms | 达标 |
| 12 月聚合 cashFlow（冷） | p95 886 ms | p95 ≤1,500 ms | 达标 |
| 12 月聚合 categories（热） | p95 14 ms | p95 ≤500 ms | 达标 |
| 12 月聚合 categories（冷） | p95 989 ms | p95 ≤1,500 ms | 达标 |
| LCP dashboard（移动 4G 实验室） | p75 616 ms | p75 ≤2,500 ms | 达标 |
| INP dashboard（移动 4G 实验室） | p75 32 ms | p75 ≤200 ms | 达标 |
| CLS dashboard | p75 0 | p75 ≤0.1 | 达标 |
| 首屏 JS dashboard（传输字节，含框架） | 160.5 KB | 自有 JS gzip ≤180 KB | 达标 |
| LCP transactions（移动 4G 实验室） | p75 1004 ms | p75 ≤2,500 ms | 达标 |
| INP transactions（移动 4G 实验室） | p75 0 ms | p75 ≤200 ms | 达标 |
| CLS transactions | p75 0 | p75 ≤0.1 | 达标 |
| 首屏 JS transactions（传输字节，含框架） | 159.6 KB | 自有 JS gzip ≤180 KB | 达标 |
| 提醒调度延迟（负载中） | p95 4 s（100/100 条） | p95 ≤60 s | 达标 |
| 汇率源时间年龄（mock 源） | p95 111.9 s | p95 ≤120 s | 达标 |

## 混合负载明细

| 场景 | 操作 | 请求 | 错误 | 错误率 | p50 | p95 | p99 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 用户模型 | api.accounts | 1519 | 0 | 0% | 12 ms | 31 ms | 56 ms |
| 用户模型 | api.create | 3087 | 0 | 0% | 34 ms | 76 ms | 118 ms |
| 用户模型 | api.preview | 3087 | 0 | 0% | 18 ms | 41 ms | 73 ms |
| 用户模型 | api.summary | 2141 | 0 | 0% | 15 ms | 37 ms | 72 ms |
| 用户模型 | api.transactions | 2881 | 0 | 0% | 18 ms | 39 ms | 70 ms |
| 用户模型 | page.dashboard | 3643 | 0 | 0% | 30 ms | 68 ms | 109 ms |
| 用户模型 | page.transactions | 1522 | 0 | 0% | 23 ms | 56 ms | 92 ms |
| 压力 | api.accounts | 8170 | 0 | 0% | 224 ms | 482 ms | 718 ms |
| 压力 | api.create | 16034 | 0 | 0% | 717 ms | 1059 ms | 1249 ms |
| 压力 | api.preview | 16034 | 0 | 0% | 314 ms | 545 ms | 707 ms |
| 压力 | api.summary | 12012 | 0 | 0% | 274 ms | 583 ms | 891 ms |
| 压力 | api.transactions | 16078 | 0 | 0% | 305 ms | 667 ms | 1036 ms |
| 压力 | page.dashboard | 20183 | 0 | 0% | 639 ms | 1420 ms | 1688 ms |
| 压力 | page.transactions | 8137 | 0 | 0% | 628 ms | 1393 ms | 1676 ms |

## 冷 / 热明细

```json
{
 "aggregation12m": {
  "cold": {
   "summary": {
    "n": 20,
    "p50": 610,
    "p75": 644.7,
    "p95": 950,
    "p99": 1146.5,
    "max": 1146.5,
    "mean": 661.7
   },
   "cashFlow": {
    "n": 20,
    "p50": 611.7,
    "p75": 710.1,
    "p95": 885.5,
    "p99": 1014.5,
    "max": 1014.5,
    "mean": 656.2
   },
   "categories": {
    "n": 20,
    "p50": 609.2,
    "p75": 667.4,
    "p95": 988.8,
    "p99": 1127.2,
    "max": 1127.2,
    "mean": 683.3
   }
  },
  "hot": {
   "summary": {
    "n": 20,
    "p50": 13.6,
    "p75": 17,
    "p95": 28,
    "p99": 34,
    "max": 34,
    "mean": 16.6
   },
   "cashFlow": {
    "n": 20,
    "p50": 13.6,
    "p75": 17.1,
    "p95": 30.5,
    "p99": 40,
    "max": 40,
    "mean": 16.3
   },
   "categories": {
    "n": 20,
    "p50": 11.8,
    "p75": 12.7,
    "p95": 13.9,
    "p99": 15.4,
    "max": 15.4,
    "mean": 12
   }
  }
 },
 "dashboardTtfb": {
  "bigCold": {
   "n": 20,
   "p50": 31.9,
   "p75": 40.8,
   "p95": 55.7,
   "p99": 408,
   "max": 408,
   "mean": 51.6
  },
  "bigColdFull": {
   "n": 20,
   "p50": 41.2,
   "p75": 54,
   "p95": 64.7,
   "p99": 430.5,
   "max": 430.5,
   "mean": 63.8
  },
  "bigHot": {
   "n": 20,
   "p50": 26.3,
   "p75": 29.7,
   "p95": 36.2,
   "p99": 85,
   "max": 85,
   "mean": 29.4
  },
  "bigHotFull": {
   "n": 20,
   "p50": 32.1,
   "p75": 35.7,
   "p95": 48.4,
   "p99": 96.7,
   "max": 96.7,
   "mean": 35.6
  },
  "smallCold": {
   "n": 20,
   "p50": 30.5,
   "p75": 33.6,
   "p95": 42.1,
   "p99": 57.1,
   "max": 57.1,
   "mean": 31.8
  },
  "smallColdFull": {
   "n": 20,
   "p50": 33,
   "p75": 46.1,
   "p95": 49.2,
   "p99": 63.1,
   "max": 63.1,
   "mean": 37.6
  },
  "smallHot": {
   "n": 20,
   "p50": 28.9,
   "p75": 34.4,
   "p95": 37.7,
   "p99": 51,
   "max": 51,
   "mean": 30.1
  },
  "smallHotFull": {
   "n": 20,
   "p50": 34.8,
   "p75": 39,
   "p95": 44,
   "p99": 55.4,
   "max": 55.4,
   "mean": 35.1
  }
 }
}
```

## 图表生命周期与减少动画

- 总览 ↔ 分析 20 次客户端切换：每页 ECharts 实例数 2–2（不累积）；GC 后 JS 堆 6.2 → 8.2 → 8.7 → 8.9 → 9 MB。
- 打开“减少动态效果”后图表动画属性：false。
- 懒加载 JS（load 之后，含 ECharts chunk）：dashboard 195.6 KB；transactions 0.0 KB。

## 备份 / 恢复（本数据规模）

全量导出 3.8 s（281.7 MB），导入到空库 33.0 s，导入后交易 124121 笔。

## 最耗时的 SQL（performance_schema，按总耗时）

| 语句 | 次数 | 平均 ms | 最大 ms | 总 s | 平均扫描行 |
| --- | --- | --- | --- | --- | --- |
| `COMMIT` | 41199 | 2.47 | 288.6 | 101.8 | 0 |
| `SELECT 'transactions' . 'id' , 'transactions' . 'kind' , 'transactions' . 'local_date' , 'transactions' . 'category_id' , 'transactions' . 'account_id' , 'trans` | 49207 | 1.85 | 897 | 91 | 273 |
| `SELECT 'role' FROM 'memberships' WHERE ( 'memberships' . 'ledger_id' = ? AND 'memberships' . 'user_id' = ? )` | 325660 | 0.19 | 53.1 | 62.3 | 1 |
| `SELECT 'id' , 'ledger_id' , 'kind' , 'status' , 'occurred_at' , 'local_date' , 'timezone' , 'account_id' , 'category_id' , 'merchant' , 'note' , 'refund_of' , '` | 71645 | 0.84 | 264 | 60.1 | 8 |
| `SELECT 'base_currency' , 'timezone' FROM 'ledgers' WHERE 'ledgers' . 'id' = ?` | 344888 | 0.17 | 82.6 | 58.7 | 1 |
| `INSERT INTO 'outbox_events' ( 'id' , 'ledger_id' , 'type' , 'payload' , 'available_at' , 'dispatch_status' , 'attempts' , 'last_error' , 'created_at' , 'dispatc` | 19121 | 2.77 | 383.1 | 52.9 | 0 |
| `SELECT 'transactions' . 'id' , 'transactions' . 'local_date' , 'transaction_amounts' . 'base_amount' FROM 'transactions' INNER JOIN 'transaction_amounts' ON ( '` | 52523 | 0.9 | 187.5 | 47.5 | 21 |
| `SELECT 'id' , 'ledger_id' , 'name' , 'type' , 'currency' , 'opening_balance' , 'balance' , 'note' , 'archived_at' , 'version' , 'created_at' , 'updated_at' FROM` | 19121 | 1.99 | 746.4 | 38 | 1 |
| `SELECT 'ledger_id' , 'transaction_id' , 'original_amount' , 'original_currency' , 'settlement_amount' , 'settlement_currency' , 'base_amount' , 'base_currency' ` | 71644 | 0.42 | 40.2 | 29.9 | 8 |
| `INSERT INTO 'account_postings' ( 'id' , 'ledger_id' , 'transaction_id' , 'account_id' , 'currency' , 'signed_amount' , 'reverses_id' , 'created_at' ) VALUES (..` | 19121 | 1.55 | 160.7 | 29.6 | 0 |
| `INSERT INTO 'write_previews' ( 'id' , 'ledger_id' , 'actor_id' , 'kind' , 'body_hash' , 'normalized_input' , 'computed' , 'account_versions' , 'expires_at' , 'c` | 19121 | 1.47 | 281.4 | 28.2 | 0 |
| `SELECT 'id' , 'expires_at' , 'token' , 'created_at' , 'updated_at' , 'ip_address' , 'user_agent' , 'user_id' FROM 'sessions' WHERE 'sessions' . 'token' = ?` | 115112 | 0.22 | 30.8 | 25.4 | 1 |
| `INSERT INTO 'transaction_amounts' ( 'ledger_id' , 'transaction_id' , 'original_amount' , 'original_currency' , 'settlement_amount' , 'settlement_currency' , 'ba` | 19120 | 1.21 | 120.1 | 23.1 | 0 |
| `SELECT 'id' , 'name' , 'email' , 'email_verified' , 'image' , 'created_at' , 'updated_at' FROM 'users' WHERE 'users' . 'id' = ?` | 115114 | 0.2 | 74.5 | 22.9 | 1 |
| `SELECT 'ledger_id' , 'transaction_id' , 'tag_id' FROM 'transaction_tags' WHERE ( 'transaction_tags' . 'ledger_id' = ? AND 'transaction_tags' . 'transaction_id' ` | 71644 | 0.28 | 68.8 | 20.3 | 0 |
