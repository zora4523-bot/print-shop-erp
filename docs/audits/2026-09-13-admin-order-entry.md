# 管理员建单归属与包装修正

范围：`ed90d1c1` 上本次独立提交，分支 `codex/gongdanceshi`。开始时没有已修改的跟踪文件；已有未跟踪截图不纳入提交。

## 行为与边界

- 管理员新建选择启用的外部销售账号；选择后 `submitterId` 指向销售，`submitterRole=SALES` 与 `EXTERNAL_SALES` 一致。实际管理员保留为 `createdById` 和 CREATE 日志操作者。未选择仍为工厂直单。
- 页面只读取账号 ID、姓名、用户名；创建事务锁定账号并重新检查角色及启用状态。其他角色不能指定归属，外部销售请求出现该字段（含 null）即拒绝。重复请求同时校验创建人与归属。
- 管理员代建复用外部预报价、报价确认与提交程序，同时保留管理员“保存草稿”。完整资料的现货工单提交后按现有接单规则进入待下发生产；提交计价与自动接单分别留价格修订。
- 管理员建单不再录入工单客户及简称，旧浏览器草稿残留值不会落库。报价结果仍是价格来源，不新增手工价格入口。
- 新建每包为正整数且最多 12 个；混装检查整包各款合计。输入框、预报价、创建 schema 与创建领域均校验；不得静默截断。包装提示移到模式按钮下方，补充说明独立留距。

## 删除依据

- `OrderForm` 的版组、计价组文本框是本次撤下的自由录入入口；预览、持久化提交及本地草稿恢复同步去掉手填值。规格到计价身份仍由目录与计价引擎推导。
- `OrderSavedConfiguration`、`lib/order/commercial-details.ts` 仍读取或写入历史款式/独立制版明细。Prisma 的 `OrderItem.plateGroupId/pricingGroup` 和 `OrderPlateLine.plateGroupId` 保留；不是删除数据库字段的任务。
- 已检查 schema、既有 SQL 约束及迁移。`20260807184000_pricing_compatibility_fence` 的结算/角色一致性约束继续成立；没有修改已应用迁移，也不需要新迁移。
- 历史包装仍使用 `calculatePackagingBagCount`；新建的 `calculateCreateOrderBagCount` 叠加容量限制，不修改既有包装与价格快照。创建测试夹具的旧 20 个/包及混装 10+10 改为有效新建输入，历史大包装回归保留。

## 验证记录

证据目录：`/tmp/erp-admin-order-form-fix`。测试使用 Next.js 16.3.4 开发运行时，E2E 端口 3100、独立数据库 `erp_e2e_custom_tiers_final_20260913`，通过 `E2E_DATABASE_URL` 和同名确认变量指定，未重置或写入日常开发库。没有发布或 push。

- 全量 Vitest 使用仓库等效的临时 native config，`--maxWorkers=2 --coverage --coverage.reportOnFailure`：6,634 通过、55 跳过，1 项既存价格基线差异及 1 项并行负载下的 AST 扫描超时；结果见 `full-final.log`。超时用例原断言单独重跑 24/24 通过（`pending-retry.log`）。覆盖率为 statements 85.63%、branches 79.68%、functions 91.89%、lines 87.47%，门禁未降低。
- 真实浏览器：`tests/e2e/admin-order-entry.spec.ts` 的 2 项新建回归，以及 `tests/e2e/order-create.spec.ts` 的历史价格保留用例通过（`e2e-seventh.log`）。覆盖管理员代建与草稿恢复、销售访问与报价确认提交、直单及混装上限。
- 原有创建后编辑用例的 Next 开发首次详情页编译耗时 7–11 秒，超过原默认 5 秒；页面跳转和首屏内容改用 20 秒有界等待，不加固定休眠。最终单独运行 `e2e-edit-verified.log` 中，创建、三次编辑保存、包装与全部金额/快照断言通过，最后 `expectNoNextErrorOverlay` 仍失败：未修改的 `AdministratorOrderEdit` / `AdminOrderEditor` 触发 React 列表缺少 `key` 警告。该用例不记为通过。旧客户简称录入与页面标题断言按现行管理员输入和公司名称同步，未放宽权限或金额断言。
- `OrderFormBNavigation.browser.spec.tsx` 20 项通过：六视口/明暗主题、键盘、触控、overflow、axe，以及包装区域专项几何与输入上限；`browser-initial.log`。
- `pnpm typecheck`、`pnpm lint`、`pnpm check:architecture` 与 `git diff --check`；最终日志位于同一证据目录。
- 已刷新日常开发页面，恢复原有本地草稿，目视确认销售选择、旧字段移除和包装间距；没有在日常开发库创建测试工单。

全量已知限制：`current-create-order-golden-gate.postgres.test.ts` 的 S8-FULL-005 至 S8-FULL-015 与当前开发库发布价目不一致。前任务基线 `/tmp/workbench-baseline-golden.log` 的失败结果与本次全量结果逐项相同，比较证据为 `golden-baseline-comparison.json`；不修改价格或降低断言以消除既存差异。开发运行时测试切换页面/结束时还会记录已取消响应的 `The destination stream closed early`，须与请求 500、浏览器 pageerror 和业务失败分别判断。
