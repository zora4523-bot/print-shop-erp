# 功能切换 / 按钮直接切换 性能审查（2026-10-01）

基线 `cdef3c8b`（分支 `claude/feature-toggle-performance-review-9c66a6`）。范围：侧边栏切换、页内 tab / 队列 / 分页切换、
直接切换状态的按钮（启停、星标、裁决、一键完成等）从点击到反馈、到内容就绪的耗时，以及背后的服务端 / 客户端成本。

## 方法

- **静态审查（并行）**：4 个 Claude 子 agent 分别审查 导航与预取 / 服务端取数 / 切换类 mutation 与刷新 / 客户端包体与渲染；
  Codex `gpt-6-astra`（xhigh，只读）独立对抗审查同一范围。所有采纳结论均由主会话回到代码 + Next 16.3.4 源码 / 文档核对。
- **实测**：`next build` 生产构建（release 配置，`127.0.0.1:3200`）+ 隔离库 `erp_e2e_perf_20261001`，用 `scripts/load-test-seed.mjs`
  灌入代表数据：**3 万工单 / 9 万款式 / 4.5 万任务 / 9 万发货 / 50 人 × 180 天工资 / 28 账号**。临时 Playwright 探针逐个点击
  管理员 37 个侧边栏入口（冷、热、悬停后点击三轮）、每页前 5 个同路径切换链接、客户端 tab/展开按钮；销售、师傅（375 宽 + 4×
  CPU 降速）、管理员手机端各一轮。记录点击→首个反馈（URL 变化 / 骨架 / aria-busy / DOM 变化）、内容稳定、RSC/action 请求、
  INP（Event Timing）、长任务、首载 JS。慢 SQL 用只对该库生效的 `log_min_duration_statement` 捕获后单独 `EXPLAIN ANALYZE`。
- **环境注意**：实测期间本机有其他会话的 Playwright / next-server / ASR 任务，load average 26–45（12 核），同一条全表 `SUM`
  在 92 ms～1.8 s 间抖动。**绝对耗时被放大，只用于排序与前后对比**；数据库结论以 `EXPLAIN (ANALYZE, BUFFERS)` 为准。

## 实测结论（修复前）

| 场景 | 样本 | 首个反馈 p50 / p95 | 内容就绪 p50 / p95 / max | INP max |
| --- | ---: | --- | --- | ---: |
| 管理员侧边栏（冷） | 37 | 76 / 209 ms | 1.1 s / 3.0 s / 12.8 s | 88 ms |
| 管理员侧边栏（热） | 37 | 56 / 242 ms | 0.39 s / 2.0 s / 10.8 s | 24 ms |
| 管理员页内切换 | 26 | 281 ms / 9.8 s | 0.5 s / 9.8 s / 11.5 s | 192 ms |
| 管理员客户端 tab/展开 | 68 | 79 ms | 0.13 s | 72 ms |
| 销售侧边栏 / 页内切换 | 5 / 5 | 60 / 82 ms | 1.1 s / 0.7 s | 16 ms |
| 师傅端（375 宽、4× CPU） | 7 页首载 | TTFB 11–57 ms | load 88–180 ms（`/worker/orders` 795 ms） | — |

- **点击响应本身不卡**：INP 全部 ≤ 192 ms，侧边栏点击 76 ms 内就有反馈；首载 JS gzip 管理端中位 365 KB、销售 414 KB、师傅 228 KB。
- **慢在服务端数据量**：离群点全部是随历史线性增长的查询——`/owner/agent-bills` 冷 12.8 s / 热 7.0 s（该分组刻意无骨架，整页像冻住）、
  `/orders` 默认待办队列 9–11 s（骨架 70 ms 出现后长时间等待）。

## 已修复（6 个提交）

| 提交 | 问题 | 证据 |
| --- | --- | --- |
| `f13b2e24` fix(master-data) | **缺陷**：7 个启用/停用按钮（账号、用料清单、工艺、物料、客户/供应商、分类、产品）成功后回执说反——停用账号提示「账号已激活」。成功 action 的 revalidate 让同一响应带回翻转后的 `isActive`，组件不重挂、成功结果仍在，标题按已翻转的 prop 推导。改为把提交的目标值存进 action state。 | 新回归测试旧实现 21/21 失败、新实现 26/26 通过；生产构建真实浏览器：停用→「账号已停用」、激活→「账号已激活」，反向文案 0 处 |
| `ba23a73e` fix(ui) | DECISIONS 2026-08-27 已拍板移除的「成功后重复 `router.refresh()`」回潮 26 处：星标、工单详情裁决 / 批量 / 核价 / 发货 / 改单审批、编辑保存（push 后又 refresh）、外协、通知渠道、CDR 撤销 / 重生成、价目簿发布 / 取消 / 改期 / 规则、导出受理。每次点击多一次整页渲染，并在路由队列里挡住下一次点击。 | Next `revalidate.js:221`：任何 `revalidatePath` 都让 action 响应带回当前页新渲染；逐处核对 action 该分支先 revalidate。保留 partial_failure / 结果未知 / 轮询 / 手动刷新 5 类。实测星标：1 个 action、0 次额外 RSC（原 2 次整页渲染） |
| `464b4968` fix(cdr) | CDR 下载包生成后固定整页刷新 40 次 / 2 分钟：轮询条件是 `useActionState` 的 `queued`，包 READY 后仍为 `queued`。改由「最近下载包」区按 PENDING 签名轮询，签名空即停、同批上限 120 秒；候选区/历史区隔离契约不变。 | Browser Mode 真实计时器测试 4/4 |
| `e58f0f64` fix(nav) | 侧边栏悬停 `prefetch={true}` 对动态路由是整页渲染（全部查询），结果缓存 5 分钟，之后点击不发请求——几分钟后点「工单」看到的是悬停时的队列。改为文档推荐的 `prefetch={intent ? null : false}`：只预取到 `loading.tsx`，点击即出骨架并取新数据。 | 修复前：悬停后点击 0 次请求；修复后：悬停只发 prefetch，点击 1 次 RSC |
| `3a497db4` fix(db) | 两条逐行 `EXISTS` 在 3 万工单下退化为逐行整表扫描：产品目录「被多少工单引用」（`lib/product.ts`）与代理商账单代理人筛选（`lib/agent-monthly-billing/query.ts`）。新增 `OrderItem(productId, orderId)`、`Order(submitterId, settlementType)`。 | 20 行产品计数 385 ms → 0.9 ms；代理人筛选 4.9 s → 0.5 ms；`/owner/agent-bills` 热加载 7.0 s → ~130 ms |
| `3495f649` fix(ops) | `load-test-seed.mjs` 因 `OrderItem` 三个新增非空列失效（事务回滚、无写入）。 | 按 `information_schema` 核对其余表无缺列；本次用它生成代表数据 |

门禁：`pnpm lint`（2 条既有警告）、`typecheck`、`check:architecture`、`test:backup` 通过；全量单测 **8,100 通过 / 0 失败**（135 跳过均为
只在隔离 e2e 库运行的 postgres 用例与既有 `describe.skip`，另在新建隔离库 + `test:e2e:prepare` 上补跑这些 postgres 用例，全部通过）；
浏览器组件 **990/990**；生产构建重跑上述真实浏览器核对。

## 未修复：按收益排序，需要业主拍板或先在安静机器上实测

业主 09-21 口径是「实测收益不明显就停下说明」。以下项目要么改动面大（队列语义、详情页结构），要么本机负载下无法给出干净数字，
故只记录证据与建议，不在本批动手。

1. **P1 `/orders` 默认待办队列的汇总随历史线性变慢**（`lib/order/admin-workspace.ts:528-583`）。待办队列 where 是含「待审改单」
   相关 `EXISTS`（不带状态条件）的 OR，任何索引都用不上；`orderItem.aggregate` 的计划是扫全部 9 万款式再逐条回表过滤
   （单独执行 9 s，本机负载放大），5 个 count + 3 个 sum 在 repeatable-read 事务内串行重复同一过滤。建议：像
   `loadCurrentPrintOrderIds` 一样先解析小集合（待审改单 / 人工核价 / 待定金额的 orderId），把 where 变成纯列谓词 + 小 id 列表；
   先在接近生产的机器上 `EXPLAIN ANALYZE` 定量。今天生产库 0 工单，按每天 30 单约 3 年到 3 万。
2. **P2 管理员手机端点侧栏无任何反馈**：`AppSidebar` 点击即关 Sheet，唯一的 pending 指示在已关闭的 Sheet 里，触屏又没有悬停预取；
   建议 Sheet 在 pathname 变化后再关，或在页头加细进度条（交互方案，需业主确认）。
3. **P2 工单详情 `/orders/[id]` 约 110–125 条查询、约 10 段串行**，无 Suspense 分段（`app/(admin)/orders/[id]/page.tsx:183-380`，
   `getAdminOrderDetailPresentation` 重读整单）。建议把 191–193 行三处独立读取并入并行批、生产/工资面板包 Suspense、复用
   `getOrderDetail` 结果；先按 09-21 的埋点方式量化。
4. **P2 客户端输入卡顿（未实测）**：建单表单 `OrderForm.tsx:734` `useWatch({ control })` 订阅全部字段，每次按键重渲约 2,700 行组件
   并做两次整表 `JSON.stringify`；改单/编辑器每次按键对每款遍历「产品 × 规格」并以抛异常过滤
   （`change-request-catalog-identity.ts:193-230`）。需在低端安卓上量 INP 后再改。
5. **P2 师傅端设计图用原图做缩略**：`DesignImageGallery.tsx:42-46` 无 `loading="lazy"`，签名未带已有的
   `DESIGN_THUMBNAIL_PROCESS`；上传上限 10 MiB。本地无真实 OSS，未能量化。
6. **P2 其他缺索引 / 无上限查询（本次代表数据里这些表为空，未量化）**：`/foreman/outsource` 全量外协单无分页、无 `createdAt` 索引；
   计件结算页 `ProductionReport.reportedAt`、`ProductionWage(workDate, settlementId)`、`ProductionJob.status` 前导索引缺失；
   `/owner/background-jobs` 按 `createdAt` 排序无索引且账本无保留期；客户计价每切一次 section 按 100 组分页在并行事务里重读整本规则。
7. **P2 导出轮询在单次渲染 > 3 秒时会叠加**（`OrderExportControls.tsx:79-91` `setInterval(router.refresh, 3000)`）；导出结束即停，
   根因是第 1 项。可改为上一次刷新完成后再排下一次。
8. **P2（中等把握）师傅「完成生产」按天全局排他 advisory lock**（`lib/production/completion-registration.ts:39`）：下班集中登记时
   所有师傅串行；报工可改共享锁、结算批保留排他——涉及并发语义，需确认没有依赖「两个报工互斥」的地方。
9. **P3**：列表分页 / 排序 / 搜索提交无 pending 提示（`AdminDataTable`、各 `next/form` 筛选）；`owner/rules`、`owner/salary`、
   师傅详情等无 `loading.tsx`；`sidebar_state` cookie 写了不读（每次整页进入侧栏重置展开）；详情页 `generateMetadata` 与页面重复读取
   未用 `cache()`；React Compiler 未启用；`/worker/orders` 精确 count 覆盖全部历史工单。

## 核对为「无问题」的部分

- 各 layout 只读 React `cache` 的会话，无角标 / 计数查询；布局在客户端导航时不重渲。
- 启停 / 加急 / 顺丰到付 / 后台任务按钮：pending 禁用、`aria-busy`、提交目标值（最后一次点击生效），无重复刷新。
- 师傅一键完成：一次往返、确认步骤、pending 禁用，服务端请求哈希重放 + revision 校验防重复登记。
- 主题切换纯客户端；recharts 走 `next/dynamic`；qrcode 不进客户端；客户端模块无任何 Prisma / `lib/db` 依赖。
- `/orders` 队列切换（09-21 已验收）在 3 万工单下筛选队列 100–250 ms、反馈 50–100 ms。

## 环境与清理

隔离库 `erp_e2e_perf_20261001`（压测数据）、`erp_test_perf_unit_1001`（单测）、`erp_e2e_perf_pg_1001`（postgres 用例）在收尾时删除；
临时探针脚本只在会话 scratchpad，未入库；未推送、未部署，生产与开发库未触碰。
