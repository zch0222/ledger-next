# UI 细节排查与修改方案

日期：2026-10-05 ｜ 基线提交：`6c159ce` ｜ 性质：本机 Docker 栈上的 e2e 排查 + 修改方案；组件库已定为 Base UI，实施进度见 §5

## 0. 排查方式

- 环境：`docker compose up -d --build --wait` 启动的本机栈（web / worker / migrate / MySQL / Redis）。
- 账号：在 `/login` 通过 UI 注册测试账号 `ui-audit@example.test`（密码沿用 `tests/e2e/helpers.ts` 的测试口令），称呼用 5 个汉字“测试审计员”，与截图里“称霸幼儿园”同类。在 UI 中创建账本“UI 排查账本”（CNY / Asia/Shanghai）和首个账户“招行Visa”。
- 数据：先截“新账本无分类”状态，再通过 REST 播种 3 个账户（含长名称 HKD 账户）、4 个分类、4 笔账目（含长商户名）、1 个 USD 订阅、1 个月度预算。
- 驱动：`ledger-next` 的 Playwright 镜像（`docker build --target tests`）以 `--network container:ledger-next-web-1` 访问 `http://localhost:3000`，同源校验与真实部署一致。
- 覆盖：12 个页面 + 5 个弹层；1440×900 深色 / 浅色、1024×768、390×844（移动 + 触屏）；每页跑计算样式探针（select 外观、文本换行、内容溢出、可选中的界面文字、原生控件、弹层滚动），并做真实交互（双击、三击、拖选、点击头像）。
- 截图与探针结果在会话临时目录，不入库；修复时把下文的检查固化成 e2e 用例（见 §3）。

## 1. 问题清单

### P0：功能性或明显错误

| # | 问题 | 证据 | 位置 |
| --- | --- | --- | --- |
| 1 | **头像变形、点一下直接退出登录** | 实测 34×42 椭圆；全局 `button` 的 `padding: 9px 14px` 只给文字留 6px，“测试”折成两行并溢出（内容高 45 > 盒高 42）。按钮 `aria-label="退出登录"`，点击即调 sign-out 跳回 `/login`，无菜单、无确认 | `components/account-menu.tsx`、`globals.css` `.avatar` |
| 2 | **移动端账目筛选不可用** | 390px 下“类型 / 分类 / 账户”三个 select 被压到约 60px，只剩“：”和箭头，看不到当前值 | `components/transactions/filters.tsx`、`globals.css` `.filterbar` |
| 3 | **新增订阅弹窗保存按钮不在视口内** | 1440×900 下弹窗高 858px，整个 `<dialog>` 在滚（不是 `.dialogbody`），标题栏随内容滚走，底部“保存”需要滚动才能看到；用的是系统默认滚动条（截图 3 右侧的灰色滚动条） | `globals.css` `dialog` / `.dialogbody`、`subscriptions/subscription-form.tsx` |
| 4 | **水合错误 React #418** | `/settings/channels` 每次加载都报。SSR 输出“最近验证 2026/10/5 10:00:36”，浏览器渲染成 18:00:36：`toLocaleString` 没传 `timeZone`，服务端按 UTC、客户端按本机时区 | `components/notify/channels.tsx:205`；同类写法还在 `entry-drawer.tsx:734`、`settings/data.tsx:307,417`、`transactions/detail-drawer.tsx:84` |
| 5 | **“最近操作”显示原始事件码** | 31 种审计动作里 18 种没有中文映射，页面直接显示 `category.created`、`budget.created` 等 | `app/ledgers/[ledgerId]/settings/page.tsx` 的 `ACTIONS` |

### P1：你点名的三类问题和同类项

| # | 问题 | 证据 | 位置 |
| --- | --- | --- | --- |
| 6 | **界面文字可被选中** | 全站没有任何 `user-select` 规则。双击、三击或拖选可以选中品牌副标题、导航、页面 kicker、KPI 标签（实测三击选中“本月支出”）、按钮、表头、表单 label、legend、图表图例；ECharts 用 SVG 渲染，坐标轴文字（每张图 10–13 个 `<text>`）也会被选中 | `globals.css` |
| 7 | **选择框是浏览器默认样式** | 14 个组件共 37 个 `<select>`，全部 `appearance: auto`：收起时用系统箭头，展开后是操作系统原生列表（截图 3：浅蓝高亮、直角、不跟随主题色）。账本切换用 `<select>` 并把“＋ 新建账本”塞成一个选项，是把操作伪装成选项 | `globals.css` `select`、`ledger-select.tsx` |
| 8 | 侧栏品牌副标题折行且字号违规 | “YOUR MONEY, CLEARLY.” 10px + 字距 2px，在 134px 宽度里折成两行；规范要求辅助文字 ≥12px（UI_SPEC §2） | `layout.tsx` `.brand small` |
| 9 | 导航图标风格不统一 | 用 Unicode 字符 ▦ ≡ ▣ ◴ ▤ ♧ ⌘ ⚙ 当图标：字形大小、基线各不相同（◴、⌘ 明显偏小）；“提醒中心”和站内通知用的是梅花 ♧，语义不对 | `shell/nav.tsx`、`layout.tsx` |
| 10 | 其他原生控件未统一 | `<summary>` 用默认 ▶ 三角；“显示已归档”复选框 `accent-color: auto`，未跟随主题色，文字还折到复选框下方；日期输入用系统图标，也没有可见标签（只看到 mm/dd/yyyy） | `globals.css`、`settings/catalog.tsx`、`filters.tsx` |
| 11 | 账本切换的焦点环压住副标题 | 无边框 select 高 28px，`outline-offset: 3px` 的焦点环盖住“所有者 · Asia/Shanghai” | `.book select` |
| 12 | 面板上下贴边 | 账本设置、Agent 接入页连续的 `.panel` 之间没有间距，边框直接相接 | `globals.css` |
| 13 | 新账本没有任何分类 | 新账本的分类下拉只有“未分类”（截图 3 即此状态），记账和订阅都无法分类，界面也没有引导去建分类 | 建账流程 / `entry-drawer.tsx`、`subscription-form.tsx` |

### P2：打磨项

| # | 问题 | 位置 |
| --- | --- | --- |
| 14 | 分类排行图在分类少时柱子间距过大（2 个分类占满 252px 高）；趋势图把未来的周画成 0（10/12 之后是一条贴底直线），与“不插入虚构数据”相违 | `charts/chart.tsx`、`reports/*` |
| 15 | 账目表的金额下方多出一行“CNY”，与 ¥ 重复，行高被拉大；已按日期分组，日期列又重复一遍；商户首字头像中，“十月工资”的“十”看起来像“+” | `transactions/table.tsx`、总览“最近账目” |
| 16 | 操作样式混用：同一行里既有描边按钮又有文字链接（账户卡“转账 / 记一笔 / 改名 / 归档”，预算行“查看明细 → / 调整”，前者有下划线后者没有）；“归档”这类破坏性操作也没有区分颜色 | 多处 |
| 17 | 页面 kicker“YOUR MONEY, CLEARLY.”每页都有，onboarding 页和品牌副标题一起出现了两次，不提供信息 | `ui/page.tsx` `PageHeading` |
| 18 | 预算面板随右侧环图被拉伸，下方大片留白；桌面账目筛选栏换行不整齐（“有效”单独一行，“全部账户”被拉得很宽） | `globals.css` `.grid`、`.filterbar` |
| 19 | 移动端隐藏了头像，“更多”页也没有账号 / 退出入口，只能到“账本设置”页底部退出 | `more/page.tsx` |

## 2. 修改方案

按 4 个工作包推进，每个包可以独立合并。

### WP1 基础样式层（只改 `globals.css`，覆盖面最大）

1. **文字选择策略**：界面元素不可选，内容保持可选。不在 `body` 上全局禁用，否则金额、商户、备注、令牌、请求号就无法复制。

   ```css
   /* 界面元素不是内容：点击、双击、长按都不应选中文字 */
   button, .button, .nav, .mobile-nav, .brand, .sidefoot, .kicker, .tabs, .segmented-links, .seg,
   .chart-toggle, .chart-legend, .legend, .pill, .badge, .avatar, .chip-filter, .month-nav, summary,
   legend, label, th, .metric .label, .metric .hint, .calendar-head, .swatch, .empty-symbol, .echart {
     -webkit-user-select: none;
     user-select: none;
   }
   .nav a, .mobile-nav a, .brand, .mobile-nav button { -webkit-user-drag: none; -webkit-touch-callout: none; }
   button, a, summary, label { -webkit-tap-highlight-color: transparent; }
   ```

   保持可选：`.value`、`.amount`、`td`、`.code`、`.detail-list dd`、令牌、邮箱、错误信息。

2. **select 收起态**：`appearance: none`，加主题色箭头。用两段渐变画箭头，可以直接引用 `var(--muted)`，深浅模式自动适配，不需要 data URI：

   ```css
   select {
     appearance: none;
     padding-right: 36px;
     background-image:
       linear-gradient(45deg, transparent 50%, var(--muted) 50%),
       linear-gradient(135deg, var(--muted) 50%, transparent 50%);
     background-position: calc(100% - 18px) 50%, calc(100% - 13px) 50%;
     background-size: 5px 5px;
     background-repeat: no-repeat;
   }
   select:hover { border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); }
   select:disabled { opacity: .55; cursor: not-allowed; }
   ```

3. **select 展开态**：渐进增强使用 Chromium 的可定制 select（`appearance: base-select`，Chrome / Edge 135+）。只在精确指针设备启用，手机保留系统滚轮选择器：

   ```css
   @supports (appearance: base-select) {
     @media (hover: hover) and (pointer: fine) {
       select, ::picker(select) { appearance: base-select; }
       select { background-image: none; }               /* 改用 ::picker-icon */
       select::picker-icon { color: var(--muted); transition: rotate .16s; }
       select:open::picker-icon { rotate: 180deg; }
       ::picker(select) {
         background: var(--panel); color: var(--ink);
         border: 1px solid var(--line); border-radius: 12px;
         box-shadow: var(--shadow); padding: 4px; margin-block: 4px;
       }
       option { border-radius: 8px; padding: 8px 10px; min-height: 36px; }
       option:hover, option:focus-visible { background: var(--bg); }
       option:checked { background: var(--soft); color: var(--accent); font-weight: 600; }
     }
   }
   ```

   Firefox / Safari 回退到原生列表，`color-scheme` 已保证深色可读。这一步改动小、可访问性零损失；如果之后要求所有浏览器展开态完全一致，再引入自研 Listbox，不建议现在就上。

4. **弹层布局**：标题栏、底栏固定，只滚动内容区。

   ```css
   dialog[open] { display: flex; flex-direction: column; overflow: hidden; }
   dialog > form { display: flex; flex-direction: column; min-height: 0; flex: 1; }
   .dialogbody { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
   .dialogbody, .table-scroll, .sidebar { scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
   ```

   注意必须写 `dialog[open]`，写在 `dialog` 上会让关闭的弹窗也显示出来。

5. **其他原生控件**：
   - `input[type=checkbox], input[type=radio] { accent-color: var(--accent); }`
   - `summary { list-style: none }`、`summary::-webkit-details-marker { display: none }`，改用旋转的 chevron 伪元素。
   - 日期控件：`::-webkit-calendar-picker-indicator` 统一透明度与光标；格式由浏览器语言决定，暂不替换为自研日期选择器。
6. **头像**：`.avatar { flex: none; width: 36px; height: 36px; padding: 0; min-width: 0; min-height: 0; line-height: 1; white-space: nowrap; overflow: hidden; font-size: 14px; font-weight: 600; border-color: transparent; }`。触屏下全局 44px 规则会把它撑成 44px 圆，仍然是正圆。
7. **零散修正**：`.panel + .panel { margin-top: 20px }`（或页面级 `.stack { display: grid; gap: 20px }`）；`.grid { align-items: start }`；`.book select:focus-visible { outline-offset: 1px }`；品牌区去掉 10px 副标题（见 WP2.4）。

### WP2 组件

1. **账户菜单**：替换 `AccountMenu`。
   - 头像按钮 `aria-haspopup="menu"` 加 `aria-expanded`，用原生 Popover API（`popover` 属性；自带点外部关闭、Esc 关闭、顶层渲染，主流浏览器均已支持）弹出菜单。
   - 菜单内容：姓名、邮箱、“账本设置”、“外观”、分隔线、“退出登录”（negative 色）。
   - 定位：头像固定在右上角，用 `position: fixed; top: 76px; right: 24px` 即可，不依赖 CSS anchor positioning。
   - 首字规则写成 `initials(name)` 并加单测：用 `Intl.Segmenter` 按字素切分；首字是汉字取 1 个字（称霸幼儿园 → 称）；拉丁名取首尾两个单词的首字母大写（Alex Wu → AW）；单个单词取前两位；emoji 不会被切断。
2. **账本切换**：`LedgerSelect` 改成同一套菜单组件，列出账本（当前项打 ✓，显示角色），分隔线下放“＋ 新建账本”“账本设置”。顺带解决焦点环压字（#11）。
3. **图标**：新增 `components/ui/icons.tsx`，放约 15 个内联 SVG（24 视框、`stroke="currentColor"`、线宽 1.75，路径取自 Lucide，ISC 许可，不新增依赖），替换导航、通知（铃铛）、关闭 ✕、月份 ‹ ›、＋。
4. **品牌区**：侧栏只保留标记和 “Ledger”，整体做成指向总览的链接；副标题留给登录 / onboarding 页，并至少用 12px。`PageHeading` 的 kicker 改成栏目名（如“总览 / 账目 / 订阅”），或直接删除（待定，见 §4）。
5. **弹层**：抽一个 `components/ui/dialog.tsx`（head / body / foot 三段结构 + `showModal` 同步 + Esc 关闭），先在订阅、账户、预算、记一笔这 4 个弹层上使用，WP1.4 的布局只需维护一份。订阅弹层宽度改为 `min(600px, 100% - 24px)`，或把“金额与周期”改成两列，避免“每期金额（原币）”折行。

### WP3 页面

1. **账目筛选（#2、#18）**：`.filterbar` 改用 CSS grid。
   - 桌面：`minmax(220px, 2fr) repeat(4, minmax(120px, 1fr))` 一行放搜索和 4 个 select，日期区间放第二行，配可见标签“从 / 至”。
   - ≤767px：搜索占整行；4 个 select 排成 2×2；日期占两列。
   - 后续可以收成“筛选（n）”按钮加底部 sheet，本轮不做。
2. **时间格式（#4）**：在 `lib/time.ts` 增加 `formatInstant(iso, timezone, opts?)`，统一传 `timeZone: ledger.timezone`，替换上面列出的 5 处调用；客户端组件从 `useLedgerUI().ledger.timezone` 取时区。频道页修复后水合错误应消失。
3. **审计文案（#5）**：把 `ACTIONS` 移到 `lib/audit-labels.ts` 并补齐 18 个动作；加一个 vitest，扫描 `packages/domain/src` 里的 `audit(…, '<action>')`，断言每个动作都有中文文案，防止以后再漏。
4. **账目表（#15）**：只有原币与基准币不同时才显示第二行（如“USD 20.00 · ≈ ¥142.50”）；按日期分组时，日期列改为显示时间或隐藏；商户头像改用分类色块加分类首字，收入 / 支出用不同底色。
5. **图表（#14）**：分类排行图高度按分类数计算（`n × 36 + 48`，最小 120px），设置 `barMaxWidth`；趋势图把未来区间的值设为 `null`（ECharts 会断开），折线开启 `smoothMonotone: 'x'`，避免平滑曲线过冲。
6. **操作层级（#16）**：卡片内主操作用按钮；次要操作收进“⋯”溢出菜单（复用 WP2 的菜单）；“归档”加确认并用 negative 色；`.linkbtn` 与 `a` 的下划线规则统一。
7. **移动端账号入口（#19）**：“更多”页底部加“我的账号 · 退出登录”。

### WP4 回归测试（`tests/e2e/ui.spec.ts`，desktop 与 mobile 两个 project 都跑）

- 头像是正圆，宽高相等且 ≥36px，文字只有一行；点击头像打开菜单且**不会**退出登录。
- 每个页面里每个可见 select 满足 `scrollWidth <= clientWidth`（390px 宽度下 #2 必须通过）。
- 界面元素（`.nav a`、`.kicker`、`th`、`label`、`.metric .label`、`button`）的 `user-select` 为 `none`；`.amount`、`td` 仍可选。
- 1440×900 和 390×844 下，所有弹层的 `.dialogfoot` 完整位于视口内。
- 遍历全部路由，无 `pageerror` 或 console error（覆盖 #4）。
- vitest：审计文案覆盖率；`initials()` 用例。
- 验证命令：`docker build --target verify .`，以及 `docker compose -f compose.tools.yaml run --rm e2e`。

## 3. 建议顺序与工作量

| 顺序 | 内容 | 预估 |
| --- | --- | --- |
| 1 | WP1 全部 + WP3.2（时间）+ WP3.3（审计文案）：纯样式和小改动，修掉 #1 外观、#3、#4、#5、#6、#7、#10–#12 | 0.5–1 天 |
| 2 | WP2.1–2.3（账户菜单、账本切换、图标）+ WP3.1（筛选）：修掉 #1 行为、#2、#9 | 1–1.5 天 |
| 3 | WP2.4–2.5 + WP3.4–3.7：打磨项 | 1–1.5 天 |
| 贯穿 | WP4 测试与每个包一起提交 | 随包 |

## 4. 需要你决定

1. ~~**展开后的选择列表**~~：已决定改用 Base UI（`@base-ui/react`），样式由 `globals.css` 统一定义，见 §5。
2. ~~**新账本默认分类（#13）**~~：采用不改数据模型的做法：分类为空时，设置页给出“添加常用分类”（一次添加 8 个支出 + 3 个收入分类，可改名或归档），记一笔和新增订阅的分类下拉下方提示并链接到设置。建账时自动预置仍可后续再定。
3. ~~**页面 kicker**~~：改为栏目名（总览、账目、设置…），登录与建账卡片保留品牌语。
4. ~~**退出登录**~~：不加二次确认，菜单项本身已是明确操作。

## 5. 实施记录（2026-10-05，Base UI）

**组件库**：`@base-ui/react@1.8.0`，只装在 `@ledger/web`。Base UI 负责交互与无障碍（焦点管理、键盘、读屏、表单隐藏字段），外观全部写在 `globals.css` 的 “Base UI components” 一节，只用主题令牌和 Base UI 的状态属性（`data-open`、`data-highlighted`、`data-selected`、`data-checked` 等），深浅模式与自定义主题色自动生效。根布局加了 `.root { isolation: isolate }`，保证弹层始终在页面之上。

**统一入口**（`apps/web/src/components/ui/`，新代码只用这些，不再直接写原生 `<select>` / `<dialog>` / 复选框）：

| 组件 | 用途 | 要点 |
| --- | --- | --- |
| `select.tsx` → `Select` | 全部下拉选择 | `id` 落在触发按钮上，外层 `<label htmlFor>` 照常生效；`name` 通过隐藏字段进入 `FormData`；`plainOptions` / `labelOptions` 生成选项 |
| `menu.tsx` → `MenuRoot` / `MenuTrigger` / `MenuPopup` / `MenuItem` / `MenuLink` | 账户菜单、账本切换 | `MenuLink` 用 Next 路由跳转 |
| `modal.tsx` → `Modal` / `ModalHeader` | 全部弹窗 | 标题自动成为可访问名称；只滚动内容区；默认点击外部不关闭（防止误丢表单），需要时传 `dismissible` |
| `checkbox.tsx` → `Checkbox` | 全部复选框 | 外层 label 命名；`name` 提交 `on`，与原生一致 |
| `icons.tsx` → `Icon` | 统一线性图标 | 24 视框、1.75 线宽、`currentColor`，替换导航等处的 Unicode 字符 |

**已迁移**：37 个下拉、10 个弹窗、全部复选框；头像改为账户菜单（姓名、邮箱、账本设置、外观、退出登录），账本切换改为菜单；侧栏与移动底栏改用图标；移动“更多”页增加账号与退出入口。

**第一轮已解决**：#1 头像、#2 移动端筛选、#3 弹窗保存按钮、#6 文字可选、#7 下拉样式、#8 品牌副标题、#9 图标、#10 其他原生控件（复选框、`<summary>` 箭头、日期图标）、#11 焦点环压字、#12 面板间距、#19 移动端账号入口，以及 #18 的筛选栏布局部分。

**复查结果**（同一测试账号，1440×900 / 390×844，深色与浅色）：头像 38×38 单行“测”；点击头像打开菜单，不再退出；界面文字 `user-select: none`，金额与表格仍可选；新增订阅弹窗宽 598px，底栏在视口内，只滚动内容区；记一笔打开时焦点在金额，外观面板打开时焦点在当前模式；手机筛选 4 个下拉各 156px，无截断；页面不再有原生 `select` / `dialog`；遍历页面无 pageerror。

**行为差异**（有意为之，需要知道）：

- 下拉在触屏设备上显示页内列表，不再调起系统滚轮选择器。
- `form.reset()` 不会重置 Base UI 下拉（保留上次选择）；目前只有分类、成员、人工汇率三处表单提交后重置文本框，影响可以接受。
- 外观面板和账目详情点击外部即关闭（与浮层习惯一致）；其余表单弹窗保持只能用关闭按钮、取消或 Esc 关闭。
- 页面刚加载、Base UI 代码到达前的一瞬间（通常数百毫秒内），下拉与顶栏菜单是静态占位，点击不会展开；e2e 用例据此先等真实控件可用再操作。
- 账户卡片的“改名 / 归档”在“⋯”菜单里，e2e 用例已同步。

**第二轮（同日）**：其余问题全部修复。

- #4 水合错误：新增 `formatInstant(iso, timezone)`（`lib/time.ts`），5 处时间显示统一按账本或账目时区格式化；提醒渠道页不再报 React #418。
- #5 审计文案：`lib/audit-labels.ts` 覆盖领域层写入的全部 46 种动作；单测 `tests/unit/audit-labels.test.ts` 扫描 `packages/domain/src`，漏写即失败。
- #13 新账本无分类：见 §4 第 2 条。
- #14 图表：趋势图未开始的周期留空，不再画成 0；分类排行高度随分类数变化（最小 120px）。
- #15 账目表：去掉金额下重复的币种行（币种写在表头）；按日分组时日期列改为时间；行首标识改为分类首字（转账用图标，收入 / 退款绿色底），不再出现“十”像“+”。
- #16 操作层级：账户卡片的“改名 / 归档”收进“⋯”菜单，归档为危险色且仍需确认；分类“归档”用危险色；面板标题、预算行等文字操作统一为无下划线、悬停下划线。
- #17 kicker：见 §4 第 3 条。
- #18 预算面板不再被右侧环图拉伸；表单同一行字段顶部对齐（一侧有提示时另一侧不下沉）；带图标的按钮图标与文字同行。

**首屏 JavaScript**：引入 Base UI 后总览页首屏脚本一度超出 TECHNICAL_DESIGN §7.3 的 180 KiB gzip 预算（e2e 实测 233 KiB）。现在下拉、菜单在服务端和水合阶段渲染外观相同的静态占位（`aria-disabled`），水合后再加载 Base UI 并替换（`components/ui/lazy.tsx`，用 `useSyncExternalStore` 保证水合一致）；弹窗在首次打开时加载（`components/ui/modal.tsx`），记一笔表单按需加载并在空闲时预取。总览页首屏不再包含 Base UI 代码。

**验证（2026-10-06）**：`docker build --target verify .` 通过（lint、格式、typecheck、189 个单测、契约、进度校验）；`docker compose -f compose.tools.yaml run --rm e2e` 通过：83 个 MySQL 集成测试，Playwright 74 个通过、1 个按设计跳过（首屏预算只在桌面量一次），含 axe 无障碍扫描、触控目标和日志脱敏检查；总览页首屏 JavaScript 151.4 KiB gzip（预算 180 KiB）。e2e 用例的改动：下拉用 `choose()`，复选框用 `getByRole('checkbox')`（Base UI 隐藏的表单 input 也会被 `getByLabel` 命中），触控目标检查跳过 `aria-hidden` 元素，`N` 快捷键前等待外壳水合完成，账户归档改走“⋯”菜单。
