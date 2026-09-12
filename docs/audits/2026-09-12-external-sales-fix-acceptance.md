# 外部销售前端修复与验收报告

范围：基于 `926fea4` 后的8项审查结论，按数据暴露 → 其余 P1 → P2 修复，并复跑同一份审查清单。

## 逐项结果

| 项目 | 根因（一句话） | 改动文件与结果 | 回归验证 |
|---|---|---|---|
| 1. 客户资料暴露 | 建单页把无销售范围限制的客户主数据传给客户端，仅在界面隐藏选择器。 | [客户范围规则](../../lib/order/sales-customer-policy.ts)、[销售客户查询](../../lib/order/sales-customer-scope.ts)、[建单页](../../app/(admin)/orders/new/page.tsx)、[工单写入](../../lib/order.ts)、[客户选项类型](../../lib/party.ts)：按当前销售关联工单限制客户，仅读取标识、编码、名称、简称；写入同样拒绝绑定范围外客户。 | 两个销售分别关联客户，检查建单与编辑的实际响应不含他人客户和客户联系电话；新增查询范围、角色拒绝及越权绑定测试。 |
| 2. 编辑页暴露内部说明 | 编辑页使用通用工单查询，绕过销售详情的字段白名单。 | [销售详情查询及序列化](../../lib/order/sales-detail-query.ts)、[销售编辑组件](../../components/business/order/SalesOrderEditor.tsx)、[编辑路由](../../app/(admin)/orders/[id]/edit/page.tsx)、[共享展示](../../components/business/order/SalesOrderDetailView.tsx)：详情和编辑只走同一份销售投影，保留工单自身收件信息，不传内部改价说明、成本和生产关系。 | 同一测试单的详情和编辑响应均不含内部收费说明；另用非空 Decimal 重量验证编辑页不会传递原始 shipment 对象。 |
| 3. 月账单未接通 | 销售入口读取已经停止写入的旧 Bill，而管理员使用 AgentMonthlyBill。 | [销售月账单查询](../../lib/agent-monthly-billing/sales-query.ts)、[列表](../../app/(admin)/sales/bills/page.tsx)、[详情](../../app/(admin)/sales/bills/[id]/page.tsx)、[标题查询](../../lib/page-title/refs.ts)：列表、详情及标题改用同一月账单数据源，按当前销售限定归属，显示账单保存金额和明细，草稿不计待支付；管理历史归档保留。 | 专用账单由管理员真实确认命令归集并冻结，销售看到同一工单和123.45金额；另一销售访问失败；单测检查非法筛选、所有权和无内部关系投影。 |
| 4. 驳回后无法重提 | 状态机已有驳回重提边，但销售缺少入口且提交核价器会复用驳回前报价。 | [销售详情](../../components/business/order/SalesOrderDetailView.tsx)、[提交领域](../../lib/order.ts)、[提交核价](../../lib/order/submit-external-order.ts)：提供重提，阻止待审申请和缺图，重新计价并确认，回到待工厂处理，不自动跳过补正复核。 | 真实浏览器完成缺图拦截 → 补图 → 确认新报价 → PENDING_FACTORY，核对报价与价格记录一致；单测确认旧报价不能直接复用。 |
| 5. 驳回/暂停原因缺失 | 管理员已保存决定，但销售投影未读取原因和受影响款式。 | [销售详情查询](../../lib/order/sales-detail-query.ts)、[销售详情展示](../../components/business/order/SalesOrderDetailView.tsx)：显示当前适用决定的原因、说明、款号、时间，隐藏内部恢复证据和执行人；管理端现有强制原因及款式校验保留。 | 原工厂工作流测试覆盖原因持久化；新增投影测试检查当前/过期决定、字段隔离；浏览器验证驳回及暂停原因可见。 |
| 6. 驳回图稿不能补正 | 图稿授权和界面只允许草稿增删。 | [图稿领域](../../lib/order-design.ts)、[销售详情](../../components/business/order/SalesOrderDetailView.tsx)、[上传组件注释](../../components/business/order/DesignUploadPanel.tsx)、[上传 action 注释](../../actions/design-upload.ts)：开放本人驳回稿件补正，在工单锁内校验并增加业务/编辑版本，日志保存文件前后标识、URL、类型、大小，保留旧对象。 | 新增上传/删除审计、版本递增和他人拒绝测试；原 HEAD 文件大小、待审申请及并发状态改变测试通过；浏览器实际删旧图并核对审计，再完成重提。 |
| 7. 取消流程缺口 | 销售没有早期取消权限和入口，暂停取消能力也未在销售界面贯通。 | [权限](../../lib/auth/permissions-dict.ts)、[取消 action](../../actions/order.ts)、[工单领域](../../lib/order.ts)、[申请领域](../../lib/order/change-request.ts)、[取消表单](../../components/business/order/CancelOrderForm.tsx)、[销售详情](../../components/business/order/SalesOrderDetailView.tsx)：销售可取消本人草稿/待工厂处理/驳回单，必须提交编辑版本及原因；暂停可申请取消，仍按原生产阶段校验和审批结算。 | 三个状态真实取消成功；单测拒绝他人、旧版本、待审申请；暂停单提交/撤回取消申请后原状态保持 ON_HOLD；原生产与结算边界测试保留。 |
| 8. 有包装组仍能选择新增款式 | 前端没有使用包装组信息限制后端不支持的 ADD 操作。 | [修改申请表单](../../components/business/order/OrderChangeRequestForm.tsx)、[销售详情](../../components/business/order/SalesOrderDetailView.tsx)、[通用详情](../../app/(admin)/orders/[id]/page.tsx)、[编辑页](../../app/(admin)/orders/[id]/edit/page.tsx)：按实际包装组状态隐藏新增款式，并把能力变化纳入表单草稿标识，后端拒绝规则保留。 | 新增有/无包装组渲染及草稿重置测试；浏览器确认有包装组无新增入口、仍可申请取消。 |

客户表尚无独立“所属销售”字段，本次范围以当前销售已关联工单为依据；没有把所有客户默认为其名下客户。客户选项不返回联系方式，与工单收件信息正常展示是不同数据用途。

复查一并修复：驳回重提跳过重新核价、补正自动越过工厂复核、重复补正通知被原去重键吞掉、编辑页传递原始重量对象，以及包装能力变化后沿用旧表单草稿。状态机已有所需转换边，未重复添加或放宽生产终态规则。

## 同一审查清单复跑

| 检查范围 | 结果 |
|---|---|
| 登录、错误密码、未登录和他人工单 | 通过，未扩大工单所有权范围 |
| 建单地址2、分货、快递计价、提交复核 | 通过 |
| 连续删款、焦点、按钮位置、重复校验提示 | 相关回归通过 |
| 搜索、分类、16种新旧状态、计数、详情与预览入口 | 通过，未把待工厂处理误判为完成 |
| 草稿备注回显、管理员修改名称/备注/包装/收件人后销售刷新 | 通过 |
| 顺丰到付往返、报价与金额记录一致、待审申请阻止直接改动 | 通过 |
| 修改/取消申请、撤回、原单不提前变化 | 通过 |
| 驳回补图、重提、早期取消、暂停申请取消、原因展示 | 新增回归通过 |
| 客户与内部商业字段的实际响应隔离 | 新增回归通过 |
| 管理月账单到销售列表/详情、金额、他人账单拒绝访问 | 新增回归通过 |
| 六视口 × 明暗主题 × 列表/详情/编辑、手机触控、横向溢出、axe | 36组检查通过 |

## 验证结果

8 项问题及本次复查发现的问题均已修复；上述审查范围内无待修复项。

| 验证 | 最终结果 |
|---|---|
| `pnpm test --run` | 575 个测试文件通过，6013 项测试通过；既有 3 个文件、55 项测试跳过，未降低门禁 |
| Chromium 浏览器回归 | 原有 14 项 + 新增 5 项，合计 19 项全部通过；包含 36 组视口/主题检查 |
| `pnpm typecheck` | 通过 |
| ESLint（排除既有 `.next-release` 生成目录） | 0 错误；2 条既有导航警告，位于 `app/global-error.tsx` 和 `OrderForm.tsx` |
| `pnpm lint:ui` | 文案 0 命中、令牌 0 新增违例 |
| `git diff --check` | 通过 |

浏览器运行范围：`sales-functional-review.spec.ts`、`order-delete-navigation.spec.ts`、`order-multiple-addresses.spec.ts`、`auth.spec.ts`，使用 Chromium 单 worker。开发服务器保持运行。

## 测试及契约文件

- 浏览器：[sales-functional-review.spec.ts](../../tests/e2e/sales-functional-review.spec.ts) 新增5项，覆盖8个问题；保留原14项回归入口。草稿保存测试改为等待 action 跳转完成再导航，不屏蔽 Next.js 错误。
- 新增单测：[客户范围](../../lib/order/__tests__/sales-customer-scope.test.ts)、[销售月账单](../../lib/agent-monthly-billing/__tests__/sales-query.test.ts)。
- 扩展/迁移单测：[销售详情投影](../../lib/order/__tests__/sales-detail-query.test.ts)、[提交核价](../../lib/order/__tests__/submit-external-order.test.ts)、[图稿](../../lib/__tests__/order-design.test.ts)、[工单](../../lib/__tests__/order.test.ts)、[取消 action](../../actions/__tests__/order.test.ts)、[权限](../../lib/auth/__tests__/permissions.test.ts)、[修改申请表单](../../components/business/order/__tests__/OrderChangeRequestForm.business-language.test.tsx)、[自动准备生产](../../lib/order/__tests__/submit-order-auto-activation.test.ts)、[标题](../../lib/page-title/__tests__/refs.test.ts)。
- 月账单契约迁移：[详情可见性](../../app/(admin)/__tests__/bill-detail-visibility.test.tsx)、[空态](../../app/(admin)/__tests__/detail-empty-state-ownership.test.ts)、[状态注册表](../../app/(admin)/__tests__/status-registry-consumers.test.ts)；建单查询依赖更新：[目录绑定](../../app/(admin)/__tests__/new-order-catalog-binding.test.tsx)。原管理员历史归档断言保留，没有降低覆盖率或截图门禁。
- 契约：[API.md](../../API.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md)、[DECISIONS.md](../../DECISIONS.md)；原审查报告保留历史证据并链接本报告。

验证使用专用测试账号和新建测试工单/月账单，不改用户真实工单；无数据库迁移、无历史金额回写、无 push 或发布。OSS 真实网络上传未在浏览器执行：上传登记的授权、HEAD和并发检查由单测验证，浏览器补正流程使用新登记图稿夹具；未把该结果表述为生产存储或真实收付款验收。
