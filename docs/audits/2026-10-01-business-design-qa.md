# 业务页面 Design QA（2026-10-01—02）

本轮由业主要求「打开业务页面做完整 Design QA」，承接 `8577a470` 的规范审查。初始工作区干净；候选为该 SHA 加本报告同一提交的增量。审查者为 Codex，通过真实 Chromium 页面、截图、键盘及项目门禁复核；不是用户研究或奖项评分。

## 范围与功能保护

沿用当前导航、产品结构、业务流程与 Design System。应用改动仅涉及布局、对比度、导航提示层挂载、主题按钮初始化状态、登录失败输入保留和打印长文本换行。未修改角色权限、金额计算、状态机、工单版本、幂等、审计、历史快照、数据库 schema 或迁移；打印模板缓存版本升为 8，避免继续命中存在溢出的旧 PDF。没有新增视觉资产或外部设计引用。

- 环境：macOS、Node 24.15.0、pnpm 10.33.1、Next 16.3.6、Chromium，`next dev`，端口 3106。
- 数据：独立数据库 `erp_e2e_designqa_20261001_6f81`，由现有 E2E 数据库复制，再仅向该副本应用当前待执行迁移及准备夹具。日常库和生产库未写入。
- 外部服务：通知与 CDR 使用 mock，后台任务 inline。真实企业微信实收、OSS、生产 worker、生产构建及真机不在本轮证据内。
- 页面矩阵：320×568、375×667、390×844、393×852、430×932、768×1024、1024×768、1280×800、1920×1080；每种尺寸浅色/暗色。保留已有 393px，新增标准要求的 320/390/430px。
- 打印按物理 A4/PDF 验证，不把固定纸张宽度套用普通页面的手机重排；正文必须留在纸张内，页数必须与声明一致。

## 确认问题与修复

| 编号 | 严重度 | 实际触发与影响 | 修复及原条件复验 |
|---|---|---|---|
| QA-01 | P2 | 320px 编辑工单页，操作组挤占标题宽度，四字标题断成两行，长工单名形成窄列 | 手机标题与操作纵向排列，桌面结构保留；标题单行及操作位置回归、九视口明暗门禁 |
| QA-02 | P2 | 推送配置的危险状态面板与徽章半透明底色叠加，浅色文字对比度 4.38:1，低于 4.5:1 | 面板复用 `bg-card`，保留危险边框、文案及状态；九视口明暗 axe 复验 |
| QA-03 | P2 | 通知规则/日志表格在 320px 把中文挤成逐字竖列；无 body 溢出仍明显不可读 | 表格设置最小阅读宽度，保留已有 `TableScrollArea` 局部滚动；文字行高回归、键盘横滚后编辑入口可见可点 |
| QA-04 | P2 | 抵扣表单标签换行后，原因框比金额框/提交按钮高 24px | 网格控件底边对齐；九视口明暗几何门禁及真实抵扣流程 |
| QA-05 | P2 | 历史日薪调整原因含连续英文时，320/768/1024px 页面横向溢出 | 两列中屏、四列宽屏、文本可换行；九视口明暗原长文本复验，历史数值不变 |
| QA-06 | P2 | 手机菜单连续 Tab 后，隐藏 Tooltip 拦截第一次 Escape，菜单未关闭 | Tooltip 只在桌面收起侧栏挂载；连续 35 次 Tab 焦点陷阱、一次 Escape 关闭、焦点返回及桌面提示回归 |
| QA-07 | P1 | 打印规格/款名含连续英文，明细表撑出 A4 纸张，打印可能缺失右侧数量 | 仅规格、款名列允许长串换行，数字列不改；新增纸张横向边界与长串回归，并运行原打印像素基线 |
| QA-08 | P2 | 登录密码错误后，React 表单重置同时清空用户名，不能仅修改密码重试 | 用户名由本地输入状态保留；密码错误反馈、只改密码后 Enter 登录及无 JS 契约复验 |
| QA-09 | P2 | 整页导航后，主题按钮先显示可点击，交互脚本尚未就绪时首次点击丢失 | SSR 阶段禁用、hydration 完成后启用；暂停真实脚本请求复现与复验，首次可用点击、主题切换及 Escape 焦点返回回归 |

功能前后对照：工单字段、锁定状态和保存/放弃调用未改；通知目标与事件配置的提交、测试、权限路径未改；抵扣字段、金额和跨月归属未改；日薪历史只调整布局；导航链接、路由完成后关闭规则未改；登录仍由原 Server Action 校验凭据及跳转；打印完整规格、款名、数量、二维码和分页逻辑未改。对应组件回归、真实业务提交与打印测试用于核对这些不变量。

打印实页负控：移除新增换行规则时，第一页 `clientWidth=794 / scrollWidth=1046`，续页之一 `794 / 851`；恢复后 7 张纸均 `794 / 794`，每张高度仍为 1123px。登录实页先复现错误密码导致用户名为空，再确认修复后值仍为 `e2e-owner`，仅输入正确密码并按 Enter 可进入 `/owner`。

主题实页负控：阻塞 31 个页面脚本请求时，原按钮仍 enabled，点击后释放脚本，菜单数量仍为 0；修复后阻塞期间 disabled，释放后 enabled，首次可用点击打开菜单。没有给账单主题测试增加等待、强制点击或重试来掩盖问题。Next.js hydration 依据为当前安装版 `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`。

修复前后截图均为隔离测试数据，保存在本机忽略目录，不随源码提交，也不保证跨机器或长期保留；长期证据为本报告的复现条件、测量结果与对应回归断言：

- [编辑工单，320px](../../output/playwright/design-qa/curated/order-edit.png)
- [推送配置，320px](../../output/playwright/design-qa/curated/notifications.png)
- [抵扣表单，1280px 局部](../../output/playwright/design-qa/curated/credit.png)
- [历史日薪，320px 局部](../../output/playwright/design-qa/curated/daily-salary.png)
- 打印明细局部：[修复前](../../output/playwright/design-qa/curated/print-before.png)、[修复后](../../output/playwright/design-qa/curated/print-after.png)

## 路由与状态覆盖

| 角色/区域 | 页面与状态 | 证据入口 |
|---|---|---|
| 管理员日常工作 | 工作台、经营图表真实挂载、四类关注事项、工单列表/长筛选/详情/建单/编辑、设计与规格标签、发货与批量操作专项 | `admin-responsive.spec.ts`、浏览器候选截图及首轮专项 |
| 规则与基础资料 | 规则中心各分区、纸张/工艺/规格/分类/产品资料、价目版本/员工规则、用户/客户供应商/用料清单/物料的新建与详情、仓库设置 | 页面矩阵及 `audit-admin-02/03/04` |
| 财务与运营 | 外部销售月账单列表/详情/未入账/抵扣、历史账单归档、薪资总览/时薪与日薪历史/日薪长备注详情/计件结算、采购/外协/工时、CDR、后台任务、通知目标/事件规则、系统设置、Pigsty | 页面矩阵、补充实页审查及业务 E2E |
| 销售 | 自有工单/详情/创建/长内容抽屉、总览、货款账单/结算依据/收款展开、跨页筛选和导出失败重试 | 角色登录后的矩阵、`sales-overview-export`、`bill-workspace` |
| 师傅 | 工序/报工表单、工单与详情、工资与历史详情、报工记录、账号、找不到/无权限反馈 | `worker-responsive.spec.ts`、报工 E2E |
| 公共入口 | 登录、错误密码及重试、改密码返回、当前二维码跳转与过期纸单阻断、打印预览 | 实页检查、auth/no-js、打印测试 |

默认、有数据、长文本、空列表、加载结束、禁用、待确认、失败恢复及成功回执分别由适用页面/业务用例覆盖；不宣称每个页面的所有业务组合都经过穷举。后台配置写入、采购与报工仅在隔离库进行；通知 mock 不代表消息真实送达。

计件结算详情先检查零金额展示夹具；跨过上海业务日后，再通过原 `lockPieceworkSettlement` 领域入口锁定隔离副本内已完成的 5 条前日报工（合计 240.02 元），管理员和所属师傅的非空详情均完成九视口明暗检查。非空报工详情使用已有合法报工。旧账单详情只使用新建的零金额展示夹具（无明细），非空旧账单状态仍不在本轮证据内。没有改写既有报工或绕过结算日/历史不可变约束。

缩放补查采用 1280×800 在 200% 页面缩放时的等效 CSS 视口 640×400，工作台、编辑、通知、历史日薪均无横向溢出；原生浏览器菜单缩放控制超时，未计作真机/原生缩放通过。另一次直接覆盖 `html { font-size: 200% }` 的诊断在工作台产生 25px 溢出；该方法同时改变 rem 尺寸、却不改变视口断点，不能等同浏览器页面缩放。原样保留诊断记录，不用它证明原生缩放已验收，也不据此擅改已确认的看板结构。

## 十项 QA 结论

| 顺序 | 检查 | 本轮方法与结果 |
|---:|---|---|
| 1 | 视觉层级 | 实屏查看手机与桌面首屏，核对当前任务、主要信息和操作；编辑标题挤压已修。代理自查，不声称真人 3 秒测试。 |
| 2 | 排版与留白 | 同行控件、长中文/英文、数字、表格、固定区域及页面末尾；修复表单错位、逐字列、历史备注和打印溢出。 |
| 3 | 色彩与对比度 | 明暗主题及 WCAG A/AA axe；修复通知嵌套表面对比度，不更换全局品牌色。 |
| 4 | 组件一致性 | 沿用 PageHeader、Button、Input、TableScrollArea、Sheet 与语义 token；没有新增局部组件体系。 |
| 5 | 交互反馈 | 键盘/指针 Hover、Pressed、Focus，加载结束、错误重试、Disabled、确认与成功；登录输入保留、菜单 Escape 和主题初始化状态已修。 |
| 6 | 动效 | 销售长内容抽屉在正常/Reduced Motion 下关闭及历史恢复；导航焦点、滚动和操作不依赖动画。没有新增动画。 |
| 7 | 响应式 | 九视口明暗自动检查，手机/桌面截图实看；局部横滚可聚焦，页面不以隐藏溢出来掩盖文本。 |
| 8 | 功能质量 | 业务提交与权限隔离 E2E；实际补查页面监听 console/pageerror/异常请求，加载结束后采样布局。开发环境数据不作为生产 Web Vitals 结论。 |
| 9 | 可访问性 | axe、语义/标签、键盘 Tab/Enter/Escape、焦点陷阱与返回、44px 手机目标、Reduced Motion。未进行真实读屏器与真机验收。 |
| 10 | 原创性 | 本轮只修已有产品，没有复制外部作品、引入视觉资产或改变业务结构。 |

## 验证记录

本轮已确认的 1 项 P1、8 项 P2 均按原触发条件修复复验；未发现遗留 P0/P1。结论限于上列实际覆盖范围，不代表生产部署、真机或全部历史数据组合已验收。

| 检查 | 实际结果 | 本机证据 |
|---|---|---|
| 首轮 320/1280 页面专项 | 54 通过、3 有意限定项目的跳过、1 冷编译/并行负载下建单路径超时；后续九视口建单/详情/编辑已覆盖原失败 | `baseline-gates.log`、`baseline-report.json` |
| 九视口管理/销售/师傅最终矩阵 | 98 通过、1 导航断言 5 秒超时、0 跳过；原 1024 暗色完整路由用例单 worker 复验 1/1 通过（59.8 秒），不修改超时或断言，99 个用例均获得通过结果 | `final-matrix-report.json`、`matrix-recheck-report.json` |
| 业务与打印首轮 | 49/50 通过，含打印 33/33、采购 2/2、报工 3/3、通知权限 2/2、销售 2/2、登录 3/3、无 JS 4/4；账单首次导航耗时 5.4 秒（编译占 4.6 秒）超出断言预算，后续复验发现 QA-09 并修复；未更新打印像素基线 | `functional-report.json`、`bill-recheck-report.json`、`bill-cold-navigation/`、`bill-theme-failure/` |
| 主题修复后的业务最终复验 | 11/11、0 跳过，3.8 分钟：完整账单 1、销售导出/九视口 2、登录/慢加载主题 4、无 JS 4；此前失败的账单通过，金额/权限/历史依据断言保留 | `final-business-recheck-report.json`、`final-business-recheck.log` |
| 编辑工单浏览器组件 | 64/64；320px 原条件修复前 2/2 失败，修复后通过 | `editor-before.log`、`editor-after.log` |
| 导航浏览器组件 | 修复 Tooltip 后 44/44；补桌面提示回归及主题初始化修复后，两个 suite 最终 45/45（含重叠用例，不相加计数） | `sidebar-before.log`、`sidebar-after.log`、`navigation-final.log` |
| 打印 HTML 单测 / 分页组件 | 46/46、2/2 | `print-unit.log`、`print-browser.log` |
| PDF 缓存身份、快照竞态、下载路由与批量打印 | 模板缓存版本升为 8 后，70/70 | `pdf-cache-final.log` |
| 完整 lint / typecheck | 通过；lint 仅两条既有 Next 导航 warning，UI 文案/令牌无新增违规 | `lint-final.log`、`typecheck-final.log` |

日志、JSON、完整截图和失败 trace 保存在本机 `output/playwright/design-qa/`（忽略目录，无跨机器保留承诺）。初始超时与复验记录均保留；错误的探测 URL `/owner/stock-skus*` 已按实际路由 `/owner/rules/stock-skus*` 更正，不记作产品死链；ADMIN 被重定向离开 `/sales/overview` 不计为销售页面通过，销售覆盖来自真正 SALES 会话。

最后一次重启测试服务器时，先前有头浏览器持有人工服务器签发的 cookie，与 E2E 固定签名密钥不同，服务端记录一次 `JWTSessionError`；已关闭该旧会话。错误密码用例的 `CredentialsSignin` 和跳转期间的 `destination stream closed early` 也原样保留，未把服务端开发日志写成零错误。独立 E2E 会话通过登录、错误恢复和原有业务断言。

补查监听没有非预期 Console Error、pageerror 或 HTTP ≥400；两条 RSC 请求在换页时 `net::ERR_ABORTED`，保留在 `audit-admin-03` 中，不能写成「所有请求都成功」。采样的稳定页面布局位移很小，最高约 0.00081；这不是生产 CWV 基准。

核心矩阵之外，补充实页审查去重后共 51 个路由、918 个视口/主题组合，最终几何/axe 无违规（`supplemental-summary.json`）；包含登录、创建/编辑页、非空计件结算和取消采购等状态。该数字包含路由别名的真实跳转结果，不等于 51 种独立业务，也不与主矩阵数字累加成页面总数。

收尾已停止本轮 3106 服务、关闭专属浏览器会话，删除测试副本 `erp_e2e_designqa_20261001_6f81` 和本轮新建的 `.env`。复制来源 `erp_e2e_l8chrome_1001` 仍存在，原有 3003 服务未操作；日志和截图留在忽略目录。未 push、未部署。

主要命令（实际经本任务 `.review/design-qa/run.mjs` 的隔离环境激活器运行 E2E）：

```sh
pnpm exec playwright test tests/visual/admin-responsive.spec.ts tests/visual/worker-responsive.spec.ts --project='admin-*' --project='worker-*' --grep 'critical routes|worker routes|order creation, detail|sales routes|long sales order drawer|design and specification tabs' --workers=2
pnpm exec playwright test tests/visual/admin-responsive.spec.ts --project=admin-1024x768 --grep 'critical routes pass the same gates with dark tokens' --workers=1
pnpm exec playwright test tests/visual/order-print.spec.ts tests/e2e/bill-workspace.spec.ts tests/e2e/sales-overview-export.spec.ts tests/e2e/owner-notifications.spec.ts tests/e2e/purchase-flow.spec.ts tests/e2e/production-operation.spec.ts tests/e2e/auth.spec.ts tests/e2e/no-js.spec.ts --project=chromium --project=no-js --workers=1
pnpm exec playwright test tests/e2e/bill-workspace.spec.ts tests/e2e/auth.spec.ts tests/e2e/sales-overview-export.spec.ts tests/e2e/no-js.spec.ts --project=chromium --project=no-js --workers=1
pnpm test:browser components/business/order/__tests__/AdminOrderEditor.browser.spec.tsx
pnpm test:browser components/business/admin/__tests__/AppSidebarMobileClose.browser.spec.tsx components/business/admin/__tests__/AdminShellNavigation.browser.spec.tsx
pnpm test --run lib/order/__tests__/print-html.test.ts
pnpm test:browser lib/order/__tests__/print-pagination.browser.spec.tsx
pnpm test --run lib/pdf/__tests__/order-snapshot.test.ts lib/background-jobs/__tests__/pdf-snapshot-race.test.ts app/__tests__/order-pdf-route.test.ts lib/order/__tests__/batch-print.test.ts
pnpm lint
pnpm typecheck
git diff --check
```

## 长期执行与停止条件

事实源仍是 [`docs/ui-规范.md` §11](../ui-规范.md#11-ui--ux-quality-standard)。本轮把九种视口落实到共享 Playwright 配置和 main 的 CI 项目，PR 仍保留两种代表视口；PR 绿灯不能替代完整 QA。新增回归只锁定真实缺陷，不降低 axe、触控、几何或截图门槛。

全站 QA 先列角色/路由/状态和证据；检查默认页也要打开弹层、展开懒加载区、触发失败恢复。无 body 溢出不能证明中文列可读或主标题层级正确；隐藏提示层仍可能接收键盘事件。关键 JS 控件应区分 HTML 可见与交互已就绪。打印除纵向页数外还要检查横向纸张边界，修改模板时核对 PDF 缓存身份。

验收须同时满足：本轮 P0/P1 清零，确认的可用性/一致性/层级问题闭合，原触发条件与共享消费者复验通过，功能不变量与相关业务回归通过，记录限制。若只剩审美偏好则停止扩张；遇到产品结构、业务语义或新增资产决策，先保留可审查方案，不擅自重构。环境/数据阻断时明确未验证范围，不把跳过或样例页当作完成。
