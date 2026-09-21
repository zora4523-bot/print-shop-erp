# 旧产品代码清理与死代码增量门禁

日期：2026-09-21。基线：`57687109`，`codex/maindev`，开始时工作区干净。
本次按业主授权执行审查和有证据的清理；不把扫描候选等同于已证明无用的代码。

## 已删除的旧读路径

核对范围包括 actions、app 路由、components、hooks、lib、scripts、配置、部署脚本、Prisma schema、迁移与测试。
删除前除了精确符号搜索，还核对了现行页面的调用链、动态采集入口以及数据库关系。

| 已删除符号（均原位于 `lib/product.ts`） | 原消费方 | 现行业务入口 |
|---|---|---|
| `listProducts` | 仅本模块单测；旧决策记录曾提及 | [产品管理页面](../../components/business/rules/catalog/ProductCatalogPages.tsx) 调用 `listProductsPage`，保留服务端分页和过滤 |
| `listActiveProductOrderOptions` | 仅本模块单测 | [建单目录](../../lib/order/create-order-options.ts) 共用当前目录服务 |
| `listCurrentExternalSalesProductOrderOptions` | 仅本模块单测；按 BASE 规则的 Product ID 生成目录的旧方案 | 空白封按已发布正价和纸张/规格生成候选；非空白路线调用 `listExternalCreateOrderProductOptions` |
| `listProductOptions` | 无调用方 | [BOM 服务](../../lib/bom.ts) 有自己的产品选项查询，不调用该函数 |

同时删除两个专属类型、一个专属 select、无用 imports、8 条专门测试这些旧函数的单测与专属 mock。
未删除现行分页/筛选、产品写入、停用引用保护等测试。清理运行时代码约 169 行。

[兼容性采集器](../../scripts/lib/capture-paper-spec-compatibility.ts) 动态加载的是建单目录、报价服务及纸张目录模块，
没有按字符串调用上述四个导出。它们不是公开 HTTP API；未发现注册表、部署脚本或 SQL 消费这些符号。

## 明确保留的内容

| 内容 | 保留依据 |
|---|---|
| `Product`、`productId`、`ProductCategoryNode` 及对应历史数据 | 专版、彩印、BOM 与历史工单仍消费，不能把空白封解耦扩大成删除整个产品域 |
| `listExternalCreateOrderProductOptions` | 建单目录及[改单目录解析](../../lib/order/change-request.ts)实际调用；非空白合法产品缺价时转人工核价 |
| `/owner/rules/stock-skus` 列表、新建与详情路由 | 带权限检查的旧链接兼容跳转；详情还检查记录存在性，空白封转单价表，非空白转产品资料 |
| `next.config.ts` 旧产品重定向、面包屑、导航路径常量 | 旧深链兼容，当前独立“可建单产品组合”菜单已移除 |
| 已应用迁移、回填/预检/报价比较脚本 | 历史迁移不可改；部署记录中的生产版本尚未包含本轮空白封迁移，不能因开发库已升级而删发布所需工具 |
| 旧方案及决策的归档文档 | 历史审计证据；当前口径以[空白封管理文档](../空白封纸张规格管理-20260913.md)为准 |

2026-09-21 对 `localhost:5432/print_shop_erp` 执行只读、可重复读事务：
42 条 `BLANK_STOCK` 产品全部至少有一项关系引用，无零关系引用产品。
数据库元信息核对到 Product 的外键消费者为 `OrderItem`、`CustomerPriceRule`、`BillOfMaterial`、`PriceTier`。
证据 `/tmp/legacy-cleanup-db-readonly.json`。没有删除数据、修改价目或保存/发布草稿；没有连接正式库。
即使后续关系计数归零，仍需另核历史 JSON 快照和外部消费者，不能据此直接物理删除。

## 全仓扫描与新增候选门禁

扫描清理前：145 组 Knip、714 个 ts-prune、0 环。
清理后：144 组 Knip、711 个 ts-prune、0 环。两个工具重复报告同一符号，数字不可相加当作死代码数量。

[候选清单](../../config/dead-code-baseline.json)保存 1,089 个工具/文件/符号标识。
这是现存待核实候选的初始清单，并非逐项审批的删除列表。
增量门禁比较实际标识，不用总数阈值；源码位置变动不误报，同数量替换为新符号仍报错。
新候选阻断 CI；已消失条目也要求移除，避免豁免旧代码再次引入。循环依赖按有向环规范化。
命令不自动刷新基线，工具失败或基线错误会失败。当前 CI 配置已接入，远程 CI 尚未运行。

本轮另外抽查的代表性候选：

- `lib/warehouse.ts:listWarehouses` 有模块内调用，“unused export”不意味着整个函数无用。
- `lib/order.ts:listOrdersPage` 是导出层候选，底层查询仍被工单列表消费，不能删实现。
- `DeferredDashboardCharts.tsx` 同文件还有实际使用的图表导出，不能按文件名直接删除。
- `vitest.browser.config.ts` 的 `axe-core` 提示来自显式从 `@axe-core/playwright` 安装路径解析资源，实际浏览器检查在用，保留为工具候选。
- 工价发布兼容别名、动态加载、生产专用脚本、UI 原子件及其类型继续保留，后续需逐项沿消费者核实。

工具局限：测试入口会让“仅测试使用”的旧导出看似被引用，本次三个旧查询正是人工调用链审查发现；
模块内使用、约定入口和外部调用也不能靠静态扫描直接判断。
因此本次完成的是全仓候选盘点、旧产品域有证据清理及防新增门禁，并未宣称所有候选已逐个审完或所有历史代码已清空。

操作方法见[开发指南](../../DEVELOPMENT.md#死代码候选审查)。

## 验证

候选为上述基线加本次工作区增量。所有写入测试使用本次创建的
`erp_e2e_legacy_cleanup_1789925775141`，完整 160 条迁移、seed、E2E 目录/工价/包装准备通过。
日常开发库只读，生产未连接；现有 3000 开发服务保留。

- 产品与扫描器定向 Vitest：2 文件、80 项通过。新增 5 项门禁测试，覆盖真实报告写入、拒绝新增/过期豁免、位置漂移、循环、坏基线及异常格式。
- 全量 Vitest：685 文件通过、1 文件跳过；7,472 项通过、44 项沿用既有跳过。
  相对基线删去 8 条旧函数测试，增加 5 条门禁测试。覆盖率语句 85.92%、分支 79.99%、函数 91.72%、行 87.87%，门禁通过，未改阈值。
- 建单浏览器组件：3 文件、41 项通过。
- typecheck、架构、完整 lint 通过；lint 3 条既有警告，未新增违例。
- 完整扫描和 `--check` 通过；真实 CLI 负控临时移除一个已有候选登记，命令正确返回 1 并指出 `NEW`，随后原样恢复基线并确认 added/resolved 均为空。
- release 真实浏览器回归：8 文件、26 项通过、0 失败、0 跳过（4.1 分钟），含两端三路线具体金额/落库、人工改价、断网恢复、BOM 用料、停售后的历史重试/材料补核/取消并发、旧入口跳转，以及包装、表单视口和历史编辑器六视口明暗/axe 检查。完整 `next build` + `next start`，独立 `.next-release`、3200 端口；非 UI 改动，未另跑全站视觉套件。
- 首轮构建为避免与全量单测并行而主动中止，退出 130，不计通过；上条结果来自单测结束后重新完整构建。服务日志仍有上一轮已出现的 `The destination stream closed early` 提示，本轮所有场景通过；未通过屏蔽错误或修改断言处理。
- 已确认测试进程退出、测试库无连接，再删除本次创建的可丢弃库与连接信息临时文件。日常 3000 服务仍可访问；新增文档本地链接及 `git diff --check` 通过。

主要命令（数据库连接仅通过隔离环境注入）：

```sh
pnpm exec vitest run lib/__tests__/product.test.ts scripts/__tests__/dead-code-scan.test.ts
pnpm check:dead-code --check
pnpm exec vitest run --coverage
pnpm lint
pnpm typecheck
pnpm check:architecture
pnpm test:browser components/business/order/__tests__/OrderCreateReview.browser.spec.tsx \
  components/business/order/__tests__/OrderCreationWorkspace.browser.spec.tsx \
  components/business/order/__tests__/ExternalSalesOrderFormRail.browser.spec.tsx
pnpm exec playwright test --config=playwright.release.config.ts --workers=1 \
  tests/e2e/admin-create-pricing.spec.ts tests/e2e/admin-order-entry.spec.ts \
  tests/e2e/order-create.spec.ts tests/e2e/order-create-ui-parity.spec.ts \
  tests/e2e/order-entry-stability.spec.ts tests/e2e/order-packaging-types.spec.ts \
  tests/e2e/order-auto-pricing.spec.ts tests/e2e/blank-price-only.spec.ts
```

本机日志 `/tmp/legacy-cleanup-*.log`；扫描报告 `.review/dead.json`；浏览器报告 `.review/playwright-release.json`。
验证产物不提交。真实通知、OSS 上传及 durable worker 不在本轮范围；通知/CDR 使用 mock，后台任务使用 inline。
没有推送、部署或修改日常价目。

## PR #26 合并检查阻塞记录

2026-09-21，默认价格页面移除历史列表后，一条旧测试仍要求展示已取消记录；已按用户批准的新行为更新，继续验证计划改期和取消入口。后续 CI 完整单测及覆盖率通过，构建、浏览器组件、兼容性、开发场景和 durable 检查通过。

合并仍被死代码候选门禁阻塞。候选 dc016445 在 Linux 比 macOS 少报 38 个 ts-prune 候选；macOS 工作区及 git archive 干净检出均报告 711 个。精确平台基线尝试在第二次 Linux 出现其中 7 个条目，不能证明差异仅由平台决定。排除测试引用后的两轮本地扫描一致（1,039 个候选），但 Linux 仍不一致。发行包源码对比一致；调整大小写模型的对照实验也未证实根因。

两次扫描器/基线调整均已撤回，最终仍为本任务开始时的原始扫描器和基线；没有放宽新增/过期门禁、删除业务代码或以失败结果合并。只保留已验证的价格面板测试修正（4 项通过）。这些实验不应被视为已完成的 CI 修复。

证据：GitHub PR #26；Quality runs 35561864239、35562541032、35563160377；本地 `/tmp/pr26-static.log`、`/tmp/pr26-static2.log`、`/tmp/pr26-static3.log`、`/tmp/pr26-dead-local.log`、`/tmp/pr26-dead-clean.log`。需进一步定位 ts-prune 引用分析不稳定的原因，并在同一最终候选上完整通过 CI 后再合并。
