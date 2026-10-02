# M4-RESP · 全页面移动端与无障碍验收 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估）· 分支 `claude/loving-planck-dvzfpc`。

## 方法

`tests/e2e/visual.spec.ts`「responsive and accessible…」在 Docker 生产镜像上逐页检查 17 个页面 / 视图：P01 总览、P02 账目、P03 详情抽屉、P04 卡片 / 列表 / 日历、P05、P06、P07、P10、P12、P09、P11、P08、P13、移动“更多”、P00 引导。

- 宽度：移动项目 360 / 390 / 640（= 1280px 窗口 200% 缩放）；桌面项目 768 / 1440 / 1920。
- 外观：浅色 + 青绿、深色 + 青绿、深色 + 紫罗兰（非默认主题色）、跟随系统 + 玫瑰 × 系统浅 / 深。
- 每个组合：页面无水平溢出（`scrollWidth ≤ innerWidth`）。
- 每页每组外观在中间宽度跑 axe-core（`@axe-core/playwright` 4.13.0，wcag2a / wcag2aa / wcag21aa，图表画布除外——图表由数据表替代）。
- 移动浅色：所有按钮、选择框、输入、标签页、导航链接、summary 触摸目标 ≥ 44×44px。
- 减少动画：页面打开后动态开启 `prefers-reduced-motion`，图表 `animation=false`，页面入场动画为 none；关闭后改变视口，页面入场动画不重播，分类图金额标签不被裁剪；移动端点击条形图钻取。
- 另：`flows.spec.ts` 在 390×420（软键盘占半屏）下保存按钮可滚动到达并保存；移动底栏不遮挡列表最后一行；dialog 焦点进入 / Escape / 焦点恢复。

## 本轮发现并修复

| 问题 | 修复 |
| --- | --- |
| 订阅日历使用 `role=grid` 但没有 row，axe `aria-required-children / parent` | 改为带标签的列表，每天的日期与账单数以可读文本提供 |
| 移动端按钮 / 选择框 42px、链接按钮 30px、账本切换 28px、数据表开关 32px，低于 44px | `(max-width:767px), (pointer:coarse)` 下统一 ≥44×44 |
| 浏览器后退后账目搜索框保留旧文本并重新推入 URL | 搜索框跟随 URL 变化 |

## 验收标准对照

| 验收标准 | 结论 | 证据 |
| --- | --- | --- |
| 页面无水平溢出，触摸目标 / 对比度通过 | 通过 | 上述矩阵 overflow = []、axe 违规 = []、小于 44px 的目标 = [] |
| 手机可以独立完成记账、查询、订阅管理 | 通过 | `flows.spec.ts` / `visual.spec.ts` / `settings.spec.ts` 全部用例在 Pixel 7（390×844，触摸）项目中通过，记账从底栏“记一笔”进入 |
| 图表容器缩放不重播页面入场、不裁剪金额；减少动画时操作等价 | 通过 | 同上“减少动画”步骤；减少动画下钻取与切换功能不变 |

## 留给人工审查

- 真机（iOS Safari、Android Chrome）软键盘与 safe-area；200% 浏览器缩放的真实观感（本轮以 640px CSS 宽度等效）。
- 屏幕阅读器实际朗读；axe 不能覆盖的认知 / 文案可用性。
