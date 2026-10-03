# Analytics 实施与验收记录

日期：2026-10-03。开始 HEAD：`2d49dd9c`，开始时工作区无未提交修改。候选为该 HEAD 加本任务工作区增量；提交前按项目技能完成验证。功能实现已冻结，审查期间只更新本记录，不修改源码或测试。

候选源码/测试 SHA-256 清单总指纹：`574a4f7866040b762cfac436d28e3a3fa53e5d30084f6b6c0ca4cba2c5920e7d`。清单见文末；原始 JSON 在 `/tmp/erp-analytics-20261003/candidate-final.json`。这是 CONTRIBUTING 允许的「候选 SHA 或工作区增量」证据；不提前提交未经审查通过的实现。提交后以本任务 commit 作为最终索引。

## 范围与不变量

- `/owner/analytics` 五视图、日期/维度筛选、URL 恢复、25 行明细分页、来源链接、当前筛选全部 CSV。
- 原工作台入口、侧栏、权限、工单/账单写流程不变；未改 schema、迁移、全局样式或依赖。
- 页面/导出回库核对管理员身份；数据查询再次校验角色。只读 RepeatableRead 事务，8 秒 SQL 与 15 秒事务超时。
- Decimal 金额、入袋包含关系、旧任务/报工/工资互斥、关联重做、已出账分项、取消成本和缺失金额状态保留；调整单独列示，有调整或取消的工单不报告可核对差额。
- 唯一必要的共享财务修复：`lib/bill/costing.ts` 把已有非空完工工资（包括零金额）视为自动计件依据，避免账单页与分析页漏计或口径不同。先新增用例实测 2 项失败，再修复并回归。未知工资仍保留历史手工依据；未改记账、计价或工资写入。
- 管理外壳仅增加 ADMIN 在 analytics 路径的 noscript 导出表单与内容槽标记。其他路径该组件返回空；禁用脚本时原生 GET 导出可用，避免流式页面永久占位。外壳导航浏览器回归覆盖全部角色。
- 共享趋势图只新增可选 label（默认完工不变）并修正跨年月标签，旧日粒度显示不变。组件浏览器测试覆盖默认完工、提交切换和跨年月。
- 参考为用户指定历史订单项目的信息层级与钻取原则；无新视觉资产或第三方图表库。未定位来源的平台专属维度继续按原计划不伪造。

## Claude 第一轮处理

原文及实际模型见 [Claude 审查](2026-10-03-analytics-claude-review.md)。6.9 分未放行。

| 发现 | 处理 |
|---|---|
| P1 证据漂移 | 冻结源码指纹，重新运行完整批次；复审期间不再修改源码 |
| P1 长范围限制 | 总览指标/排行/分布改为 SQL 聚合，无明细上限；明细与 CSV 设经实测的 30,000 源记录上限，超限明确缩小范围 |
| P2 抵扣/补收遗漏 | 读取原账单项 credits，独立显示请求、已入账及待入账；成本明细显示调整并排除相应差额 |
| P2 成本两处不一致 | 修复共享 costing，删除 analytics 特判，覆盖纯工资/零工资/未知工资/历史手工项 |
| P2 性能缺证据 | 独立 3 万单库执行真实查询与 EXPLAIN ANALYZE，见下表 |
| P3 取消、空值、预估、跨年月、工艺、停用物料、aria/标题 | 分别显示已知取消结算、不计差额；文本空值显示未填写；预估费用独立标签；月份保留年份；合并主工艺与字典工艺去重；同名的三类主工艺及目录别名在分组、明细、数据库筛选、钻取、页面选项、导出中按同一工艺处理（沿用工单详情按名称去重的展示原则），补齐仅有目录工艺的款式；标出停用物料余额；补 group role 并统一标题 |

## 第二轮 Claude 与最终增量

Claude 第二轮 **9.2/10，PASS**，无剩余 P0/P1/P2，原文见审查记录。对应指纹 `760c91bb9313b3a864a1b98d49c108449173369716e566e9d4818fdb6c8cbe0e`。随后按其提交前建议仅修两项 P3：

1. 工艺选项查询移到 `getAnalyticsCrafts(actor)`，页面只组合数据；继续通过同一个有角色校验的只读事务，增加权限/查询契约测试。
2. 已出账但缺失或不合法分项的旧账单，在收费构成显示 **已出账未分解** 的已知整单金额，同时保留分项待核对提示；不回退到当前收费。缺失与损坏两种分项均覆盖。

本轮只改六个源/测试文件，其余文件与第二轮指纹相同：analytics page、owner-analytics test、queries、queries test、reports、analytics test。定向测试 44 项通过；同一冻结候选的全量单测、E2E、九视口、工作台代表视口及性能复测全部完成，结果见下文。Claude 最终增量复核 **9.3/10，PASS**，无未处理 P0/P1/P2，原文已追加至审查记录。评审完成后再次逐文件重算指纹，34 个源码/测试文件均与冻结候选一致。

### 非阻断后续项（Claude 第二、三轮 P3，负责人均为项目维护者）

| 跟进编号 | 保留理由/实际限制 | 后续工作 |
|---|---|---|
| ANALYTICS-P3-2 | 无脚本是明确的简化 CSV 表单，仅视图/日期/关键词，未复原当前 URL 的全部维度；无效请求返回既有 JSON 错误，浏览器可返回重填。正常页面筛选/恢复/错误反馈完整 | 扩展降级表单维度及可读错误返回；须避免重新落入无脚本 Suspense 占位 |
| ANALYTICS-P3-3 | 总览页面无明细上限；CSV 明确按全部明细路径导出，有 30,000 条上限，超限返回提示且不截断。排序并列不影响金额 | 统一聚合来源并增加页面/CSV 聚合等价测试，评估大范围摘要导出 |
| ANALYTICS-P3-5 | 停用物料余额已在说明中标注，缺料指标明确为低于安全库存，不包含手动缺料标记；采购/收货/库存三组用于同页指标。当前性能样本不覆盖库存 | 补逐行停用/手动缺料区分及库存规模性能测试，评估明细按需加载 |
| ANALYTICS-P3-6 | 成本 SQL 已逐行与账单口径独立复核、mock/3 万单真实查询及账单生命周期通过；尚无真实多种成本同单与账单逐项对照测试 | 增加 PostgreSQL 多来源成本对照 fixture |
| ANALYTICS-P3-7 | 当前权限字典 report:all 仅 ADMIN，layout 降级入口角色条件等价；真正查询仍执行服务端权限检查 | 后续调整权限字典时同步改为 hasPermission 并保留角色回归 |

第三轮额外记录，负责人同为项目维护者：

- **ANALYTICS-P3-8**：选项与报表的工艺字典在不同只读事务中读取，字典恰好并发变动时可能短暂不一致；后续评估同请求共享字典快照。单次报表/CSV 内部仍在同一事务。
- **ANALYTICS-P3-9**：缺少正常/未分解混合账单、DRAFT 回退、零快照金额三项组合测试；现有实现已由 Claude 核对，缺失/损坏分项回归通过，后续补齐组合覆盖。
- **ANALYTICS-P3-10**：`getAnalyticsSales` 的选项查询有角色校验但直接使用 `db.user.findMany`，未进入报表的只读事务包装；它没有写操作，后续统一只读包装。

这些项不改变本次通过门禁或阻断核心任务；不把非阻断意见写成已修复。

## 测试环境与性能

Node 24、Next 16.3.6、PostgreSQL 16、Chromium 桌面模拟。业务回归库 `erp_e2e_analytics_20261003`，性能库 `erp_e2e_analytics_perf_20261003`，均本任务新建、与普通 DATABASE_URL 不同，无生产数据。E2E 为 next dev，通知/CDR mock、后台任务 inline；不代表生产通知、worker、发布构建或真机验证。

性能样本：30,000 张非取消工单、30,000 条款式、30,000 条材料成本，覆盖今年范围，按测试销售筛选；款式有工艺/纸张/规格。单用户、未包含 3 万个不同客户或大量账单调整，是边界规模读路径验证，不是生产容量承诺。

| 场景 | 端到端读取/聚合 | SELECT 数 | 报表数据序列化字节 |
|---|---:|---:|---:|
| overview | 335 ms | 3 | 605 |
| trend | 37 ms | 1 | 475 |
| orders | 808 ms | 12 | 6746 |
| costs | 1100 ms | 15 | 12899 |
| structure | 668 ms | 13 | 6046 |
| orders-page-100 | 672 ms | 12 | 6794 |
| orders-export | 666 ms | 12 | 6339288 |

最终冻结候选复测（与另一隔离库的 E2E 同机并行，包含首次连接开销）全部通过：overview 4851 ms、trend 49 ms、orders 1561 ms、costs 1871 ms、structure 917 ms、orders-page-100 1278 ms、orders-export 1417 ms。查询次数和返回规模与上表一致，执行计划均成功；同机争用会使首次端到端耗时明显上升，上表不是延迟保证。最终原始结果覆盖保存于 performance.json，首轮计时以上表保留。命令：`DATABASE_URL=<独立性能库> node --conditions=react-server --import tsx /tmp/erp-analytics-20261003/perf.mts`。

第二轮审查候选在业务/视觉批次结束后复测：overview 364 ms、trend 35 ms、orders 1072 ms、costs 1144 ms、structure 627 ms、structure-craft-filter 666 ms、orders-page-100 670 ms、orders-export 711 ms。最后两项 P3 修复后，最终冻结候选再次顺序执行完整业务/视觉批次及性能测试：overview **423 ms**、trend **33 ms**、orders **809 ms**、costs **1153 ms**、structure **602 ms**、structure-craft-filter **636 ms**、orders-page-100 **646 ms**、orders-export **655 ms**；8 场景全部成功，执行计划无错误，SELECT 数依次为 3/1/12/15/13/14/12/12。工艺筛选覆盖 3 万条主工艺记录；当前 performance.json 为最终这次结果，前几次计时在上文保留。

每个实际 SELECT/WITH 均另行执行 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`，无错误。总览只回聚合行；订单/成本/结构在只读事务中加载有上限的源数据并汇总，响应仅包含本页，翻页仍重读该范围，这是当前已测实现的明确成本。不存在逐工单循环发 SQL。原始读计划与计时保存在 `/tmp/erp-analytics-20261003/performance.json`；临时日志不保证长期保留，本表为持久摘要。

## 工程验证

本批次源码指纹固定如上。命令均在仓库根目录运行，原始日志 `/tmp/erp-analytics-20261003/*-final.log`。

- 目标 5 文件测试：44 项通过（`target-final.log`）。
- `pnpm typecheck`：退出 0。
- `pnpm lint`：退出 0；0 error、2 条既存 Next 导航 warning（global-error、OrderCreatedSuccessView），UI 文案与 token 无新增违例。
- 隔离库环境变量 `DATABASE_URL`、`E2E_DATABASE_URL` 同指向测试库，并设置 `E2E_DATABASE_CONFIRM_DATABASE` 后，`pnpm exec vitest run --maxWorkers=2 --reporter=default --reporter=json --outputFile=/tmp/erp-analytics-20261003/unit-final.json`：778 文件通过、3 文件跳过；8,635 项通过、46 跳过、0 失败，101.95 秒。跳过包含 41 项旧账单用例以及有专门环境要求的导出快照 2、取消迁移 2、包装修复 1，不计为通过。
- `pnpm test:browser components/business/analytics/__tests__/AnalyticsTrend.browser.spec.tsx components/business/admin/__tests__/AdminShellNavigation.browser.spec.tsx`：2 文件、63 项通过；相关组件后续未修改，覆盖趋势切换/跨年月、管理外壳角色导航/键盘/主题/axe。
- `pnpm exec playwright test tests/e2e/analytics.spec.ts tests/e2e/owner-dashboard.spec.ts tests/e2e/bill-flow.spec.ts --project=chromium --workers=1`：10/10 通过，52.9 秒；覆盖 analytics 5 项、工作台连续导航 1 项、账单生命周期 4 项。
- `node --conditions=react-server --import tsx /tmp/erp-analytics-20261003/craft-alias.mts`：真实隔离 PostgreSQL 的主工艺/目录别名过滤、去重和全部 CSV 一致性通过（同一只读事务内比较）。
- `node /tmp/erp-analytics-20261003/keyboard.cjs`：390px 实际 Tab/Shift+Tab/Enter/Space、触控切换视图、方向键横滚通过；pageerror 为空，焦点环截图已复核。
- `pnpm exec playwright test tests/visual/admin-responsive.spec.ts --grep 'analytics five views' --project='admin-*' --workers=2`：9/9 通过，2.3 分钟。实际执行 320×568、375×667、390×844、393×852、430×932、768×1024、1024×768、1280×800、1920×1080；每视口 7 个正常分析页面 + 1 个无脚本降级状态 × 明暗两主题，共 144 个页面/主题组合。
- `pnpm exec playwright test tests/visual/admin-responsive.spec.ts --grep 'owner dashboard focused' --project=admin-320x568 --project=admin-1280x800 --workers=2`：2/2 通过，25.5 秒，覆盖原工作台、analytics 和四类关注事项，6 路由 × 2 主题 × 2 视口。

过程中发现的本次回归均修复后复跑：原生降级表单 label 精确定位失败；手写标题/按钮违反共享组件规范；工艺明细只显示主工艺。保留全部既有断言，补齐多工艺去重与明细一致性断言。未修改任何测试基线或门禁阈值。

日志边界：最终 E2E 的账单请求重放阶段有 Next dev 的 `Cannot write/close a CLOSED writable stream` 日志（e2e-final.log 140–148 行附近）。该用例在读取状态后主动 `replay.dispose()` 并刷新页面；对应请求均为 200，账单回执/幂等/历史成员断言及该用例自身 `pageErrors=[]` 均通过。按已关闭测试响应的开发流诊断记录，未宣称整份服务端日志无错误；analytics 两个交互用例和最终视觉批次无 pageerror/500/水合错误。未进行该开发流日志的生产模式复现。

## Design QA（按 1–10 顺序复核）

审查者为 Codex 代理，非真人用户测试。按下列 1–10 顺序完成最终复核；截图在 `test-results/admin-ui-baseline-candidates/<实际视口>/analytics-<view>-<theme>.png`，均为本次运行输出，未更新已接受的视觉基线。截图、trace 和临时日志不保证长期保留，本记录保留实际结果及复现命令。

| 顺序 | 结论 | 实际证据与边界 |
|---:|---|---|
| 1 视觉层级 | 通过 | 复核 1280 浅色总览及 320 首屏：页名、当前视图、时间/筛选、导出明确；先范围再指标/分类/明细。数据说明未隐藏。 |
| 2 排版与留白 | 通过 | 375 工艺、768 库存、1920 订单实屏检查；长中文/测试单号、多行与 25 行明细有局部横滚和分页。同名主工艺/目录工艺去重后复验，金额与数量使用现有 formatter/token。 |
| 3 色彩与对比度 | 通过 | 九视口明暗主题 axe 全通过；选中、错误、未知金额均有文字。复核暗色成本/工艺/库存及无脚本页；沿用共享按钮/焦点/图表颜色，无新增硬编码颜色。 |
| 4 组件一致性 | 通过 | PageHeader、Button、Input、NativeSelect、StatCard、Table、EmptyState、错误/加载组件均复用。原工作台/关注事项代表视口和 63 项导航/趋势浏览器组件测试通过。无新增通用组件，不要求新增 showcase。 |
| 5 交互反馈 | 通过 | E2E 触发筛选空态、刷新恢复、清除、视图切换、真实下载；503 错误后重试成功，导出 pending 按钮禁用。趋势按压状态/总数由组件浏览器测试与键盘实测核对。 |
| 6 动效 | 通过 | E2E 默认动效及 reduce 后切换成本，视觉门禁等待现有动画稳定；图表按默认/减少动效均可用。无新增装饰动效或弹层，操作不依赖动画结束。 |
| 7 响应式 | 通过 | 九视口每个视图顶部/明细页尾的溢出、裁切、触控尺寸门禁通过；320 无脚本 header 挤压已在原条件修复复验。表格键盘横滚实测，所有页面主体无横向溢出。安全区沿用共享外壳；未做真机刘海硬件验收。 |
| 8 功能质量 | 通过 | 10 项业务 E2E、44 项定向测试、8,635 项全量单测，含权限拒绝、无效日期恢复、原工作台和账单生命周期。390/1280 交互 pageerror 为空；401/400/注入的 503 为预期。分析只读；未新增数据库迁移。禁脚本原生 GET 下载成功，不留永久 loading。 |
| 9 可访问性 | 通过 | 九视口正常页面 axe，降级静态 DOM 的同门禁及布局一致性检查通过；真实 Tab/Shift+Tab/Enter/Space、触控、方向键横滚通过，焦点环实屏可见。390/1280 的 200% 缩放无溢出；标题、label、group、aria-current/pressed、pending/error 提示已核对。未声称屏幕阅读器真人测试。 |
| 10 原创性 | 通过 | 仅参考用户指定历史订单项目的信息层级和来源追溯；使用本仓库既有 Design System，没有新增外部资产、图片或依赖。 |

已处理本次可复现 P1/P2：长范围总览被截断、调整/工资成本口径、无脚本永久占位、无脚本窄屏顶栏裁切、表格焦点边框裁切及同名工艺重复。最终复验未发现范围内剩余阻断；Claude 最终真实评分 9.3/10，PASS。

视觉检查适配说明：最终候选在原候选上修复无脚本 header 挤压面包屑及表格焦点环被外框裁切，并重新执行完整批次。新增无脚本检查适配了浏览器执行限制。浏览器禁用脚本时不会执行 RAF/axe 的异步回调，因此早期检查等待失败，不计通过。最终在禁用脚本的原页面直接核对页面无横向溢出并截图；将实际渲染的 DOM（移除所有 script、展开 noscript）复制到检查页面，核对表单 x/y/宽/高与原页面相差不超过 1px，然后运行同一几何与 axe 门禁。这个 axe 结果是原生 DOM 的静态检查，不声称在禁用脚本上下文直接运行 axe；真实无脚本表单下载由 E2E 另行验证。测试工具与业务源码一起纳入最终指纹；不得把早期失败记为通过。

## 收尾

- 本地功能候选完成；没有 push、部署或宣称生产验收。
- 按项目技能仅暂存 34 个源码/测试文件及 5 份关联文档，未包含环境、数据库、生成物或测试输出；34 个本地 Markdown 链接存在，差异格式检查通过。
- 测试结束后移除本任务新建的 `.env.local`，恢复任务开始时的环境文件状态；保留隔离测试数据库用于复现，未操作其他开发服务。
- 本地提交主题：`refactor(analytics): 重构经营分析并统一筛选与导出`；提交标识通过 `git log` 查询，避免文档自引用。

## 候选文件指纹

```text
254d4800d20939784931614eed3ce19874d3e7ff7785e02982d260305b201869  app/(admin)/__tests__/owner-analytics.test.tsx
05c82bdab88b1e846c101521dc0630540d860255ba66b0106558a5fef3273600  app/(admin)/layout.tsx
e7b38548d3783bf521ea856361623895094fd8cc6f341455465f6991cb83d5a7  app/(admin)/owner/analytics/loading.tsx
0c855806209e57aab39f61a52b54f51d7895f12b3baf63085a98bc048d7e5af1  app/(admin)/owner/analytics/page.tsx
af39ea0e34cd7c22c737c6dace5ac6848a673257cf644a73e99c1063dcbfd8e2  app/__tests__/slow-loading-fallbacks.test.ts
f03eaafe983fcf0b29d79c36adf5b1b74e0f375de56c8642a04441d07681204d  app/api/owner/analytics/export/__tests__/handler.test.ts
3af2c4b50fcd01dd1611b6cf7c35697b3cc7e174c66256b0326241289e393695  app/api/owner/analytics/export/handler.ts
7037a5a3e8c44fa0886c97bcdd6dd161d491099c781db445462a0422d85b6965  app/api/owner/analytics/export/route.ts
fadeedd5af674d06dd188448f8af51660267f10ccea55bc8a69c2a7d4841fffb  components/business/analytics/AnalyticsFilters.tsx
07fc2c1deca93560b924229e8006fb3a22710fac6ad2fc31ca1e7e5410af730b  components/business/analytics/AnalyticsNoScript.tsx
c3faff8c570e8f690dee2cb329833ec91e56f2c34e534db5ff3dac792dbbabfd  components/business/analytics/AnalyticsPresentation.tsx
2c2d50d0c075e59f19c10ecf246da9dcd3fde8a1cf2415c06f80efce70c4285b  components/business/analytics/AnalyticsTrend.tsx
a156a56a72c670f624f62245efbc3ce0fba5d6a4acf8d8cb64cd275d4cda2615  components/business/analytics/__tests__/AnalyticsTrend.browser.spec.tsx
f20f899a1fa3febfabd4e00ef8a95d314de6ac6ffd1c70362d4612e943892e6a  components/business/dashboard/OwnerAnalytics.tsx
fb239915cfae4c2197b2435d4b4c7fb7847ed6db870d599a8444f27a462213f4  components/business/dashboard/ProductionTrendChart.tsx
9510df46e4b68089efe1aabc58530228683b8b0481eadb50f4e858ed9f347c27  lib/analytics/__tests__/analytics.test.ts
8d0efd0422ff940dbb08392eea4f7b09ad03ff742b6ff9d62a79f4e8ef0c5bf0  lib/analytics/__tests__/cost-inventory.test.ts
1c9345a37915d6838d9416eb03a07ce8af29f6316834fc76ecd5342fe94ab7cf  lib/analytics/__tests__/queries.test.ts
2a457100408f09feff524a075ca5ad257abd507168dd7dbbb0d46ccbc61a3b35  lib/analytics/costs.ts
da50810b130f11ad1c95951d77acf8c3400e6426258f5e5c36cf6ec2243e83bf  lib/analytics/crafts.ts
81b17b6540bfd604b18b0bb7d655faaec951663d4ed5ecd915fc1e0c4550290d  lib/analytics/export.ts
e1f940c249dcbd01728f22a695d61b89dc11b656538e0f31d91f6ce70bdcf208  lib/analytics/filters.ts
2bc27c82da01e0438517ee265197dd877b0771c20ed9af28d6aad656531aad20  lib/analytics/inventory.ts
2744d4ddebf894af0a103e6805b9b6fd73f7dbb6b9cf74a0af7ccf8d4683c57d  lib/analytics/overview.ts
b940fd2d5ed9095f28350e314be9396c36363df46f8fe1bbf2d29b784c4fad10  lib/analytics/queries.ts
6cbf5faafb5c1171669503d0a91e9fa10d10e2892ce7608b8c08f5d1333a2824  lib/analytics/reports.ts
18e7e0548c90cffcff35561cfaf04e4fe17c8a7073fd35213b8e31f4c99dfbb4  lib/analytics/service.ts
f18a4574dd70f8e8c97f223a85026abbaf96d18c70aa8a3f97df4d2640964c9e  lib/analytics/types.ts
dbc53da204f9701a84a60a04929662293cccf69f3a0cfe6812d650860a96721c  lib/analytics/views.ts
e08f2e7cdaa98228b574ebec223c7643c9cfc022ba1b8b993e57dfa4d433bf42  lib/bill/__tests__/costing.test.ts
1155b2cd2b65c8e1f575901c444e5e2921cf0c4bef3653e4871756650024b97f  lib/bill/costing.ts
cb623b148c2299c8a61ff2184f400479511aa3839bcab072ceb6660b6a25fea5  tests/e2e/_helpers.ts
2368aa98072d6baf2a6dc3b4db744f9efbc89ef93fddc61ad91ca0c07854b38e  tests/e2e/analytics.spec.ts
dbf512641230d3fd484709d6db3d68461d2a888ab90d7bd0d37075f90c57f7d9  tests/visual/admin-responsive.spec.ts
```
