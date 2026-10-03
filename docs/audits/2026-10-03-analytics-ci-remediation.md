# Analytics 合并前 CI 整改

用户已明确授权提交远程仓库、合主分支并跑 CI。开始点 `5b28bd09`，工作区干净；分支 `codex/analytics-acceptance`，PR [#45](https://github.com/zora4523-bot/print-shop-erp/pull/45)。不执行生产部署。

## 首次远程失败

[Quality 37114287981](https://github.com/zora4523-bot/print-shop-erp/actions/runs/37114287981) 的 static job 在 `check:dead-code --check` 失败；之前的架构、备份测试、lint、typecheck 都通过。此前本地验收漏执行该库存检查，本次按真实 CI 补齐，不把首轮失败记为通过。

新增候选来自 analytics 重构留下的旧图表外壳及模块内部导出；`orderSelect satisfies Prisma.OrderSelect` 还被 ts-prune 拆出伪导出名。修复不改扫描脚本、不扩大豁免。

## 删除依据与边界

- 当前页面入口 `app/(admin)/owner/analytics/page.tsx` 使用 `OwnerAnalytics`，它直接组合 AnalyticsTrend / AnalyticsBars / AnalyticsReportContent，保留原图表的 data-slot 契约；工作台 `/owner` 仍只放摘要入口。路由没有继续消费旧 Deferred 外壳。
- 删除 `DeferredDashboardCharts.tsx`、`DashboardChartsContent.tsx`：前者的所有动态导入均指向后者，两者形成孤立的旧包装层调用链；新入口已替代这条链。项目 `private: true`，不是对外发布的组件包，无 package exports 或独立预览入口消费此 API；配置、脚本、注册引用、Prisma schema/迁移不依赖它们。
- 实际剩余消费方是业务文案源码测试读取旧文件，已改成检查当前 `OwnerAnalytics`，保留所有禁用文案断言；视觉测试只更新过时注释，真实图表的等待、overflow、touch、axe 断言未改。
- SalesRankingChart / CategoryDistributionChart 自身仍有测试消费，不删除组件；仅将失去外部消费者的 Props 类型改为内部类型。AnalyticsDataTable、cellText、orderSelect、salesGroups 同样仅去掉 export，函数体和调用不变。
- 基线仅移除两条已删除 Deferred 外壳的旧库存记录，没有添加新候选或降低门禁。历史文档描述的是当时实现，保留历史事实。
- 无 schema、迁移、依赖、全局样式、权限、金额、查询、可见流程变化；这是本次 analytics 合入所必需的 CI 修复。

## 本地验证

- `check:dead-code --check`：通过（最初另查出两个 Props 类型导出，收紧后完整重扫通过）。
- 相关 8 文件 / 68 项 Vitest：通过，含 analytics、dashboard、业务文案与加载态契约。
- 最终 `pnpm typecheck`：通过。
- 修改文件 ESLint：通过；架构检查：1214 模块、4972 依赖、24 项既存长函数债务。
- 差异检查与删除调用链复核通过。日志在 `/tmp/analytics-ci-*.log`；生成的 `.review` 报告不入库。
- 合并仍须等待修复提交对应的远程 CI；不能沿用旧 SHA 的成功 job 代替新提交的结果。

## 增量 Claude 复审

实际 Claude Code / `claude-opus-5-5`，186502ms，`is_error=false`。增量评分 **9.4/10 PASS**，无 P0/P1/P2。源码无必修项。新增整改文档明确纳入本任务提交。补跑完整 `pnpm lint`（含 ui-copy/ui-tokens），`/tmp/analytics-ci-full-lint.log` 明确 `exit_code=0`，仍有2条既存导航 warning。空 ESLint 日志和没有退出码的局限由此补齐；远程新 SHA CI 仍是合并门禁。

后续P3由 project-maintainers 跟进：仅测试消费的旧图表/查询模块、视觉加载态检查更精确的等待条件、业务文案契约覆盖面。当前不继续扩大删除或改变既定视觉断言。以下为完整审查原文。

# 增量对抗 review：PR #45 CI 死代码清理（基于 `5b28bd09`）

**源码评分：9.4 / 10 → PASS（> 9）**

有两点前提：一是新 SHA 的远程 CI 要全部跑绿；二是本地 lint 没有可用的证据，最终以远程 static job 为准。上一轮的 9.3 没有沿用，这次分数只针对这 10 个文件的补丁重新评估。

## P0 / P1 / P2
没有。

## 源码必修项
没有。

**合并前要满足的条件**（不是改代码）：
1. `/tmp/analytics-ci-lint.log` 是空文件，不能当作 lint 通过的证据。完整的 `pnpm lint` 还包括 ui-copy 和 ui-tokens 两项检查，而整改文档里写的是"修改文件 ESLint 通过"，覆盖面更窄。我核对过：ui-tokens 基线里没有指向已删文件的条目，被改的 `SalesRankingChart.tsx` 行数也没变，所以预期不会失败，但结果以远程 static job 为准。
2. 整改记录 `docs/audits/2026-10-03-analytics-ci-remediation.md` 不在这 10 个文件里，看起来是新加的未跟踪文件。如果要入库，请按路径单独 `git add`，不要用 `-A`。
3. 必须等修复提交本身的远程 CI 跑完：static、unit、browser、E2E、两个视口都要绿，不能用旧 SHA 的结果代替。如果 main 已经前进，merge ref 可能带进新的候选，需要重新看一遍。

## 四项声明的独立核对
我没有只凭 grep 无命中就认可删除，下面每项都有别的依据。

**1. 删除两个旧外壳：成立**
- 有独立工具佐证：远程 CI 的 knip 本身就把这两个文件都报成了未使用的 `files`（static 日志第 498–499 行）。这是 knip 对整个依赖图的判断，不是文本搜索。
- 架构检查的模块数从 1216 降到 1214，正好对应删掉的两个文件，说明架构日志是在打补丁之后跑的。
- 补丁里能看到原来的动态 import 只有 `import('./DashboardChartsContent')`，确实是两个文件之间的闭环。真实入口是 `app/(admin)/owner/analytics/page.tsx:6,33` 里的 `OwnerAnalytics`。
- 除了 docs，整个仓库都没有引用它们，包括 `.github/`、`config/`、`scripts/`、两份基线，也没有 `vi.mock` 路径字符串引用。
- data-slot 契约还在：`dashboard-chart-deferred` 和三个 `-card` 都由 `OwnerAnalytics.tsx:38-45` 输出，e2e 和视觉测试的选择器仍然能匹配。
- `owner-dashboard.spec.ts:49` 断言 `/owner` 页面上 `dashboard-charts-deferred` 的数量为 0。这个 slot 只在 `/owner/analytics` 上渲染，两者一致。
- 文案测试改指 `OwnerAnalytics`，断言强度没有下降：被删掉的旧文件本来也不含那两条被禁止的字符串。

**2. 四个函数/常量只去掉 export：成立**
- 补丁里函数体没有任何改动。
- 调用都在本模块内：`reports.ts:83`，`queries.ts:53,71`，`AnalyticsPresentation.tsx:18,27,36-37`。
- 没有任何测试 import 它们。knip 把测试文件当作入口，如果有测试在用，就不会报出来。
- ts-prune 报的 `OrderSelect`、`Prisma`、`satisfies` 是它把 `export const … satisfies Prisma.OrderSelect` 拆错产生的假名字，去掉 export 后一起消失。
- 导出的类型 `AnalyticsOrder` 通过 `typeof orderSelect` 引用一个未导出的常量。在当前 tsconfig 下（只有 `isolatedModules`，不生成声明文件）这是合法的。

**3. 两个 Props 类型改为内部类型：成立**
现在只在各自文件内使用。

**4. 死代码基线：成立**
- 只删了两行：一条是 CI 报为 RESOLVED 的 knip 条目，另一条是同一个导出在 ts-prune 下的对应条目，文件删掉后它也必然失效。
- 没有新增例外。`compareDeadCodeBaseline` 对新增和失效都会直接报错，扫描脚本也没改，所以这次修改不可能降低门禁。
- 本地 `dead-final.log` 里出现了 "dead-code scan wrote…"。脚本只有在 `--check` 通过后才会打印这句（`scripts/dead-code-scan.mjs:222-229`），所以它算有效的通过证据。
- `typecheck-final.log` 的内容和 tsc 成功时一样（成功时不输出），但日志里没有退出码。

## 剩余 P3（不阻塞，不要求在本 PR 处理）
1. **还留下几个只有测试在用的旧图表模块。** `SalesRankingChart.tsx`、`CategoryDistributionChart.tsx`、`lib/dashboard/owner-charts.ts` 现在都没有生产代码在用，只剩各自的测试。门禁没报它们，应该是因为 browser spec 和单测被当成了入口。这是 `2850f39e` 重构留下的，适合以后单独开 PR 清理，同时清掉 ui-tokens 基线里那 3 条和 owner-charts 的 3 条 ts-prune 库存。`ProductionTrendChart` 还被 `AnalyticsTrend` 用着，不在其列。
2. **视觉测试新注释说得比代码保证的多。** `admin-responsive.spec.ts:810-811` 写的是"避免把加载占位当成图表"，但：
   - 第 820 行检查的 `dashboard-chart-placeholder` 只在被删的文件里出现过，这条断言现在永远成立。这在 `5b28bd09` 之前就是这样。
   - 趋势卡片内部还有 `AnalyticsTrend` 动态加载时显示的骨架（`data-slot="section-loading"`），卡片可见不代表图表已经渲染出来。

   建议下一轮把注释写得保守一些，或者把那条断言改成检查 `section-loading`。本 PR 按你的约束保持断言不变是可以的。
3. **文案测试只盯一个文件。** 测试名还叫 "Dashboard"，而且只检查 `OwnerAnalytics.tsx`；概览里实际可见的文案还分布在 `AnalyticsPresentation.tsx` 和 `lib/analytics/overview.ts`。断言强度和以前一样，只是覆盖面偏窄。
4. **一份 docs 还提到已删文件。** `docs/UI迁移清单.md:155` 提到 `DeferredDashboardCharts`，属于历史完成记录，按约定不改写。
