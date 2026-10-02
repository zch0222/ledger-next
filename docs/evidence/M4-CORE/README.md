# M4-CORE · 认证、账目、账户与设置 UI · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估）· 分支 `claude/loving-planck-dvzfpc`。

## 交付

| 步骤 | 实现 |
| --- | --- |
| P00 / P02 / P03 / P06 / P09 / P11 / P12 | 路由 `apps/web/src/app/ledgers/[ledgerId]/…`：[onboarding](../../../apps/web/src/app/onboarding/page.tsx)（建账本 → 首个账户，可跳过）、[transactions](../../../apps/web/src/app/ledgers/[ledgerId]/transactions/page.tsx) + [detail-drawer](../../../apps/web/src/components/transactions/detail-drawer.tsx)、[entry-drawer](../../../apps/web/src/components/entry-drawer.tsx)、[accounts](../../../apps/web/src/app/ledgers/[ledgerId]/accounts/page.tsx)、[settings/currencies](../../../apps/web/src/app/ledgers/[ledgerId]/settings/currencies/page.tsx)、[settings/data](../../../apps/web/src/components/settings/data.tsx)、[settings](../../../apps/web/src/app/ledgers/[ledgerId]/settings/page.tsx)（成员、分类标签） |
| 首屏 SSR，表单 REST 写入，空 / 错 / 冲突状态 | 页面在服务端直接调用领域层（AuthContext），写入全部走 `/api/v1`（预览 → 同一 previewId + Idempotency-Key 提交）；面板级错误带 request id 不清空页面；首次无数据与“当前条件下没有账目”分开；412 冲突并排展示服务器当前版本（沿 `replacedById` 找到最新版本，D24）与本地输入，不自动覆盖；有有效退款的支出锁定更正 / 作废并说明原因 |
| keyboard / focus 与 URL 筛选 | 快捷键 N、dialog 打开聚焦金额、Escape 关闭并把焦点还给触发按钮、未保存内容拦截；筛选（搜索 / 类型 / 分类 / 账户 / 日期 / 版本状态）全部在 URL，chips 可逐个移除；浏览器后退时搜索框跟随 URL（修复了后退后旧文本被重新推入的问题） |

## 验收标准对照

| 验收标准 | 结论 | 证据 |
| --- | --- | --- |
| 无需等待图表 JS 可读首屏信息 | 通过 | `visual.spec.ts`「dashboard: server-rendered numbers…」在 `javaScriptEnabled: false` 上下文读取 KPI 与图表数据表；`ui.spec.ts` SSR HTML 含标题且 `Cache-Control: private` |
| 记账、更正、退款、账户归档端到端通过 | 通过 | `flows.spec.ts`「record, correct, refund and void…」（桌面 + 移动各一遍：记账、更正生成新版本并可回看旧版本、退款与可退余额、作废后余额恢复、状态筛选 / 刷新 / 后退、412 冲突不覆盖，API 余额核对）、「accounts: create, transfer, credit-card liability, archive…」、「entry dialog: keyboard, focus return…」；`settings.spec.ts` CSV 导入向导 → 重复跳过 → 撤销批次 → 导出下载（公式转义）、人工汇率必须填理由、分类改名归档后历史账目仍显示名称、viewer 只读 |

## 留给人工审查

- 真实用户走查文案与信息密度；屏幕阅读器（NVDA / VoiceOver）实际朗读。
- 远程 CI 运行结果（本轮在本机 Docker 执行）。
