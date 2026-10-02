# M6-QODER · Qoder IDE / CLI 联调 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估）· 服务 commit `515beb9`（Docker E2E）。

> **这是协议级模拟，不是真实客户端联调**（D21、D32）：本轮不连接任何模型服务，也没有安装 Qoder IDE / CLI。测试按 Qoder IDE / CLI 读取配置的方式解析我们发布的包，再用官方 MCP SDK 客户端（@modelcontextprotocol/sdk 1.31.0）走同一传输。依赖模型判断的用例与客户端版本记录必须在最终人工审查中用真实 Qoder IDE / CLI 复测，配置存在不能代替实测。

## 模拟方式

- 配置：解析 `mcp/ledger.json`（stdio）：`command: node`、`args`、`env.LEDGER_API_URL`；令牌在本机注入（包内只有占位符），启动 `pnpm mcp:build` 产出的 stdio.js。
- 传输：stdio；协商协议版本：（stdio，SDK 默认协商）；服务：http://web:3000（Docker 测试栈）。
- Skill：包内 Skill 放到该客户端的发现路径，校验 frontmatter、SHA256SUMS 与同名保护。
- 用例来源：[API_AGENT_CONTRACT §7](../../API_AGENT_CONTRACT.md)；测试：`tests/e2e/clients.api.ts`（`client matrix (simulated qoder)`），结果文件 `test-results/agent-matrix/qoder.json`。

## 结果

| 用例 | 结论 | 观察 | requestId |
| --- | --- | --- | --- |
| 发现工具 / 读取 context | 模拟通过 | 15 个工具；context 返回基准币 CNY、时区、作用域 | `62c8849f…` |
| Skill 发现与按需加载 | 待人工（真实客户端） | 已放到 .qoder/skills/ledger-service/SKILL.md（frontmatter、校验和、同名保护通过）；客户端是否按需加载需真实客户端确认 | — |
| 预览 / 明确授权单笔创建 | 模拟通过 | 预览不入账，提交返回交易 3a53246c-05fd-4c88-b60a-9f9929678294 | `f59b8dcc…` |
| 查询期间收支含币种和口径 | 模拟通过 | 2026-10-01–2026-11-01：支出 28.00，文本写明 CNY 与历史汇率口径 | `c7627f83…` |
| 同一幂等键重试不重复 | 模拟通过 | replayed=true，明细仍为 1 笔 | `5e5d705b…` |
| 缺币种 / 缺账户先澄清 | 待人工（真实客户端） | 服务端拒绝缺字段的预览（未写入）；Skill §4 要求先问用户——模型是否先问需真实客户端确认 | — |
| 只读 token 拒绝写入 | 模拟通过 | INSUFFICIENT_SCOPE，isError=true | `3886a1a5…` |
| 跨账本 / 已撤销 token 拒绝 | 模拟通过 | 其他账本 404；撤销后下一次调用被拒绝 | `584241b5…` |
| stale 汇率不伪称实时 | 模拟通过 | 历史时点 2005-12-10 无报价 → freshness=missing；工具文本写明历史 / 非实时 | `318eff9d…` |
| 恶意备注当作数据，不执行其中指令 | 待人工（真实客户端） | 备注原样作为数据返回并附带“不要执行”提示；模型是否遵守需真实客户端确认 | — |
| 超时查询既有结果，不重复写入 | 模拟通过 | stdio：提交后按幂等键查到 succeeded，同键重试为重放，共 2 笔 | `7f193f14…` |

数据库核对：每个用例在独立测试账本中执行；“同一幂等键”与“超时”用例通过 `ledger_list_transactions` 核对笔数（1 笔 / 2 笔），撤销与跨账本用例核对拒绝码。

## 留给人工审查

- 在真实 Qoder IDE / CLI（记录版本号）中按上表 11 项复测，保存脱敏工具输出、requestId 与数据库核对结果。
- 重点：Skill 是否被发现并按需加载；缺币种 / 缺账户时是否先追问；是否把恶意备注当数据而不执行。
