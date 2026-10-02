# M1-BASE · 工程骨架与版本锁定 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 环境：Windows 11 + Docker Desktop（Engine 29.7.2、Compose v5.5.1，Linux 容器）· 执行：Claude Code（实现者自检，非独立评审）· 代码尚未提交，工作区状态即被验证版本。

## 验收标准对照

| 验收标准 | 结果 | 证据 |
| --- | --- | --- |
| 干净克隆后可启动 Web 与 worker | 本机通过 | 见“干净检出启动” |
| CI lint、typecheck、build 通过且有版本清单 | 本机等价命令通过；**远程 CI 尚未运行**（代码未推送） | 见“质量命令”，[版本清单](VERSIONS.md)，[CI 工作流](../../../.github/workflows/ci.yml) |

## 干净检出启动

为模拟克隆，用 `git ls-files --cached --others --exclude-standard` 导出 Git 会纳入的文件到临时目录（不含 node_modules、.env、构建产物），然后：

```powershell
node scripts/setup-env.mjs          # 随机本地密钥；WEB_PORT/APP_URL 改为 3300 以免占用开发端口
docker compose -p ledger-clean up -d --build --wait
```

结果：`UP EXIT 0`；mysql / redis / web / worker 均为 `running healthy`；`GET /api/health` → `200 {"status":"ok","database":"mysql"}`；`GET /login` → 200；`POST /api/auth/sign-up/email` → 200；migrate 日志 `Applied 0001_identity.sql`、worker 日志 `Ledger worker ready`。随后 `docker compose -p ledger-clean down --volumes` 只删除该临时项目。

## 质量命令（本机 Node 22.23.2，见版本清单的限制说明）

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | 通过，0 问题 |
| `pnpm typecheck` | 通过 |
| `pnpm test:unit` | M1-BASE 复验时 3 文件 34 测试通过；M1-API 完成后 7 文件 77 测试通过（覆盖范围与比例见 M1-API 记录） |
| `node scripts/progress.mjs validate` | 通过 |
| `pnpm build` | 在 Docker builder（Node 24.21.0）中通过，见 E2E 构建日志 |

## Docker 端到端（`pnpm test:e2e`）

上一轮遗留结果为 7 项失败。原因与修复：

1. **认证限流导致 429**：Better Auth 默认对 sign-in / sign-up 每客户端 10 秒 3 次；所有测试请求来自同一个测试容器，因此后续测试被限流。保留生产限流不放宽；测试改为每个模拟用户使用独立客户端地址（`X-Forwarded-For`，即生产中反向代理提供的客户端地址），并新增“同一客户端第 4 次失败登录返回 429 + X-Retry-After，其他客户端不受影响”的测试。
2. **前端把 429 显示为“验证失败”**：`client.ts` 对 429 显示“尝试次数过多，请稍后再试”。
3. **主题色单选的可访问名称包含装饰性“✓”**：选中色块的 CSS `::after` 字符进入读屏名称（“✓ 紫罗兰”）。色块加 `aria-hidden`，视觉不变。
4. **测试选择器问题**：`getByRole('alert')` 同时命中 Next 路由播报区；改为按文本过滤。隐藏单选按钮改为像用户一样点击可见标签并断言选中。

修复后完整运行：`11 passed`（api 5、desktop 3、mobile 3）；加入 M1-API 契约测试后的最终运行为 `16 passed`（见 [M1-API 运行记录](../M1-API/README.md#运行记录)）；迁移重放、持久化种子、重启 mysql/redis/web/worker 后 `PASS: user, authentication and ledger persisted through Docker restart`；测试项目与卷已清理。

同时完成：

- MySQL / Redis 镜像按多平台摘要锁定（此前为浮动标签）。
- 测试容器直接运行 Playwright，不再经 `pnpm run` 在运行时从 registry 重装依赖。
- worker / migrate 容器直接由 Node 启动（`node --import tsx`），不再经 pnpm 包装；E2E 末尾检查 SIGTERM 停机：worker 退出码 0；Next 在排空连接后按设计返回 143，均视为正常，137（超时被强杀）判失败。

## 未覆盖 / 待办

- 远程 GitHub Actions 结果：需推送后由 CI 产生；推送需用户确认。
- 本机未安装 Node 24；本机质量命令在 Node 22 上执行。
- 生产部署须在反向代理上覆盖设置 `X-Forwarded-For` 为真实客户端地址，否则认证限流按单一共享桶计算；Compose 默认只把 Web 端口绑定到 127.0.0.1。正式加固属于 M7-SEC / M7-OPS。
