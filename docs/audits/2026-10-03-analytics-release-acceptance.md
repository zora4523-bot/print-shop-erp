# Analytics 后续功能与发布验收

开始基线：`2850f39e698f6d97999dd06b376f21b2b9ebb738`；工作区和暂存区均干净。日期：2026-10-03。

## 范围与不变量

用户要求继续验收计划。本轮修复用户实际触发的派工页资料校验整页报错，并补充本地生产模式验收；不执行生产部署、push 或真实通知发送。

- 对工艺/包装资料不完整的工单列出名称、业务原因及详情入口；混合选择时阻止整批提交，不能静默丢弃异常单后发布其余工单。
- 只识别生产计划资料校验错误；数据库等未知异常继续抛出，不伪装为空数据。
- 权限入口、写入时的再次校验、排单复核、工价、工资、历史记录与事务原子性不变。没有修改 schema、迁移、依赖、共享视觉组件或全局样式。
- 未修改或补造用户数据；测试在隔离数据库生成专用工单，包括缺失工艺和包装组的回归样本。
- UI 沿用 PageHeader、ActionNotice、链接按钮；状态矩阵包含正常排单、异常整批阻止、正常/异常混合、长名称、查看详情/返回列表、九视口明暗、键盘、缩放和减少动效。

## 执行计划

1. 保留失败证据并修复派工页；完成领域/页面边界测试。
2. 类型、lint、架构、生产依赖审计、全量单测与既有覆盖率门禁。
3. 独立空库完整迁移链；生产构建、生产模式 analytics/工作台/账单 E2E；派工成功路径及异常恢复九视口。
4. 可用本地 durable worker/PDF/导出检查；外部生产配置、真实通知与目标环境 smoke 单独记录，不用 mock 代替。
5. 按十项 Design QA 记录实际结果，冻结源码后调用 Claude 对抗审查；达到 >9 分后本地提交。

## 回归证据

- 修复前 `pnpm exec vitest run lib/production/__tests__/dispatch-plan-errors.test.ts`：1 项失败，收到普通 Error，内容为用户报告的三条工艺/包装缺失错误。日志 `/tmp/erp-acceptance-20261003/dispatch-red.log`。
- 修复后目标三文件：9 项通过，覆盖可识别的资料校验错误、对外文案不泄露内部编码、混合批次阻止及未知异常继续抛出。

## 验收结果

临时证据目录 `/tmp/erp-acceptance-20261003`。源码测试与生产构建均为基线加本次增量；新改动必须单独经过最终 Claude 审查。

| 检查 | 实际结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过；2 条既存 Next 导航警告，UI 文案/token 无新增违例 |
| `pnpm check:architecture` | 通过；1216 模块、4976 依赖，24 项既存长函数债务 |
| `pnpm audit --prod --json` | 697 个生产依赖；info/low/moderate/high/critical 全为 0 |
| `pnpm test:backup` | 23/23 通过 |
| 隔离库 `vitest run --coverage --maxWorkers=2` | 779 文件通过、3 跳过；8640 项通过、46 跳过；103.45 秒；既有阈值全部通过。语句 86.9%、分支 81.01%、函数 91.86%、行 89.27%。46 跳过仍为上一轮的旧账单/专门环境套件，不计作通过 |
| `pnpm test:migrations:fresh` | 本轮新建空库 `erp_e2e_acceptance_fresh_20261003` 的 188 个迁移及后置条件全部通过 |
| `pnpm exec tsx scripts/e2e-release-build.ts` | 生产构建退出 0；`.next-release`，没有运行开发服务器；2 条既存动态文件系统 tracing 警告来自账单/工单导出产物清理函数 |
| production analytics / 工作台 / 账单 E2E | `E2E_PREBUILT=1 pnpm exec playwright test --config=playwright.release.config.ts tests/e2e/analytics.spec.ts tests/e2e/owner-dashboard.spec.ts tests/e2e/bill-flow.spec.ts --project=chromium --workers=1`，10/10 通过，24.4 秒 |
| production 派工资料异常九视口 | 同 release config，`tests/visual/production-dispatch.spec.ts --grep 'incomplete dispatch' --project='admin-*' --workers=2`，9/9 通过，18 秒；每视口明暗两主题，真实链接恢复、整批无写入断言通过 |

本轮 E2E 使用 `erp_e2e_analytics_20261003` 隔离库，普通 DATABASE_URL 仍为不同的参考库。测试账号和工价均为测试专用；模拟通知、CDR，不代表真实生产外部服务。生产构建中的上述两处 warning 文件未在本任务或 analytics 提交中修改。

生产模式 E2E 导航期间出现 React 服务端流 `The destination stream closed early` 日志。安装版 `react-server-dom-turbopack-server.node.production.js:3918` 明确由 destination close 取消处理器生成；浏览器业务断言通过。该日志与生产资料校验异常不同，不声称整份服务端日志无错误，后续保留连接取消日志降噪跟进。


## 后续完成结果

| 检查 | 实际结果 |
|---|---|
| 正常派工、数量审批、提成、发货生产模式 E2E | `tests/visual/production-dispatch.spec.ts --grep-invert 'incomplete dispatch' --project=admin-320x568 --project=admin-1280x800 --workers=1`，6/6 通过，1.1 分钟；含师傅端及销售端权限可见性 |
| 真实 durable worker | `pnpm exec playwright test --config=playwright.durable.config.ts tests/durable/files.spec.ts tests/durable/pdf-recovery.spec.ts`，4/4 通过，2.8 分钟；真实导出 XLSX 内容、IO 失败重试、月账单请求时快照、真实 PDF、离线恢复和重复下载授权；CDR 转换仍为 mock |
| 浏览器组件 | ProductionDispatchForm / AnalyticsTrend / AdminShellNavigation，3 文件、79/79 项通过，42.79 秒 |
| `pnpm exec prisma validate` | 通过；没有 schema 或迁移修改 |
| 开发预览补充检查 | 3100 已重启，隔离 E2E 库。320 / 1280px、正常 / 减少动效，Hover、Focus、Tab、Shift+Tab、Enter 详情/返回实际通过；焦点 outline 可见，pageerror 为零。`qa.log` / `qa-*.png` |

## Design QA（本轮派工异常恢复，按 1–10 顺序复核）

审查者：Codex 自查；没有冒充真人用户或真机测试。生产模式九视口截图目录：`test-results/production-dispatch-ui-baseline-candidates/`（不提交生成物）。目视复核 320px 浅色聚焦截图及 1280px 深色混合批次截图；工程门禁覆盖九视口两主题。原 analytics 的设计验收见此前 implementation audit，本轮未改 analytics 视觉。

| 顺序 | 检查 | 结果与证据 |
|---|---|---|
| 1 | 视觉层级 | 通过；页头明确安排生产，warning 明确本批阻止，异常工单名称链接和返回列表可见；无伪可用发布按钮 |
| 2 | 排版留白 | 通过；长中英文名折行完整，款式编号/问题列表可读，窄屏和桌面无重叠；复用既有字号、间距 |
| 3 | 色彩对比度 | 通过适用门禁；明暗截图和 axe，warning/primary/card 语义 token，状态有文字；聚焦可见 |
| 4 | 组件一致性 | 通过；复用 PageHeader、ActionNotice、buttonVariants；没有共享组件修改；原正常排单、提成确认和导航组件回归通过 |
| 5 | 交互反馈 | 通过本轮适用状态；真实 Error → 详情/返回，正常流程草稿恢复 → 复核 → 发布 Success 与数量审批有 E2E；异常页是服务端渲染的原生链接，没有新增异步写入控件、Disabled/Pending 状态或新加载器，不伪造此类状态检查 |
| 6 | 动效 | 通过；九视口 reduce 门禁，补充正常/reduce 下焦点及链接导航；异常页无新增动画或弹层；正常确认弹层回归通过 |
| 7 | 响应式 | 通过；九个实际视口明暗主题的 overflow / touch 门禁，含 320/390/430 和低高度、长名称、页面末尾；浏览器模拟，不是真机 |
| 8 | 功能质量 | 通过本轮路径；混合批次无发布入口且数据库无 ProductionJob；详情、返回、正常单重新打开和正常写入流程均通过；未知异常不吞掉。服务端流取消日志已单列说明 |
| 9 | 可访问性 | 通过适用检查；九视口 axe，320/1280 Tab / Shift+Tab / Enter 恢复，焦点轮廓可见，390/1280 的 200% 放大无横向溢出；新增链接使用 Enter，Space/方向键不是其操作契约；语义标题、具名列表、ActionNotice status 复核 |
| 10 | 原创性 | 通过；本轮沿用项目 Design System，无新增外部资产或复制外部布局 |

## 验收与部署的边界

本轮补齐本地生产构建、覆盖率、空库迁移、真实 worker 和功能回归，修复资料不完整导致派工页整页崩溃。目标生产环境 smoke、目标环境配置/系统 Chromium、备份恢复操作演练、真实通知通道/CDR 服务连通性尚未在目标环境执行；本地测试或 mock 不作为这些项目的通过证据。没有生产部署或 push。发布负责人仍须对实际 release SHA 核对目标环境前置和 smoke（项目 CONTRIBUTING 的发布候选要求）。

已知非阻断维护项：两条既存构建 tracing 警告、两条导航 lint 警告、24 项长函数债务、导航取消流日志。保留原因：未修改对应模块且当前业务验收通过；后续由项目维护者分别处理导出 tracing 范围和服务端取消日志诊断，不以降低门禁处理。

## 第一轮源码冻结指纹（8.8 分，未通过）

基线 HEAD 加以下九文件即第一轮已构建、已测试的源码候选，不能代替修复后的最终候选；文档可补充实际报告，不重新计算为源码变更。清单 SHA256：`1cc8f5b2e4d61b2450bc528138563f773fa7c7ba470aa2cb5cb8f2d29efaca1a`。

| 文件 | SHA256 |
|---|---|
| `app/(admin)/__tests__/production-dispatch-owner.test.tsx` | `9b5a38fff0c943d4a740d88a2b7257d9bdd531d421caf80423c46865a1f7cd08` |
| `app/(admin)/orders/production/page.tsx` | `cd93f6ef00ea4c9b91020479bd991e988fafe91252cb94251fd5aaa895e86e6c` |
| `lib/production/__tests__/dispatch-page.test.ts` | `1e3550b42afef6f68ea9588c96a44f684b07594088c78914e9fb19bdf8ddae2b` |
| `lib/production/__tests__/dispatch-plan-errors.test.ts` | `4fdcc4a9f31a520a5947d08a9ed747d3f5e695c0d52303e6e0de01e0e37d2bc1` |
| `lib/production/dispatch-page.ts` | `f09ebaee1edd68451187d1b9e26f798f10f2ba5d9962bbc22adfaf46cf70afa9` |
| `lib/production/dispatch-plan-error.ts` | `dddf1e7b71fbac785ae267153b866d066536cb40dd7a48063fe5659fde8bb04c` |
| `lib/production/dispatch-plan.ts` | `39c80345930883d6e215e8d9a9511e05553174c7196f17298ce28d197acb0326` |
| `tests/visual/production-dispatch-fixture.ts` | `bcc5cba470742e41975b63bdb8b64e38b8bac8d3d74d69d516a9f0908d1855dc` |
| `tests/visual/production-dispatch.spec.ts` | `ab6b9bb552916b5d77ded0c18e03785be937989249e0cf0d5012d723b1dc1e6d` |

发布后的具体探针顺序沿用 [备份与部署 Smoke 清单](../deployment-smoke-checklist.md)：同一 SHA 构建 → 目标环境迁移/备份与配置核验 → login/live/ready/jobs 和受保护路由 → 无效 cron token 必须 401 → 目标系统 Chromium/私有 PDF 存储 → 经授权的真实通知/CDR。当前不将任何历史生产检查套用到本候选。


## Claude 第一轮缺陷与修复复验

真实 Claude Opus 5.5 首轮 **8.8/10 FAIL**，原文见 [本轮 Claude 报告](2026-10-03-analytics-acceptance-claude-review.md)。发现 P2：action 的 `error.constructor === Error` 分支不会接受 Error 子类，导致历史核对、补登和发布排单的计划校验原因退化成刷新提示。保留 `error.message` 仅保留了底层诊断文本，并不能保证写入入口的原反馈行为；此前对此的判断已更正。

已在 `actions/production-dispatch.ts` 统一 failure 边界显式处理 `DispatchPlanValidationError`，返回工单名与安全中文 issues。领域校验/事务保持原样，SQL 和未知错误仍不可见。新增发布、RECOVER、历史核对 3 个 action 用例，修复前 3 失败/9 通过（`action-red.log`），修复后共 14 项目标测试通过（`action-green.log`）。首次未注入测试 DATABASE_URL 的执行属于环境失败，没有算作 RED 行为证据。

新增生产框架 E2E 在复核后破坏排序靠后的第二张测试工单工艺，再真实提交整批。检查安全原因、两张工单的 status/revision/simpleProduction 完全不变、ProductionJob / ProductionOperation / 派工日志均未产生，用真实 PostgreSQL 回滚断言补足仅检查无按钮的局限。首次测试选择所有 alert，与 Next 路由播报器冲突；改成按业务 accessible name 精确选择，保留所有内容、数据库和视觉门禁断言。失败日志保留为 `dispatch-write-selector-failed.log`，不计通过。

第二轮 typecheck 曾与 release E2E 启动的 `prisma generate` 同时执行，出现生成文件类型暂时缺失；没有修改业务类型来掩盖环境竞争。最终顺序执行后结果单独记录。

P3 后续：错误码映射编译期穷举、数量不匹配时款式定位、失效 URL 工单的读取恢复。影响与保留原因见 Claude 原文；跟进负责人 project-maintainers。未新增「仅安排其余工单」产品流程。


## 最终修复后验证（第二轮 Claude 候选）

| 检查 | 结果 |
|---|---|
| 完整 Vitest + 覆盖率 | 779 文件通过、3 跳过；8643 项通过、46 跳过；105.86 秒。语句 86.9%、分支 81.01%、函数 91.86%、行 89.27%，既有阈值全部通过。`coverage-final.log` / `unit-final.json` |
| 生产构建 | `release-build-final.log`，退出 0，只有已记录的两条 tracing warning |
| 异常读取 + 复核后失效提交 | 九视口各两用例、每用例明暗主题；18/18 通过，57.1 秒。`dispatch-write-final.log`；真实事务整批回滚通过 |
| 正常派工、数量审批、提成、发货 | 两代表视口 6/6 通过，1.1 分钟；`dispatch-normal-final.log` |
| analytics / 工作台 / 账单生产 E2E | 10/10 通过，24.3 秒；`release-e2e-final.log` |
| 类型 / lint / 架构 | 顺序执行 `typecheck-final2.log` 退出 0；完整 lint 仍 2 既有 warning，最终视觉测试文件 eslint 退出 0；1216 模块、4977 依赖、24 项既有长函数债务 |

最终生产模式浏览器业务检查本批 34 项通过（18 + 6 + 10）。先前本轮 4 项真实 durable worker、79 项浏览器组件、188 空库迁移、23 备份脚本测试、Prisma schema 校验及零生产依赖漏洞仍作为对应未变化模块的证据；不声称这些在最后两行 action 映射修复后重跑过。

Design QA 补验：新增写入失败反馈在全部九视口、明暗主题沿用相同 overflow / touch / axe 门禁；额外目视 320 浅色与 1280 深色 `dispatch-invalidated` 截图，反馈原因完整，原输入/复核选择保留，返回工单列表仍在，role=alert 可播报。没有新增颜色、控件、动效或第三方资产。前述十项 QA 中 1/2/3/5/7/8/9 的新增失败状态已覆盖，其余不变量与无变化项继续有效。

最终源码11文件清单 SHA256：`61a35cefb9b015445cf16379a90cea8a25a25b14775e31e437da1b06d76a4b00`。第二轮审查以此为准，不能沿用第一轮8.8分的候选。

| 文件 | SHA256 |
|---|---|
| `actions/__tests__/production-dispatch.test.ts` | `3e4027203d9a7699188c16871d0e0960c365b81d4533d690c5695ed419379c55` |
| `actions/production-dispatch.ts` | `cfee4df4a2e6e6732a459617a34f66056ed82eb00e5de648da552a5a0b9381fa` |
| `app/(admin)/__tests__/production-dispatch-owner.test.tsx` | `9b5a38fff0c943d4a740d88a2b7257d9bdd531d421caf80423c46865a1f7cd08` |
| `app/(admin)/orders/production/page.tsx` | `cd93f6ef00ea4c9b91020479bd991e988fafe91252cb94251fd5aaa895e86e6c` |
| `lib/production/__tests__/dispatch-page.test.ts` | `1e3550b42afef6f68ea9588c96a44f684b07594088c78914e9fb19bdf8ddae2b` |
| `lib/production/__tests__/dispatch-plan-errors.test.ts` | `4fdcc4a9f31a520a5947d08a9ed747d3f5e695c0d52303e6e0de01e0e37d2bc1` |
| `lib/production/dispatch-page.ts` | `f09ebaee1edd68451187d1b9e26f798f10f2ba5d9962bbc22adfaf46cf70afa9` |
| `lib/production/dispatch-plan-error.ts` | `dddf1e7b71fbac785ae267153b866d066536cb40dd7a48063fe5659fde8bb04c` |
| `lib/production/dispatch-plan.ts` | `39c80345930883d6e215e8d9a9511e05553174c7196f17298ce28d197acb0326` |
| `tests/visual/production-dispatch-fixture.ts` | `bcc5cba470742e41975b63bdb8b64e38b8bac8d3d74d69d516a9f0908d1855dc` |
| `tests/visual/production-dispatch.spec.ts` | `71d372385420c73d9fb0616754c60d1c77af63a0c1c72043bc03e030aac1be9f` |


## 终审与交付

- 实际 Claude Code 第二轮 **9.3/10 PASS**，P0/P1/P2 为零；首轮8.8及最终完整原文均保留在 [对抗审查报告](2026-10-03-analytics-acceptance-claude-review.md)。达成用户要求的严格大于9分门槛。
- 本地功能候选验收通过，目标生产部署前置仍按上述清单待执行。此次没有 push、生产部署、真实通知发送或生产数据改写。
- 最终11文件指纹只覆盖源码/测试，**不是提交的完整文件清单**。本次提交另外包含3份关联文档：本验收报告、上述 Claude 报告和 `docs/管理后台使用手册.md`（第3节新增异常派工及写入失败反馈说明）。这三份都属于本任务，非遗漏他人改动。首轮开始工作区干净，结束前重新核对差异与归属。
- 最终视觉测试 eslint 曾零输出，执行编排最终退出0；另再次记录 `visual-lint-confirmed.log`，显式 `exit_code=0`。类型竞争失败和 selector 冲突已保留解释，没有记为通过。
- 第二轮剩余 P3 由 project-maintainers 跟进：同名工单的提示可辨识性、测试两单使用不同名称及扩展打印/日志回滚断言、REJECT/INCLUDED_LATER 独立模式用例；首轮错误码穷举/款式定位等继续保留。共同映射、事务代码与真实浏览器回滚已有证据，因此不阻断本轮，不扩展产品流程。
- 3100 开发预览已恢复，使用隔离测试库；登录页 HTTP 200。其他工作树服务未操作。
- 本地提交主题：`fix(production): 修复派工资料异常并完成后续功能验收`。提交前验证11个源码指纹、文档链接及暂存差异；不提交环境、生成物、测试输出或数据库。
