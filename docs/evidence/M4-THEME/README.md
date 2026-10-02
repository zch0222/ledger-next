# M4-THEME · 外观：主题色与深浅模式 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估，见 [AUTONOMOUS_DELIVERY](../../reviews/AUTONOMOUS_DELIVERY.md)）· 分支 `claude/loving-planck-dvzfpc`。

## 交付

| 步骤 | 实现 |
| --- | --- |
| 浅 / 深两套令牌与固定语义色 | [globals.css](../../../apps/web/src/app/globals.css) `:root` / `prefers-color-scheme` / `[data-theme]`；`--positive --warn --danger --blue --cat-*` 不引用主题色 |
| 主题色生成器（OKLCH、WCAG、palette_version） | [theme.mjs](../../../packages/ui/src/theme.mjs)（服务端与客户端共用），`theme.test.ts` |
| user_preferences、GET/PATCH /me/preferences、ln_appearance Cookie、SSR 首帧 | 迁移 [0008_preferences.sql](../../../packages/db/migrations/0008_preferences.sql)、[preferences.ts](../../../packages/domain/src/preferences.ts)、[appearance.ts](../../../apps/web/src/lib/appearance.ts)、根 [layout.tsx](../../../apps/web/src/app/layout.tsx)（`data-theme` + 内联 `--accent-*`，`generateViewport` 输出 color-scheme / theme-color） |
| 顶栏浮层、移动 sheet、P13、matchMedia、ECharts 同实例换色 | [appearance.tsx](../../../apps/web/src/components/appearance.tsx)、[settings/appearance](../../../apps/web/src/app/ledgers/[ledgerId]/settings/appearance/page.tsx)、[chart.tsx](../../../apps/web/src/components/charts/chart.tsx) 监听 `ledger:appearance` |

同步策略（D23）：选择即时应用并写 Cookie；500 ms 防抖保存到账号，关闭面板立即保存；412 时重读版本后再应用最新选择。保存失败或刷新早于保存时，Cookie 带当前用户 id 的 `pending` 标记：SSR 对该用户优先采用本设备值，下一次页面加载自动补同步；其他账号在同一设备登录不继承。

## 验收标准对照

| 验收标准 | 结论 | 证据 |
| --- | --- | --- |
| 浅色 / 深色 / 跟随系统 × 系统浅深 6 种组合首帧正确、无闪烁；跟随系统时切换系统外观，页面与图表即时更新 | 通过 | `visual.spec.ts`「appearance: six first-frame combinations…」：DOMContentLoaded 时记录 `data-theme` 与 body 背景，6 组合逐一断言；`emulateMedia` 切换系统深色后背景与趋势图（同一实例、渲染次数增加）即时更新 |
| 全部预设与极端自定义色两种模式下关键对比度 ≥4.5:1；非法颜色或未知预设 422 且不落库 | 通过 | `tests/unit/theme.test.ts`（全部预设、极端色、近似色提示）；`visual.spec.ts` 对 `red`、`neon` 返回 422 且 version 不变；`identity.api.ts` 偏好契约；axe 颜色对比在 4 组外观设置下 0 违规（M4-RESP） |
| 偏好跨设备同步、刷新保持；保存失败仅本设备生效并提示；语义 / 图表数据色不随主题色变化 | 通过 | `ui.spec.ts` 主题持久化 + 账号副本同步；`visual.spec.ts` 拦截 PATCH 后显示“未同步到账号，仅本设备生效。”、刷新仍为本设备选择、恢复网络后自动补同步、无 Cookie 的第二个浏览器上下文读到账号值；切换主题色前后 `--positive/--warn/--danger/--blue/--cat-*` 完全相同 |

## 留给人工审查

- 真机 iOS / Android 浏览器地址栏 theme-color、系统深色切换的观感。
- 主题色视觉品味（预设与自定义色的实际观感）。
