# 运行手册

适用于 Docker Compose 自托管部署（D08、D15、D18）。命令以项目根目录为工作目录；`<p>` 表示 compose 项目名。演练结果见 [M7-OPS 证据](evidence/M7-OPS/README.md)。

## 1. 组成与依赖

| 服务 | 作用 | 无它时 |
| --- | --- | --- |
| web | Next.js SSR + REST `/api/v1` + MCP `/mcp` | 页面与 API 不可用；worker 继续发送已排程提醒 |
| worker | 汇率拉取、提醒调度与投递、导入导出、预算 / 汇率告警 | 页面与记账照常；提醒、导入、导出排队，恢复后补做或按有效期过期 |
| mysql | 唯一事实来源（账务、审计、投递日志即任务存储） | 全部不可用 |
| redis | 报表缓存、汇率最新批次缓存、BullMQ 分发、限流计数 | 页面直读 MySQL；限流放行（资金仍受幂等与审批保护）；worker 从 MySQL 任务存储恢复分发 |
| migrate | 一次性迁移（`GET_LOCK` 串行） | — |

生产不包含 `compose.mock.yaml`、`compose.test.yaml`、`compose.perf.yaml`、`compose.ops.yaml`。

## 2. 首次部署

1. 主机：Linux，4 vCPU / 8 GB 起；Docker Engine + Compose v2；时间同步（chrony）。
2. `sh scripts/setup-env.sh --app-url https://ledger.example` 生成 `.env`：密钥随机生成且不输出，权限 600，已存在时拒绝覆盖。主机没有 sh 时用 `docker compose -f compose.tools.yaml run --rm setup-env --app-url https://ledger.example`，文件属主为仓库目录属主。再按 [README「环境变量」](../README.md#环境变量) 配置汇率供应商（D09）、SMTP、Webhook 白名单、Agent 审批门槛、限流与 `WEB_CONCURRENCY`。`LEDGER_ENCRYPTION_KEYS` **与数据库分开备份**，丢失则渠道凭据不可恢复（只能让用户重新填写）。

3. 反向代理（Caddy / Nginx）终止 HTTPS，转发到 `127.0.0.1:${WEB_PORT}`：
   - 必须设置 `X-Forwarded-For`（限流按第一个地址计数）并保留 `Host`；
   - 加 `Strict-Transport-Security: max-age=31536000`；
   - `/mcp` 不需要 WebSocket / SSE（无状态 JSON 响应），请求体上限 64 KB；导入上传上限 5 MB。
4. `docker compose up -d --build --wait`。`migrate` 先执行，web / worker 等它成功后启动。
5. 检查：`curl -fsS https://ledger.example/api/health/ready`（数据库、迁移版本；Redis 只报告不阻断）；`/api/health/live` 只表示进程存活。
6. 首个用户注册后在「账本设置」检查时区与基准币；在「提醒渠道」逐个发送测试消息并确认真实收到。

## 3. 监控与告警

| 信号 | 来源 | 告警阈值（建议） |
| --- | --- | --- |
| web 就绪 | `/api/health/ready` | 连续 3 次失败 |
| worker 心跳 | 容器健康检查（`/tmp/ledger-worker-health` 30 s 内更新） | unhealthy |
| 汇率新鲜度 | `GET /api/v1/exchange-rates` 的 freshness / sourceAt | stale 超过 15 分钟 |
| 提醒投递 | `GET /api/v1/ledgers/{id}/notification-stats`（失败率、调度延迟） | 7 日失败率 > 5 % 或延迟 p95 > 60 s |
| 队列积压 | `notification_deliveries` 中 `status='queued' AND next_attempt_at < now - 5 min` 的数量 | > 0 持续 10 分钟 |
| 备份 | 备份任务退出码与文件大小 | 失败或大小骤降 50 % |
| 日志 | web / worker 输出 JSON 行（requestId / 任务 id / 状态码），不含金额、备注、凭据 | `SERVICE_UNAVAILABLE` 突增 |

## 4. 备份

### 4.1 每日全量（必须）

```sh
docker compose exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql \
  mysqldump -uroot --single-transaction --routines --triggers --events --set-gtid-purged=OFF --source-data=2 \
  --databases "$MYSQL_DATABASE" | gzip > "backup/ledger-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
sha256sum backup/ledger-*.sql.gz > backup/SHA256SUMS
```

- `--single-transaction` 不锁业务表；输出头部记录 binlog 位置（`--source-data=2`）。
- 备份文件与 `LEDGER_ENCRYPTION_KEYS`、`BETTER_AUTH_SECRET` **分别**存放在不同位置（例如对象存储 + 密码管理器），保留 30 天。
- 仅有每日全量时，RPO 按 ≤24 小时对外说明（TECHNICAL_DESIGN §8），不得宣称 15 分钟。

### 4.2 热备 / 低 RPO（具备第二台主机时）

MySQL 复制到另一台主机上的备库（`--server-id=2 --read-only=ON`），用带 `--source-data=1` 的一致性导出初始化，再 `CHANGE REPLICATION SOURCE TO SOURCE_HOST=…, SOURCE_USER='repl', … ; START REPLICA;`。监控 `performance_schema.replication_applier_status` 与延迟。备库不是备份：误删除会同步过去，每日全量仍然要做。官方镜像不含 `mysqlbinlog`，如需基于 binlog 的时间点恢复，备份主机需另装 MySQL 客户端工具。

## 5. 恢复

1. 停止写入：`docker compose stop web worker`。
2. 新建空库：移走旧卷（保留以便取证），`docker compose up -d --wait mysql`（用 `.env` 中同样的库名 / 用户初始化）。
3. 导入：`gunzip -c backup/ledger-<时间>.sql.gz | docker compose exec -T -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql mysql -uroot`；或从备库导出：`STOP REPLICA;` 后对备库执行 4.1 的命令并导入。
4. **清空 Redis**：`docker compose exec redis redis-cli FLUSHALL`。报表缓存键包含账本数据版本号，恢复后的版本号可能与旧时间线上的缓存键重合，必须清空；投递任务以 MySQL 为准，worker 会重新分发。
5. 恢复密钥：`.env` 中的 `LEDGER_ENCRYPTION_KEYS`、`BETTER_AUTH_SECRET` 必须与备份时一致。
6. `docker compose up -d --wait web worker`；检查 `/api/health/ready`。
7. 对账：任选账本，账户余额 = 期初 + postings 合计；交易数、审计条数与备份时记录一致；任一渠道测试消息成功（证明主密钥正确）。
8. 告知用户恢复点之后的记账需要补录（导入 CSV 可去重）。

## 6. 升级、迁移与回滚

1. 升级前：执行 4.1 全量备份并校验。
2. `git pull` 后 `docker compose build`，`docker compose up -d --wait`：migrate 先应用新迁移（expand：只新增，旧代码仍可运行），再滚动 web / worker。
3. 应用回滚：切回上一个镜像标签即可（迁移是向后兼容的）。
4. 数据库回滚只在新迁移的表仍为空时允许：`docker compose run --rm -e LEDGER_ROLLBACK_CONFIRM=<迁移文件名> migrate node --import tsx packages/db/src/rollback.ts <迁移文件名>`（本机有 pnpm 时等价于 `LEDGER_ROLLBACK_CONFIRM=<迁移文件名> pnpm db:rollback <迁移文件名>`）；表内已有数据时脚本拒绝执行，此时按第 5 节从备份恢复。
5. 每个版本都在 `pnpm test:e2e` 中演练“最新迁移空表回滚 → 重放 → 有数据时拒绝回滚”。

## 7. 常见事件

| 事件 | 现象 | 处理 |
| --- | --- | --- |
| Redis 宕机 / 重启 | 页面变慢、限流放行；提醒暂停分发 | 恢复 Redis 即可；worker 从 MySQL 认领到期投递，在途请求标为“结果未知”，不自动重发 |
| worker 被杀 | 提醒、导入停止 | 重启 worker；`sending` 超过 `NOTIFY_STUCK_SECONDS` 的投递按有无尝试记录重排或标为未知 |
| 汇率源故障 | freshness 逐步变为 delayed / stale | 页面照常；外币记账要求用户选择接受过期汇率或填人工汇率；检查供应商额度与密钥 |
| 渠道凭据失效 | 渠道变“已停用”，站内通知用户 | 用户在「提醒渠道」更新凭据并重新测试 |
| 主密钥轮换 | — | 新密钥放到 `LEDGER_ENCRYPTION_KEYS` 第一位（旧的保留在后面），重启后执行 `docker compose run --rm migrate node --import tsx scripts/rewrap-channel-keys.ts`（= `pnpm channels:rewrap`）；确认后再移除旧密钥 |
| 令牌泄露 | — | 用户在「Agent 接入」撤销，下一次请求即失败；审计中可见签发与撤销 |
| 疑似暴力尝试 | 大量 401 / 429 | 限流按来源地址生效；在反向代理层封禁来源 |

## 8. 优雅停机

`docker compose stop`：web 收到 SIGTERM 后排空连接（退出码 143 属正常），worker 停止领取新任务并释放租约后以 0 退出。不要用 `kill -9`；若发生，见第 7 节 worker 被杀。
