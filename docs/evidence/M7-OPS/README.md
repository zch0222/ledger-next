# M7-OPS · 部署、备份恢复与运行手册 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估）。运行手册：[RUNBOOK.md](../../RUNBOOK.md)。

## 恢复演练（`pnpm test:ops`）

隔离的 Compose 项目（`ledger-ops-{pid}`，随机凭据），生产镜像 + 本地 mock；步骤见 [ops-drill.mjs](../../../scripts/ops-drill.mjs) 与 [drill.ts](../../../tests/ops/drill.ts)。2026-10-02 运行结果（`test-results/ops/drill.json`）：

| 步骤 | 结果 |
| --- | --- |
| 种子数据 | 2 个账户，8 笔交易（支出、转账含手续费、退款、更正、作废），11 条 posting，13 条审计；已验证的 Telegram 渠道（凭据信封加密）；只读令牌 |
| 全量备份 | `mysqldump --single-transaction --source-data=2`：0.4 s，111,591 字节，记录 binlog 位置 `binlog.000002:140080`，SHA-256 已记录 |
| 流复制备库 | 从一致性导出初始化，`CHANGE REPLICATION SOURCE`（主机、凭据与位置同一语句）；追平用时 0.3 s，应用线程 ON |
| worker 不依赖 web | 停掉 web 后到期的提醒由 worker 独立发出：Telegram（mock）已受理、站内通知已送达，56.1 s 内完成 |
| 备份之后的写入 | 再记 3 笔（余额 5554.40 → 5488.60） |
| 灾难 | 删除主库容器与数据卷 |
| 恢复 A：从全量备份 | **RTO 25.1 s**（空库启动 → 导入 → 清空 Redis → web / worker 就绪）；与备份时快照逐项一致：余额、交易 8、posting 11、审计 13，余额 = 期初 + posting；令牌可用；用另存的主密钥解密渠道凭据并成功发出测试消息。**丢失备份之后的 3 笔（81.4 s 窗口）**——仅有全量备份时 RPO = 距上次备份的时间 |
| 恢复 B：从备库 | **RTO 25.8 s**；与最新快照逐项一致（交易 11、审计 17、余额 5488.60），**丢失 0 笔**；渠道测试消息成功 |

规模说明：演练库很小，导入时间主要是容器启动。10 万笔规模（919 MB 库、124,121 笔交易）由 `pnpm test:perf` 实测：全量导出 3.8 s（282 MB SQL），导入到空库 33.0 s，导入后交易数一致——据此估计该规模的恢复 RTO 约为 1 分钟加容器启动时间。RTO 未计入发现故障与人工决策时间。

## 演练中发现并修正

- 恢复后必须清空 Redis：报表缓存键包含账本数据版本，恢复后版本号可能与旧时间线上的缓存键重合（D35，写入 RUNBOOK 第 5 节）。
- 设置备库时只改 `SOURCE_HOST` 会重置复制位置，导致备库从头重放而冲突；必须与 `SOURCE_LOG_FILE / POS` 写在同一条语句。
- 未验证的渠道不会接收提醒（设计如此），演练种子先发送测试消息完成验证。
- 官方 MySQL 镜像不含 `mysqlbinlog`，本轮不宣称基于 binlog 的时间点恢复（D35）。

## 其他验收项

| 项 | 结论 | 证据 |
| --- | --- | --- |
| 健康检查 | `/api/health/live`（进程）与 `/api/health/ready`（数据库 + 迁移版本，Redis 只报告）；compose 探测 ready | `migrate-files.test.ts`（期望迁移 = 最新文件）；Docker 栈健康检查 |
| 升级、兼容迁移与回滚 | 每次 `pnpm test:e2e`：最新迁移空表回滚 → 重放 → 有数据拒绝回滚；重启 MySQL / Redis / web / worker 后数据保留；web 143 / worker 0 优雅停机 | Docker 记录 |
| worker 独立于 web | 通过 | 上表 |
| 恢复后余额与审计对账一致，RPO / RTO 有测量 | 通过（测试规模） | 上表 |
| TG 与国内消息通道可达 | 未实测（mock） | 需要生产主机与真实渠道，列入最终人工审查 |
| 生产环境、HTTPS、域名、监控 | 未实施 | RUNBOOK 给出步骤；需要真实基础设施，列入最终人工审查 |

## 留给人工审查

- 选定生产主机 / 区域 / 域名，按 RUNBOOK 部署 HTTPS 反向代理并核对 `X-Forwarded-For`、HSTS。
- 在生产主机上实测 Telegram 与国内渠道（飞书、企业微信、pushplus、SMTP）可达。
- 配置每日备份与异地保存、密钥分离保管，按季度做一次真实恢复演练；如需 RPO ≤15 分钟，部署第二台主机上的备库。
