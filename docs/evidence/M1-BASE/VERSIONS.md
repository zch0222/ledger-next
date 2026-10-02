# M1-BASE · 版本清单

记录日期：2026-10-02（Asia/Hong_Kong）。来源：`package.json`（`save-exact`）、`pnpm-lock.yaml`（lockfile v9）、`Dockerfile` 与 `compose.yaml` 中的镜像摘要，以及在本机 Docker 中实际运行镜像得到的运行时版本。升级任一项都要更新本表并重跑 `pnpm test:e2e`。

## 运行时与镜像

| 组件 | 锁定方式 | 实测版本 |
| --- | --- | --- |
| Node.js（构建 / web / worker / migrate） | `node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6` | v24.21.0（LTS 系列） |
| Playwright 测试镜像 | `mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27` | Node v24.20.0，Ubuntu 24.04.4 LTS |
| MySQL | `mysql:8.4@sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242` | 8.4.11（LTS） |
| Redis | `redis:8-alpine@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0` | 8.10.2 |
| pnpm | `packageManager` + 镜像内 `npm install --global pnpm@11.19.0` | 11.19.0 |
| Docker Compose（本机） | 要求 ≥2.24.4（`!override`） | v5.5.1，Engine 29.7.2 |

镜像摘要为多平台 index 摘要。`package.json` 的 `engines` 要求 Node `>=24 <25`；CI 使用 `actions/setup-node` 的 Node 24。

## 应用依赖（精确版本）

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| next | 16.3.8 | App Router、Route Handlers、standalone 输出 |
| react / react-dom | 19.3.0 | UI |
| better-auth / @better-auth/drizzle-adapter | 1.7.7 | 数据库 Session、邮箱密码、认证限流 |
| drizzle-orm | 0.45.3 | MySQL 映射与事务 |
| mysql2 | 3.24.5 | MySQL 驱动（`decimalNumbers: false`，UTC） |
| zod | 4.3.6 | 输入契约校验 |
| ioredis | 5.8.2 | Worker Redis 连接 |
| decimal.js | 10.6.0 | 金额运算（M2 起使用） |

## 开发与测试依赖

| 依赖 | 版本 |
| --- | --- |
| typescript | 5.9.3 |
| eslint / eslint-config-next | 9.39.4 / 16.3.8 |
| vitest / @vitest/coverage-v8 | 5.0.3 |
| @playwright/test | 1.63.0 |
| tsx | 4.23.15 |
| esbuild | 0.28.2 |

## 本机限制

开发机 nvm 当前只安装了 Node 22.23.2，因此本机 lint / typecheck / unit 以 Node 22 执行（pnpm 提示 engines 不匹配，但命令通过）；构建、迁移、Web、Worker 与全部端到端测试均在上述 Node 24 镜像中执行。Node 24 运行时以 Docker 结果为准。
