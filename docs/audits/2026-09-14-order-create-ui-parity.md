# 建单费用与跨前端交互修复

基线 `58c6910b`，分支 `codex/gongdanceshi`。开始时没有跟踪文件改动，既有未跟踪截图保留。本任务是该基线上的 UI 与交互增量；没有改动金额引擎、Server Action 公共契约、角色授权、价目版本、Prisma schema、SQL 或历史快照。

## 审查结论与实现

- 原内部费用栏忽略 `quoteItems.components`，导致同一份报价在销售端有加工分项、管理端只有款式合计。内部费用栏也缺独立待核制版费行；人工金额仍显示“预估费用”。现在两种结算共用费用行，款式小计下展示自动分项，人工替代价不再附带失效的自动拆分。0 元、待核金额和错误状态分别呈现。
- 工厂直单没有销售应收物流费用，不能为了界面一致增加收费。费用组件、警示汇总和提交复核均按原 `usesExternalSalesPricing` 条件展示纸箱/快递费；权威合计仍来自既有报价链路。现有 Decimal 金额处理没有改算法。
- 管理员代销售时，旧代码用结算方式隐藏款式名和稿件版本。两字段改由实际操作者控制；人工定价权限继续保留，销售仍无入口。额外工艺和自定义要求仍受原有建单规则限制。
- 内部提交原来有缺项时仅禁用按钮。现在与销售共用提交前复核，点击提交先校验，错误链接能选择对应款式并定位字段；人工价格错误也有稳定输入目标。复核取消不创建订单，确认走原创建、上传、提交和报价变更检查。
- `OrderForm` 的离页保护原仅在外部销售结算启用。现在各角色都保护未保存输入及待上传文件；文字草稿不能代替文件本身。
- 复核弹窗增加费用后，小视口内容需要滚动。实测 axe 发现原滚动区不能被键盘聚焦，现增加有名称的可聚焦区域；按钮仍固定可达。

## 替换与保留依据

`OrderFormBRail` 的唯一生产调用方是 `OrderForm`；原私有内部费用栏仅从此分派，没有动态注册或外部 API 消费。删除这套重复 JSX 后，原导出类型和金额 helper 保留兼容，类型移至无运行时依赖的文件，栏位和复核共用 `OrderCreateFeeDetails`。规则配置、数据库、迁移和打印模板无变动。旧测试对“管理端不显示分项”“缺项时使用另一按钮文案”的展示断言依本次授权统一更新，保留金额、权限、异步报价与持久化检查。

## 验证记录

证据目录 `/tmp/erp-order-ui-parity-20260913/`（任务跨午夜）。Next.js 16.3.4 开发模式；真实写入仅使用独立库 `erp_e2e_packaging_20260913`、端口 3105 与 `.next-durable` 构建目录。没有刷新用户 3000 端口上尚未保存的表单，没有发布或 push。

- `pnpm test --run --maxWorkers=4`：6,700 项通过、56 项既有条件性跳过、1 项既存失败；613 个文件通过。`unit-completed.log`。失败为下述数据库价目基准，未包含本次 UI 回归。
- `pnpm test:browser` 指定 `ExternalSalesOrderFormRail`、`OrderFormBNavigation`、`OrderCreateReview`、`AdminCreatePriceFields`：105/105 通过（`browser-completed.log`）。六视口为 375×667、393×852、768×1024、1024×768、1280×800、1920×1080，均覆盖明暗主题；包含 44px、overflow、axe、键盘确认、缺项定位、输入和异步报价时不跳动。
- `pnpm exec playwright test tests/e2e/order-create-ui-parity.spec.ts tests/e2e/admin-create-pricing.spec.ts --project=chromium`：6/6 通过（`e2e-completed.log`）。通过 `E2E_DATABASE_URL` 和同名确认变量指定上述独立库；`E2E_BASE_URL=http://127.0.0.1:3105`、`E2E_DURABLE_MODE=1` 只隔离构建目录，运行仍为开发服务及 inline/mock 测试模式。
- 真实页面验证管理员/销售均展示空白封和机烫费、管理员人工价替代自动分项、代销售仍能填写款式名/稿件版本、销售无改价入口、离页保护、缺失交期及价格错误定位。复核取消时数据库无工单；重新确认只创建一单，款式加工费 `123.45` 及管理员定价来源正确保存。不包装费用为 0，内部复核没有纸箱/快递费。
- `pnpm typecheck` 通过（`types-final.log`）；`pnpm lint` 通过（`lint-completed.log`），0 错误，保留原有两条 Next 导航警告，文案和令牌无新增违例。`git diff --check` 通过。
- 架构检查仅保留下述原有长度问题（`architecture-completed.log`）。初次检查发现的本次类型依赖循环已通过独立类型模块消除，没有新增模块循环。
- 已目视核对真实内部复核截图 `internal-review.png`。初次浏览器测试发现的费用描述列表结构和复核滚动区可访问性问题均已修正；没有排除 axe 规则或更新截图基线。E2E 结束关闭页面时开发服务器仍记录既有 `The destination stream closed early`，浏览器 `pageerror` 为 0，不能将通过结果表述为“全部日志无错误”。

既存问题对照：将基线 `58c6910b` 独立 `git archive` 到临时目录，运行原 PostgreSQL 价格基准和架构检查。`S8-FULL-005` 至 `S8-FULL-015` 与当前开发库价目不匹配，失败实际值与本次全量结果逐项相同（`baseline-comparison.json`）；`OrderPricingReviewForm` 724 行超过登记上限 723 行也在基线重现。没有修改价目或放宽断言/长度上限来消除这些既存问题。生产构建、真实通知及后台任务不属于本次 UI 验收范围。
