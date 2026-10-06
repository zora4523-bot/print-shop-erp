# PR #52 对抗审查修复

日期：2026-10-06。分支：`codex/dev-main-2026-10-03`。开始 SHA：`6ec53ce0`，开始工作区干净；本轮合入 `origin/main` 的 `793bf6fa`。

菜单字体缩放修复前的实现与测试指纹：相对 `793bf6fa` 的 `.ts/.tsx/.json/.yml` 差异 SHA-256 为 `1848253fcd8de5eaf3739526f5f897e5ef217d44cd1197feefeceb5c2ea136a4`。下述全量单测与共库验收对应该阶段；随后实际图像 QA 发现第 11 项范围内问题，新增最小 CSS 修复及针对性复验，不能将之前结果冒充新增 CSS 后的执行。

最终实现与测试冻结指纹为 `58b3f051bbbc6595581fa7ae55fe205512e671dd442f16261e938d103e694f13`，原始差异在 `.review/pr52-frozen-implementation-final.diff`。中间指纹 `0b35d206…` 对应宽度/图标修复，`08669cf7…` 补齐测试登录隔离，`352079ad…` 修复第 12 项定位及内部边界断言；最终仅再给 release 的独立 exclude 补 `test-results`，不改已构建产品代码，通过该配置的实际 TypeScript 检查。各阶段结果分开记录。

## 范围与不变量

- 保留 PR 的文案、字段说明和账号菜单可访问性改动；修复配置容错、测试接入和文档冲突。
- 权限、金额、数据库结构、已应用迁移、历史快照和生产流程均沿用 main。测试使用专用本地库，不操作生产。
- main 的 CONTRIBUTING 风险相称验证表、CLAUDE §8.2 测试分层及 §15.7 配置降级与本分支的全局禁止 mock/配置错误直接抛出规则冲突。用户已批准本轮修复计划，按既有业务行为统一规则。

## 修复与证据

1. `lib/cdr/zip.ts` 恢复显式 `CDR_BUNDLE_MOCK_MODE` 优先；未指定模式且 OSS 配置缺失/非法时返回降级状态。设计文件地址校验在非法配置下返回 false。配置齐全时仍走真实打包；没有新增外部写入或改变 ZIP 产物。
2. `zip-config.test.ts` 保留独立真实配置测试，覆盖非法 endpoint + 默认/true/false 三种模式、缺配置、开发/生产默认模式和文件地址。原 ZIP 流测试继续验证上传、流失败和归档内容。
3. 恢复 `AdminShellNavigation.browser.spec.tsx`，保留开发环境标签、角色、明暗、键盘、焦点、几何和 axe 组件覆盖；真实导航 E2E 并行作为更高层验证。
4. 删除独立的 navigation 配置及 CI 作业；真实导航由既有 `admin-*` projects 收集，继承 PR 两视口/main 九视口分层、隔离库、生产构建和失败截图/trace。固定桌面操作只在 1280×800 执行，其余视口保留完整布局、账号菜单、父级导航与可访问性检查。
5. 规则目录导航从已选中的 machine 切换到 blank，明确断言切换前未选中、目标 href、实际 URL 与切换后唯一选中态；CDR 页面验收检查汇总页及工作台恢复提示。
6. 文档保留 main 的新规范、历史证据边界和文档门禁；清除仍要求独立下发生产的现行描述。协作与编码规则允许按测试分层隔离外部依赖，禁止以规则变化跳过回归。文档基线仅移除一条本分支已删除的历史引用，无新增豁免。
7. 全量验证发现文案测试在 `test-results/ui-copy/` 生成的临时 TypeScript 文件被类型检查收集，测试清理与编译并行时产生 TS6053。常规、release 及 durable 配置均明确排除该生成目录；dead-code 配置继承常规排除。修复后与全量单测并行的 typecheck 通过，最终 release 独立配置也执行 `tsc --project tsconfig.release.json --noEmit` 通过。
8. 既有按钮 AST 门禁指出账号菜单提交按钮缺少必要原生承载说明。保留共享 DropdownMenuItem 的样式、方向键行为与表单提交，对承载原生按钮补充明确原因；同一门禁失败后复验通过，未修改扫描规则。
9. Claude 首轮发现运维文档仍写非法 OSS 配置直接抛错、视觉门禁表格含字面量换行、两份规范末尾仍要求全部真实服务，以及退出帮助函数注释过时。逐项对照代码修正；历史文案验收标明旧测试政策已被取代，表述规则明确保留准确术语与 Markdown 表格。另为既有“不主动使用视觉功能”增加已授权 UI 任务必须完成 Design QA 的例外，消除规则冲突，不据此新增视觉功能或扩大为全站重构。
10. 共库组合验收的 trace 暴露既有 `admin-responsive` 的主题初始化脚本可能先于 `documentElement` 执行，产生空元素异常。为该脚本增加根元素存在检查；仍先保存主题，应用读取该值，页面就绪后的主题断言和错误检查保持原样。未改产品代码。
11. 320px 视口的真实 200% 根字号 QA 发现账号弹出菜单右边界为 453px；原固定 `w-56` 随 rem 放大到 448px。依据当前安装 Base UI 的可用宽度变量，仅给菜单增加最大可用宽度，账号文字容器允许收缩，图标保持标准尺寸，并沿用项目长词换行工具类。新增真实长账号、明暗主题、九视口、全文边界、方向键滚动后的动作边界、键盘焦点和真实退出回归。旧生产构建执行新增测试在 `453 > 320` 处真实失败，截图与 trace 保存在 `.review/pr52-long-menu-before-fix/`，没有覆盖。
12. 更完整矩阵在 768px、200% 字体、长账号时发现锚点已在视口外，浮层稳定右界 808px。实时诊断确认可视视口与 clientWidth 都是 768px，而既有顶栏/侧栏放大后的锚点左界为 808px；Base UI 默认 `limitShift` 保留与锚点接触，导致浮层也越界。共享 `DropdownMenuContent` 仅透传可选的定位器 `sticky`，只在 `UserMenu` 启用，使菜单在锚点离开视口后仍留在可视区域。其他菜单默认定位不变，不改整页结构。主任务独立核对安装版 API 与实现。按 Claude 第二轮建议，动作同时断言在菜单内部可见矩形和视口内。

## 实际验证

环境：Node 24.15.0，Next.js 16.3.6。已读取当前安装版 Playwright/Next 测试指南。初始浏览器库 `erp_e2e_pr52_fix_20261006`、单测库 `erp_e2e_pr52_unit_20261006` 位于本机；菜单增量使用另一个完整迁移、seed、fixture 准备通过的 `erp_e2e_pr52_css_20261006`，不重写已由前轮测试使用的价格书。常规服务端口 3214，产物 `.next-release`；durable 使用专用 `.next-durable`。通知/CDR 使用隔离测试模式，不代表生产基础设施通过。

- 冻结安装通过；浏览器库完整 188 条迁移通过，seed 与 fixture 准备完成。初次 fixture 准备因未传本轮 seed 管理员名称失败；使用实际已建测试管理员后通过，未改变前置检查。
- 目标 Vitest：4 文件、85 项通过（CDR 配置、ZIP、OSS 配置、文案检查）。
- 原始 `6ec53ce0` 的 ZIP 模块与修复版使用相同非法 endpoint 对比：原版默认/true/false 均在模式及地址检查抛错；修复版模式分别为 true/true/false，地址均为 false。证据 `.review/pr52-config-comparison.log`。
- 导航与移动抽屉组件浏览器：2 文件、66 项通过。
- 架构门禁：1221 模块、5020 内部依赖、24 项既有超长函数记录，通过。
- 菜单 CSS 增量前的生产构建、typecheck、完整 lint、文档门禁及未使用代码门禁通过。Lint 保留 `app/global-error.tsx`、`OrderCreatedSuccessView.tsx` 两条既有 Next 导航 warning；文档基线 19 条，未使用代码零新增/失效/循环。原生按钮门禁 1 项复验通过。
- 首轮全量 Vitest：780 文件、8723 项通过，2 项失败、46 项跳过。按钮 AST 为本分支回归，已修复；另一个 PG 警告探针在并行构建负载下超过其原有 10 秒期限，不改实现或超时后独立复验 3.55 秒通过。两个失败目标均通过，随后重跑完整批次。
- 首轮真实九视口/零 JS：73 项通过、1 项失败、49 项专项跳过、25 项未执行；新增 CDR 验收错误访问了销售工作台 `/workbench`，该页没有 CDR 区域。依据 `app/(admin)/owner/page.tsx` 实际调用改为 `/owner#cdr-download`，保留恢复提示断言并增加区域标题断言。CDR 与规则目录真实切换 2 项独立复验通过，随后重跑完整矩阵。零 JS 4 项在首轮已通过。
- 最终全量 Vitest：782 文件、8725 项通过，0 失败，46 项跳过。跳过包含 41 项已退役旧账单实现、2 项需 fresh/upgrade 专属迁移夹具、2 项要求特定命名数据库的导出快照集成检查、1 项需显式启用的包装历史修复夹具；本轮没有改变这些条件，未将其记为通过。
- 菜单 CSS 增量前完整真实九视口与零 JS：92 项通过，0 失败，56 项有意限定视口的专项跳过。88 项导航检查覆盖管理员/销售、九视口、明暗主题和账号交互；7 项固定桌面行为在 1280×800 执行，其余 8 个视口各跳过这 7 项。另 4 项零 JS 登录/退出/改密通过；无 flaky、无未执行的后续步骤。
- 单独注入非法 `OSS_ENDPOINT` 与完整测试专用 OSS 字段、保留 `CDR_BUNDLE_MOCK_MODE=true`，生产构建下 CDR 汇总页及管理工作台恢复提示 1 项通过。这项页面测试仅证明显式测试模式不会因非法 endpoint 进错误边界；默认未设置模式时的容错由未 mock 配置模块的 `zip-config.test.ts` 三模式测试证明，不将其记为默认模式真实页面验收。
- 两代表 admin 项目全部规格共库首轮：23 项通过、1 项失败、7 项专项跳过、61 项未执行。失败为既有暗色 routes 检查的工单搜索在 5 秒内未出现预期 URL；trace 有目标 q 请求的 200 响应头但未完成响应体。搜索页及该断言与 main 一致，未修改断言、未增大超时，原样单独复验 1 项通过。此超时未稳定重现，来源未最终确定；第 10 项初始化异常不作为其已证实根因。保留首次报告和 trace。
- 菜单 CSS 增量前完整共库组合复验：84 项通过、8 项视口条件跳过、0 失败；同时收集导航、后台响应式与生产排程三个规格，覆盖两代表项目。8 项跳过是 375px 上的 7 项桌面专项，以及一项仅在 1280px 执行的既有几何检查。
- 菜单 CSS 增量前消费方：认证、退出竞态、结算流程、结算工作区、个人计件、计件管理、计件撤销、smoke 共 27 项通过。durable 首次误用 `E2E_PREBUILT=1` 时因不存在 `.next-durable` 在服务启动阶段失败，实际执行 0 项；随后按标准入口单独构建及复验，结果见最终条目。
- 初版菜单 CSS 增量后的导航与移动抽屉组件浏览器检查：66 项通过。新增 200% 长账号回归的失败、后续修复与最终矩阵结果分别列在下面。
- 首轮新 CSS 矩阵：6 项通过、1 项失败、33 项未执行。长账号使共享菜单进入现有的纵向滚动模式；测试未聚焦退出项前即要求它全在视口内，测得底部 570px 超过 568px。保留面板与全文宽度断言，改为真实方向键聚焦后检查每项可见边界，验证滚动访问能力；不缩小文字、不放宽边界数值。截图另发现非交互图标被长词挤缩，补 `shrink-0` 并重新构建。首次 JSON、截图及 trace 独立保存于 `.review/pr52-long-menu-scroll-before/`。
- 保留初版 CSS 构建，仅以真实方向键逐项聚焦的同一场景独立复验 1 项通过，证实原菜单内部滚动可用。新增图标实际尺寸回归在旧构建得到 9.59375px（要求 32px）真实失败，证据保存于 `.review/pr52-long-menu-icon-before/`，最终修复不通过放宽该断言。
- sticky 修复前的 release 构建通过（12.1 秒编译、11.0 秒 TypeScript），目标 ESLint 与文档门禁通过。320/1280 明暗工作台及普通/200% 菜单截图在该产物再次采集；320px 的浮层右边界为 315px、动作右边界为 307px，焦点检查通过，既有底层 382px 横滚保留记录。
- 最终 CSS 矩阵第二次执行：19 项通过、1 项失败、20 项未执行，393px 暗色用例的登录页明确提示“登录尝试过于频繁”。新增规格未使用现有 `_login-client.ts`，多个独立浏览器页因直连本地服务共用 `unresolved-client` 限流桶。沿用项目 `isolateE2eLoginClient` 为独立页提供文档保留网段的稳定地址，不改生产代理、限流参数、认证或超时；同一页继续使用真实限流。两个登录入口补充调用后重跑完整 40 项，原始报告保存在 `.review/pr52-menu-rate-limit-first/`。
- 限流隔离后完整矩阵：26 项通过、1 项失败、13 项未执行。新增 768px 检查真实捕获第 12 项越界；等待动画结束及额外 250ms 的诊断仍为右界 808px，不归因于动画或测试速度。失败 trace、截图及几何记录保存在 `.review/pr52-menu-768-before/`，修复后使用同一 768px 边界断言复验。
- 最终 sticky 候选 release 构建通过（10.5 秒编译、19.8 秒 TypeScript）；导航/移动抽屉组件 66 项通过，目标 ESLint、UI 文案与 UI 令牌门禁通过。真实 768px 诊断在同样锚点左界 808px 时，动画完成后的浮层右界为 763px，额外 250ms 后保持该位置，见 `.review/pr52-position-probe.json`。
- 最终菜单矩阵 40/40 通过（3.4 分钟，0 失败/跳过）：18 项九视口管理员/销售普通菜单，18 项九视口明暗 200% 长账号（全文、图标、菜单与视口内可见动作、键盘和真实退出），4 项零 JS 恢复路径。日志/JSON 为 `.review/pr52-release-menu-popup-final.*`；最终登录隔离、图标及 768px 定位修复均参与此次执行。
- 最终 durable：按 `E2E_PREBUILT=0` 标准入口在 3215 单独构建 `.next-durable`（16.7 秒编译、41 秒 TypeScript），`tests/durable/files.spec.ts` 3/3 通过（2.6 分钟）。真实 HEAVY worker 验证工单导出的 IO 失败与重试、XLSX 内容/所有者/过期、月账单导出，以及 CDR 测试模式状态与真实 PDF 下载。日志/JSON 为 `.review/pr52-release-durable-final.*`；没有复用 release 产物，也没有宣称真实 OSS 已验收。
- 最终冻结候选按 PR CI 两代表项目共库组合执行：88 项通过、8 项视口条件跳过、0 失败、0 flaky（10.5 分钟）。本轮新增的长账号用户夹具与导航、后台响应式（含账号管理）、生产排程规格在同一专用库依次执行；相较 CSS 前的 84 项，新增 4 项两代表视口明暗 200% 长账号检查。原有 8 项视口限定跳过保持不变。原始日志与 JSON 为 `.review/pr52-release-shared-final-candidate.*`。

## 对抗审查

关键复验入口（Node 24 PATH，浏览器命令配套上文的专用 `E2E_DATABASE_URL`、确认库名和 seed 账号；常规复用 `.next-release`，durable 独立构建）：

```sh
pnpm exec tsx scripts/e2e-release-build.ts
pnpm exec tsc --project tsconfig.release.json --noEmit
pnpm exec vitest run --config vitest.browser.config.ts components/business/admin/__tests__/AdminShellNavigation.browser.spec.tsx components/business/admin/__tests__/AppSidebarMobileClose.browser.spec.tsx
pnpm exec playwright test tests/e2e/admin-shell-navigation.spec.ts tests/e2e/no-js.spec.ts --config=playwright.release.config.ts --grep '200%|账号菜单|JS'
pnpm exec playwright test tests/durable/files.spec.ts --config=playwright.durable.config.ts
pnpm exec playwright test --config=playwright.release.config.ts --project=admin-375x667 --project=admin-1280x800
pnpm check:docs
```

Claude Code 2.1.291 首轮只读 review 的真实评分为 7/10，建议暂不合并。它没有确认运行时缺陷，但指出 5 处文档/注释问题、审查快照包含已修正的 CDR 测试旧路由，以及完整测试尚未结束。以上可确认问题已按第 9 项修复；保留首轮原始结果 `.review/pr52-claude-review.json`，不以本段代替最终复审。

第二轮真实评分为 8/10（`.review/pr52-claude-final.json`）。首轮文档、配置和注释问题全部闭环，仍要求完整菜单矩阵、durable 及新增长账号夹具后的共库验收；另指出动作边界只比较视口，已在第 12 项补强。第二轮执行过程中发生登录隔离修复，因此没有将其视为最终冻结候选已通过。

第三轮在实现、测试及配置冻结且上述验收全部完成后执行，真实评分为 **9.2/10**，未发现可确认的产品缺陷，建议以远端 CI 通过为前提合并。Claude 独立核对安装版 Base UI 的 `sticky` 默认值与定位实现，并核对最终 40/3/88+8 项原始报告及内部动作边界。原始结果 `.review/pr52-claude-completion.json`，同一只读会话 `dd31e58f-ad9e-4408-bd6e-dc9ddf53b863`，执行 98.8 秒、30 turns，返回 `success`。其非阻断文档意见为 DEVELOPMENT 少列 release 配置，已补齐；短视口下浮层可能覆盖触发按钮属于定位策略的剩余低风险，现有九视口未见不可操作。远端 CI 和其他七视口的三规格共库组合未执行，保留该边界。复审后不再修改实现或测试。

Claude 还指出先前静默的 TypeScript / ESLint 日志缺少可独立确认的退出码。相同冻结源码补跑 `tsc --project tsconfig.release.json --noEmit` 及最终四个改动文件的 ESLint，均退出 0；`.review/pr52-release-typecheck-final.log`、`.review/pr52-eslint-completion.log` 记录实际命令与退出码。源码指纹复核仍为上述 `58b3f051…`，未重复业务矩阵。

## 验证边界

本轮按代码、DOM、计算样式、真实交互、axe 及范围内截图复验，未做全站逐页图像验收。320px 根字号 200% 时底层既有 header/body 仍有 382px 横向宽度；本轮限定修复浮层可用宽度与长账号，不把整页横向布局写为通过。页面切换时服务端仍记录既有 `The destination stream closed early.`；导航规格的浏览器 console error/pageerror 断言通过，未吞掉日志或将服务端日志写为零异常。现有测试模式不能证明真实 OSS 上传、真实通知收件或生产部署已通过。远端 CI、生产 smoke 与发布未执行。

## Design QA 复核范围

本轮修复保留既有页面结构，UI 增量为原生退出按钮说明、菜单可用宽度与长账号排版；同时复核原 PR 的菜单与文案消费者。实施审查者为 Codex，主任务代理独立目视截图，独立对抗审查为 Claude Code。以下只对实际列出的证据作结论。

1. 视觉层级：320/1280px 明暗主题的工作台及打开菜单截图完成三秒检查；标题、导航、账号身份与修改密码/退出操作顺序明确。主任务代理独立复核四张普通菜单及 200% 菜单，确认信息完整和修复后的浮层边界。
2. 排版与留白：九视口导航边界、长标题和菜单文字位置检查通过；不声明全站逐像素一致。
3. 色彩与对比度：light/dark 导航与展开菜单 axe 检查通过；未新增色值。
4. 组件一致性：共享 DropdownMenuItem、原生表单、主题令牌及开发环境标签覆盖保留，66 项组件检查通过。
5. 交互反馈：打开、Escape、焦点恢复、方向键、Enter、鼠标退出及实际登录页跳转通过；27 项实际业务消费方结果与后续 CSS 增量结果分别列出。
6. 动效：1280×800 的 Reduced Motion 和折叠焦点行为通过，其他视口保留正常模式布局与交互检查。
7. 响应式：320/375/390/393/430/768/1024/1280/1920 宽度均实际运行，管理员与销售均包含明暗主题。
8. 功能质量：真实路由切换、角色入口、模式记忆、零 JS 三条恢复路径和 CDR 非法配置恢复提示通过；生产基础设施未验证。
9. 可访问性：axe、触控区域、键盘、焦点与 Reduced Motion 通过。200% 实屏检查发现并修复菜单横向越界，普通账号 320/1280 明暗截图与焦点检查通过；最终 40 项矩阵中包含 18 项长账号九视口明暗 200% 检查，全数通过。主任务代理另独立目视 320px 长账号全文与动作截图。整页既有 200% 横滚不在通过范围。
10. 原创性：没有新增视觉资产、参考或组件体系，保持项目既有设计。

原始证据位于本工作树忽略目录 `.review/pr52-*.log`、`.review/pr52-unit-final.json` 及标准 Playwright 报告；不提交密钥、数据库、构建产物或测试截图。本轮未 push、未合并 PR、未部署。
