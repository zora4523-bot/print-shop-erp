# Codex Prompt：定价表单展示层优化（批次五）

把下面 `---` 之间整段交给 Codex。设计稿在仓库 `docs/ux-redesign/`，用浏览器打开即可。

这是**展示层**任务，与 `docs/codex-prompt-代码质量审查修复-2026-08-23.md`（结构收口）并行、文件几乎不重叠。不要在本任务里改 jobs / notification / salary / prisma。

---

你是红包印刷 ERP（Next.js 16 App Router + React 19 + Tailwind v4 + shadcn/ui + 语义 token）的实现者。
本轮只做 **外部销售定价表单** 的展示优化，规格以批次五为准。

## 读取顺序（不要跳）

1. `docs/定价表单优化-2026-08-24.md` —— 现状对照表，哪一条还在、哪一条不要动
2. `docs/ux-redesign/批次五 价格与报价 交互稿.dc.html` —— P1 工作台、发布中心、阶梯表、契约 09
3. `docs/ux-redesign/收费项目工作台 重设计.dc.html` —— 只当早期演示；**冲突以批次五为准**
4. `docs/ux-redesign/交互与状态设计规范.dc.html` —— L3、五态；清单没写的情况按契约推
5. `UI-SYSTEM.md` —— 当前展示层护栏（调色板字面量、视口闸、打印基线）；`docs/codex-ui-brief.md` 仅作历史背景
6. 实现前先读：
   - `components/business/price/ExternalSalesChargeWorkspace.tsx`
   - `components/business/price/ExternalSalesPriceTierGroupEditor.tsx`
   - `app/(admin)/owner/prices/external-sales/items/page.tsx`
   - `app/(admin)/owner/prices/external-sales/versions/` 下现有页面
   - 对应 `__tests__` 与 `visual-fixture`

**不要从** `docs/ux-redesign/ERP 全站线框 批次1-3.dc.html` 开始实现。
**不要做**全站执行清单 01–12（工单列表裁列、新建工单三段式、师傅报工置顶、侧栏折叠等）。那些是下一轮。

## 范围

只改：

- `components/business/price/**`
- `app/(admin)/owner/prices/external-sales/**` 的 JSX / className / loading
- 若必须为对比度新增语义 token：`app/globals.css` 的 `:root` 与 `.dark` **两处**一起加；业务代码只引用 token
- 更新被 DOM 变化打红的现有测试

不许碰：`lib/`、`actions/`、`app/api/`、`prisma/`、金额算法、价目状态机、Server Action 签名、`expectedUpdatedAt` 协议。

## 必须保持的业务契约

- 当前价 / 调价草稿 / 计划生效版本始终可分。不得把草稿画成已生效价。
- 销售报价页本轮不做；若你碰到 `/sales/quote`，停下来。
- 金额：服务端权威。Δ、涨幅只用已有 Decimal 字符串做展示格式化，禁止 `Number` 做钱。
- 整组保存：任一行失败整组不保存。文案可以更明显，行为不能改。
- 并发：继续用 `expectedUpdatedAt`。冲突要能看见差异，禁止静默覆盖。
- 「计价单位」列：按个 / 按张 / 每万个 / 每款一次时是常量，只放表头；**整批固定总价时该列是折合单价，不能上移到表头当常量。**
- 加工费与「快递与打包耗材」仍是两个 purpose，不要合成一张表。
- 停用 ≠ 删除。启用开关是档位是否参与报价，不是删档。
- 视觉语言继承现有 shadcn 皮肤（业主选 1b）。不要换 Industry 皮肤。
- 打印视图完全不要碰。

## 要落地的 UI（按顺序，一次一项）

### P1 阶梯表（`ExternalSalesPriceTierGroupEditor`）

桌面列：数量 | 当前价 | 草稿输入 | Δ（金额 + 百分比）| 启用。

- 行高桌面约 44px（`min-h-11`），Label 只在小屏出现，不要每行再写「500 个草稿单价（元/个）」
- 金额、Δ 右对齐 + `tabular-nums`
- Δ 为 0 显示「未修改」，非 0 显示 `+¥0.03` / `+5.8%`（下调用警告语义，不要用品牌红当涨幅色）
- 启用与 Δ 拆开，不要混在「状态」一列
- 已改行可用 `bg-warning/5` 或输入描边提示，不要整行大红
- 可选：对当前打开的这一组提供「按百分比批量调草稿价」+ 撤销到进入编辑时的值。撤销不得发请求。没有现成 action 就不要做「保存为模板」之类新功能

### P2 工作台壳（`ExternalSalesChargeWorkspace`）

- 草稿条吸顶（`sticky`），滚列表时仍能看到「第 N 版 / 已调整档数 / 最近保存 / 去发布」
- 右栏不要复制左列的价格胶囊；右栏 = 选中项身份 + 阶梯表
- 无草稿时整表只读，文案：「当前为生效价，发起调价后才能改」
- 选中项不在当前草稿内：右栏只读，文案与上一句**不同**
- Loading：左列表约 6 行骨架，右栏「选择一个收费项目」
- Empty：无项目 / 筛选无结果 / 无权限，结构一致、文案不同

### P3 visual-fixture

`app/(admin)/owner/prices/external-sales/visual-fixture/**` 必须继续用工作台同一组件。改了 P1/P2 就要改 fixture，否则视觉回归失去意义。

### P4 发布中心（现有 versions 页）

- 按用途两栏：加工费 | 快递与打包耗材
- 草稿 / 当前生效 / 等待生效分色，但红色只留给待办与破坏性动作
- 发布确认层（L3）：列出受影响项目数、档数、涨幅区间、是否有下调、生效时间。字段以**现有表单已有的为准**
- 校验展示分三级：通过 / 注意 / 待办。若服务端现在没有「注意」级，不要编数据，只把已有错误/成功态映射清楚
- 若现有 action 不能提供影响汇总数字：做静态结构 + 用页面上已经渲染的计数，**不要**为了汇总去写新的 Prisma 查询

## 不要做

- 全站五态组件库、工单列表、新建工单三段式、师傅报工、侧栏折叠、保存视图
- 经营分析、款式模板、Dashboard last-viewed
- 补侧栏分组 / 抽 useListState / 改图表为彩色 / 给面包屑补 key
- 销售报价查询（缺原图）
- 内部 `/owner/prices` 阶梯价与加价规则（与外部销售不是同一套）
- 把 `RETRYING` 改成 `FAILED`、动通知账本、动 migration
- git stash / reset / 丢掉工作区里与定价无关的未提交文件
- 部署、生产、真企业微信

## 验收

每完成 P1–P4 贴出：改了哪些文件、对应测试名、你怎么确认吸顶/Δ/两套只读文案。

完成前必须实跑：

```
pnpm typecheck
pnpm lint
pnpm test run components/business/price app/(admin)/owner/prices
```

动了页面再评估 `pnpm build`。有怀疑就跑。

lint 不得出现调色板字面量（`bg-red-500`、`bg-[#...]`）。`app/**`、`components/business/**` 只用语义 token。

测试：

- 更新现有 `ExternalSalesChargeWorkspace.test.tsx`、`ExternalSalesPriceTierGroupEditor.test.tsx` 的 markup 断言
- 新增：常量计价单位不在行内重复；Δ 在草稿相对当前价变化时出现；无草稿与「不在草稿内」两句文案不同
- 不要为了 UI 去改金额计算单测

提交：

- 小步 commit，`type(scope): subject`，例如 `feat(price): densify external-sales tier editor columns`
- 不要把结构审查的改动混进定价 commit
- 不要开新分支、不要开 PR（工作树已在 main 的未提交批次上；本任务只叠加展示层文件）
- 不要 force push

完成定义：

- P1–P4 落地或在回复里写明被现有 action 挡住的部分（只许 P4 汇总数字）
- 定价相关测试绿
- 没有改 lib/actions/prisma
- 工作区里其它未提交文件仍在
```

---

## 2026-08-28 废止说明

本历史 prompt 中关于销售独立报价页的边界已废止，不再作为实现指令。当前产品决策为销售直接创建工单，不保留独立查价或询价入口。
