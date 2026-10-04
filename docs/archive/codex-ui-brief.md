# Codex UI 优化任务 Brief（历史归档）

> **状态：已被取代。** 本文件记录 2026-07-19 的初始范围与当时仓库现状，不再是当前权威任务书，其中“无主题入口”“只有一个 Desktop Chrome project”等描述已经过期。当前规范以 [`UI-SYSTEM.md`](../../UI-SYSTEM.md)、[`docs/UI-DESIGN-COVERAGE.md`](../UI-DESIGN-COVERAGE.md)、[`docs/UI-REMEDIATION-BACKLOG.md`](../UI-REMEDIATION-BACKLOG.md) 和 [`docs/UI-UX-ADVERSARIAL-REVIEW-2026-08-24.md`](../UI-UX-ADVERSARIAL-REVIEW-2026-08-24.md) 为准。

> 本文件曾用于交给 Codex（或任何 AI/人）执行 **UI / 交互 / 跨设备高可用** 优化时的
> **初始任务书 + 硬护栏 + 验收定义**。目标：生产在手机 / 平板 / 桌面全设备
> **无裁切、无溢出、无展示错误**，明暗双主题达标，符合执行当时可用的现代 CSS。
>
> 阅读顺序：先读 §1 现状与护栏 → §2 验收闸（没有它就无法证明"无裁切"）→
> §3 必修清单 → §4 现代 CSS 采用规则 → §5 遗漏清单 → §6 执行方式。
>
> 维护者：业主 + Claude Code / Codex ｜ 建立：2026-07-19

---

## 0. 一句话范围

**只改展示层，颜色只走语义 token，每批改完必须过多设备验收闸，全程测试/lint/构建保持绿。**

- ✅ 可改：`components/`、`app/**/{page,layout,loading,error,not-found}.tsx` 的 JSX 与
  className、`app/globals.css` 的设计 token。
- ❌ 不许碰：`lib/`、`actions/`、`app/api/`、`prisma/`（业务/服务端逻辑）。任何
  服务端行为、鉴权、状态机、金额、任务队列改动都**不在本任务范围**。

---

## 1. 现状与硬护栏（先读，违反即回退）

### 1.1 项目 UI 栈（已确认）

| 项 | 现状 |
|---|---|
| 框架 | Next.js 16.2.4（App Router）+ React 19 |
| 样式 | Tailwind CSS v4（`@import "tailwindcss"`，`@theme inline`）+ `tw-animate-css` |
| 色彩 | **OKLCH** 色彩空间；语义 token（`--primary/--warning/--success/--info/--destructive` + `--chart-1..5`）定义在 `app/globals.css` 的 `:root` 与 `.dark` |
| 组件 | shadcn/ui 原子件（`components/ui/`）+ 业务组件（`components/business/`）|
| 图表 | recharts 3.8.1 |
| 字体 | 系统 UI 无衬线栈 + CJK 逐字形回退（苹方/雅黑/Noto CJK），`lang="zh-CN"` |
| 暗色 | `@custom-variant dark (&:is(.dark *))` + `.dark` 变量齐全，但**当前无切换入口、无 `prefers-color-scheme` 接线**（半成品，见 §3-H）|

### 1.2 已做对、**必须保留、别推翻**的东西

1. **OKLCH + 语义 token 体系**：不要退回 hex / rgb / HSL 硬编码。
2. **ESLint 调色板守卫**（`eslint.config.mjs` 的 `no-restricted-syntax`）：
   `app/` 和 `components/business/` 里**禁止** `bg-amber-50` / `text-emerald-600` /
   `border-red-500` 这类 Tailwind 调色板字面量，也禁止 `bg-[#...]` 硬编码颜色。
   例外仅 `components/ui/`（shadcn 原子件）。**违反 → `pnpm lint` 直接红。**
   新配色需求 → 在 `app/globals.css` 新增语义 token（`:root` 和 `.dark` **两处都要加**），
   业务代码只引用 token。
3. **CJK 字体回退栈**、`tabular-nums` 数字对齐、`lang="zh-CN"`。
4. **打印视图视觉基线**（`tests/visual/order-print.spec.ts-snapshots/*.png`）是资产：
   工单打印是给车间的真实产物，改全局样式**不能把它改糊**。

### 1.3 硬护栏（每一条都是回退条件）

1. 只动展示层（见 §0）。不改服务端逻辑。
2. 颜色只用语义 token；不许调色板字面量 / 不许 `bg-[#...]`。
3. **每批收尾必须全绿**：`pnpm typecheck && pnpm lint && pnpm test && pnpm build`。
4. **打印视觉基线像素不许变**。若某次改动确实需要动它，单独说明原因、附截图，
   等业主人工看图确认后才提交，**禁止**自行 `playwright test --update-snapshots`。
5. **禁止**用"已适配 / 已优化"之类口头结论交付。每批必须贴出 §2 验收闸的
   实际输出（溢出探测器 + axe + 各视口截图）。
6. 分批提交，一批一个页面组（见 §6）。禁止一次改动上百个文件的大 commit。

---

## 2. 验收闸：无裁切 / 无展示错误 / 跨设备 的可执行定义

> **这是本任务的核心。** "确保所有设备无裁切" 若无自动化闸，只会变成一句无法
> 证伪的声明。**当前仓库还没有这套闸**（`playwright.config.ts` 只有单个
> `Desktop Chrome` project，`tests/visual/` 只覆盖打印页）——所以**第一步就是
> 把闸建起来，之后所有 UI 改动都必须让闸保持绿**。

验收闸 = 下面四层，缺一不可：

### 2.1 多设备视口矩阵（Playwright `projects`）

至少覆盖：

| 名称 | 视口 | 代表 |
|---|---|---|
| mobile-sm | 375×667 | iPhone SE / 小屏安卓 |
| mobile | 393×852 | iPhone 15 / 主流安卓 |
| tablet | 768×1024 | iPad 竖屏 |
| tablet-land | 1024×768 | iPad 横屏 |
| desktop | 1280×800 | 常规笔记本 |
| wide | 1920×1080 | 大屏 |

每个关键页在每个视口都要跑 §2.2–2.4。**关键页清单**（登录、师傅端任务列表/
详情/报工、老板 Dashboard、工单列表/详情/新建、排产、账单、薪资、各主数据列表）
在 §6 分批时对应。

### 2.2 溢出 / 裁切自动探测器（不靠人眼）

在每个页面每个视口注入检测脚本，**任一命中即测试失败**：

- 横向溢出：`document.documentElement.scrollWidth > clientWidth`（body 被撑破）。
- 元素越界：任何可见元素的 `getBoundingClientRect()` 右/下边超出视口。
- 隐性裁切：元素 `scrollWidth > clientWidth` 且 `overflow` 为 `hidden/clip` 却
  **无** `title` / `aria-label` 露出全文（= 文字被切且用户拿不到全文）。
- 触摸目标：交互元素（button/a/input）在 mobile 视口下命中区 < 44×44px。

> 建议实现为一个共享 helper（如 `tests/e2e/helpers/no-overflow.ts`），每个页面
> spec 调用一次；失败信息要打印出**是哪个元素、在哪个视口、超出多少 px**。

### 2.3 无障碍闸（`@axe-core/playwright`）

每页每主题跑 axe，**对比度、label 关联、focus 可见、重复 id、图片 alt** 等
违规为失败。对比度门槛：正文 4.5:1、大字/图标 3:1（WCAG AA），**明暗两主题都要过**。

### 2.4 明暗双主题视觉基线

每个关键页在 light 和 dark 各截一张基线像素回归。首次生成的基线**必须经业主
人工看图确认**后再纳入版本控制（项目既有约定：视觉基线改动要人工 gate）。

---

## 3. 必修清单（逐条给 before/after，逐条过 §2 闸）

### A. 表格窄屏不裁切
全站 `<table>`（约 28 个文件）与 `AdminDataTable` 当前**无横向滚动容器**。
每张表包一层 `overflow-x-auto` 滚动容器（或窄屏改**卡片式堆叠**，一行一卡）；
表头考虑 `sticky`。验收：375px 下不横向撑破 body（过 §2.2）。

### B. 移动视口高度与师傅端
- 全站 `min-h-screen` / `h-screen` / `100vh` → **`100dvh`**（配 `svh`/`lvh` 兜底），
  修 iOS Safari 地址栏导致的底部裁切与 `100vh` 抖动。
- 师傅端（`app/(worker)/`）按**手机竖屏优先**重排：单列、大点击区、
  触摸目标 ≥44×44px、拇指可达的主操作。这是最高频的移动场景，优先做。

### C. viewport / 安全区
`app/layout.tsx` 补 `export const viewport`：
`width=device-width, initial-scale=1, viewportFit: 'cover'`，并设 `themeColor`。
固定/贴边容器加 `env(safe-area-inset-*)` 内边距，修 iPhone 刘海/底部横条遮挡。

### D. 图表分类配色（"着色"缺陷）
`app/globals.css` 的 `--chart-1..5` **当前全是灰阶**（`oklch(... 0 0)`，chroma=0）——
销售排行等分类图表各系列**肉眼无法区分**。改为一套**色觉友好**的分类 OKLCH
调色板：相邻色相间隔 ≥40°、明度错开（不要只靠色相区分）、在 light/dark 两主题
都可分辨、**通过色盲模拟**（红绿色盲对品牌红尤其敏感）。图表消费方
（如 `SalesRankingChart`）不写死颜色，只引用 `--chart-*`。
> 方法论可参考正规分类调色板做法（间隔色相 + 错开明度 + 对比度校验），
> 不要随手挑五个颜色。

### E. 状态完整性 + 边界
仓库当前**无任何** `loading.tsx` / `error.tsx` / `not-found.tsx`（出错=白屏）。
补全全局与关键路由的：
- `loading.tsx`：骨架屏（skeleton），不要空白。
- `error.tsx`：友好错误 + 可重试按钮（`reset()`）。
- `not-found.tsx`：友好 404。
- 每个列表/表单补齐 **空态 / 加载态 / 错误态 / 禁用态 / pending 态** 五态。

### F. 长中文文本不溢出
中文无单词边界，长订单号 / 客户名 / 地址 / 备注会溢出裁切：
- 长串标识：`overflow-wrap: anywhere` + 合适的 `line-clamp`，并用 `title` /
  tooltip **露出全文**（切了但用户能拿到全文，才不算"展示错误"）。
- 标题：`text-wrap: balance`（若 Baseline 达标，见 §4）避免孤字。

### G. 无障碍与动效
`focus-visible` 环全站可见且不被裁；尊重 `prefers-reduced-motion`（关掉非必要
动画）；对比度明暗两主题均 ≥ WCAG AA（过 §2.3）。

### H. 暗色模式：补全 **或** 明确删除（二选一，别半吊子）
现状是死代码（`.dark` 变量在，但无切换、无系统偏好、只有 5 个 shadcn 件用 `dark:`）。
- 若**补全**：加系统偏好探测 + 手动切换入口 + 全站 `dark:` / token 覆盖审查 +
  §2.4 双主题基线 + §2.3 双主题对比度。
- 若**删除**：清掉 `.dark` 相关死代码，避免半成品意外上线且完全未测。
- **决策需业主拍板**——不要默默上线半成品暗色。

### I. 性能感知（防布局抖动 CLS）
图片 `loading="lazy"` + 明确尺寸/占位；长列表考虑 `content-visibility`（§4 验证后）；
避免异步内容插入导致的跳动。

---

## 4. 现代 CSS / 着色技术采用规则（重要：先验证再用）

> **诚实前提**：本文件建立于 2026-07，但撰写者知识有截止点，**无法担保 2026 年
> 各浏览器基线的最新真值**。因此**禁止凭记忆断言"某特性已支持"**。

**规则**：采用任何较新 CSS 特性前，用 **caniuse / web-platform Baseline** 现场核实
它在项目目标浏览器（iOS Safari、Android Chrome、桌面 Chrome/Edge/Firefox 近两年
版本）已达 **Baseline "Widely available"**；否则提供**渐进增强回退**
（`@supports` 或降级样式）。每采用一项，在提交说明里注明 **"已确认 Baseline +
回退方案"**。

优先考虑（**若届时已达标**）：

- `@container` 容器查询 —— 组件级响应式，替代部分媒体查询（表格/卡片尤其受益）。
- `:has()` —— 父级条件样式，减少 JS 状态。
- 逻辑属性（`margin-inline` / `padding-block` / `inset` 等）。
- `color-mix()` / 相对颜色语法 —— 已在用 `bg-warning/10` 的 alpha-mix 思路，可延伸。
- `light-dark()` —— 简化双主题 token（若补全暗色）。
- `text-wrap: balance / pretty` —— 标题与段落排版。
- `dvh` / `svh` / `lvh` —— 移动视口高度（§3-B 已列，属稳妥项）。
- `field-sizing: content` —— 输入框自适应。
- `content-visibility` —— 长列表/长表格性能。
- `overflow: clip` + `scroll-margin` —— 更可控的裁剪与锚点定位。

**着色**：坚持 OKLCH（已在用）；分类色过色盲模拟；对比度用工具核实而非目测。

---

## 5. 遗漏清单（容易被漏、必须覆盖）

- **无障碍**（最常被当作"非展示错误"而漏）：键盘全可达、焦点顺序合理、`aria-*`
  标签、表格语义、对比度（明暗都要）、触摸目标尺寸、`prefers-reduced-motion`。
- **CJK 排版**：`overflow-wrap: anywhere` 防长串溢出；标题 `text-wrap: balance` 防孤字。
- **五态齐全**：加载 / 空 / 错误 / 禁用 / pending。当前连全局 error/loading 边界都没有。
- **图表色觉友好**：不只是"能区分"，要过色盲模拟。
- **安全区 / 刘海**：`viewport-fit=cover` + `env(safe-area-inset-*)`（师傅在 iPhone 上用）。
- **打印**：改全局样式别把工单打印视图改糊（护栏 §1.3-4）。
- **性能感知 / CLS**：图片懒加载 + 尺寸占位、避免布局抖动。
- **暗色模式取舍**：补全或删除，别半吊子（§3-H）。
- **RTL**：本项目仅中文，不需要 RTL；用逻辑属性即可，无需专门做双向布局。

---

## 6. 执行方式（分批 + 每批过闸）

### 6.1 前置：先建 §2 验收闸

在改任何页面**之前**先建好 §2 的多设备矩阵 + 溢出探测器 + axe + 明暗基线。
闸建成、当前全绿后，才开始 §3 的修改——之后每批都必须让闸保持绿。

### 6.2 分批顺序（风险低 → 高）

1. **师傅手机端** `app/(worker)/`（最需要、面积小、独立）
2. **表格 / 列表组件**（`AdminDataTable` 等，一次性受益 ~28 处）
3. **`app/globals.css` 图表色 + token 补充**（§3-D）
4. **各 admin 页面组**（owner / foreman / sales，逐组）
5. **状态边界**（loading/error/not-found，§3-E）
6. **暗色模式**（§3-H，最后，单独一批，需业主拍板）

### 6.3 Codex 调用范式

```bash
# 让 Codex 改（写模式，限定范围，一批一组）
codex exec -m gpt-5.4 --sandbox workspace-write \
  "按 docs/archive/codex-ui-brief.md 修复 app/(worker) 师傅端的响应式与裁切。
   只动展示层；改完自己跑 pnpm typecheck / pnpm lint / pnpm test / pnpm build 和多设备视口闸，
   贴溢出探测器与 axe 结果，不许只说已适配。"

# 每批改完，只读 review 复核
codex exec -m gpt-5.4 --sandbox read-only -c service_tier="fast" - <<'EOF'
review 刚才这批 UI 改动：有无调色板字面量违规、是否碰了业务逻辑、
375/768/1280 三视口有无残留溢出、明暗对比度是否达标、打印基线是否被动。
EOF
```

### 6.4 每批交付物（缺一不算完成）

- [ ] `pnpm typecheck` 绿
- [ ] `pnpm lint` 绿（无调色板字面量违规）
- [ ] `pnpm test` 绿
- [ ] `pnpm build` 绿
- [ ] 本批页面在全部视口的**溢出探测器**输出（0 命中）
- [ ] 本批页面的 **axe** 输出（0 严重违规）
- [ ] 明暗双主题截图
- [ ] 打印视觉基线未变（或已单独说明并等人工确认）
- [ ] before/after 说明每条改了什么、为什么

---

## 附：给评审者的红旗清单（一眼判断 Codex 是否偷懒）

- 出现 `bg-[#...]` 或 `text-red-500` 之类字面量 → 违反 §1.2-2，退回。
- 动了 `lib/` / `actions/` / `app/api/` / `prisma/` → 越界，退回。
- 只说"已适配"但没贴溢出探测器/axe 输出 → 未验收，退回。
- 打印基线像素变了却没说明 → 违反 §1.3-4，退回。
- 暗色模式半成品上线（有 `dark:` 但无切换/无基线）→ 违反 §3-H，退回。
- 用了新 CSS 特性但没写"已确认 Baseline + 回退" → 违反 §4，退回。
