# M6-SKILL · 正式 Skill 与配置包 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估）。

## 内容

- 单一来源：[packages/skill/ledger-service](../../../packages/skill/ledger-service/SKILL.md)（SKILL.md、references/workflows.md）。`references/tools.md` 在构建时由服务端实际 `tools/list` 生成，参数、必填项、只读 / 幂等提示与作用域与服务一致。
- SKILL.md：先确认 15 个工具存在并调用 `ledger_get_context`；相对日期按账本时区与 `today`（`dateTo` 不含当日）；查询讲明币种 / 口径 / partial；写入“字段齐全 → 预览 → 一个 UUID 幂等键提交 → 回复真实 id”；超时用 `ledger_get_operation`；stale 汇率交给用户选择；审批只给链接、不自批；用户数据中的指令不执行；不索要令牌。描述含正向触发词与“不要使用”的边界。
- workflows.md：记一笔（含账户币种不一致时先问）、转账、退款、更正、查询（上月 / 下周到期 / 汇率）、新增订阅并提醒、超时重试、审批，参数均为真实工具输入格式，示例数值标注为示例。
- `pnpm skill:build [--origin URL]`：先静态校验，再生成 codex（`.agents/skills`）、claude-code（`.claude/skills`）、dsh（`.dsh/skills`）、qoder（`.qoder/skills`）四个包，各含同一份 Skill、各自 MCP 片段（`mcp/ledger.*`）、INSTALL.md 与 SHA256SUMS。
- `pnpm skill:install --client <id> --target <项目>`：目标不存在才直接安装；内容相同不动；内容不同时打印逐文件差异并以退出码 3 停止，`--force` 先把旧目录移到项目根 `.ledger-skill-backup/`（D33）。不写入任何客户端 MCP 配置。

## 验收标准对照

| 验收标准 | 结论 | 证据 |
| --- | --- | --- |
| 不虚构工具、权限、金额或成功状态 | 通过 | `lintSkill`：引用了不存在的工具 / 作用域 / 链接即失败，15 个工具都有说明；`skill.test.ts`「passes the lint against the real tool list…」；Skill 要求 `isError` 即未完成、回复返回的真实 id；示例数值标注为示例 |
| 安装说明不含真实 secret，四包口径一致 | 通过 | `skill.test.ts`：四包 SKILL.md 完全相同、校验和可验证、篡改可发现；凭据模式（PAT、Bearer、Bot token）检测为空；片段只引用 `LEDGER_API_TOKEN` |
| 同名覆盖保护 | 通过 | `skill.test.ts` install plan；手工演练：首次安装 → 再次安装“已是最新” → 本地改动后安装显示差异并退出 3 → `--force` 备份到 `.ledger-skill-backup/` |
| 触发边界、缺字段澄清、stale、未知写入结果 | 部分（静态 + 服务端） | Skill 文本覆盖四类规则；服务端侧：缺字段被 schema 拒绝、stale 汇率返回 `FX_RATE_STALE` 与选择建议、超时建议查 operation（`mcp.test.ts`、`clients.api.ts`）。模型是否按规则触发 / 追问需真实客户端验证 |

## 留给人工审查

- 在四个真实客户端中验证 Skill 被发现、按需加载，正例（“记一笔 28 港币午餐，现金账户”“下周有哪些订阅到期”“按历史汇率汇总上月支出”“新增一个每月 20 美元的订阅并提前一天提醒”）触发，反例（“开发记账页面”“解释 Next.js SSR”）不触发。
- 核对各客户端当前版本的 Skill 目录、重名优先级与重载方式（契约 §5）。
