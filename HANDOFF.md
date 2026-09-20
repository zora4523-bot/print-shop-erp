# 会话交接

## 当前生产状态（2026-09-19 更新）

生产已运行 `09f1a1ca`（`main`，PR #20 + PR #23），158 条迁移；2026-09-19 17:25–17:29 切换，停机约 4 分 40 秒，上线后检查全部通过。报价第 8 版与统一烫金工价第 1 版不变，包装工价仍暂缓；OSS 双仓库备份正常（切换前手动 full：repo1 `20260919-172512F`、repo2 `20260919-172531F`）；企业微信 `CONNECTED`。正式库仍只有 1 个管理员 + 3 个销售账号，工单 / 账单 / 报工为空。详见 [发布记录](docs/audits/2026-09-19-production-release-09f1a1ca.md)；上一次见 [09-17 发布](docs/audits/2026-09-17-production-application-release.md)。

发布方式（两次都一样，**不要用 `deploy/update.sh`**——生产目录不是 `main` 分支检出，且应用机 1.6 GiB 内存扛不住构建）：本机 Docker 构建 linux/amd64 运行包 → 上传 + git bundle 建候选目录 → 正式库副本演练迁移 + 影子进程冒烟 → 停写、逻辑备份 + 两份 pgBackRest full + 门禁 → `cutover-app.sh` → `APP_VERSION=<sha> pm2 restart … --update-env`（PM2 不会自动带上新版本号）→ `post-cutover-check.cjs` + `deploy-smoke`。脚本在服务器 `/root/erp-release-20260919/`。应用机 `47.110.247.150`、数据库主机 `120.26.184.160` 均已可用开发机密钥登录。Claude Code 做生产 SSH 需要业主在权限设置里放行，聊天里的授权不够。

未验收（不得写成已验收）：登录后的各角色页面逐页检查、真实写入、实体手机扫码、企业微信真实消息实收；Sentry 未配置。

> **每次新对话开始前，先读这份文件。** 它记录了上次会话停在哪、下次该接着做什么。
>
> 本文件每次 session 结束前**整体重写**（除"历史"小节是追加式时间线）。

---

## 当前任务

**2026-09-20：纸张、规格缩小方案五批次及本地 S10 验收已完成；验收修正提交 `18551e8c`。未推送、未部署。**

- 用户明确要求开始测试验证。本轮从 `cdfe6d66` 干净工作区开始，沿用 `codex/maindev`。前五批实现为 `7a81c801`、`30b813ca`、`f69fe343`、`9e05a4ee`、`804438af`；本轮只修测试准备并记录真实结果，未改业务代码、公式、权限、历史快照、schema、迁移或 DECISIONS。方案偏离无。
- 创建本机一次性库 `erp_e2e_paper_1789915500470` / `erp_e2e_paper_1789915668619`，158 条迁移、seed、`test:e2e:prepare` 全部成功。使用 `playwright.release.config.ts` 的 `.next-release` / 3200 服务；没有连接写入开发库或操作 3000。完成后两个自建库已删除、连接信息临时文件已清理，3200 服务已退出，3000 原服务仍在运行。
- 真实 E2E 三文件：`paper-specifications.spec.ts`、`blank-paper-pricing.spec.ts`、`master-data-flow.spec.ts`，最终 **13/0/0（1.9 分钟）**。覆盖真实纸张/规格操作、价目发布及建单、历史金额、三类异常、无外键/重复/长编码守卫，并包括录价页面六视口明暗、overflow、axe。合成图片上传沿用旧用例中断 PUT + 数据库图纸夹具，不代表 OSS 上传通过；未更新截图基线。
- 首轮 8 通过/5 失败，第二轮 10 通过/3 失败，均为测试准备问题：旧录价 E2E 的规格先于纸张/克重导致禁用；新真实报价夹具缺发货分配；响应式用例遗留草稿阻挡后续发布。修复为正确选择顺序、完整 2000 件分配、finally 通过正式放弃服务清理自建草稿。没有放宽断言或业务校验；修正后完整重跑通过。
- **前后真实采集已通过**：[比较工具](scripts/maintenance/compare-paper-specs.ts) 对已有历史工作树 `6e1f9715` 与当前业务源码 `cdfe6d66`，同一隔离库、固定 `2026-09-20T14:51:36.607Z` 采集。历史树比实施起点早，但静态追踪 192 个本地依赖后，已跟踪变更仅涉及报价服务文件；实际调用的共享报价函数和异常类声明文本与 `09dcb022` 一致，差异在未调用内部预览及类型/辅助函数，schema 无变化。未修改该历史树或复制仓库。
- 比较结果 `equal=true, differences=[]`，退出码0：65个产品、40个纸张分组及禁选状态一致；6例覆盖空白封/专版/彩印标准报价、缺价、零价、四位小数。全部规格 CATALOG，零价0.0000、四位价0.1234、缺价人工原因保持一致，完整报价分项/小计/展示均一致。摘要和解释见 [实际验收记录](docs/空白封纸张规格管理-20260913.md)。本地 `/tmp/paper-acceptance-{before,after,cases}.json`，不提交采集数据。
- 门禁：架构/typecheck/lint通过（lint 3条既有警告），工具17/0/0、指定契约31/0/0、备份23/0/0；离线全量647文件7323通过/0失败/43跳过，另排除28个postgres文件与真实会话测试。真实E2E通过不表示被排除的单测也已运行。日志 `/tmp/paper-acceptance-{e2e-3,compare,architecture,types,lint,tools,contracts,backup,offline}.log`。构建有2条既有动态文件追踪警告，无构建失败。
- 本期实现与本地验收已闭环，不再等待隔离库配置。若后续安排发布，正式库仍须重新只读预检；开发库当时25个启用空白封同节点、3组重复纸张身份未修复等历史结果不能代替正式库。专版默认准入、历史重算状态待确认项维持现状；下架/不适用、120g收尾、彩印启用均不在本期，无新增业务待拍板。

**2026-09-19（晚）：CI 提速两步。业主目标「等待时间优先」，全绿等待 61.4 → 24.9（第一步）→ 9.1 分钟（第二步）。**
- 第一步 PR #24 已合入 `main`（`3cbe6abf`）：`static` / `unit` 拆出先跑、各套件独立作业、**PR 两视口（375×667、1280×800）/ main 六视口**（CLAUDE.md §8.2 已同步）、`push: main` 只跑 `static` + `viewports-main`、纯文档改动不触发、`print-darwin` 拆成带路径过滤的独立 workflow、CI trace 改 `on-first-retry`、`.review/` 每次传而报告只在失败时传、浏览器缓存按需装。`main` 首次 push 运行 `static` 与六视口门禁已通过。
- 第二步 PR #25：共享一次 release 构建 + E2E 六分片 + browser 组件两片，全绿 9.1 分钟（run 35447718850），分钟数合计与改动前持平。**踩坑**：共享构建必须 tar 传，`upload-artifact` 丢符号链接 → `sharp` 找不到 `detect-libc` → 症状是「提交后工单停在 DRAFT」；已在 `e2e-preflight` 加检查。详见 DECISIONS 2026-09-19 两条。
- 注意：当天 Actions 预算被打满过一次（job 0 分钟失败、注解「an Actions budget is preventing further use」），业主已提高。推 workflow 文件需要 `gh` token 带 `workflow` scope（已补）。
- 余量小：关键路径 = `build` 2.4 + 最长分片 6.6。若常态超过 10 分钟，把 chromium 拆四片；`compat` 也可以改成复用共享构建（只省计费分钟）。

**2026-09-19：grok 对抗审查 PR #20 / #21 / #22 全量 diff → 4 个修复提交（`c9a54cbb`、`b8e4ebc0`、`ad2a7164`、`1be6195b`）+ e2e 收口 4 个提交；CI run 35417042155 全绿后 PR #20 以 merge commit `78e49183` 合入 `main`（2026-09-19 12:13 上海），#21 随之自动标记 merged，#22（base 不是 main）手动关闭并留言。随后 PR #23（业主拍板的 4 项）以 `09f1a1ca` 合入。**均未部署，生产仍是 `0e6c009b`；`main` 比生产多出的迁移与数据步骤见下文「部署前仍必须先做」。** 推送前的本地门禁请跑全 CI 第 11 步四条：`pnpm check:architecture && pnpm test:backup && pnpm lint && pnpm typecheck`（CLAUDE.md §6.3 只列了后两条加单测）。**
- 做法：`grok`（`~/.grok/bin/grok` 1.0.25，模型 grok-4.6）无头模式、工具白名单 `read_file,grep,list_dir`（自带 `--sandbox read-only` 在本机因 `/var/run/docker.sock` 是符号链接起不来），按主题切 7 片并行：A = PR #21、B = PR #22、C = release 独有的备份脚本、D1a/D1b = 未推送 46 个提交的前段、D2 = 跳转回执、D3 = 内部工单物流。要求每条发现回到 HEAD 核实、避开 CLAUDE.md 已拍板例外。7 片全部 `MERGE_WITH_FOLLOWUPS`，无 P0；Claude 逐条回代码核实后才动手。
- 已修 5 处（各带回归测试）：① `add-shipment` 仍用「有物流行」判定 REQUOTE，补录（`priceBookId: null`）过快递费的老内部工单加地址会报「原物流费用不完整」→ 改用 `hasLogisticsChargeRows`（新测试在修复前为红）；② 工单详情 `canAdminManageCommercialDetails` 仍对 `INTERNAL_SALES` 放行、服务端必拒 → 恢复为外销 / 工厂直接（这两处都是 `552fa165` 回退没改全）；③ 改单「新增款式」烫金色不走显示名反查，「红金」原样入库 → 与现有款共用 `knownOrderFoilColors` + `addedItemFoilColors`；④ `safeReturnTo` 放行 `..`，时薪回执可落到计件页 → 拒绝 `.` / `..` 段（含 `%2e`）与反斜杠；⑤ 省份解析无锚点、按价目表顺序匹配，「北京市朝阳区广东大厦」按广东计运费（**main 上的既有行为**，`d58f5e79` 只搬了位置）→ 带「省 / 市 / 自治区」后缀优先、同类取最先出现。
- 核实后判定**不算缺陷**：B 片「`20260917011000_foil_wage_ledger` 在同一迁移里 `ADD VALUE` 后立即使用新枚举值会挂 `migrate deploy`」——开发库（PG 16.13）`_prisma_migrations` 已完成未回滚、PR #22 空库 CI 全绿、生产已应用；A 片「寄样包装默认最小档少收钱」——`docs/寄样与打样开发任务.md` 第 54 / 92 / 103 行写明的既定设计，测试也是特意这样断言。
- 验证：typecheck 通过；lint 0 错误 3 警告（既有的 `window.location.assign` ×2 与 `_logistics`，顺手清掉了 `f9faea24` 留下的两个未使用标识）；全量 Vitest 导 `.env` 真实 URL 为 7134 通过 / 56 失败 / 44 跳过，**失败的 6 个文件与下方「全量测试基线」②完全一致**，换占位 `DATABASE_URL` 单跑这 6 个文件 403/403 全过。**没跑 e2e、没在真实浏览器目视**（同前两批）。
- grok 未修的发现见「卡住的问题 → 待业主拍板（2026-09-19 grok 对抗审查）」与其下的「后续项」。
- **推送后 CI 两轮红，都来自这 46 个从未跑过 e2e 的提交，不是 grok 修复引起的**（业主选「修到 CI 全绿再合并」）。第一轮 run 35368838680 红在 Browser component contracts：`ExternalSalesOrderFormRail.browser.spec` 仍断言「非外销不显示纸箱耗材」→ `9313aece`。第二轮 run 35370555955 红在第 18 步 44 例（225 过）：本地建隔离库逐个复现后，42 例是用例没同步（`493bd623`：提交二次确认、内销物流行、粘贴组件 label 星号、供应商回执撞 `getByLabel`、分层建单无「复制当前」、设计款 tablist、额外地址 textarea 无 name、交期夹具跨日 flake），**2 类是真回归**：① 师傅端零 JS 退出登录失效——`d84f42d1` 把退出表单挪进 `/worker/account`，而该页在 `app/(worker)/worker/loading.tsx` 的 streaming 边界里，无 JS 时永远停在骨架屏（§15.8 硬约束）→ `3ca23ed7` 照 `AdminHeader` 在外壳加 `<noscript><LogoutButton /></noscript>`；② 393px 下规格标签校验时变长、把「＋ 增加规格」挤到下一行，输入框下跳 52px → `ea50a1ab` 标签容器窄屏独占一行。
- **教训**：只读代码判断「零 JS 没破」是错的（表单确实还是原生 form，但被 streaming 边界挡住），必须实际跑 `no-js` project。改动师傅端 / 后台外壳或把原生表单挪进带 `loading.tsx` 的路由时，跑 `pnpm exec playwright test tests/e2e/no-js.spec.ts`。本地 e2e 用开发配置即可（`:3000` 没起 dev server 时），冷编译可能把单例 45s 超时耗尽，重跑即过。
- 隔离库 `erp_e2e_grok_20260919` 用完已 DROP。

**2026-09-18（夜）：内部工单物流自动计价，2 个代码提交（`012feeea`、`f9faea24`），未 push、未部署。**
- 起因：业主在建单页发现填了地址但费用栏没有快递费。查证是设计如此——运费自 2026-08-08 起被建模成「外销渠道的对客应收」，`quoteInternalCreateOrder` 明写 `includeOrderCharges: false`，工厂直接业务只能在详情页「编辑收费」补录，忘了补就漏收。业主拍板：**客服工单与工厂直接业务和外销用同一本已发布物流价目自动计价，顺丰到付维持运费 0、耗材照收**（取代 2026-07-30「totalAmount 只汇总款式小计」与 2026-09-15「内部结算不新增物流应收」在这两类结算下的口径）。
- `012feeea`（建单 + 提交）：`settlementBillsLogistics`（除 NO_CHARGE 外全计物流）；`quoteInternalCreateOrder` 收与外销相同的 logistics 事实、返回同一份 `CreateOrderQuotePresentation`（含物流行与握手 token）；`submitOrder` 对内销 / 工厂直接也走共享 `finalizeExternalOrderQuoteInTx`，同一快照落款式价、入袋费、快递费 / 耗材收费明细与双价目版本锁。**客服业绩口径不变**：新增 `csSalesBasisAmountInTx` = 工单总额 − 代收物流，提交 / 取消 / 改单批准 / 终价确认四处按该口径记账与对平。
- `f9faea24`（履约 + 核价）：`lib/order/settlement.ts` 的 `orderBillsLogistics`（有物流行即按物流行走）统一判定发货逐地址确认、承运商计费重量、`SHIPMENT_CHARGES_FINALIZED` 版本、顺丰到付切换、履约费用更正、追加地址重算、快捷编辑地址的省份复核、管理端详情与行内抽屉入口。**退役前提交、没有物流行的老工单维持原加工费流程**，完整编辑仍可补录。附加费用维护放宽到除免费工单外都可用。
- Codex 对第一片的三条已在第二片一并修掉：核价完整编辑**补录**的物流行漏出业绩基数（取消时对不平）；内部「配置外」款式提交被 `assertSelectedPapersAvailable` 拦住进不了人工核价；管理员价工单首次提交必然误报 `quote_changed`（预览 token 不含管理员价快照 → finalizer 同时接受预览 token 与含管理员价的 token）。
- 验证：typecheck / lint（仅既有 2 条 `window.location.assign` 警告）/ 架构门禁通过；`order.test` 243、`submit-external-order` / `pricing-review` / `change-request` / `components/business/order` 全绿；建单三个 browser spec 87/87。**未在真实浏览器目视**，也**没跑 e2e**。
- `552fa165`（Codex 对第二片的三条）：附加费用维护误放开到 `INTERNAL_SALES` 已回退（该路径不记 `CsSalesEntry`，客服工单加附加费会让业绩对不平、取消被拒）；`hasLogisticsChargeRows` 收紧为只认 `priceBookId` 非空的行——管理员在完整费用编辑里**补录**的行是 `priceBookId: null`，不能当成按价目计费，否则发货重算报「未绑定唯一价目簿」卡死；预览 token 的兼容放行缩到「从未报价的 DRAFT 首次提交」，堵住驳回重提时用旧预览 token 绕过管理员改价确认。
- **全量测试基线（重要，下次别再误判）**：本机 `pnpm test run` 的结果取决于有没有 `export DATABASE_URL`。① 不导出 / 导占位 URL：`.postgres.test.ts` 全部在模块加载期炸（28 个文件），其余全绿。② 导 `.env` 的真实 URL：postgres 文件能跑，但 `app/api/cron/notification-wire`、`lib/__tests__/{material,order,outsource,production-completion,purchase}` 这 6 个文件会挂 56 例——**已用 worktree 在本批次之前的 `6e1f9715` 上复现同样的 6 файла / 56 例，属既有问题，与本批无关**，~~根因是这些文件在真实 DB 存在时会走到未 mock 的连接路径（未深查）~~ **2026-09-19 更正：根因与数据库地址无关**——`set -a; . ./.env` 会把 `.env` 里的 `BACKGROUND_JOBS_MODE="durable"` 一起导进 vitest 进程，这 6 个文件按测试默认的 `inline` 模式写断言，durable 下通知 / cron 改走 `enqueueBackgroundJob` 就全挂（单独设 `BACKGROUND_JOBS_MODE=durable` 跑 `purchase.test.ts` 即可复现 1 例）。**正确跑法是只导出 `DATABASE_URL`**：`env -u BACKGROUND_JOBS_MODE DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | sed -E 's/^DATABASE_URL=//; s/^\"//; s/\"$//')" pnpm test run` —— 2026-09-19 在 `292d9b87` 上实测 663 文件 / 7190 项全过、0 失败。③ 全量跑时另有几个 `.postgres` 迁移/发布用例因共用开发库并发而红，单独重跑 6/6 全绿（同 CLAUDE.md §14 对 e2e 的并发警告）。
- **待办（下次会话接着做）**：① 全量 Vitest 与 Codex 对 `f9faea24` 的 review 结果在本次会话末尾，若有红需先收口；② e2e 里外销/内销发货与核价用例可能因「内销现在也要逐地址确认收费」而需要更新；③ SPEC §193「不计物流费用」与 §248 仍是旧口径，等这两片稳定后按 §9.3 更新并记 CHANGELOG。

**2026-09-18（晚）：「保存后没反馈」审查 → 零依赖「跳转回执」推广，3 个代码提交 + 1 个记忆提交，未 push、未部署。**
- 审查结论：项目没有 toast 库且 `docs/ui-规范.md §5.4` 明确不引入，`ActionNotice` 已是规范件。缺口在 18 处 `redirect()`：13 处不带任何标记（主数据新建 ×10、通知渠道/规则 ×3、工单编辑）、1 处出账 `?issued=1` 被 `/owner/bills/[id]` 兼容跳转丢掉、4 处计件/时薪用私有 `appendReceipt` 自成一套；另有 `TaskDisputeAdminPanel`（action 返回的 message 被丢）、`SalesTextEditForm`（「没变化」毫无提示）两个表单吞掉成功结果。失败反馈基本都有，只是 12px 红字不显眼，本轮没动。
- 落地：`lib/admin/receipt.ts`（`RECEIPT_KEYS` 固定字典 + `appendReceipt` / `readReceipt` / `safeReturnTo`）、`components/ui-business/ReceiptNotice`（服务端渲染 ActionNotice；`ReceiptUrlCleanup` 挂载后 `history.replaceState` 清参数，写法同 `OrderListNavigationState`）。18 处 redirect 全部带回执；目标页渲染：账号 / 往来单位 / BOM / 采购单 / 采购新建（从采购流程新建供应商回来）/ 物料三条路由（owner、foreman、rules/papers 经 `MaterialCatalogPages`）/ 工艺 / 可建单组合 / 产品结构分类 / 工单详情两分支（SALES 分支加了一层 `space-y-4` 包裹）/ 客服业绩周期 / 账单归档详情（出账回执改落这里）/ 通知配置（区分 channel / rule）/ 计件 / 时薪（迁到公共件，保留零 JS 的「关闭提示」链接）。`TaskDisputeReviewForm` 改常驻挂载 + `open`，终态只留成功回执；`SalesTextEditForm` 「没有变化，未保存」显式播报。
- 验证：`pnpm typecheck` / `pnpm lint`（仅既有 2 条 `window.location.assign` 警告）通过；全量 Vitest（`DATABASE_URL` 取自 `.env`）7158 通过 / 44 跳过；`ReceiptNotice.browser.spec.tsx` 2/2（真实 chromium 里回执可见、只清回执 key、保留 hash）。10 个 action 测试里钉死的跳转路径已改成带 `?created=1` / `?updated=1`（往来单位那条 `supplier%201` 变 `supplier+1`：`URLSearchParams` 重序列化，语义不变）。
- **未在真实浏览器目视**：内置浏览器访问 `localhost:3000` 被拒，且登录要密码。下次有登录会话时：`/owner/rules/crafts/new` 建一条工艺 → 详情页顶部应出现「工艺已创建」，地址栏 `?created=1` 随即消失；再到 `/owner/notifications` 改一个渠道保存 → 列表页顶部「通知目标已保存」。
- Codex 四轮：第一轮 3 条（`replaceState` 传带 `__NA` 的 state 会让 Next 跳过 canonical URL 同步 → 改传 null；工单详情 ADMIN 分支在回执前就 return → 补上；`split('?', 2)` 截断查询串 → 按首个 `?` 切分），第二轮 1 条（时薪页筛选 `paid` 与计件回执 `paid` 同名被一起清掉 → `readReceipt(sp, keys)` 白名单），第三轮 1 条（同一页连续两次带回执时组件不重挂载、清理 effect 不重跑 → `ReceiptNotice` 每次服务端渲染发 `renderId` 作 effect 依赖），第四轮「no discrete actionable issues」。四条均已修并各自单独提交（`4789807d` / `23729326` / `6e1f9715`）。
- 已知取舍：零 JS 下回执参数留在地址栏，刷新会再播报一次（接受）；e2e 里 `toHaveURL('/orders/{id}')` 精确断言（`sales-functional-review` / `order-create` / `order-external-sales-association`）依赖挂载后清参数，Playwright 会重试到超时所以预期能过，但本轮**没跑 e2e**。

**2026-09-18（下午）：对抗 review `d84f42d1` 之前的 11 个提交 → 5 项缺陷修复 + Codex 四轮追加，共 12 个代码提交（`3f0ce6db` 起），未 push、未部署。**
- `3f0ce6db` / `548b7d8d` / `38e321ff`：120g 退役拦截从共享报价适配器挪到新建入口（`createOrder`、两个报价预览、打样提交、内销旧草稿 `submitOrder`、销售工作台），`lib/rules/paper-availability.ts` 的 `hasRetiredPaperItem` 单点判定；改单 / 取消结算不再受新增的 120g 退役闸拦截；原有产品/物料状态校验仍在，关联停用物料及无外键专版纸张仍可能阻断历史重算（见「卡住的问题」）。
- `7df2677d` / `38e321ff`：改单表单烫金色显示名反查（`foilColorFromLabel`），`known` 列表保护真实目录名；管理端两页从 `listExternalCreateOrderFoilOptions` 取目录名，销售端只带工单上已有颜色。
- `3d53816d` / `67c39148`：师傅工资页「累计已结算 / 尚未发放」全量，未结算报工只在显式区间时过滤，状态 / 分页链接只带显式日期。
- `05b31d1c`：规格按「当前纸张在该规格下有任一可用克重」启用；同设计款材料分叉在 `changeItemSelection` 提示而不是灰按钮。
- `7b0b3a6f`：珠光暗红显示名补齐工单详情 / 打印 / XLSX 导出 / 销售详情 / 师傅端工序来源。
- `cdd5000b`：自动激活用例 tx mock 补 `orderItem.findMany`。
- `0957b0ae`：烫金显示名与真实目录名同名时以 known 身份集消歧，目录烫金名接到销售端。
- 本轮末：客服编辑页也取目录烫金名；烫金输入的空白不再绕过反查。
- `d58f5e79`（业主追加需求）：收货地址输入统一复用「粘贴自动识别」——新组件 `components/business/order/ReceiverAddressPasteField.tsx`，解析在 `lib/order/receiver-address-paste.ts`（原 OrderForm / 表单 B 的两个解析函数挪过去，旧导出位置 re-export）。接入：外销建单表单 B（DOM/id/占位文案不变）、寄样品/打样、追加收货地址、工单编辑主地址 + 逐票、建单额外地址、客户默认收货地址（粘贴框不提交）。语义：粘贴覆盖收货人/电话/省份，手输只补空（`applyParsedReceiverFact` 单点规则，`090d3d01`）；粘贴走浏览器原生插入、onPaste 只打标记，表单级 onChange/dirty 判定照常；客户默认地址粘贴时清城市/区县、详细地址去省份前缀；textarea 随内容增高。4 个 browser spec 112 例、SSR/单测通过；**未在真实浏览器里登录目视**（本机没有可用的登录账号），下次会话若有 dev server + 账号可在 `/workbench` 寄样品页核一眼。

验证：全量 Vitest 7024 通过 / 56 跳过。**4 个文件在没有 `DATABASE_URL` 的 shell 下模块加载即抛**（`lib/db` 直连：`actions/__tests__/report-disputes`、`app/(worker)/__tests__/worker-task-legacy-dispute`、`app/(admin)/__tests__/owner-metadata-auth`、`order-detail-commercial-visibility`），带占位 URL 全过——跑全量前先 `export DATABASE_URL`。typecheck / eslint（保留既有 `window.location.assign` 警告）/ 架构门禁通过。打印视图只改纸张文字，darwin 像素基线未更新；release 配置跑 `order-print` 若基线含珠光闪红样本需按 §8.4 更新并在 commit 里写 `[visual-regression]`。
Codex 前三轮（3f0ce6db、548b7d8d+7df2677d、3d53816d+05b31d1c+7b0b3a6f）意见已全部落地；第四轮（`38e321ff` / `67c39148`）指出目录同时有「红色」「红金」时显示名反查会改错身份，已在 `foilColorInputLabel` / `restoreFoilColorInput` 以 known 身份集消歧并把目录烫金名接到销售端（本轮最后一个提交）；第五轮（`0957b0ae`）再指出两处既存遗漏——客服编辑页没拿目录名、颜色旁空白绕过反查——已在本轮最后一个提交修掉（编辑页按「能改单」条件取目录名；`mapFoilColorParts` 按 trim 后的颜色匹配、保留空白与分隔符）。第六轮 review 若有新意见见下次会话。

**2026-09-15（晚）：寄样品与打样主流程已实现，本地验证完成，未 push、未部署。**
工作分支 `codex/memory-after-pr19`，开发基线 `f37d6448`。新增五入口中的寄样品/打样、外部销售权限、最小包装默认档、整单人工核价、用途胶囊与发货结算分支。
开发主库已应用 2 项新增迁移（共 148 项）；业务写入验收仅在独立克隆库 `erp_samples_test_20260915`，隔离 Next dev 为 3107，用户开发服务仍为 3000。
完整结果及复跑入口见 [寄样与打样开发任务](./docs/寄样与打样开发任务.md)。主流程、6839 单测、23 工作台浏览器回归、3 新 E2E（含六视口/明暗/axe）、typecheck/lint/架构与 fresh migration 通过。
首版样品生产款式修改需新建单；OSS 未配置，设计图测试使用夹具，未验证真实上传。打样实际师傅报工使用既有路径，本轮结算验收用明确完成态夹具。生产发布仍需原部署前置检查。


**2026-09-15（傍晚）：PR #19 已合并进 `main`（merge commit `d283b5a5`，19:34），`codex/tijian-2` / `codex/gongdanceshi` 远端与本地均已删除。**
合并前最后一轮 CI（run 34927184124 第 5 次尝试，head `5bdb907e`）verify 67 分钟 / print-darwin 3 分钟全绿，是 `1d23b144` 之后
第一次全绿。当天上午追 CI 修了三轮：`3caba196`（旧任务详情抽 `renderLegacyTaskDetail` 回到 300 行架构阈值）、`ac61743c`
（建单 browser spec 改按 aria-invalid 判断）、`5bdb907e`（登录回跳 `?from=` 剔除 Next 内部 `_rsc` 参数，auth-logout-race 用例）。
前 4 次尝试全部因 GitHub Actions 账单「payments failed / spending limit」根本没启动，业主处理后重跑才通过——
**这已是 09-12 之后第二次撞账单，以后 job 在 10 秒内 0 步骤失败先看注解，不要当代码问题查。**
**合并 ≠ 部署**：生产仍是 `aa42ba0` / 45 项 migration，`main` 现在 146 项；部署前置步骤见下文「部署前仍必须先做」。

**2026-09-15（上午）：前端缺陷批次已落地（`codex/tijian-2`）**。Codex 只读审计出 4 条（我逐条核实）+ PROGRESS 技术债 2 项，
Codex `gpt-6-astra` 写模式修、我复审提交：2afdb77e 登录跳转保留查询串（扫码 v/task 不再丢）；ace6f360 旧任务详情挂异议面板；
7ef99774 改密页无会话跳登录；23d0e29c 日薪 / 时薪 / 师傅端工资三处分页（合计走 aggregate，师傅端合计**跟随日期筛选**——
Codex 原改成忽略筛选的全量，我改回原口径）；21e92124 建单逐字段错误去 role=alert；本提交 后台 `<noscript>` 原生退出 +
no-js 用例（release 配置隔离库 4/4）。未修且说明原因：OSS 重放窗口（业主 08-21 接受）、盘点净额往返（需设计评审）、
6 处冗余 router.refresh（等拍板）、运维项。本地跑 e2e 注意：`:3000` 有 dev server 时开发配置起不了 `:3100`（Next 16 单实例检查），
用 `--config=playwright.release.config.ts`。Codex 只读对抗审查这六个提交：no discrete actionable issues。

**2026-09-15：半分金额容差 + 管理员补录生产资料已落地（`codex/tijian-2`，未合并、未部署）**。业主 2026-09-14 拍板见 DECISIONS 同日条目。
Codex（`gpt-6-astra` 写模式）实现、Claude 对抗复审后提交；Codex 的逐文件说明与门禁记录在
`docs/archive/2026-09-14-金额与存量生产资料修复报告.md`。复审要点：价格快照确实绑定 craft（`admin-pricing-snapshot.ts:160`），
所以补录工艺后对**原本可信**的终价依据做续接是必要的，且不会把失配的旧依据洗白（有测试）；下发 / 接单闸口未放宽；
`ProductionReadinessWarning` 把「canonical 工艺」这类内部术语在展示层替换，因为 `operation-materializer.ts` 本轮不动。
历史账单 cmsbmplo40008850rahu58pb4 业主决定忽略。
Codex 只读对抗审查一轮：0 P1、1 P2（补录为不包装且历史包装费非零会撞 `OrderPackagingGroup_count_by_mode_check` 整批回滚）→ e8afe8b4 领域层先拒。
全量 vitest 6783 通过；与 lint / typecheck 并发时 6 个 postgres / 扫描用例超时，单跑 4 秒全过。


**2026-09-14：PR #19（`codex/gongdanceshi` → `main`，<https://github.com/zora4523-bot/print-shop-erp/pull/19>）已开，
本地继续在 `codex/tijian-2` 上修 CI 暴露的问题，每修一处就 `git push origin codex/tijian-2:codex/gongdanceshi` 快进 PR 分支。
两分支当前同头（`1d23b144`），共 56 个提交领先 `origin/main`。未合并、未部署。**

**PR 开出后 CI 与本地门禁复核发现并已修的 4 件事（都是 09-13 批次改了行为但没同步测试 / 基线）：**

1. **GitHub Actions 账单**：09-12 15:01 起所有 run 因「payments failed / spending limit」根本没启动。业主已处理，
   `gh run rerun` 后正常。
2. **`4a6d5fd9` 打印像素基线**：`order-print-three-items` 差 1082 像素，整页只有「数据不完整」一行——`749c3d87`
   把多款式的「图 1/2/3 包装数量未填」合并成「款式包装数量未填」。业主目视确认后按新文案更新基线。
3. **`010b154f` Browser Mode 5 个 spec 导入即挂**（CI 与本地冷缓存一致，与 vite 缓存无关）：`BatchPrintControls`
   直接 import `@/actions/order-batch-print`，4 个 AdminOrder spec 没 mock 它 → `next-auth` 进浏览器预打包 →
   其 chunk 向已被 mock 的 `next/navigation` 要内部导出 `t` 报错；`ExternalSalesOrderFormRail` 经 `ui-business`
   桶文件带入真实 `next/link` → `process is not defined`。都在 spec 里补 mock，不改组件与配置。
   **规律：组件新 import 任何 server action 或经桶文件带入 `next/link`，对应 browser spec 必须同步 mock。**
4. **`77aebdd7` 管理端六视口门禁**：仍在给管理员建单填已移除的「客户名称/简称」（DECISIONS 09-13），价格版本页
   `readyHeading` 仍是旧标题「价格版本与发布」。修正后 admin 84/85（375×667 一次偶发，单独重跑两遍都过）、
   worker 12/12。CI 此前从未跑到这一步。

另 `13813008` 把 CLAUDE.md §14「Playwright 复用 :3000 并共用开发库」改成现行的隔离库 + 独立端口流程。

**第三轮 CI 首次跑到「生产构建 + E2E + 六视口」，20 个失败，已按根因分四类全部修完（run 34824602280 复核中）：**

5. **`3578db20` 真回归（最重要）**：管理员建单页点「复制当前」整页掉进错误边界，探针抓到
   `TypeError: Cannot read properties of undefined (reading 'manualQuoteReason')`——58c6910b 的
   `factsKey={adminPriceFacts(watchedItems[expandedItem])}` 没有 `?.`，复制后 `setExpandedItem` 先于
   `watch('items')` 一帧。加 `expandedWatchedItem` 守卫。它一个拖挂了 admin-order-entry /
   order-entry-stability ×4 / notification-urgent / 多地址装盒等所有管理员建单 e2e。
6. **`64f78382` 装盒价目不在迁移链**：红卡空盒 / 触感空盒 / 装盒加工费是部署后数据步骤
   （`install-box-packaging-rules.ts`），开发库有、隔离库和 CI 没有，装盒工单永远提交不了。抽出
   `scripts/lib/box-packaging-install.ts`，新增 `prepare-e2e-box-packaging.ts` 挂进 `test:e2e:prepare` 第三步
   （须 `node --conditions=react-server --import tsx`，价目簿模块带 server-only）。
7. **`aec6e722` 经营分析业绩排行图**：CI 先跑完 e2e 再跑视口门禁，e2e 留下的长显示名让 Y 轴标签在
   375 / 393 溢出 1.8px（Linux 无中文字体、回退字形更宽，macOS 单跑看不到）。改函数形式 tick 用
   `<Text maxLines breakAll>` 按字体度量省略；Browser Mode 加 393 长名用例。
8. **`8622a5dc` / `65c2e1de` 过时断言**：管理员建单已无关联客户 / 简称控件（notification-urgent、
   master-data-flow、smoke）；价格版本页标题改「价格版本」、库存列表隐藏物料编码（smoke）。

**第四轮 CI（run 34824602280）只剩 2 个失败 + 2 个重试通过，都是 CI 慢机器的时序：** `8ec5bc74` 多地址装盒用例
对齐同文件的 150 秒超时；`997e512b` 工作台纸张边界用例等报价最多 30 秒并把报价区文字带进错误信息（组件在
「正在计算…」和错误态都不渲染 `p.text-3xl`）。本地 durable 3/3、compat 16/16 已绿；dev-fixtures 要同目录起
`next dev`，会和 :3000 的开发服务器争 `.next`，没在本地跑。

**本机全量 e2e（全新库、字母序）观察到 4 个 CI 上会过的失败，都是高负载下的时序，未改：**
blank-paper-pricing:315 与 price-versions-layout:52 的 `getByText` 严格模式撞到 2 个元素（导航过程中新旧
`#admin-main` 同时存在）；sales-functional-review:316 在 375 深色下 axe 报对比度 1.01（`#17181c` 文字落在
`#171717` 上，颜色过渡未完成就跑了 axe）；order-entry-stability:88 等 `/orders/new` 报价响应超时。若要收口，
方向是给这些等待加显式条件而不是加时长。

**规律（写给下一个改建单页的人）**：09-13 那批把行为改了但没跑 `test:release`，本地 `.next` 和开发库
的历史数据把问题全盖住了。改建单 / 定价 / 包装后，至少在隔离库上跑
`tests/e2e/{admin-order-entry,order-entry-stability,order-packaging-types,smoke}.spec.ts` 与
`tests/visual/admin-responsive.spec.ts`。

**开发库已于 2026-09-14 20:42 按业主选择重建（残留数据清零）：**
- 备份：`~/print-shop-erp-backups/print_shop_erp-20260914-204227.dump`（pg_dump -Fc，全库）与
  `config-tables-20260914.sql`。恢复旧库用 `pg_restore -d`。
- 步骤：终止连接 → drop/create → `prisma migrate deploy` → `db:seed` → 回灌 Setting / NotificationChannel /
  NotificationRule / SalaryRule（`_ChannelRules` 原本就是空）→ 删掉迁移用 NOW() 生成、与原 4 月 22 日那套值完全相同的
  12 条 SalaryRule → `install-box-packaging-rules.ts --apply`（v7）→ `publish-confirmed-custom-tiers.ts --apply`（v8）。
- 结果：0 张工单、1 个账号（seed admin）、物料 32 / 产品 57（均来自迁移）、装盒 3 条规则在当前版；golden-gate
  单测在新库 2/2。丢掉的只有 2 张非测试工单（`GD-260807-001` 草稿等）与 10 个旧价目簿版本历史，都在备份里。
- `/api/health/ready` 仍 503：`.env` `BACKGROUND_JOBS_MODE=durable` 但本机没起 light / heavy worker，与数据无关。
- 本地 Postgres 仍有 28 个历史 e2e / 测试库 + 本次的 `erp_e2e_tijian_20260914`，未删。
- `:3000` 的 `next dev` 不是本会话启动的，重建期间被断连一次，已自动重连。

**09-14 上午的结构体检收口（已在 PR 内）**：

1. **建单 / 定价 / 装盒批次（09-13，业务代码）**：管理员建单定价与关联外部销售、默认入袋 / 不包装 /
   版本化装盒计价、专版十一档「达到档位取价」（`e5bac3cb`，价目簿由 `scripts/publish-confirmed-custom-tiers.ts`
   按 `config/customer-price-books/custom-tiers-20260913.json` 发布，**不是 migration**）、空白封纸张规格价格、
   批量打印 PDF、报价转单草稿修复、品牌名统一为「长昆纸品有限公司」。对应决策见 DECISIONS 2026-09-11 ~ 09-13。
2. **结构体检（09-14，只读）**：报告在 `docs/archive/项目结构体检-2026-09-14.md`。门禁实测：typecheck / lint /
   prisma validate / dead-code 全绿；分层、权限闸口、Prisma 直连边界与 CLAUDE.md 一致。
3. **体检收口（09-14，4 个独立 commit）**：
   - `e357efcc` 抽出 `buildFinalizePayload`，`OrderPricingReviewForm` 回到 723 行上限内，`check:architecture` 回绿
   - `666e8d89` `.gitignore` 忽略 `**/__tests__/__screenshots__/`（Browser Mode 运行产物，非基线）
   - `fb433c39` golden-gate 测试改按 print-sentinel 谱系（`notes.ruleVersion` + `sourceSha256`）时间点回读快照，
     本机开发库已发布 v9 / v10 十一档也能过；黄金用例一字未动。**Codex 复审指出这丢了「当前生效版发错价」
     的防线**，`1f6556ef` 补回第二条用例：读此刻快照，按当前版 `ruleVersion` 在 `LINEAGE_EXPECTATIONS`
     取期望集（print-sentinel = 原 42 例；`2026-09-13-attained-custom-tiers` = 11 个专版大号边界例覆盖），
     未登记谱系直接失败。**以后发布新的加工费谱系，必须同时在这张表登记它对 §8 黄金值的影响。**
   - `068a7803` CLAUDE.md 1.3 同步现状 + HANDOFF 重写
   - `3a70278e` `lib/auth/schemas.ts`（3756 行）按域拆到 `lib/auth/schemas/` 12 个文件，入口纯 re-export，
     60 个调用方零改动；`6f8faa83` 把按路径读源码的 `edit-field-inventory.test.ts` 改成遍历该目录
   - `d3254723` 新建 `docs/archive/` 并立归档规则，`git mv` 25 份过程文件（根目录 8 + docs/ 17），
     全部 .md 引用同步改路径，相对链接检查前后无新增断链

**验证事实（09-14，最后一次全量）**：`pnpm test run` 614 文件通过 / 4 跳过、6701 项通过；
`pnpm check:architecture` 914 模块 / 0 环 / 25 项债务无增长；typecheck、eslint 通过；
`OrderPricingReviewForm` Browser Mode 1/1；golden-gate 两条用例在本机（当前 v10）2/2。
**Codex 复审已跑两轮**（`codex exec --sandbox read-only -m gpt-5.6-sol`）：第一轮覆盖 048c5dd1..e553bed2 八个提交，
唯一中等问题即上述 golden-gate 防线，其余（载荷搬运等价、schemas 拆分无丢失 / 无环 / 无 Prisma runtime 泄漏、
测试遍历不重复计数、归档无代码消费方、CLAUDE.md 与现状一致）核对无误；第二轮只看 `1f6556ef`，结论可合入，
仅一条注释精度（`fde821fc` 已改）。没有更新任何截图基线。

**体检里刻意没做、需要业主定夺的项**：
- 三个超大文件**没有拆**：`lib/order/change-request.ts`（6143 行，143 个顶层语句里 125 个是私有函数，
  其中 45 个被 ≥3 处引用）、`lib/order.ts`（4410 行，`createOrder` 单函数 965 行）、
  `components/business/order/OrderForm.tsx`（3991 行客户端组件）。用拆 schemas 的同一套依赖分析量过：
  机械搬运要么导出几十个内部 helper、要么产生模块环，做不到「零行为变化」，需要按业务边界重新设计
  （改单：申请 / 审核 / 应用 / 时间线；建单：款式行 / rail / 费用明细）。建议只在触碰时顺手拆，不单独立项。
- `docs/release-remediation-2026-09-10.md`、`LOAD-TEST-RESULTS`、`UI-UX-ADVERSARIAL-REVIEW`、`codex-ui-brief`、
  `*-20260913.md` 刻意留在原地，原因见 `docs/archive/README.md`。
- `PROGRESS.md` 仍停在 09-03，09-13 这批建单 / 定价 / 打印工作还没写进去。
- knip 134 个未用导出 / 229 个未用类型，集中在 barrel 文件；CI 只当证据，不是门禁。

### 仍成立的 Git / 生产事实

- remote：`https://github.com/zora4523-bot/print-shop-erp.git`（**私有，HTTPS**）。开发机 SSH 不通，**不要把 remote 改回 SSH**。
- 远端只有 `main` 与 `codex/*`（`codex/fabuceshi`、`codex/gongdan`），**没有 `dev`**。PR #19 的两个分支已于 09-15 删除；
  `main` 头为 `d283b5a5`。本文档的更新走 `codex/memory-after-pr19` 分支的 PR。
- **生产未动。** <https://bag.sshapi.cn> 上次记录仍是 `aa42ba0`（2026-08-02）/ 45 项 migration；本地迁移链已有 146 项。
  这些都**不是生产已 apply 事实**，部署前必须重新核对。
- 本机开发库加工费价目簿已到 v10（`2026-09-13-attained-custom-tiers`），v8 是 print-sentinel 迁移版。
  golden-gate 测试现在按谱系读 v8，**不要**为了让它过去回滚开发库版本。

---

## 下一步具体指令（给下次 AI）

纸张/规格任务从批次 3 接续，批次 2 已提交 `30b813ca`。先获得目标库预检结果，节点归属异常须业主确定后再做相关写操作；按 S1/S2/S5 抽事务 helper、新增空白封启用入口，并完成 S8 产品身份守卫。保持草稿不代办重新启用及外键补写的现有边界，不提前做页面、下架、120g 收尾或彩印。

0. **跳转回执收尾（2026-09-18 晚）**：a) 隔离库跑 `pnpm exec playwright test tests/e2e/sales-functional-review.spec.ts tests/e2e/order-create.spec.ts tests/e2e/order-external-sales-association.spec.ts`，确认保存后 `toHaveURL('/orders/{id}')` 在回执参数被清掉后仍通过；若抖动，把这些断言改成 `toHaveURL(/\/orders\/{id}(\?updated=1)?$/)`。b) 有登录会话时按「当前任务」段落目视两条路径。c) 12px 红字失败提示迁 `ActionNotice` 另起一批（`UrgentToggleForm` / `SfCollectToggleForm` / `FinishOrderButton` / `TaskDisputeAdminPanel` 的 error 分支），不与本轮混。

**PR #19 已合并（09-15）。下一步从这里起：**

- 部署仍未做，先走「部署前仍必须先做」的 1-5 步与人工验收 6-9；部署本身需要业主明确授权（CLAUDE.md §12）。
- 「卡住的问题」里 09-14 深夜新增的代理商账单 3 项、e2e 夹具是否改走领域层、6 处冗余 `router.refresh()`、
  `pnpm test:browser` 是否进门禁，都还等业主拍板，拍板前不要动。
- 本机 git 在 09-15 曾被 Xcode 许可协议挡住（`sudo xcodebuild -license accept` 后恢复）；再遇到 `gh` 报
  「failed to determine base repo」先查这个，`gh api` 与 `-R zora4523-bot/print-shop-erp` 不受影响。

**以下为合并前的 CI 追踪记录，仅供回溯：**

先做：盯 PR #19 的 CI 跑完（run 34845568496，head `1d23b144`）

第六轮（34838580706）只剩 1 失败 + 1 重试通过：多地址装盒用例的诊断信息显示保存被
「纯引擎分项与小计不一致」拦下——CI 全套共库时表单默认纸张是 blank-paper-pricing 留下的「验证纸…」
（大号封单价 0.5555）。`1d23b144` 改为显式选珠光艳闪 / 160g / 大号封。

**半分金额下不了单（2026-09-14 已拍板并修复；下文为原发现记录）**：
最终口径为集中常量 0.01 元、两处守卫容差比较，以及金额减去已舍入的单价乘数量来拆分固定费；见本次修复报告。

`lib/order/create-order-quote-presentation.ts` 的 `splitItemAmount` 把 2 位小数的金额减去 4 位单价×数量后
四舍五入成固定费；`lib/order.ts:954` 再要求「单价×数量+固定费 == 小计」严格相等。用黄金价目（5 档，单价
`0.3250`）实测：751 → 金额 244.08、固定费 0.01、复算 244.085 ≠ 244.08；1001 同理。也就是说 3 位小数档位
（0.325 / 0.245 / 0.285，五档和十一档都有）遇到奇数数量就被 createOrder 拒绝，客户端只看到一句内部错误。
改单路径 `change-request.ts:1090` 有同款守卫。修法二选一：守卫按 2 位小数比较；或拆分时把余数并进固定费后
用同一精度校验。需要业主决定金额口径（DECISIONS 2026-08-02 金额一致性）。

第五轮（34833590442）结果：202 通过，6 失败 + 3 重试通过，全在 E2E / 六视口步骤。已修：
- `53c983c4` workbench-paper-boundaries：诊断信息显示报价区是错误态「暂无法取得当前报价」——CI 全套共库时
  「匹配产品」第一项是本 spec 自己造的「缺克重」夹具产品，`.first()` 选中它报价必失败；改为按 prefix 排除。
- `53c983c4` admin-responsive 375 / 393：`getByTestId('admin-order-detail')` 短暂解析到 2 个元素（第二份在
  `#admin-main` 之外，来源未定位），改为只取主栏可见的一份。**若再见到「resolved to 2 elements」类错误，先怀疑
  同一现象，用 `#admin-main` + `:visible` 限定；根因要拿 CI trace 才能定。**
- `41569c81` 多地址装盒：150 秒仍等不到跳转，本地秒过；已改成失败时带出页面提示（role=alert / aria-invalid /
  费用栏文字）。第六轮若仍失败，错误信息里就有原因。
未修（CI 上重试通过或本地无法复现）：order-entry-stability:88 等报价响应、admin-responsive 抽屉 Home 键复位。

1. verify job 顺序：迁移链 → 静态门禁 → 单测覆盖率 → Browser Mode → 生产构建 + business E2E + 六视口 →
   **durable → 跨浏览器打印 → dev-fixtures**。前五步的 20 个失败已全部修掉（本地 release 配置逐条复现并
   验证），后三步仍是首次跑到；本地复现方式见 CLAUDE.md §14（隔离库 + `--config=playwright.release.config.ts`）。
2. ~~绿了就合并 PR；合并后删 `codex/tijian-2`~~（09-15 已做）。
3. ~~更新 `PROGRESS.md`~~（09-14 / 09-15 已补）。
4. 新建任务过程文件直接放 `docs/archive/`（规则见其 README），不要再往仓库根目录放 PLAN- / REPORT-。
5. 新增 Zod schema 放进 `lib/auth/schemas/<域>.ts`，不要往入口文件 `lib/auth/schemas.ts` 里加。
6. 不要把 `docs/archive/项目结构体检-2026-09-14.md` 里对 change-request / OrderForm / lib/order.ts 的拆分建议
   当成已拍板；那三个文件的拆分没有立项。


**部署前仍必须先做（顺序不能反）**

1. **跑 `docs/上线前置操作清单.md` §一的"底数核对" + 查询 1**（只读，可反复跑）。
   ⚠️ **查询 1 返回 0 行有两种完全不同的含义**：真的没缺口，或谓词根本没匹配到任何东西。2026-08-21 在开发库上实测就是后者（6 个外协工艺、1 张有效外协单，但"应外协款式数 = 0"），那次执行**只证明了 SQL 语法可用，没有证明判定逻辑对**。先看底数核对的三个数字再解读查询 1。
2. **查询 2 单独成表报**——它是"横幅会误报"而不是"会被卡住"，混在一起报会让业主误判。
3. **外协那条要拆两步部署**：`f512046` 这一个 commit 里读路径横幅和完工闸口都在，**部署时需手动拆**。先上横幅让主管照着补完存量缺口，确认查询 1 返回空之后再上闸口。顺序反了 = 部署当天一批在产工单突然完不了工。
4. **盘点页低峰期发布**：部署瞬间浏览器里开着旧版盘点页的操作员，提交会因缺 `bookQuantity` 被判 invalid（fail-closed，刻意设计），刷新即可——**但已录入未提交的数据会丢**（`counts` 是纯 `useState`）。建议先口头通知盘点岗。
5. **迁移后验收唯一索引**：`SELECT indisvalid FROM pg_index WHERE indexrelid = '"NotificationLog_deliveryKey_channelId_key"'::regclass;` 必须为 `t`。`20260821120100` 用了 `CREATE INDEX CONCURRENTLY`，不能包在事务里跑（`prisma migrate deploy` 会正确处理）。

**部署前的人工验收（单测覆盖不到的）**

6. **fix#2b 外协闸口**：两个款式、只给其中一个建外协单并收货 → 报完全部内部任务后工单仍停 `IN_PRODUCTION`，主管点「已回货」时看到 notice。
7. **fix#1 报工守卫的知情通道**：计划 5000 报 6200 → 出现「确认超出计划数」复选框 → 勾选提交成功 → 工单时间线出现「超计划报工」→ **老板看板「超计划报工」表里能看到这一条**。守卫与看板是一个决策的两半，看板没验就等于守卫没上。
   （守卫本身已在真实应用上以零 JS 路径端到端验过：计划 1000 时 1500 需确认且输入值回填、3000 恰好等于 3 倍上限被硬拒、10000 被硬拒、1500+确认通过并写入 remark 与 `TASK_OVER_REPORT` 日志。验证用的开发库数据已还原。）
8. **fix#3a 盘点 CAS**：两个浏览器窗口，A 录入实盘数不提交，B 对同库位做一次领料改动，A 提交 → 该行被点名退回、其余行正常过账。
9. **业务侧重点验收**：外部销售加工费 / 快递耗材价目、改价审批、真实 OSS 图片 PDF、企业微信推送、cron、批量报工、分次结款、多地址与售后重做。

**已排期、需业主或单独评审**

10. **fix#3b：盘点的逐行时间基线 + ledger scan**（单独设计评审）。只解决「净额为零的往返」。要做就必须做**逐行**基线：`counts` 的 entry 加 `snapshotAt`、提交时逐行下发、服务端一条 `groupBy` 走 `(materialId, locationId, createdAt)` 复合索引、`InventoryCount.snapshotAt` 存 `min(item.snapshotAt)`、成功后服务端回 `postedAt` 让客户端设 `baselineFloor`。**不要**重新引入整页共用的基线时刻，也不要引入 `inventory_count_snapshot_max_age_hours` 这类墙上时钟阈值——那正是被否的四条理由的来源。需要 1 个 migration（可空列 + 复合索引，additive）。
11. **fix#4：OSS 临时 key + 服务端 copy**。**前置动作必须先于代码上线**：RAM 子账号加 `upload-tmp/*` 的 `GetObject`+`DeleteObject`、加 `design/*` 的 `PutObject`、bucket 给 `upload-tmp/` 挂生命周期规则。清单在 `docs/上线前置操作清单.md`。`design/` 前缀**永远不能挂生命周期规则**（它是业务数据）。实施时两个必踩陷阱已写进 DECISIONS 2026-08-21：`ali-oss` 的 `copyObject` 对 headers 只加前缀不删原键 → 裸 `If-Match` 让 copy 恒 412 而所有单测都 mock 了 SDK、CI 会一路全绿；`etag` 缺失被当成成功 → 写出悬空指针。
12. **三处无界查询（backlog）**——都是 `findMany` 无 `take`，行数随时间线性增长：
    - `lib/salary/daily.ts:593 listDailyWorkerSalaries`（`/owner/salary/daily`，不筛就是全表）
    - `lib/salary/hourly-aggregate.ts:549 listHourlyPayrolls`（同上）
    - `lib/worker-portal.ts:222 listWorkerSalaries`（师傅端 H5，三年约 900 行）
    **`listWorkerSalaries` 不能照抄 `listWorkerOrders` 的分页补丁**：`app/(worker)/worker/salary/page.tsx` 的 `salaryTotals()` 从整个数组 reduce 出「累计工资 / 尚未发放」，直接分页会把这两个金额静默变成「本页合计」——给师傅看错工资总额比慢更糟。正确修法是行分页 + `db.dailyWorkerSalary.aggregate` 单独算 total / unpaid。（`listWorkerHourlyPayrolls` 已核实**不需要**分页：每人每月最多一行。）
13. **运维缺口**：Pigsty 异地 repo2、30 天保留、恢复演练；生产 `SENTRY_DSN / APP_VERSION`；应用机至少 4 GiB RAM；`deploy-smoke` 继承 PM2 的系统 Chromium 路径与 `--no-sandbox`。
14. **`/api/health/jobs` 尚未接进任何外部监控**；在有东西按分钟去拉它之前，SLO 表里的死信响应目标不生效。

---

## 卡住的问题

### 需业主确认（2026-09-20：新纸张是否默认进入专版）

- 现状：`lib/order/order-item-catalog.ts:189–226` 用有效 PAPER 物料与专版规格展开选项，缺货仍禁选；非基准纸无唯一加价转人工，冰白纸由管理员核价。空白封新增有效纸张也会进入专版选项。
- **仍待确认**：继续默认进入，还是改为手动启用。缩小方案本期不改专版，在保存复核中说明实际影响；保持现状不等于业主已经选择默认政策。已同步 PROGRESS，见 [方案](docs/PLAN-纸张规格独立管理.md)。

### 2026-09-19 grok 对抗审查带出的 4 项：业主全部拍板，已落地并合入 main

- DECISIONS 2026-09-19 四条，PR #23 以 merge commit `09f1a1ca` 合入 `main`（2026-09-19 15:34 上海，CI run 35423982889 全绿；第一轮红在 `check:architecture`——`setOrderSfCollect` 超出超长函数债务上限，`00baf758` 抽成 `waiveManualFreightForSfCollectInTx`）：① 补录运费的工单标记顺丰到付时运费清零（`50957f8b`）；② 冲正 = 作废原报工，作废组只读、残留人工差额确认核定时自动抵消、原报工日已结算则拒绝（`71ff619f`）；③ 寄样品维持默认最小包装档，不改代码；④ 师傅工资页只按师傅显式选的日期筛选、日期框默认留空。
- 仍未做：应用层没有冲正入口（`REVERSAL` 只能写 SQL），日后做入口时沿用②的语义并处理「原报工日已结算」的情形。

### 后续项（2026-09-19 grok 对抗审查，P2，未修）

- 薪资：`publishSavedPieceworkDraft` / 个人工价发布不强制小单工资与装版费成对，绕过 UI 直接 POST 能发出退回线性计件的工价簿（ADMIN only）。
- 回执：计件 / 时薪回执回放 URL 里的姓名（`?paid=张三` 可伪造「已标记发放」横幅，ADMIN only、无写入）；`MaterialCatalogPages.tsx:309` 兼容跳转丢回执 query；工单详情 ADMIN 分支 `!presentation` 早退不播回执；`ReceiptUrlCleanup` 在真实 App Router 下没有 e2e。
- 地址：建单主地址（`OrderForm.tsx:3604`，仍 `preventDefault` 粘贴、无条件写姓名 / 电话 / 省份）与额外地址（`:3356`，忽略 `source`）没走「粘贴覆盖、手输补空」，`OrderForm-logistics-quote.test.ts:97` 还把无条件写省份锁成契约；手机号不去 `-`；姓名可能取到「中国」。服务端仍信任客户端 `destinationProvince`。
- 烫金：反查只在浏览器端做，`lib/order/change-request.ts` 写入 `frontFoilColors` 前没有同样的兜底。
- 寄样：管理员草稿完整编辑（`lib/order/admin-edit.ts:56`）不拦非 STANDARD 工单增改款式（改单申请有这道闸）；下发时内存校验 `CONFIRMED→RELEASED→PACKING` 但库里直接写 PACKING。
- 上传：CDR 多选后服务端没有每款文件个数上限（单文件大小与 key 前缀有闸）。
- 物流：内部工单改单 / 管理员编辑不重算物流行（`change-request.ts:2972`、`:5844` 仍只认 `EXTERNAL_SALES`）；`hasLogisticsChargeRows` 的 `priceBookId?` 可选类型会把「漏 select」当成「补录」。
- 备份：`scripts/lib/backup-readiness.mjs:27` 按每个 repo 自己的最大 db id 认定当前库，集群重建且 repo2 没跟上 stanza-upgrade 时会误绿；两个 full timer 都 `Persistent=true` 无互斥，主机恰在 01:00–01:30 重启会并发抢 stanza 锁、`StartLimitBurst=3` 可能打掉当天 OSS full；门禁不证明 repo2 连续归档；`--info-file` 不校验快照新鲜度；`pgbackrest info` 失败时吞 stderr。
- 迁移：`ProductionReportDispute` 的部分唯一索引 / CHECK / 触发器只在手写 SQL 里，schema 无对应，日后 `migrate dev` 可能生成删除它们的迁移。

### 待业主拍板（2026-09-18：关联物料已停用的历史工单能否重算）

- 此问题自 2026-09-18 起即为生产现状，不依赖下架方案是否启动；本轮未重新访问生产。2026-09-20 将待确认范围扩展为历史重算是否忽略产品与物料当前启用状态。共享适配器 `lib/order/create-order-quote-facts-adapter.ts:738–745` 拒绝停用产品；`:382–387` 拒绝停用/缺货的关联纸张；无外键专版也在 `:417–435` 检查物料身份与状态。120g 产品保留不代表所有历史工单都能重算。
- 选项 A：历史重算忽略物料当前启用状态、只看已发布价目——要改适配器，并补 change-request 层的真实回归（现有 `change-request.test.ts` mock 了整个报价服务，兜不住）。选项 B：维持现状，业务上用管理员终价绕过。本轮未擅自放宽。
- **仍待确认**：本期不选、不改适配器；选项 B 的管理员终价绕过尚未在真实调用链上验证。此项也是后续下架方案的前置问题，需单独评审历史模式与真实改单/取消结算调用链回归。已同步 PROGRESS。
- 已确认的约束保持：改单新增款式（含原样复制模板）按新准入拦截，模板原款式历史重算不受影响；重做工单边界（第三轮 T9）一并进入后续方案。

### 待业主拍板（2026-09-14 深夜新增：代理商月度账单 review 结论）

范围：`lib/agent-monthly-billing/*`、`actions/agent-monthly-bill*.ts`、`app/(billing)/owner/agent-bills`、`app/(admin)/sales/bills`。
流转：工单 SETTLED / CANCELLED 且 `settledFee` 非空 → 按 `submitterId` + 上海月份归集为 (agentUserId, period) 一张 DRAFT →
管理员确认冻结（总额 0 自动 PAID）→ 管理员整单登记收款（金额固定 = 总额，一张不可变回执）→ PAID；跨月负项以不可变
Credit 记录、只能分配到同一销售之后的 DRAFT，且封顶不超过成员小计。cron `generate-bills` 每月按上一上海月走同一 v2 写入。
隔离：销售端全部经 `sales-query.ts` 的 `agentUserId = actor.id`，有测试锁定；管理端动作全部 ADMIN。触发器保证冻结后
子表不可变、成员快照必须与工单结算事实一致。并发有 6 组 postgres 测试。**没有发现串账或越权。**
缺口处理结果（2026-09-14 深夜，Codex `gpt-6-astra` 写模式执行、Claude 对抗复审后提交 dbe42aa7 / 8b7663a1 / 0e03fee9）：
1. ✅ 销售端详情新增「收款记录」区块（金额 / 时间 / 方式 / 流水号，无回执给空态）。凭证附件仍没有字段，回执只是登记。
2. ✅ 明细区分「已取消（取消费）」/「已结算」，工单号链接到销售端工单详情。逐项费用拆分仍要回工单看。
3. ⏸ 收款只能整单全额一次、确认后不可撤销 —— 需要模型变更与业务规则，待业主拍板。
4. ✅ 列表 DRAFT 行标「整理中 / 金额未定稿」，统计卡拆成整理中 / 待支付 / 已结清；**没有隐藏 DRAFT**，是否对销售隐藏待拍板。
5. ✅ 新增 `bill:manage`（ADMIN），代理商账单与旧账单共 7 个写动作改用它；`bill:view:all` 只留只读。角色映射未变。
6. ⏸ 管理端按销售汇总表 / 分组导出 —— 新功能，待业主拍板。
复审时我改掉的 Codex 取舍：未知结算状态原显示「未识别配置」→ 改为原样显示快照值；DRAFT 详情页补了与列表一致的未定稿提示；
页面 SSR 测试从 `lib/agent-monthly-billing/__tests__` 移到 `app/(admin)/__tests__/sales-bill-pages.test.tsx`。
门禁：lint 0 错、typecheck 通过、全量 vitest 6720 通过（`raw-sql-settlement-contract` 在与 lint 并发时超时，单跑 1.5s 通过）。
Codex 对抗审查两轮（只读，`gpt-6-astra`）：第一轮 0 P1/P2、1 P3（销售端状态文案三处不一致）→ 2ad3a12f 新增
`SALES_AGENT_MONTHLY_BILL_STATUS_REGISTRY`（整理中 / 待支付 / 已结清）两页统一取用；第二轮 0 P1/P2、1 P3（详情徽标
断言可被未定稿提示条满足、注册表契约分不清两端）→ fa406ba0 徽标按三状态参数化只取 `data-slot=badge`、契约改前缀否定匹配。
复审后全量 vitest 6725 通过（616 文件）。教训：fa406ba0 曾在 vitest 启动挂起被杀后经 `| tail` 管道把退出码抹成 0 而提交推送，
事后单跑 / 合跑均通过，内容无误，但门禁被绕过了一次；此后链式门禁一律 `set -o pipefail`。

### 已拍板并修复（2026-09-14：存量工单过不了生产就绪校验）

本节下方保留发现时的证据与建议；最终口径为：价格可先保存、就绪问题仅提示，管理员补齐缺失的工艺与包装组后走正常接单/下发，不放宽生产闸口。

- **现象**：开发库工单 `e2e-multi-address-…` 核价页报「款式 #1 缺少可唯一映射的 canonical 工艺；工单没有包装组；款式 #1 未加入任一包装组」，
  同一表单下方却写「待核价必填项已完成，可以确认费用」，详情页「包装组（0）」。
- **直接原因**：这张单是 e2e 用裸 SQL 插进开发库的（`tests/e2e/order-multiple-addresses.spec.ts`），没有 `OrderPackagingGroup`，
  `OrderItem.craft` 为 NULL。开发库 560 张工单里 443 张是 e2e 残留、457 张没有包装组；非 e2e 的只有 2 张（`GD-260807-001` 草稿、
  `multi-address-…回归工单`）。
- **结构性原因（不只是脏数据）**：
  1. `lib/production/operation-materializer.ts` 只认 canonical 事实（`OrderItem.craft` + 包装组）。迁移 `20260828101000` 只把三条计价路线
     回填成 craft，`MANUAL_QUOTE` 刻意留 NULL；包装组表 `20260826140000` 从未回填。DECISIONS 2026-09-08 明确「本次不批量回填旧工单」。
  2. 该校验（`prepareOrderForProductionInTx`）挂在 5 个动作上：`submitOrder`、`confirmFactoryOrder`、`releaseFactoryOrder`、`editAdminOrder`、
     `reviewOrderChangeRequest` + 核价终价。**没有任何 UI 能给存量单补包装组或 craft**：包装组只在 `createOrder` / `rework` 创建，
     管理员编辑的 `packagingGroups` 必须带已有 `packagingGroupId`，改单也不创建组。存量单一旦进这些状态就卡死。
  3. 核价预览（`previewOrderPricingReview`）不做就绪预检，`missingRequirements` 只算价格字段，所以表单一边说可以确认、一边终价被服务端拒绝。
     工单列表倒是有 `confirmationPreflight`（`admin-workspace.ts:668`）会禁用「确认/下发」，两处口径不一致。
  4. `lib/production/operation-migration-preflight.ts` 有只读的 `preflightLegacyOperationConversion`（注释写明「部署前有一张单被阻断就要停，
     另跑经审的转换事务」），但没有任何脚本 / runbook 调用它。
  5. 14 个 e2e 文件用裸 SQL 插 `"Order"`，只有 5 个同时插包装组——夹具绕过领域层，会持续制造这类不满足不变量的数据；
     它们曾在共用开发库的年代跑过，所以开发库才长这样。
- **生产影响**：生产仍在 `aa42ba0`（无包装组表、无 craft 列）。部署本 PR 后，所有老工单都没有包装组、`MANUAL_QUOTE` 款式 craft 为 NULL；
  凡还停在 SUBMITTED / PENDING_FACTORY / CONFIRMED（待下发）或之后需要编辑 / 改单的老单，都会撞上同样的阻断且无法自救。
  已在生产的 IN_PRODUCTION 及之后状态不受影响（校验只在 awaiting-factory-confirmation 与下发路径跑）。
- **建议（需拍板）**：(a) 部署前跑 `preflightLegacyOperationConversion` 类的只读清单，把生产库里将被阻断的老单数出来；
  (b) 给存量单一条补录路径：要么迁移 / 脚本按老 `OrderItem.pack` 与 `crafts` 生成包装组和 craft，要么在管理员编辑里允许新增包装组并设定 craft；
  (c) 核价预览接入 `inspectOrderProductionReadinessInTx`，把阻断项显示在表单里、禁用确认按钮，和列表口径一致；
  (d) e2e 夹具改走领域层创建（或至少补齐包装组 / craft），并在隔离库上运行，别再往开发库塞裸 SQL 工单。
- 开发库里那 443 张 e2e 残留可整体清理，但要业主点头（含关联的收费 / 发货 / 日志行）。

### 待业主拍板（本批新增，代码已按默认口径落地）

- **盘点「部分过账」语义需业主点头**：一次提交现在可能只过账一部分行，`InventoryCount` 单据上只有被接受的那些，冲突行原样退回要求重数。原设计是一行冲突整单驳回（99 行合格数据陪葬且无 override）。风险评估为低（盘点行本来就是逐 (物料, 库位) 独立的），但要确认。
- **师傅超报要多一次提交往返**（零 JS 下是整页 POST + 重渲染），弱网车间会感知到延迟。这是拍板方案的固有成本，上线前跟业主对一次预期。
- **首页「24 小时推送失败」告警条的计数语义变了**：瞬时抖动不再点红，重试成功会把历史 `FAILED` 行就地翻成 `SUCCESS`。上线前告知业主，别让人以为数据丢了。
- **`ProductionTask.remark` 的写入格式从此是对外契约**：`[超计划报工] YYYY-MM-DD 计划 N / 合计 M（合格 a / 不良 b / 返工 c），报工人 <id>，已勾选确认`，多次写入 `\n` 追加；老板看板「明细」列原样渲染它。
- **`pnpm test:browser` 是否纳入 §6.3 文档化门禁仍需业主拍板**：当前只有 `components/business/cdr/__tests__/CreateBundleForm.browser.spec.tsx` 等交互契约落在该通道，但 `CLAUDE.md` / `DECISIONS.md` 都还没把它写成正式门禁。本轮只在单文件层面使用普通 Vitest 守住共享 Checkbox 的 Enter/Space wrapper 契约，没有擅自接浏览器门禁。

### **CLAUDE.md 待业主落笔**（配置文件，AI 不改）

- **§4.5 措辞已漂移**：`reportTasks` 实际是「逐任务 advisory 锁 + 读 + 逐条 update」，比文档描述的 `updateMany({ where: { status } })` **更稳**，但 §4.5 与 DECISIONS 2026-08-19 的措辞都还停在旧写法。（`beginTasks` 仍符合原描述，不要改错。）
- **§15.7 或 §5.3 值得补一句**：`Setting` 现在有 4 个键，`report_qty_max_multiple` 是唯一 money-adjacent 的那个（守着会算出计件金额那条路径），但 `resolveSetting` 的「校验不过退回 fallback」对它仍然安全——它不参与金额计算、只是一个上界，退回 3 只会更严。这一条已写进 `lib/settings/definitions.ts` 的 doc 注释和 `definitions.test.ts`，只是 CLAUDE.md 里还没有。

### 上一批带出、仍未拍板

- **薪资「当天 / 当月」重算的残余风险**：现只拒绝**严格未来**（日薪 `date > 今天`、月结 `month > 本月`）。(1) 当天日薪——上午 10 点点一次全员重算，当天还没报工的师傅会被写出一条只有 `dailyBase` 的正式行，能被标记已发，晚上真报工后重算又被 paid guard 挡住，只能人工撤销。(2) 月中月结更肉疼——COOK 的 `monthlyBasePay` 是整月 flat、不按天折算，月中重算厨师立刻拿满一整月 `COOK_MONTHLY`。选项 A（现状）/ B（月结改成只允许已结束的月份，方案作者推荐）/ C（连当天也拒）。任一选择都只动谓词里一个比较符 + 一条测试断言。
- **交期预警口径**：(1) 未提交的草稿单 `DRAFT` 该不该继续留在 `PROMISE_ALERT_STATUSES`？摘掉的影响不止看板——工单详情页 `PromisedDateBadge` 用同一份清单，草稿单详情页会同时不再显示「已逾期」红标。(2) 逾期超过多少天后停止预警/推送？要设就按 `outsource_overdue_days` 的样子加 `Setting`（建议 key `order_overdue_alert_max_days`），不硬编码。
- **师傅端「我的工单」**：是否接受不再急单置顶（待办队列仍在 `/worker/tasks`，那里保持急单分组）；每页 20 条（`WORKER_ORDER_PAGE_SIZE`）对手机端是否合适。
- **登录限流配套**：厂区 NAT 出口 IP 是否加 `geo` 白名单；429 是否配 `error_page` 友好提示；应用层账号级失败锁定是否另立项（现状完全没有）。
- **6 处冗余 `router.refresh()`**：已确认「`revalidatePath` 不刷 client RSC 缓存」是错误认知。选 A（清代码 + 订正注释）/ B（只订正注释，当前做法）/ C（照抄 refresh）。

### 长期未决

- 默认本地开发库 `print_shop_erp` 尚不能直接跑本发布候选：前向 migration `20260807180000_order_pricing_and_settlement` 的财务护栏识别到已全额结清账单 `cmsbmplo40008850rahu58pb4`（已付 ¥3000、2 笔付款）混入非外部销售项目，拒绝自动改写。失败 migration 已按 Prisma 标准流程标为 rolled back，未删除或修正业务行。必须先由业务负责人决定该历史账单归属，再显式修复，不能绕过护栏或猜测重分账。
- 生产 pgBackRest 只有 repo1 且仅保留 2 份 full；即时备份和 WAL 正常，但两 repo / 30 天 / 月度恢复演练目标未达成。
- 生产尚未配置 `SENTRY_DSN`，`APP_VERSION` 需核对；当前错误主要依赖 PM2 / Next 日志。
- `deploy-smoke` 尚未自动继承 PM2 的系统 Chromium 路径与 root sandbox 参数，直接按旧文档运行会假失败。
- 应用机仅 1.6 GiB RAM，构建严重依赖 swap。
- 新增三款 A4 视觉基线已生成；既有 7 张打印基线未重写。`pnpm-workspace.yaml` 的 `allowBuilds` 占位符待业主定夺。
- A07（推送按人路由）/ A20（生产单拆分）业务输入，以及 A21 供应商合同自动定价的工艺、单位、阶梯、最低收费与有效期口径。
- 后台任务账本尚无自动保留清理策略。**注意**：将来给 `NotificationLog` 加保留期时，必须排除「所属 `BackgroundJob` 仍在 `PENDING`/`RUNNING`」的行——`deliveryKey` 行是幂等凭证，删早了会让重试对已收到消息的群重复推送。
- 已结算/已发客服提成遇跨周期撤单或降价时的政策（下期扣回 / 历史工资调整 / 不追溯）；客服停用或改岗时同样不能猜测。当前代码宁可整体阻断。
- 已发布报价条件仍有 `productCodes / craftCodes` 字符串引用；若允许修改产品/工艺编码，需改用稳定 ID 或在仍被 CURRENT/SCHEDULED 价目引用时阻止改码。
- 收费类目若要新增停用入口，必须先明确 `category.isActive` 是「全局紧急停收」还是「随冻结版本不漂移」。

## 历史（追加式时间线）

- 2026-04-22：建立了项目记忆管理体系（PROGRESS / DECISIONS / HANDOFF + CLAUDE.md §13）。
- 2026-04-22 → 2026-04-23：完成 P0 #1 认证与用户管理全部切片。149 单测，Codex 15 轮 review。
- 2026-04-23：完成 P0 #2 工艺字典 + 产品字典。+100 单测（累计 249），Codex 9 轮。
- 2026-04-23：完成 P0 #3 工单核心（E-lean）。21 commits，+151 单测（累计 400），Codex rounds 25–36。E-full 延期 P1。
- 2026-04-23：完成 P0 #4 生产流程。+107 单测（累计 507），Codex rounds 37–42。
- 2026-04-24：完成 P0 #5 薪资系统 4/5 切片。+119 单测（累计 626），Codex rounds 43–47。
- 2026-04-24：完成 P0 #5 Slice C（时薪工 + 考勤）。+90 单测（累计 716），Codex rounds 48–51。
- 2026-04-25：完成 P0 #6 Slice A 应收账单后端。+56 单测（累计 772），Codex rounds 52–54。
- 2026-04-25：闭合 P0 #5 遗留 daily-salary race（commit `50956ee`）。+4 单测（累计 776）。
- 2026-04-25：完成 P0 #6 Slice B/C/D 账单 UI + cron。Codex rounds 55–63。P0 #1–#6 全 clean。
- 2026-04-25：上线前运维补齐 + Sentry 隐私收紧（rounds 64–69）。
- 2026-04-25 → 2026-04-26：本地真跑暴露 4 个 prod-only bug 全修（rounds 70–72）。
- 2026-04-26：Playwright E2E + 视觉回归落地（5 waves，13 测试，rounds 73–94）。
- 2026-04-26：SHIP / FINISH 状态机收尾，Order.status 写入路径统一 advisory lock（rounds 87–88）。
- 2026-04-26：Admin shell scaffolding（AppSidebar / AdminBreadcrumb，round 81 收敛）。
- 2026-04-26 → 2026-04-27：P1 #1 管理员 Dashboard 三切片（KPI / 关注列表 / recharts 图表）。+68 单测（累计 870），rounds 98–100。
- 2026-04-27 → 2026-05-05：P1 #2 企业微信推送四切片（引擎 / admin UI / 状态机 wire / cron）。+121 单测（累计 991），rounds 101–118。
- 2026-05-05：P0 #7 CDR 汇总下载落地。+20 单测（累计 1011）。
- 2026-05-06：CDR 收尾审计 8 轮（rounds 119–126，baseUrl 推导硬化）。+12 单测（累计 1035）。**P0 9/9 收官**。
- 2026-06-28：（Codex 批次，工作区交付）Pigsty 扩展 PR-1..10 + admin 框架 A11–A15 + ERP 主数据 A16–A19 + 审计 A22 + 客户端数据层 POC A23 + agent 自动化协议（backlog / routines / agent:next）。16 个新 migration。
- 2026-07-05：（本 session）UI Phase A–E 之后的工作区大批次全量验证绿（1214 单测 / 21 Playwright / build / lint / typecheck / migrate deploy）；A09 分区 cutover 计划交付 `docs/partition-cutover-plan.md`（Codex 2 findings 闭合）；PROGRESS.md 刷新到真实状态。队列无 `agent-ready` 任务，剩余项等业主输入。
- 2026-07-05：（业主授权）大批次按模块拆 12 commit 固化（`c84162f → accb713`）；STOCK_ALERT 出库跨越检测接线收官 SPEC §8.1 10/10 事件（`3184a26` + `4f76a85`，Codex 抓 payload 丢尾零 + 测试锁提交顺序，复核 clean）。1220 单测 / lint / typecheck 全绿。
- 2026-07-05：**A06 OSS STS 真实接入**（`968b131` feat + `d65804f` / `89b1302` fix，Codex rounds 抓 6 真 bug）。业主提供 bucket `hongbaowebdb` / region `oss-cn-guangzhou` / 角色 `erp-oss-upload` / 子账号 `webhongbao` AK（**曾误填 .env.example，已迁 .env 并恢复模板，密钥未进 git**；region 从完整域名归一化）。`ali-oss` + `archiver` 落地：signViaSts 真 AssumeRole（session policy 收缩单 objectKey，1h）+ CDR 流式打包（get→zip→putStream bundles/* + 24h 预签 GET，长期凭证——STS 1h 签不出 24h 链接）。Codex 6 修：endpoint 走 config、putStream settled 折叠防 unhandled rejection、CDR mock 非生产默认开、expiresAt 对齐签发时刻、malformed OSS_ENDPOINT 双路径降级（sign 折叠 error / isMockMode 降级 mock 防 /foreman/cdr 500）、PassThrough destroy 需先挂 error 监听器（否则崩进程）。真实冒烟：AssumeRole ✅ / 临时凭证 PUT design/* ✅ / 越权护栏 ✅ / 子账号直连 ❌（等业主挂策略）。测试对象遗留 bucket（无 DeleteObject 权限，预期）。1229 单测全绿。pnpm store v10/v11 冲突用 `CI=true pnpm install` 重链接解决。
- 2026-07-05：A06 全链路验证收官——业主挂好 `webhongbao` 对象策略后复跑冒烟 6/6 全通；真实 `uploadBundleZip` 端到端（archiver 流式打包 + 预签 URL 下载 + ZIP 魔数校验）通过。
- 2026-07-05：设计图上传 UI 接线（`3849cbd` + `ed9733e`）。工单详情页款式卡设计图面板（DRAFT 增删/其余只读）；预签 PUT URL 直传（前端零 SDK）；Codex 抓 5 真 bug 全修：sign 前置授权闸（防任意 id 铸凭证写孤儿对象）、HEAD Content-Length 权威 size + 上限兜底（防申报小传大）、order-cascade 锁内 fresh-read（防与提交并发 TOCTOU）、凭证 1h→15min（压缩重放覆写窗口，ETag 固定记 P1）、input 重置。预签 PUT 真实冒烟（含错误 Content-Type 403 护栏）通过。1242 单测。
- 2026-07-06：上线前检查 + 注释清理（`f0cebce`）。全库移除 90+ 处 "Codex round N" 溯源标注（保留约束说明；历史在 git log/HANDOFF/DECISIONS 可查），49 文件纯注释改动。教训：第一版全局正则把代码里的 `()` 也删了——回滚重做，改成只作用于注释行的脚本 + 跨行引用逐处手修。验证：tsc / eslint / 1249 单测 / next build / deploy:smoke（prisma validate + migrate status + mock-mode + Puppeteer + 路由探测）/ 21 Playwright E2E+视觉 全绿。生产部署剩纯运维动作（README §🚢）：服务器 .env 真值、NOTIFICATION_MOCK_MODE=false、OSS CORS 加生产域名、pg_cron 切换、pgbackrest、Pigsty 扩展安装。
- 2026-07-07：承诺交期 + 交期预警 + ORDER_OVERDUE 推送 + 二维码 URL 化（`d240061` / `1483867` / `5d6b04a` / `6c3fdc5`）。Order.promisedDate（2 个 migration：字段 + 规则行数据迁移）；预警口径集中 lib/order/promised-date（详情徽标 / dashboard 关注列表 / 每日 cron 三处共用）；第 11 个推送事件 ORDER_OVERDUE 只推逾期；QR 内容改 {base}/orders|worker/tasks URL（lib/public-base-url 与 CDR 共用推导，foreman-cdr 去重）；打印页眉加承诺交期行。Codex 抓 3 真问题：升级库缺规则行（数据 migration 修，高危）、视觉基线（按惯例截图待业主确认后提交）、cron E2E 缺口（补全链测试）。1264 单测 / 22 E2E 全绿。**待办：视觉基线 6 张 png 等业主看截图 OK 后以 [visual-regression] commit 提交。**
- 2026-07-08：上线前多维度审计（6 维度并行 audit → 逐条对抗性验证 workflow，54 agent；含手动核实）。发现并**即修 4 项**：(1) **blocker** `createOrderFromInput`/`scheduleOrderFromInput` 从 'use server' 导出成公开 Server Action、信任调用方 actor 无 requirePermission = 越权+审计伪造后门，零调用方直接删除（`5bdf5a3`）；(2) **high** `.env.example` 出厂 `NOTIFICATION_MOCK_MODE="true"` 会诱导运维带进生产静默 mock 推送→改留空按 NODE_ENV 判定（`3eaf050`）；(3) README env 表补 mock 开关行+OSS CORS 手动步骤+APP_PUBLIC_URL 扩到二维码、6→7 cron 漂移修正（`3eaf050`）；(4) **low** hourly-payroll cron 意外错误 scrub 对齐 COUNTS-ONLY（`c5ac707`）。1264 单测/tsc/eslint/build 全绿。**剩余为纯手动运维项**（见报告）：生产 .env 注入（APP_PUBLIC_URL/SENTRY_DSN/AUTH_SECRET 新值/DATABASE_URL 生产库）、OSS 控制台配 CORS、首次 seed、cron 调度器（crontab/pg_cron 7 端点）、Pigsty 扩展安装、pgbackrest、Puppeteer chrome、PM2/Nginx 自备。视觉基线 6 png 仍待业主确认后提交。
- 2026-07-09：全库架构体检（6 子系统深读 + 44 agent 提案验证 workflow）→ 7 个行为零变化重构切片落地（日期/cron 认证/OSS 工厂+锁 key/通知常量/collectFieldErrors/createOrder 批量/薪资规则查询，`06ecc62`→`f4b6ab7`），Codex 复核 PASS，1272 单测全绿；交付 `docs/archive/架构体检报告-2026-07-09.md`（含行为缺口 A1-A7、结构债清单、已验证路线图、不做清单）；DECISIONS 记录去重边界决策。
- 2026-07-17：生产硬化：PostgreSQL 任务账本 + LIGHT/HEAVY worker + cron/通知持久化 + CDR/PDF 资源隔离 + live/ready + ADMIN 任务看板 + pgBackRest 验收脚本落地。本地 migration 和 PDF worker 真实演练通过；1296 单测 / lint / typecheck / build 全绿。
- 2026-07-17：生产硬化上线前纠偏：修复 worker 资源限制落在 tsx 包装进程、durable 通知可抛、终态 dedupe 永久占位、CDR 永久 PENDING、未知任务不进 fail、部署 env/重启配置和 PDF 排队体验；补齐生产分支测试，1353 单测 / lint / typecheck / Prisma validate / build 全绿。
- 2026-07-19：后台角色收敛：OWNER / FOREMAN 数据与权限统一迁移为 ADMIN，管理员菜单合并经营、生产、财务、字典和运维入口；保留 `/owner/*`、`/foreman/*` 旧 URL，旧 JWT 与早期默认姓名自动归一化。迁移已在本地库执行并确认 3 个管理账号全部为 ADMIN，后台不再展示“老板/车间主管”；1397 单测 / 3 项登录 E2E / lint / typecheck / Prisma validate / build / 页面实测全绿。
- 2026-07-19：新工单号改为 `GD-YYMMDD-XXX`（例 `GD-260719-001`），保留历史编号；上海业务日 advisory lock 与严格三位流水校验继续生效。配置迁移已执行，真实新建工单 E2E 与工单列表页面验证通过。
- 2026-07-31：管理端履约与售后增强：多地址发货/分地址运单、顺丰到付后期更正、免计费关联重做、批量派工与三款 A4 单页打印落地。本地迁移和真实 Chromium 打印验收通过；109 文件 / 1479 单测全绿。
- 2026-07-31：工单变更、生产、薪资与财务闭环：版本化修改申请、彩印+烫金混合排产、师傅批量开工/完工、风车机新阶梯与账号规则、日期底薪对比、全员半天考勤、客服销售额/结款/成本分账落地；111 文件 / 1496 单测、36 项跨设备 UI、8 项打印视觉/PDF、生产 build 全绿。
- 2026-07-31：待排产列表升级为按兼容工艺分步批量排产：先选师傅再跨工单勾选，混合机型可分两次派给不同师傅；PENDING 草稿由 Order 状态双重门控，全部派完才进入生产。真实同机型批量与混合机型两阶段 E2E 均通过。
- 2026-07-31：修复删除/停用账号的长效 JWT 仍可进入排产动作并在 OrderLog 外键处 500；统一数据库实时会话校验，排产动作提供重新登录恢复态，真实失效会话 E2E 验证零任务落库。
- 2026-07-31：多能力师傅与管理员最终派工落地：账号支持主机型/多设备/熟练工艺，单单/批量/改派统一推荐与硬资格，非推荐派工强制原因并审计；任务按实际设备计薪，个人规则覆盖全部登记机型。1527 单测、4 项真实排产 E2E、375px 明暗与 1280px 管理端 UI 门禁、生产 build 全绿。
- 2026-08-02：财务/薪资/外协对账审查以 `aa42ba0` 固化（121 文件 / 1688 单测、45 项 fresh migration 全绿），随后发布到 <https://bag.sshapi.cn>。Pigsty 上线前 full backup `20260802-193420F` 成功，生产 12 条待迁移全部应用，三 PM2 进程、ready、HTTPS 路由和系统 Chromium PDF 内存生成验收通过；同时确认 repo2/Sentry/内存升级与 smoke 口径为后续运维缺口。
- 2026-08-03：同步近期功能与生产事实到三份记忆文档、README、部署/冒烟/SLO 和同事使用手册；清除 A06、任务排序、工单修改申请与生产 Chromium 等陈旧口径，并记录发布分支领先 `main`、无 Git remote 的恢复风险。
- 2026-08-07：工单列表新单优先、37 类独立筛选、稳定服务端分页和 ADMIN 全量/筛选异步 XLSX 导出在本地收官。导出包含 11 工作表、精确 Decimal、发起人+当前 ADMIN 双重授权、24h 保留和第 8 cron；事务模糊提交、过期竞态、终态 PII 收缩与删除重试经对抗性复核闭合。筛选表单导航同步、烫金色可逆转义和 WORKER 排产草稿边界已补回归；Fresh 64 migration、1840 单测、build 和 24 项全视口/axe 门禁全绿；未 commit、未部署。
- 2026-08-07：修复管理端工单详情把工艺 ID 直接显示给用户的问题；详情查询批量映射中文名并保留历史/缺失回退，款式卡补数量、四位单价、小计和准确排产语义。139 文件 / 1845 单测、生产 build、24 项全视口明暗/axe 门禁及真实草稿单浏览器回归全绿；未 commit、未部署。
- 2026-08-07：完成对客加工费自动报价与资金方向隔离：订单冻结结算类型，产品阶梯/基础价叠加工艺收费项并保存快照，MOQ 失败关闭，改单提供只读差额预览且批准时重新报价；客户应收、内部工资/提成、师傅计件和供应商应付互不复用。历史建议单价、考勤身份快照和数据库兼容围栏由第 67–71 项前向 migration 严格收口；本地库及 PostgreSQL 16 空库 71 / 71、156 文件 / 2070 单测、空库 Dashboard E2E、typecheck、lint、Prisma、生产 build 全绿；未 commit、未部署。
- 2026-08-08：外部销售快递/打包耗材对客收费完成：中通与纸箱两份来源的 SHA-256/单元格证据、每票创建估算、最终重量发货终审、顺丰到付管理员后期更正、改单耗材跨档重算、账单分项与工厂内部成本分账均已收口。74 / 74 migrations、170 个测试文件 / 2265 项单测、typecheck、lint、Prisma validate、生产 build、375px + 1280px 管理/销售明暗响应式 + axe 门禁全绿；未 commit、未部署。
- 2026-08-09：外部销售报价统一为管理/销售单入口，已接入 PROCESSING/LOGISTICS 草稿复制、单项目编辑、严格校验、上海时间发布与放弃；已发布版只读，技术证据不进入业务页面，并发陈旧覆盖失败关闭。178 个测试文件 / 2325 项单测、typecheck、lint、Prisma validate、生产 build、375×667 管理/销售 viewport+axe+touch 门禁全绿；真实草稿页技术字段零可见且无横向溢出。未 commit、未部署。
- 2026-08-11：管理端外部销售收费拆为 `/items` 日常工作台与 `/versions` 发布中心，左侧菜单可直达；121 条加工规则与物流规则支持服务端搜索、类目/产品/省份/数量/计价/状态组合筛选和当前价→草稿价对比。客户端编辑 DTO 已裁掉 code/JSON/SHA/Excel/互斥组/优先级，服务端写锁内保留技术条件并同步产品匹配。计划生效与无当前版不再显示必失败动作；桌面长编辑器改为视口内滚动。180 文件 / 2362 单测、typecheck、lint、Prisma、build 及干净 74 migration 隔离库的 375×667、1280×800 管理/销售明暗 viewport+touch+axe 门禁全绿；未 commit、未部署。
- 2026-08-12：外部销售收费按纸张、产品/工艺/规格聚合精确数量锚点；157 克与 200 克严格分组，底层规则仍逐档独立。草稿可在一个编辑器中原子保存全部数量档金额/启停，固定总价与按个/按张/每万/每款单位分别诚实展示；181 文件 / 2427 单测、生产 build 和 12 个确定性响应式/axe 场景全绿；未 commit、未部署。
- 2026-08-17：将零 JS 硬约束收敛到登录、登出、改密码三条关键会话路径，新增禁用 JavaScript 的 Playwright project；师傅端开工/报工恢复原生 form 形状，其余后台 CRUD 不再被未拍板的全仓约束阻断。
- 2026-08-18：将工单筛选/导出、计价结算、工资与外协账本、外部销售加工/物流价目、收费工作台、价格阶梯编辑、74 项 migration、测试和记录文档统一固化为提交 `feat: complete pricing, settlement, and order operations`。183 文件 / 2441 单测、typecheck、lint、Prisma、build、diff-check 与零 JS 会话门禁 3 / 3 全绿；本条只表示 Git 归档完成，生产仍为 `aa42ba0 / 45 migrations`。
- 2026-08-21：并行缺陷修复批次（11 项）：cron 密钥不再进 curl argv + 恒定时间比较、登录限流改挂 `location = /login` 并按方法豁免 GET、新增 `/api/health/jobs` 死信探针（`/ready` 状态码语义不变）、日薪/月结拒绝严格未来日期、`/owner/salary` 未发聚合下推数据库（+1 项 CONCURRENTLY 索引 migration，累计 75 项）、交期看板与逾期推送各自收窄并加 200 条 fan-out 安全阀、师傅端「我的工单」改 `createdAt desc` 分页、9 个详情页 `generateMetadata` 查真实业务编号（含四页越权标题泄漏修复）、`lib/order/export.ts` 全量显式 `select`、background-jobs 时间戳锚到数据库时钟、`OrderForm` 必填语义与 `AttendanceRecordDialog` 保存回执的无障碍修复。文档由单一 agent 统一同步：README、`docs/部署指南.md`、`docs/deployment-smoke-checklist.md`、`docs/production-slo-and-recovery.md`，DECISIONS 追加 12 条。**CLAUDE.md 未改**（配置文件，留给业主）。
- 2026-08-21：上线前对抗审查 + 修复。四条候选高风险修复经对抗性审查后**没有一条能照原样实施**，全部 blocking 破绽实读代码核对属实；定稿后落地四项：单条报工数量守卫（判据 `>=`、`Setting` 默认 3、配套老板看板「超计划报工」知情通道）、工单完工闸口收紧为款式级外协覆盖（残留粒度缺口显式接受）、盘点并发守卫改用逐行账面回声 CAS + 部分过账（时间戳基线方案整体否决）、通知投递失败可重试并进死信（`NotificationLog.deliveryKey` 幂等，+2 项 migration，累计 77 项）。OSS 直传重放加固与盘点 ledger scan 明确本批不做并写明理由与陷阱。新增 `docs/上线前置操作清单.md`（外协覆盖的两段部署前只读 SQL、唯一索引 `indisvalid` 验收、单向门与人工验证），DECISIONS 追加 6 条。**CLAUDE.md 未改**（留给业主）。
- 2026-08-22：发布源连续性收口。仓库首次配置 Git remote（`https://github.com/zora4523-bot/print-shop-erp.git`，私有）；`main`、`codex/complex-client-data-layer-poc`、`fix/launch-review` 三个分支推送完成。上线前审查的 17 项修复按主题拆成 10 个 commit 经 PR #1 合入发布分支，随后 PR #2 将发布分支快进合入 `main`（`245be5c → dd648c0`，104 commit / 795 文件）。合并后在 `main` 上复跑门禁：lint 0 / typecheck 0 / 206 文件 2758 项单测 / Prisma validate 全绿。**生产仍为 `aa42ba0` / 45 migrations，本次只是 Git 归档，未部署。**
- 2026-08-23：对工作区未提交加固批次（相对 `357a084`，111 文件 +5999/-1991 及 47 个未跟踪文件）做结构审查。结论：要求修改，不能按现状合入。报告 `docs/archive/代码质量审查-2026-08-23.md`，Codex 执行稿 `docs/archive/codex-prompt-代码质量审查修复-2026-08-23.md`。旧「RETRYING→FAILED」修法作废。未改业务代码，未 commit，未部署。
- 2026-08-23：Codex 独立复审代码质量审查；成立项已按规定修法收口并拆成 `f608e39 → 9dd1cc5` 小提交。未做 / 已证伪的是已发与冻结 roster 语义改写、删外协兼容缓存或把 `max` 改 `sum`、强搬所有取号进事务、客户端化 Server Component `<details>`、改登录令牌消耗时机及 `RETRYING→FAILED`；程序化门禁全绿，未部署。
- 2026-08-23：修复签名 JWT 仍有效但数据库账号已失效时 `/` 返回 500 并连带触发 Script 警告的问题；根路由现统一跳转 `/login`，四角色分流与异常透传回归已补，提交 `cbc88ca`，全量门禁与浏览器复验通过，未部署。
- 2026-08-24：入库 UI 重设计交付包（源：Downloads「定价表单优化分析」）。交互稿在 `docs/ux-redesign/`；定价对照 `docs/archive/定价表单优化-2026-08-24.md`；Codex 展示层执行稿 `docs/archive/codex-prompt-定价表单优化-2026-08-24.md`。首批只做外部销售工作台/阶梯表/发布中心，不做全站 12 项。未实现、未部署。
- 2026-08-24：按交互稿改已有页面（展示层，未 commit）：工单详情常驻动作条 + 时间线 + 款式折叠 + 取消收回页头；收费工作台阶梯 Δ / 粘性草稿条 / 两套只读文案 / 发布 L3 影响；排产「本次可派 / 阻断」列 + 师傅候选卡；Dashboard 处理队列优先（无毛利、无上次查看）；工单修改申请列表前移决策列；计件工资重算移到筛选行末。未碰 lib/actions/prisma。未部署。
- 2026-09-08：UI 规范三段式完成（只写 docs / lint / PR 模板，零 UI 代码改动，未 commit）。盘点 `docs/UI现状盘点.md`（原始扫描 `docs/audits/2026-09-08-ui-scan-*.md`）；对照裁决 `docs/audits/2026-09-08-UI对照裁决表.md`（业主确认，待拍板项按默认生效）；定稿 `docs/ui-规范.md`（§2 令牌、§7 文案，附录 A 豁免）；`docs/UI迁移清单.md` P0/P1/P2；新门禁 `scripts/ui-tokens/check.mjs` + `baseline.json`（裸色 / 内联金额 / deep import，存量 warn、新增 error、stale 报错）已挂进 `pnpm lint`，实测 0 error / 132 warn。随附的「七组原型 ui-规范.md」未送达，基准由四份原型 `:root` + 仓库条款拼合。同日完成 P0-3：`AdminOrderEditor` 的 Sheet「确认保存修改」与 Dialog 离开确认改走 `ConfirmActionController`，待补运费/阻断改为页内「核价结果」区，`AdminOrderEditor.browser.spec.tsx` 43/43。同日完成 P0-2：`app/`+`components/` 14 处 UTC 日期切片改 Shanghai formatter（真缺陷仅 `AccountForm` 默认入职日）。2026-09-09 完成 P0-1：金额全部走 `formatMoney` / `formatMoneyPlain` / `formatMoneyDelta` / `formatUnitPrice`，门禁新增拦 `¥ ${…}` 直拼，`baseline.json` money 待迁移清零；遗留阶梯价 4 位小数与费率格式两项待拍板（见迁移清单）。同日完成 P1-4（deep import 清零）与 P1-3（删 10 行无用 token）。P1-8 / P1-7 / P1-10 / P1-2 同日完成。P1-5 圆角间距归并同日完成。P1-6 与 P1-1 同日实施完毕（`baseline.json` 存量豁免清零；`--muted-foreground` 因 AA 压到 L 0.53），admin 门禁 axe 对比度归零、剩余失败为另一任务的工单号标题定位器；业主已目视确认；`.decision` 深色按钮方案另立 P2-12。P1 仅剩 P1-9 金额三态（待拍板）。P2 已完成 P2-9（关闭，无死导出）、P2-5（2/3，RulePriceWorkbench 因导航拦截豁免）、P2-8（空态工厂改「暂无X」/「没有匹配的X」）、P2-7（新增 `SectionLoading`，业务代码 `animate-pulse` 归零）、P2-11（手写横滚包裹归零，`TableScrollArea` 透传 div 属性）。三项待拍板已按业主授权定案（DECISIONS 2026-09-09：`formatRate`、保持 L2、三态收编 `pricingStatus`+`estimated`），P1-9 转 P2-13。P2-4（复制 hook）与 P2-12（决策列 emphasis，顺带修好批准/拒绝同色的潜在缺陷）已完成。P2-13（三态 helper，顺带把待核价的 destructive/warning 统一成 primary、销售端文案统一为「待工厂核价」）已完成。P2-1（状态药丸归并，6 组并行 + 对抗校验；顺带修掉归档账单外显原始枚举、销售端急单 danger 误用、临期/逾期同色，以及并行任务引入的 heading-order 回归）已完成，残余登记为 P2-14 / P2-15。P2 剩余：、P2-2 NativeSelect、P2-6 字段错误、P2-3 PendingButton、P2-10 disabled 审计。注意 `AdminOrderListLayout.browser.spec.tsx`（未跟踪，另一任务 WIP）等待尚不存在的「下发生产」按钮，整套超时，不是回归。
- 2026-09-14：结构体检（`docs/archive/项目结构体检-2026-09-14.md`）+ 四项收口 commit：架构门禁回绿（`e357efcc`）、忽略 Browser Mode 截图产物（`666e8d89`）、golden-gate 按 print-sentinel 谱系回读（`fb433c39`）、CLAUDE.md 1.3 同步现状。未推送、未部署、未跑 Codex 复审。
- 2026-09-14（续）：体检剩余项收口：`lib/auth/schemas.ts` 按域拆分（`3a70278e` + 测试改遍历 `6f8faa83`）、`docs/archive/` 归档 25 份过程文件并立规则（`d3254723`）、CLAUDE.md §3 / §15.3 同步。change-request / lib/order.ts / OrderForm 量过耦合度后**没有拆**，理由写在「当前任务」。
- 2026-09-14（Codex 复审）：两轮只读复审。一处中等问题（golden-gate 丢了当前生效版防线）由 `1f6556ef` 补回「按谱系登记期望」的第二条用例，`fde821fc` 修注释；其余提交核对无误。
- 2026-09-14（下午）：推 `codex/gongdanceshi` 开 PR #19。CI 先因 Actions 账单未启动；恢复后依次修：打印基线（`4a6d5fd9`，业主确认）、Browser Mode 5 个 spec 缺 mock（`010b154f`）、管理端六视口门禁两处过时断言（`77aebdd7`）、CLAUDE.md §14 E2E 流程（`13813008`）。均在 `codex/tijian-2` 修后快进 PR 分支。
- 2026-09-14（晚）：第三轮 CI 的 20 个 E2E / 六视口失败全部修完：真回归 `3578db20`（复制款式崩页）、装盒价目进 E2E 准备 `64f78382`、排行图省略 `aec6e722`、过时断言 `8622a5dc` / `65c2e1de`。均在隔离库 release 配置下逐条验证后快进 PR 分支。
- 2026-09-14（夜）：第四轮 CI 剩余 2 个时序失败改超时 / 加诊断（`8ec5bc74`、`997e512b`）；本地 durable、compat 绿；PROGRESS 补上 09-13 / 09-14。第五轮 CI（34833590442）复核中。
- 2026-09-14（深夜）：第五轮 CI 6 失败按诊断信息修 3 处（`53c983c4`、`41569c81`），第六轮 34838580706 复核中。顺着业主截图查出「存量工单过不了生产就绪校验」的结构性问题，已写进「待业主拍板」。
- 2026-09-14（夜）：第六轮 CI 诊断出装盒用例是默认纸张漂移（`1d23b144` 显式选纸）；探针坐实「半分金额下不了单」引擎缺陷（待拍板）。业主选择重建开发库：备份后 drop/create + 迁移 + seed + 回灌配置 + 装盒 / 十一档发布，残留清零。第七轮 CI 34845568496 复核中。

- 2026-09-15（上午）：前端缺陷批次 6 个提交（登录跳转查询串、异议面板、改密页、工资分页、逐字段 alert、零 JS 退出）；Codex 审计 + 实现，Claude 复审。
- 2026-09-15：按业主决定修复半分金额（0.01 容差 + 拆分先舍入）、终价不再被就绪校验回滚、新增管理员补录生产资料路径（`order:production-facts:repair`）；Codex 实现、Claude 复审提交。
- 2026-09-15（傍晚）：追 CI 三轮（`3caba196` / `ac61743c` / `5bdb907e`），账单恢复后 run 34927184124 全绿；PR #19 以 merge commit `d283b5a5` 合入 `main`，删 `codex/tijian-2` 与 `codex/gongdanceshi`。生产未部署。
- 2026-09-18（下午）：对抗 review 建单分层 / 师傅端 11 个提交出 5 项缺陷，逐项修复 + Codex 五轮追加共 12 个提交（120g 拦截移位、烫金反查与同名消歧、工资汇总全量、规格克重解锁、珠光暗红补齐）；全量单测 7024 通过，OrderCreationWorkspace browser spec 5/5。未 push。
- 2026-09-18（傍晚）：业主追加——收货地址输入统一复用粘贴自动识别组件（`d58f5e79`），六处接入，browser spec 4 文件 112 例通过；Codex 两轮追加修正（`090d3d01`、`9211fbed`：原生粘贴 + 统一「粘贴覆盖、手输补空」+ 客户地址城市/区县与省份前缀边界）。侧栏「工单」→「工单列表」、新增管理员「新建工单」常用入口（`feat(nav)`）。未 push。
- 2026-09-18（晚）：「保存后没反馈」审查 → 零依赖跳转回执推广：`lib/admin/receipt.ts` + `ReceiptNotice` / `ReceiptUrlCleanup`，18 处 redirect 带回执、17 个目标页播报，异议审核与销售文本编辑不再吞掉成功结果；全量单测 7158 通过、browser spec 2/2；开源候选（Base UI Toast / sonner / nuqs / next-safe-action / 两个 cookie flash 包）评估记入 DECISIONS。未 push。
- 2026-09-19（凌晨）：grok 无头只读对抗审查 PR #20 / #21 / #22（7 片并行，全部 MERGE_WITH_FOLLOWUPS、无 P0）；Claude 逐条核实后修 5 处共 4 个提交（补录物流行加地址卡死、附加费用入口与闸口不一致、新增款烫金反查、`safeReturnTo` 放行 `..`、计费省份被地名盖掉），其余记入「卡住的问题」；推送后 CI 两轮红（46 个提交从未跑过 e2e），同步 42 例过时用例并修 2 类真回归（师傅端零 JS 退出、393px 规格标签挤行）；CI 全绿后合并 PR #20。
- 2026-09-19（下午）：业主拍板 grok 带出的 4 项——补录运费切顺丰到付清零、冲正 = 作废原报工（只读 + 残留差额自动抵消）、师傅工资页只按显式日期筛选、寄样维持最小包装档；PR #23 以 `09f1a1ca` 合入 `main`。未部署。
- 2026-09-19（傍晚）：业主授权后由 Claude Code 按 09-17 同一受控流程把生产从 `0e6c009b` 切到 `09f1a1ca`（156 → 158 条迁移，停机约 4 分 40 秒），上线后检查通过；发布记录 `docs/audits/2026-09-19-production-release-09f1a1ca.md`。
- 2026-09-19（晚）：CI 提速——PR #24（快门禁先出、PR 两视口 / main 六视口等）合入 `main`；PR #25（共享构建 + E2E 分片）全绿 9.1 分钟，全绿等待 61.4 → 9.1 分钟。
- 2026-09-20：第四轮缩小纸张/规格方案并登记业主决定；第五轮继续落实 U1–U6 与小修，恢复 09-18 待拍板 A/B 原文，DECISIONS 保持上轮内容。累计仅四份文档未提交，未运行应用或数据库操作。
- 2026-09-20：完成纸张/规格缩小方案批次 1（`7a81c801`）：格子纯函数、身份函数抽取、只读预检与七处规格契约；137 + 31 + 23 项测试通过，未连目标库；批次 2 待接续。
- 2026-09-20：完成纸张/规格批次 2（`30b813ca`）：三入口共用多值身份，增加查重及文本引用保护；目标 77/0/0、非数据库回归 7228/0/43，批次 3 待目标库预检。
