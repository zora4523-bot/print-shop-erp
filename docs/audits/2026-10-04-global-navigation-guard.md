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
| 放行 | 确认后的放行是**一次性的、绑定到那一次导航**，所有守卫都认。① 链接：`resume()` 用一次可取消的 click 事件重放原链接，只放过这一次点击（保留 Next Link 的 replace / scroll 与 pending）；被链接自己取消（如 Next `onNavigate.preventDefault()`）后照常布防。② 后退 / 前进：每次 `resume()` 是一个独立请求，只放过它那条历史的 navigate 事件；请求结束（成功、失败、中止）而事件未到时清除，旧请求不会清掉新请求。③ 刷新 / 关闭：`leaveDocument(href)` 与链接重放授予一次刷新放行（重放的点击被取消时，靠 Next 公开钩子 `onRouterTransitionStart`——根目录 `instrumentation-client.ts` 经无依赖的 `navigation-guard-transition.ts` 转发——区分「Next Link 接管了导航」与「调用方 onNavigate 真的取消」：前者保留放行直到新 URL 在本文档提交（Navigation API 的 navigate 事件，或不依赖该 API、每 100 ms 检查一次地址的路径 / 查询串变化）或整页回退消费它，**一经接管便不再受 10 秒定时器约束**，后者立即收回）。确认后的程序化跳转一律经 `navigateConfirmed(() => router.push(...))`，与链接重放共用同一生命周期，覆盖授予后的**第一个** beforeunload 事件（同一次派发里所有守卫都放过），之后的事件不再覆盖；页面明显留下时（pointerdown / keydown、重新可见、bfcache 恢复、pagehide）立即作废，在 Next 接管之前或根本没有接管时另有 10 秒兜底上限（下载、204 等页面不离开又无交互时）。`release()` 只用于保存成功等「内容已安全」的整体解除，持续到 `when` 再次由 false 变 true。 |
| 多守卫共存 | 按挂载（effect 注册）顺序，**最后注册且 `when && shouldBlock()` 为真**的守卫独自决定：只调用它的 `onBlocked`、只弹一个确认层；它已放行则直接通过，不再询问更早的守卫；它没有可丢内容时由更早的守卫判定。beforeunload 任一守卫需要即拦。 |

原语只负责判定、拦截与回调；确认层仍由各业务用 `ConfirmActionController level="L2"` 渲染，文案不变。

## 迁移清单

| 接入方 | 变更 | 行为 |
|---|---|---|
| 新建工单 `order-creation-leave.tsx` | `when = enabled && (guarded || busy)`，`shouldBlock` 读 ref 中的最新整批计划；删去 `useOrderFormLeaveGuard`（`use-order-form-leave-guard.ts` 只留被测试使用的纯函数） | 侧栏、面包屑、顶栏及正文任意站内链接（实测覆盖侧栏、面包屑父级与工作台内链接；顶栏用户菜单走同一 document 拦截、未单独测试）与后退 / 前进进入与页头返回相同的判定与确认层：有未上传文件「放弃修改并离开」，仅未保存文字「保存草稿并离开」，草稿保存失败留在本页并显示原因，「仍然离开」继续原导航（链接重放原点击、历史按原条目返回；自带本守卫 onNavigate 的页头返回等链接在重放时仍按各自目标 `router.push`，保持原测试语义）。**忙碌（上传 / 提交中）时直接拦下、不弹确认**，与页头返回既有的忙碌锁一致；页面上的提交中 / 上传进度即提示。页头返回、程序化跳转、焦点返回、部分失败清单等既有语义不变。 |
| 管理员改单 `use-admin-order-leave-guard.ts` | 变为薄适配层（保留 `useAdminOrderLeaveGuard` / `PendingOrderEditorNavigation` 接口），删除自带监听与 `isDifferentOrderEditorPage` | 链接重放、traverse 取消与恢复、无 Navigation API 降级不变。第三轮复审起，放弃确认只用一次性放行：`allowNavigation()`（整体解除）只在保存成功后调用。 |
| 销售改单 `SalesOrderEditGuard.tsx` | 自带 beforeunload 并入原语（`blockUnload` 函数：有未保存表单或忙碌区域） | 原先与管理员 hook 各挂一个 beforeunload，现只有一个。第三轮复审起，确认放弃时不再清空未保存表单记录，只靠一次性放行。 |
| 价格工作台 `PriceWorkspaceNavigationGuard.tsx` | 文档级链接与 beforeunload 改用原语；`PriceWorkspaceLink` 改用 `data-navigation-guard-skip` 跳过文档级拦截 | 确认后重放原链接（第二轮复审修复，见下）；**新增**：有未保存档位时后退 / 前进也先确认。`PriceWorkspaceLink` 自带确认，确认后重新点击自身（保留 replace / scroll 与 pending）；`PriceWorkspaceFilterForm`（next/form 提交，没有原链接）仍 `router.push`。 |
| `PendingButton` | 提交中的链接 / 刷新保护改用原语 | **新增**：提交中后退 / 前进也先确认（「仍要离开」按原条目返回）；确认离开链接时经 `leaveDocument()` 整页跳转，同页其它提交中的按钮也不再触发浏览器二次询问；外链不再弹自定义确认层，改由浏览器原生 beforeunload 确认（提交中仍拦）。 |

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

## 复审修复（Codex gpt-6-astra，main..22841915）

逐条对照 HEAD 核实后修复，先写失败测试；「修复前」是把被测源码回退到 `22841915`（P2 用本次之前的「只放行本按钮守卫」语义）实测。

| 问题 | 核实 | 修复 | 测试（修复前 → 修复后） |
|---|---|---|---|
| P1 一次确认永久解除守卫 | 属实：`resume()` 置 `released = true`，只在失败或 `when` 由 false 变 true 时恢复；价格工作台同分区后退（只变查询串、编辑器仍脏）后，再离开 / 刷新不再拦；重放点击被 Link 的 onNavigate 取消后同样一直放行 | 放行改为绑定到那一次导航、用后即作废（见「设计」放行行）；`release()` 保留为保存成功后的整体解除 | 原语新增「重放被取消后仍布防」「同页查询串后退后续仍拦且刷新仍拦」2 例：修复前（`22841915` 源码 + 临时加一个不带放行的 `leaveDocument` 桩，以便测试文件能导入）均失败 → 通过；另加「只放过被确认的那条历史」1 例，替换了修复前曾失败的「traversal 结束即重新布防」写法（该写法与管理员改单既有断言冲突），新写法未在修复前单独执行；价格工作台新增「同分区后退后侧栏 / 后退 / 刷新仍拦」1 例：修复前失败 → 通过 |
| P2 多个提交中按钮时确认离开后仍弹原生提示 | 属实：只放行确认的那个按钮的守卫，其余按钮的 beforeunload 照拦（CdrWorkbench 三个按钮共用 pending） | 新增 `leaveDocument(href)`：发起整页加载的那个任务内所有守卫都不拦 beforeunload；PendingButton 改用它 | 原语「leaveDocument 免去所有守卫的刷新提示」「只在该任务内有效」；PendingButton「三个按钮同时提交中，确认一次不再二次提示，之后刷新仍拦」：修复前失败 → 通过（假 assign 按 Chromium 实测行为同步触发 beforeunload；已用独立探针确认 `location.assign` 与锚点点击的 beforeunload 都在调用内同步触发） |
| P3 新建工单确认后 `router.push` 绕过原链接 | 属实：侧栏 `useLinkStatus` pending 指示与移动抽屉随 URL 关闭的反馈在慢导航时缺失 | 确认（含草稿保存成功、「仍然离开」）后统一 `resume()` 重放原链接；带本守卫 onNavigate 的页内链接在重放时仍按自身目标 `router.push` | 组件测试：面包屑确认后由原链接自己导航、之后侧栏仍受保护：修复前失败 → 通过；E2E「确认侧栏离开后，慢导航期间侧栏链接显示 pending」（拦住目标页 RSC 响应）：修复前在 pending 断言失败 → 通过 |

忙碌期间静默拦下的行为按协调要求未改（待业主决定）。价格工作台的链接确认仍用 `router.push`（不在本次三条范围内），其侧栏 pending 反馈同样缺失，列入残留风险。

## 第二轮复审修复（价格工作台确认后重放原链接）

- 核实：价格工作台捕获到侧栏 / 面包屑链接后，确认时仍 `router.push(destination)`；`PriceWorkspaceLink` 自带确认后 `router.push / replace`。被点的 Link 进不了 pending，侧栏 `useLinkStatus` 指示在慢导航时缺失（与 P3 同类）。
- 修复：Provider 确认后一律 `navigation.resume()`（链接重放原点击，历史按原条目返回）；`PriceWorkspaceLink` 确认后重新点击自身，只放过这一次点击（保留 replace / scroll 与 pending）。没有原链接的 `PriceWorkspaceFilterForm` 仍 `router.push`。
- 测试（源码回退到 `eb9be3af` 时失败 → 修复后通过）：`PriceWorkspaceNavigationGuard.browser.spec.tsx`「确认后由原侧栏链接导航、之后再点仍要确认」；新增 `PriceWorkspaceLink.browser.spec.tsx`「确认后重放自身（replace + 保留滚动）、下次仍要确认」；新增 E2E `tests/e2e/price-workspace-leave.spec.ts`：有未保存档位时点侧栏，取消后焦点回链接、值保留；确认后拦住目标页 RSC 响应，侧栏链接 pending 可见、URL 仍在价格页，放行后到达 `/orders`。修复前在 pending 断言失败。
- 其余守卫消费方逐一核对「确认 → router.push」：
  - 管理员改单页头「返回工单详情」与「放弃」是按钮，没有原链接，保持 `router.push`。
  - 新建工单的程序化 `navigate()`、样品完成跳转没有原链接，保持 `router.push`。
  - `PendingButton` 有意整页加载。
  - 新建工单自带守卫的页内链接见残留风险。

## 第三轮复审修复（Codex gpt-6-astra，main..ed056a7f）

逐条在 HEAD 核实后修复；「修复前」指 `ed056a7f` 源码上实测失败。

| 问题 | 核实 | 修复 | 测试（修复前 → 修复后） |
|---|---|---|---|
| P1 真实消费方仍「确认一次、永久解除」 | 属实：`AdminOrderEditor` 放弃确认先调 `allowNavigation()`（映射为永久 `release()`）；`SalesOrderEditGuard` 确认时先清空未保存表单记录，MutationObserver 随后把守卫与刷新保护一起撤掉。若这次导航被链接自己取消，草稿仍在但不再受保护 | 放弃确认只用一次性放行，不碰真实未保存状态；`allowNavigation()` 只在保存成功后调用 | 真实组件（不是直接调 `resume()` 的夹具）：`AdminOrderEditor.browser.spec.tsx`「放弃确认只覆盖一次导航：链接取消后草稿仍受保护」；新增 `SalesOrderEditGuard.browser.spec.tsx`「链接自己取消确认后的离开，未保存输入仍受保护（刷新与再次离开）」——均修复前失败 → 通过 |
| P1 traverse 放行在成功但无可消费事件时残留 | 属实：只在匹配事件或 `finished` 失败时清除；`traverseTo()` 当前条目可只 resolve 不派发 navigate，之后同 key 的 traversal 会吃掉过期放行 | 每次 `resume()` 是独立请求；成功、失败、中止都清除自己未用掉的放行，旧请求不会清掉新请求 | `AdminOrderLeaveGuard.browser.spec.tsx` 的替身改为符合规范的顺序（先 navigate，再 committed / finished）；原语新增「成功但无事件不留放行」「同一条目的旧请求结束不清新请求」——修复前失败 → 通过 |
| P2 `leaveDocument()` 的放行用 `setTimeout(0)` 收回 | 属实，且已实测：独立 Playwright 探针中 Chromium 在 `location.assign` / 锚点点击内同步派发 beforeunload，**WebKit 在当前任务之后才派发**，旧实现在 WebKit 下会再弹一次原生提示 | 放行绑定到导航生命周期（见「设计」放行行），不用更长的定时器；被取消的链接重放立即收回 | 原语新增「首个 beforeunload 在当前任务之后到达（WebKit 顺序）时仍覆盖且只覆盖一次，之后页内离开仍拦」「页面留下（pointerdown）后刷新仍拦」「bfcache 恢复后刷新仍拦」——修复前失败 → 通过 |

WebKit 覆盖：用临时 Vitest 配置（未提交）只跑 `webkit` 实例，执行 `navigation-guard`、`PendingButton.navigation`、`AdminOrderLeaveGuard`、`SalesOrderEditGuard` 四个浏览器组件测试：4 文件 / 49 用例通过。这些测试用合成事件模拟异步 beforeunload 顺序；**没有**在 WebKit 下跑真实页面的整页跳转或 E2E（项目 Playwright 配置只有 Chromium），WebKit 下真实浏览器提示的行为只由上面的时序探针间接支持。

## 第四轮复审修复（Codex gpt-6-astra，1 项 P2）

- 核实：已安装的 Next 16.3.6 `client/app-dir/link.js` 在正常接管导航时也会对点击 `preventDefault()`（之后才调用 onNavigate），所以「重放点击被取消」不能区分 Next 接管与调用方取消。原实现据此立即收回刷新放行；若目标页 RSC 请求失败，Next 退回 `location.assign()` 整页加载，仍挂载的守卫又拦 beforeunload，用户在已确认后再看到一次原生提示（违反 §8.3）。
- 修复：新增根目录 `instrumentation-client.ts`（Next 公开文件约定），导出 `onRouterTransitionStart`，经无依赖的 `components/ui-business/navigation-guard-transition.ts` 转发给守卫。Next 在接管点击时同步调用这个钩子（`dispatchNavigateAction` → `startRouterTransition`），守卫据此判断：
  - 重放期间收到钩子，算作接管，保留放行，直到新 URL 在本文档提交（同文档 push / replace 且 URL 改变）或整页回退消费第一个 beforeunload；
  - 点击被取消且没有收到钩子，算作真实取消，立即收回。
  - 页面明显留下时的收回规则与 10 秒兜底不变。
- 测试：
  - 原语新增「路由接管后，稍后到来的整页回退 beforeunload 仍被覆盖且只覆盖一次」：修复前失败 → 通过。
  - 原语新增「客户端导航在本文档提交后放行结束」「调用方取消（无路由转场）立即恢复保护」。
  - 原有「onNavigate.preventDefault() 后仍受保护」的用例保留并通过。
  - E2E `order-leave-recovery.spec.ts` 新增「确认侧栏离开后目标页 RSC 返回 500，整页回退到 `/orders` 且没有第二次提示」：修复前收到一次 beforeunload 对话框 → 修复后 0 次。
  - 慢导航 pending 两条 E2E 仍通过。
- 范围：没有修改任何 `next.config` 选项；`instrumentation-client.ts` 只转发一个函数调用，不做别的初始化。`check:dead-code`（非门禁）对新文件没有报告，只把 `isGuardedNavigationDestination` 的 index 再导出列为未被外部使用。

## 第五轮复审修复（Codex gpt-6-astra，2 项 P2，同一根因）

- 核实：
  - P2-1：第三轮去掉 `allowNavigation()` 后，管理员改单「返回工单详情」「放弃」确认后直接 `router.push()`，不经过一次性放行。Next 接管后若 RSC 失败退回 `location.assign()`，仍布防的守卫再拦 beforeunload。
  - P2-2：`grantUnloadPass()` 总会启动 10 秒收回；Next 接管只记一个标志，不改截止时间，RSC 在 10 秒后失败会再弹提示（原 E2E 立即返回 500，测不到）。
- 修复：新增唯一的共享 API `navigateConfirmed(navigate)`。链接重放与 `leaveDocument()` 改走同一个 `runConfirmedNavigation()`：授予一次性放行，导航期间监听 Next 的 `onRouterTransitionStart`（可嵌套，结束时恢复上一层监听）。一旦接管，就停掉 10 秒定时器，放行改由该导航的生命周期结束：本文档提交新 URL、整页回退消费首个 beforeunload，或页面明显留下（交互 / 可见性 / bfcache 恢复 / pagehide）。点击被取消且未接管的，立即收回。
- 迁移（全部「确认 → 跳转」改为 `navigateConfirmed`）：
  - 管理员改单「返回工单详情」「放弃」；
  - 新建工单确认离开的 `router.push`，含自带守卫链接重放时的跳转、「仍然离开」；
  - `PriceWorkspaceLink` 自身重放与无原链接时的跳转；
  - 价格筛选表单确认后的跳转。
- grep 复核：守卫消费方中剩余的 `router.push / replace` 都不是「确认后跳转」：
  - 保存成功后跳转（管理员改单已整体 `release()`，价格编辑器保存后已无未保存档位）；
  - 未布防时的直接跳转（管理员改单未修改时返回、`navigate()` 无可丢内容、样品表单无离开上下文）；
  - 工作台带入、URL 清理等程序化跳转，本就不经过守卫，见残留风险。
- 测试（`083b3ac5` 源码上失败 → 修复后通过）：
  - `AdminOrderEditor.browser.spec.tsx` 新增「返回工单详情 / 放弃：Next 接管后整页回退不再提示，之后刷新仍拦」2 例；
  - 原语新增「接管后超过 10 秒仍覆盖回退」（假定时器）、「`navigateConfirmed` 共用同一生命周期」2 例，修复前（临时加一个直接调用的 `navigateConfirmed` 桩，以便测试文件能导入）失败；
  - 新增「未接管时只保留安全上限」；
  - 新增 E2E `tests/e2e/admin-order-edit-leave.spec.ts`：「返回工单详情」「放弃」确认后目标详情页 RSC 返回 500，另一例延迟 11 秒再返回 500。修复前 3 例都收到一次 beforeunload 对话框，修复后 0 次、整页到达详情。
  - 真实取消立即恢复保护的既有用例仍通过。

### 协调方运行中的 4 个 ERR_ABORTED

协调方在第五轮修改进行时，于本工作树跑 `test:admin-ui` 得到 223 通过 / 4 失败，都是打开工单详情时 `page.goto: net::ERR_ABORTED`：
- `:163`「order detail expanded records…」在 768 / 1024 / 1280；
- `:170`「shipping recovery…」在 430。

核查：
1. **改动全部提交后在新库复跑。** 两条用例在 430 / 768 / 1024 / 1280 四个视口串行（`--workers=1`）连跑 3 次，共 24 次全部通过；完整 `test:admin-ui` 227 / 0。另：首次用 `--repeat-each=3 --workers=4` 复跑时有 5 次失败，原因是同一 describe 的 beforeAll 固件被并行的重复实例重复插入或提前清理（`Cannot read properties of undefined (reading 'hourlyWorkerId')`、详情标题找不到）。这是 `--repeat-each` 叠加并行的用法问题，不是导航中止，所以改为串行。
2. **main 对照。** 在 main（`be338762`）的全新分离工作树和新库上，同样四个视口串行跑 3 次：24 / 24 通过。
3. **根因复现。** 在本分支 HEAD 上重跑这两条用例，运行中每隔几秒改动并还原 `navigation-guard.ts`（模拟开发服务器热更新）。复现出同一错误：`page.goto: net::ERR_ABORTED at …/orders/…-order`（1024 视口），其余 7 次通过。协调方那次运行期间，本工作树里确有源码改动（第五轮失败测试用的临时桩写入并还原了 `navigation-guard.ts`）。

结论：这 4 个失败来自开发服务器热更新打断进行中的 `page.goto`，不是守卫拦截了不该拦的导航。代码稳定时本分支与 main 均不复现，所以没有加对应的失败测试。教训：门禁运行期间不要在同一工作树改源码。

## 第六轮复审修复（Codex gpt-6-astra，1 项 P2）

- 核实：第五轮起，Next 接管后不再用 10 秒定时器，「新 URL 已提交」只靠可选的 Navigation API `navigate` 事件识别。不支持该 API 的浏览器里，若确认后的客户端导航只改查询串、脏表单仍挂载，放行会一直保留，之后一次独立的刷新不再提示，违反 §8.3「降级时仍保留刷新保护、放行只覆盖那一次导航」。
- 修复：Next 接管后（`hold()`），记下当时的地址，每 100 ms 检查一次。地址的路径或查询串一变（Next 只在导航成功提交时改地址），就立即收回放行；收回时停止检查。这一判定不依赖 Navigation API；有该 API 时两条路径并存，先到者收回。
- 测试：原语新增「无 Navigation API：确认导航 → 本文档提交新地址（表单仍挂载）→ 第一次刷新被提示」，修复前失败 → 修复后通过。有 Navigation API 时的既有用例（提交即结束、超过 10 秒仍覆盖回退、真实取消立即恢复）全部仍通过。

## 验证结果

环境：Node 24.15.0、pnpm 10.33.1、Next.js 16.3.6，Chromium（Playwright）；guard 相关浏览器组件测试另在 WebKit 执行（见第三轮复审）。E2E 使用本工作树开发服务器 `127.0.0.1:3100`。最终一轮（HEAD `966402db`）用独立可丢弃库 `erp_e2e_navguard_20261004e`（功能 E2E）与 `erp_e2e_navguard_20261004f`（九视口门禁，先跑功能 E2E、门禁用另一新库），均 `migrate deploy` + seed + `test:e2e:prepare`，用后已 DROP；更早各轮的库也已全部 DROP。未连接生产库，日常开发库只作 prepare 的隔离比对与单测库。

| 检查 | 结果 |
|---|---|
| `pnpm check:architecture` | 通过（第六轮 `e7a2a90c` 重跑；1199 模块，24 项存量超长函数债务，未新增） |
| `pnpm test:backup` | 23 / 23 通过（第六轮重跑） |
| `pnpm lint` | 第六轮重跑：0 error；2 条既有 warning（`app/global-error.tsx`、`OrderCreatedSuccessView.tsx` 的 `location.assign`，与 2026-09-30 记录一致）；UI 文案 0 命中、令牌 0 新增违例 |
| `pnpm typecheck` | 通过（第六轮重跑） |
| 全量 `pnpm test run`（只传主仓 `.env` 的 `DATABASE_URL`；第六轮重跑） | 758 文件通过、19 文件按条件跳过；8,466 用例通过、173 按条件跳过 |
| 全量 `pnpm test:browser` | 第六轮在 HEAD `e7a2a90c` 的全新分离工作树（`pnpm install --offline --frozen-lockfile` + `prisma generate`）中执行：92 文件、1,203 用例全部通过（此前 `59c1a054` 92 / 1,202， `267c903a` 92 / 1,197， `966402db` 92 / 1,194， `530e2691` 91 / 1,187，`2f58b82d` 90 / 1,186，同法执行）。**更正**：首版记录称 `CdrWorkbench.browser.spec.tsx` 导入失败（`deps/next_navigation.js does not provide an export named 't'`）是既存问题，不对——协调方在干净 main 与本分支每个提交的新检出上均通过；失败只出现在本开发工作树，来自本地环境状态（清除 `node_modules/.vite/vitest` 不能消除，根因未查） |
| 相关 E2E（chromium，17 个 spec，含管理员 / 销售改单相关的 order-field-repairs、foil-color-history、order-multiple-addresses、order-external-sales-association、sales-functional-review、order-create，以及 order-leave-recovery、price-workspace-leave、order-create-ui-parity、order-creation-groups、sample-orders、price-entry、price-versions-layout、blank-price-only、blank-paper-pricing、confirmed-custom-tiers、interaction-discoverability） | 第六轮（新库 `erp_e2e_navguard_20261004p`，18 个 spec）85 / 85 通过（8.3 分钟）。此前各轮：85 / 85（第五轮）、79 / 79、80 / 80、81 / 81、81 / 81、82 / 82 |
| `test:admin-ui`（全部九个配置视口，第五轮 `59c1a054` 新库，`--workers=4`；第六轮未重跑） | 227 通过、16 跳过、0 失败（第二、三、五轮均如此）。16 个跳过是两条按设计只在单一视口运行的用例在其余 8 个视口各跳过一次。另见下文「协调方运行中的 4 个 ERR_ABORTED」。首轮（`22841915`）曾有 1 次偶发失败：`admin-390x844`「critical routes … dark tokens」，此后未再出现，根因未确认 |
| `test:worker-ui`（全部九个配置视口，第五轮新库；第六轮未重跑） | 18 / 18 通过（第二、三、五轮均如此） |

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
- 新建工单里自带本守卫 onNavigate 的页内链接（页头返回、结果页「查看工单」、报价草稿「恢复草稿」、「打开草稿」）确认后重放时，仍按各自目标 `router.push`，不经 Next Link 自己导航。这些链接没有 `useLinkStatus` / `LinkPendingHint` 之类的 pending 界面，所以界面上看不出差别；改为由 Link 自己导航会改变 `OrderCreationLeave.browser.spec.tsx` ①② 中既有的 `router.push` 断言，按规则不改，待评审决定。
- `PendingButton` 确认离开后有意用整页加载（`leaveDocument`），不重放原链接：软导航会排在进行中的 action 之后。外链由浏览器原生 beforeunload 确认，文案由浏览器决定。
- 一经 Next 接管，刷新放行不再有时间上限（地址提交会结束放行，不依赖 Navigation API）：若该导航既不提交、也不回退整页（如 RSC 请求一直挂起），且用户不与页面交互、页面也未切到后台再回来，放行会一直保留，直到上述任一事件发生；这期间经浏览器菜单的刷新不再提示。
- 区分「Next 接管」与「调用方取消」依赖 Next 的 `onRouterTransitionStart` 钩子在点击处理中同步触发（16.3.6 已实测）；Next 升级若改变这一时序，确认后的整页回退可能再弹一次原生提示，升级时需复跑 `order-leave-recovery` 的 RSC 500 用例。
- 刷新放行在无法跟踪时的退化：页面既未卸载、也没有交互 / 可见性 / pageshow 事件时，放行最多保留 10 秒；这期间由键盘以外方式（如浏览器菜单）触发的刷新不会再提示。反过来，若浏览器在页面交互之后才派发 beforeunload，用户会再看到一次原生提示（只多一次，不会丢内容）。
- WebKit 只做了组件级测试与时序探针，没有真实页面 / E2E 验收；Firefox 未验证。
- `admin-responsive` 首轮的一次偶发失败（见上表）根因未确认，若 CI 再现需在基线上对照分类。
- 九视口门禁仅在开发服务器上执行；生产构建、真机、Safari 未验收。
