# M4-DASH · 总览、分析与预算可视化 · 验证记录

日期：2026-10-02（Asia/Hong_Kong）· 执行：Claude Code（实现者自评估）· 分支 `claude/loving-planck-dvzfpc`。

## 交付

| 步骤 | 实现 |
| --- | --- |
| P01 / P05：KPI、趋势、分类、预算、近期账单 | [dashboard](../../../apps/web/src/app/ledgers/[ledgerId]/dashboard/page.tsx)、[analytics](../../../apps/web/src/app/ledgers/[ledgerId]/analytics/page.tsx)、[budget-form](../../../apps/web/src/components/budgets/budget-form.tsx)；KPI = 有效支出 − 退款，收入单独，结余 = 收入 − 净支出；缺率显示“另有 N 笔待补汇率”；月均订阅标注“预测” |
| 图表懒加载；SSR 数值与数据表替代 | [chart.tsx](../../../apps/web/src/components/charts/chart.tsx) 动态 import [echarts.ts](../../../apps/web/src/components/charts/echarts.ts)（`echarts/core` + SVGRenderer，按需注册 Line / Bar / Pie 与组件）；每个图表下有数据表或可键盘访问的列表 |
| 钻取携带同一期间 / 口径并可返回 | 分类 → `/transactions?dateFrom&dateTo&categoryId[&currency]`（分类钻取不再限定“支出”，退款随原分类出现，明细合计 = 分类净额）；趋势桶 → 同日期范围；预算“查看明细”；浏览器后退回到原页面 |
| echarts/core、稳定 series.id / data.name、setOption 过渡、ResizeObserver / dispose | 每个容器一个实例；数据、模式、主题色、减少动画变化都在同一实例 `setOption`；`data-chart-instance / -renders / -animation` 供 E2E 观察；卸载时 dispose |

## 验收标准对照

| 验收标准 | 结论 | 证据 |
| --- | --- | --- |
| 图表合计与明细一致，缺率和预测清楚标注 | 通过 | `visual.spec.ts`「dashboard…」：KPI ¥150.00 / ¥5,000.00 / ¥4,850.00 与种子数据一致；键盘进入“餐饮”钻取后列表金额合计 = −120（80 + 50 − 10 退款）；「analytics…」预算 75%、构成 80% / 20%、新建交通预算显示“已超出”；`reports.test.ts` 缺率 partial |
| 键盘 / 触摸均可钻取，JS 预算符合目标 | 通过 | 键盘：分类列表 focus + Enter；触摸（移动项目）：点击分类条形图进入该分类；JS：「first-screen JavaScript stays within budget」首屏脚本 gzip 合计见运行记录（含框架，低于 180 KiB 上限），ECharts 独立 chunk 只在首屏后加载 |
| 动画、同实例更新、深浅与主题色切换、数据表替代、离屏 / 卸载清理；不计入首屏同步包 | 通过 | 「dashboard…」：切换“收支对比”、主题色、深色均为同一 `data-chart-instance` 且渲染次数递增，语义 / 数据色令牌不变；导航离开后页面无 `_echarts_instance_` 残留，返回生成新实例；M4-RESP 中减少动画动态开启后 `data-chart-animation=false` |

## 留给人工审查

- 动效观感（入场错峰、更新过渡）与低端手机流畅度；M7-PERF 按目标数据量复测聚合 p95。
