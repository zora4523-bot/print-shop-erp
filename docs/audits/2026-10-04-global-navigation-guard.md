---
status: local-validation-complete
last_verified: 2026-10-04
applies_to: claude/global-navigation-guard
verification_base: be338762
verification_scope: 本分支相对 be338762 的共享导航守卫与离开保护迁移；未 push、未合入、未部署
---

# 全应用导航守卫

依据业主「本轮做全应用导航守卫」的决定与 [UI 规范 §8.3、§11](../ui-规范.md)。无数据库、权限、金额计算、Server Action 变更；零 JS 三条硬约束（登录、登出、改密码）不涉及。决策见 `DECISIONS.md` 2026-10-04。

## 问题

- **新建工单**（`order-creation-leave.tsx` 及 OrderCreationWorkspace / OrderForm / OrderSampleEntry / SampleOrderForm / useSampleWorkbenchDraft）只拦截页头返回和若干程序化跳转。侧栏、面包屑父级（2026-10-02 起是二级页唯一返回入口）、顶栏用户菜单等站内链接与浏览器后退 / 前进都绕过离开保护，未上传的设计文件、未存草稿的打样 / 寄样品填写静默丢失；beforeunload 拦不住 Next 客户端导航。在 be338762 上用下文新增的浏览器组件测试与 E2E 复现（见「先失败后通过」）。
- 仓库另有 4 处各自实现的 document 级拦截：管理员改单（`use-admin-order-leave-guard.ts`，含 Navigation API）、销售改单（`SalesOrderEditGuard.tsx`，借用前者并另挂 beforeunload）、价格工作台（`PriceWorkspaceNavigationGuard.tsx`，只拦链接与刷新）、提交中按钮（`PendingButton`，只拦链接与刷新）。判定规则略有出入，共存时由谁处理取决于监听注册先后。任务原列三套，`PendingButton` 是检查中发现的第四套，一并迁移。

## 设计

`components/ui-business/navigation-guard.ts`：`useNavigationGuard({ when, shouldBlock?, onBlocked, blockUnload? }) → { release, isReleased }`，并由 `components/ui-business/index.ts` 导出。

| 路径 | 实现 |
|---|---|
| 站内链接 | 任一守卫挂载时在 document 上挂一个 capture click 监听（全局一份）。只拦同源、路径或查询串不同、普通左键的 `<a href>`；跳过修饰键、中键、`target` 非 `_self`、`download`、只差 hash、外链、已被 `preventDefault` 的事件、`data-navigation-guard-skip` 容器内的链接（守卫自己的确认层、自带确认的 `PriceWorkspaceLink`）。拦下时 `preventDefault + stopPropagation`，Next Link 与页面 onClick 都不再执行。 |
| 后退 / 前进 | 沿用管理员改单已验证的做法：Navigation API `navigate` 事件中取消可取消的同文档 traverse，早于 App Router 处理 popstate，不插入重复历史、不改 `history.state`；`resume()` 用原条目 key `traverseTo`，被后续导航中止时自动重新布防。不支持 Navigation API 的浏览器只剩链接与刷新保护（与原实现一致）。 |
| 刷新 / 关闭 | 每个守卫自己的 beforeunload 监听；`blockUnload` 默认等于 `when`，也可传函数在整个挂载期实时判定（销售改单「保存中仍防刷新」）。 |
| 放行 | `resume()`：放行该守卫并按原样继续（链接重放原点击，保留 Next Link 的 replace / scroll；历史按原条目返回）。`release()`：放行后由调用方自行跳转。放行持续到 `when` 再次由 false 变 true（与原管理员改单语义一致），覆盖链接、历史与 beforeunload。 |
| 多守卫共存 | 按挂载（effect 注册）顺序，**最后注册且 `when && shouldBlock()` 为真**的守卫独自决定：只调用它的 `onBlocked`、只弹一个确认层；它已放行则直接通过，不再询问更早的守卫；它没有可丢内容时由更早的守卫判定。beforeunload 任一守卫需要即拦。 |

原语只负责判定、拦截与回调；确认层仍由各业务用 `ConfirmActionController level="L2"` 渲染，文案不变。

## 迁移清单

| 接入方 | 变更 | 行为 |
|---|---|---|
| 新建工单 `order-creation-leave.tsx` | `when = enabled && (guarded || busy)`，`shouldBlock` 读 ref 中的最新整批计划；删去 `useOrderFormLeaveGuard`（`use-order-form-leave-guard.ts` 只留被测试使用的纯函数） | 侧栏、面包屑、顶栏及正文任意站内链接（实测覆盖侧栏、面包屑父级与工作台内链接；顶栏用户菜单走同一 document 拦截、未单独测试）与后退 / 前进进入与页头返回相同的判定与确认层：有未上传文件「放弃修改并离开」，仅未保存文字「保存草稿并离开」，草稿保存失败留在本页并显示原因，「仍然离开」继续原导航（链接 `router.push`，历史 `traverseTo`）。**忙碌（上传 / 提交中）时直接拦下、不弹确认**，与页头返回既有的忙碌锁一致；页面上的提交中 / 上传进度即提示。页头返回、程序化跳转、焦点返回、部分失败清单等既有语义不变。 |
| 管理员改单 `use-admin-order-leave-guard.ts` | 变为薄适配层（保留 `useAdminOrderLeaveGuard` / `PendingOrderEditorNavigation` 接口），删除自带监听与 `isDifferentOrderEditorPage` | 不变：链接重放、traverse 取消与恢复、`allowNavigation` 放行、无 Navigation API 降级。 |
| 销售改单 `SalesOrderEditGuard.tsx` | 自带 beforeunload 并入原语（`blockUnload` 函数：有未保存表单或忙碌区域） | 不变；原先与管理员 hook 各挂一个 beforeunload，现只有一个。 |
| 价格工作台 `PriceWorkspaceNavigationGuard.tsx` | 文档级链接与 beforeunload 改用原语；`PriceWorkspaceLink` 改用 `data-navigation-guard-skip` 跳过文档级拦截 | 链接确认后仍 `router.push`；**新增**：有未保存档位时后退 / 前进也先确认。`PriceWorkspaceFilterForm`（next/form 提交）与 `PriceWorkspaceLink`（onNavigate）不是 document 监听，保持原样。 |
| `PendingButton` | 提交中的链接 / 刷新保护改用原语 | **新增**：提交中后退 / 前进也先确认（「仍要离开」按原条目返回）；确认离开链接时先放行再整页跳转，不再被浏览器二次询问；外链不再弹自定义确认层，改由浏览器原生 beforeunload 确认（提交中仍拦）。 |

迁移后 `components/`、`app/`、`hooks/`、`lib/` 中只剩原语挂 document click（导航）、`navigate` 与 beforeunload；`SalesOrderEditGuard` 的 document click 监听处理的是非链接控件（链接分支直接返回），不属于导航拦截。

## 测试：先失败后通过

「失败」均在本分支的被测代码回退到 be338762（`git checkout be338762 -- components` 或仅回退对应文件）时实测；之后恢复到 HEAD 复测。

| 测试 | be338762 | 本分支 |
|---|---|---|
| `components/ui-business/__tests__/navigation-guard.browser.spec.tsx`（原语：普通点击、嵌套元素、`_self`；meta / ctrl / shift / alt / 中键；`_blank`、download、本页锚点、外链、跳过容器；同址不同查询串；已取消事件；未布防与 `shouldBlock`；`resume` 重放一次；traverse 取消不改历史、按 key 恢复、中止后重新布防、不可取消 / 同页 / push 不拦；无 Navigation API 降级；beforeunload 布防、卸载、独立判定；`release` 与重新布防；多守卫：最后挂载者决定、回退到更早守卫、一次确认不连弹、卸载后其余守卫仍生效） | 无法导入（模块不存在） | 27 / 27 通过 |
| `OrderCreationLeave.browser.spec.tsx` 新增 5 例（侧栏 / 面包屑 / 后退在未上传文件时确认且焦点返回；后退时保存本机草稿后按原条目返回；后退时草稿保存失败留在本页、「仍然离开」恢复后退；无可丢内容直接通过；上传中侧栏 / 面包屑 / 后退直接拦下不弹层） | 4 失败、1 通过（直接通过一例本就应通过，作回归护栏） | 全文件 17 / 17 通过 |
| `PriceWorkspaceNavigationGuard.browser.spec.tsx`（新增 3 例：侧栏链接确认与焦点返回、后退确认、无未保存档位不干预） | 后退一例失败，其余 2 例通过（行为不变护栏） | 3 / 3 通过 |
| `PendingButton.navigation.browser.spec.tsx`（新增 3 例：提交中链接确认与焦点返回、后退确认、结束后不干预） | 后退一例失败，其余 2 例通过 | 3 / 3 通过 |
| `tests/e2e/order-leave-recovery.spec.ts` 新增 4 例（管理员、销售各 2：真实外壳侧栏 / 面包屑父级 / `page.goBack()`；侧栏确认后放弃文件离开） | 4 例均在第一次点侧栏后找不到确认层而失败 | 全文件 11 / 11 通过 |
| 既有守卫测试：`AdminOrderLeaveGuard`、`AdminOrderEditor`、`OrderFormLeaveConfirm`、`OrderCreationWorkspace`、`PriceWorkspaceFilterForm` 浏览器测试 | — | 全部通过，未删改断言 |

E2E 首版两处用例问题已在用例侧修正、未放宽断言：① 管理员侧栏「采购单」在折叠分组内不可见，改用可见的「工单列表」；② 只填文字时本机草稿自动保存后已无可丢内容，后退被正确放行，改为以未上传文件作为可丢内容（仅文字的「保存草稿并离开」路径由浏览器组件测试覆盖）；确认层打开时背景为 inert，名称值改到关闭确认层后再断言。

## 验证结果

环境：Node 24.15.0、pnpm 10.33.1、Next.js 16.3.6，Chromium（Playwright）。E2E 使用本工作树开发服务器 `127.0.0.1:3100`、独立可丢弃库 `erp_e2e_navguard_20261004`（功能 E2E）与 `erp_e2e_navguard_20261004_ui`（九视口门禁），均 `migrate deploy` + seed + `test:e2e:prepare`；未连接生产库，日常开发库只作 prepare 的隔离比对与单测库。

| 检查 | 结果 |
|---|---|
| `pnpm check:architecture` | 通过（1198 模块，24 项存量超长函数债务，未新增） |
| `pnpm test:backup` | 23 / 23 通过 |
| `pnpm lint` | 0 error；2 条既有 warning（`app/global-error.tsx`、`OrderCreatedSuccessView.tsx` 的 `location.assign`，与 2026-09-30 记录一致）；UI 文案 0 命中、令牌 0 新增违例 |
| `pnpm typecheck` | 通过 |
| 全量 `pnpm test run`（只传主仓 `.env` 的 `DATABASE_URL`） | 758 文件通过、19 文件按条件跳过；8,466 用例通过、173 按条件跳过 |
| 全量 `pnpm test:browser` | 89 文件、1,173 用例通过；1 文件导入失败：`components/business/cdr/__tests__/CdrWorkbench.browser.spec.tsx`（`deps/next_navigation.js does not provide an export named 't'`）。单独重跑、清除 `node_modules/.vite/vitest` 后重跑、把 `components/` 回退到 be338762 后重跑均同样失败，属既存问题，与本次无关，未处理 |
| 相关 E2E（chromium，16 个 spec：order-leave-recovery、order-create、order-create-ui-parity、order-creation-groups、sample-orders、order-field-repairs、order-multiple-addresses、order-external-sales-association、foil-color-history、sales-functional-review、price-entry、price-versions-layout、blank-price-only、blank-paper-pricing、confirmed-custom-tiers、interaction-discoverability） | 79 / 79 通过（8.3 分钟） |
| `test:admin-ui`（九视口，新库） | 226 通过、16 按配置跳过、1 失败：`admin-390x844` 的「critical routes pass the same gates with dark tokens」在 `/orders` 点「全部」队列链接后 5 秒内 URL 未出现 `queue=all`（该页没有布防的守卫）。同库同视口单独 `--repeat-each=3` 重跑 3 / 3 通过；其余 8 个视口同一用例均通过。判定为 4 并发下的偶发点击丢失，未确认根因，未在 be338762 上对照复现 |
| `test:worker-ui`（九视口，新库） | 18 / 18 通过 |

## Design QA（§11.4）

本次没有新增布局或组件，用户可见变化是：同一个确认层在更多入口（侧栏、面包屑、顶栏、后退 / 前进）出现，以及价格工作台 / 提交中按钮在后退时出现既有确认层。用一次性 Playwright 探针（未提交，脚本与截图在本机 `/private/tmp/claude-501/.../scratchpad/navguard/qa/`，会话结束后不保证保留）在管理员与销售的新建工单页、九视口 × 明暗主题，从面包屑父级触发确认层：

1. 视觉层级：确认层标题「放弃修改并离开」、后果一行、两个按钮，与页头返回触发时完全相同。通过（截图 320 / 375 / 1280 × 明暗）。
2. 排版与留白：沿用共享确认层，320px 下按钮纵向堆叠，无截断。通过。
3. 色彩与对比度：等动画结束后对 `[role=alertdialog]` 跑 axe，36 个组合 0 违例。动画进行中测得的 color-contrast 与 41.8px 按钮高度来自缩放入场动画，非稳定状态。通过。
4. 组件一致性：全部入口共用 `ConfirmActionController`（L2）与原文案，未新增组件。通过。
5. 交互反馈：鼠标、键盘（Enter 打开、焦点落在「继续编辑」、Enter 取消）、Escape 关闭均实测；忙碌时拦下不弹层（浏览器组件测试）。通过。
6. 动效：未新增动效；判定只在动画结束后进行。不适用新增项。
7. 响应式：九视口 body 无横向溢出；面包屑父级 44px 高，确认按钮 44px。通过。
8. 功能质量：见上表功能测试；E2E 用例收集 `pageerror` 为空。通过。
9. 可访问性：取消后焦点回到触发链接（侧栏 / 面包屑，E2E 与组件测试均断言）；axe 见第 3 项。200% 文字放大未单独执行（本次无布局变更）。
10. 原创性：无新增参考或资产。

## 残留风险

- 不支持 Navigation API 的浏览器（较旧的 Safari / Firefox）后退 / 前进仍不受保护，只有站内链接与刷新 / 关闭保护；与改造前的管理员改单一致。
- 浏览器后退在 Chromium 中只有页面已有用户激活时才可取消；真实用户在填写后通常满足，但长时间无交互后直接点后退可能无法取消、内容丢失。E2E 用 `page.goBack()` 实测可取消，不代表所有浏览器 / 真机。
- 新建工单忙碌期间点击侧栏 / 面包屑或后退时静默拦下，没有额外提示，依赖页面已有的上传 / 提交中状态说明；如需「正在上传，完成后再离开」之类提示需另行确定文案。
- 程序化 `router.push`、`next/form` 提交、`window.location` 赋值不经过原语（与改造前一致）；业务里的此类跳转须继续自行调用守卫判定（新建工单的 `navigate()` / 价格工作台筛选表单已如此）。
- `PendingButton` 外链在提交中由浏览器原生 beforeunload 确认，文案由浏览器决定，不再显示自定义后果说明。
- `admin-responsive` 的一次偶发失败（见上表）未在基线上对照，若 CI 再现需按基线分类。
- 九视口门禁仅在开发服务器上执行；生产构建、真机、Safari 未验收。
