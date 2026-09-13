---
status: maintained
owner: project-maintainers
last_verified: 2026-08-24
applies_to: repository source at last_verified
---

# API 与 Server Action 契约

本项目不是面向第三方开放的 REST API。页面读取主要由 Server Components 完成，页面写入主要通过 Server Actions；HTTP Route Handlers 只承担认证、健康检查、调度、下载、导出和少量查询。

端点实现以 [`app/api/`](./app/api/) 为事实源。修改方法、认证、参数、状态码或响应形状时，必须同步修改本文件和契约测试。

## 销售工作台计算

`actions/workbench.ts` 的 `quoteWorkbenchAction(raw)` 要求 `order:create`。
输入为单款产品 ID、当前目录规格/纸张、计价路线、整数数量、正反面烫金颜色、烫金方式和 0–100 的整数加价百分比。
服务端校验目录归属与颜色，复用建单 schema，并在正式计价事务中重新校验目录、读取当前价格。
目录纸张缺少克重时返回明确的补资料错误，不猜测克重或金额。
纸张输入是目录选项显示值，最多 69 字符（物料名称与克重前缀）；必须精确匹配当前目录选项。服务端使用建单同一规范化函数拆分名称和克重，再执行订单原有 32 字名称校验。合法 32 字名称不因显示克重前缀而被拒绝；规范化后仍超限时返回人工核价提示，不截断名称。
返回 `{ status: 'success', quote }` 或 `{ status: 'error', message }`；认证失败沿用授权入口抛错。
`quote` 只含加工费、加价金额、加工费参考报价、费用明细、核价/制版待定标记及加工价版本号。金额均为十进制字符串，缺价为 `null`；不返回内部成本、规则快照或报价签名，不写订单。
`quote.pricingReasons` 为受控中文核价原因数组，完整报价为空数组；前端兼容省略该字段的响应。原因由正式引擎的业务代码映射，不透传内部诊断。已知规格/烫金组合错误返回具体的修改条件或人工核价提示，其他异常保持通用错误。
计算范围与原型差异见 [销售工作台](./docs/销售工作台.md)。

## 认证类型

| 标记 | 含义 |
|---|---|
| Public-minimal | 匿名可访问，只返回最小健康信息 |
| Session | 需要有效 Auth.js session，并继续做资源范围检查 |
| Permission | 需要 session 和权限字典中的指定 permission |
| Bearer | `Authorization: Bearer <CRON_SECRET>`；缺配置时端点拒绝服务 |
| Capability URL | URL 中的高熵、限时标识即访问能力；响应不得泄漏标识是否曾经有效 |

页面 Proxy 不是 API 授权边界。`proxy.ts` 排除的公开路径必须在各 Route Handler 中自行完成认证或刻意保持最小匿名响应。

## Route Handler 清单

### Auth.js

| 方法与路径 | 认证 | 目的 |
|---|---|---|
| `GET/POST /api/auth/[...nextauth]` | Auth.js | 登录、回调、session 与退出协议；实现由 `lib/auth/config.ts` 导出 |

### 健康检查

| 方法与路径 | 认证 | 成功 / 降级语义 |
|---|---|---|
| `GET /api/health/live` | Public-minimal | `200`：进程存活；不检查数据库或 worker |
| `GET /api/health` | Public-minimal | `200 {status:"ok",db:"ok"}`；数据库不可用为 `503` |
| `GET /api/health/ready` | Public-minimal | `200`：实例可接流量；数据库或 durable 模式所需 worker 不可用为 `503`；队列告警只进入 body/warnings |
| `GET /api/health/jobs` | Public-minimal | `200 ok/degraded`；需要人工处理的非通知死信、卡死任务或 worker 问题为 `503 alert`；数据库失败为 `503 error` |

健康接口不返回连接串、worker id、任务 payload 或内部错误正文。部署 readiness 和队列告警语义不同，不能合并判断。

### Cron

以下八个端点都是 `POST`、Node runtime、动态响应并使用 Bearer 认证。在 `durable` 模式下正常接受返回 `202 {status:"queued", ...}`；`inline` 模式直接执行并返回任务汇总。`CRON_SECRET` 未配置返回 `503`，不匹配返回 `401`。调度时间以
[`deploy/crontab.example`](./deploy/crontab.example) 为唯一事实源。

| 路径 | 可选 JSON 输入 | 默认业务范围 |
|---|---|---|
| `/api/cron/daily-salary` | `{ "date": "YYYY-MM-DD" }` | 上海日历昨天；格式错误或未来日期为 `400` |
| `/api/cron/hourly-payroll` | `{ "month": "YYYY-MM" }` | 上海日历上月；格式错误或未来月份为 `400` |
| `/api/cron/cs-settle` | 无 | 当前上海业务日扫描 |
| `/api/cron/generate-bills` | `{ "period": "YYYY-MM" }` | 上海日历上月；显式空值或格式错误为 `400` |
| `/api/cron/outsource-overdue` | 无 | 当前上海业务日扫描 |
| `/api/cron/cs-period-ending` | 无 | 当前上海业务日扫描 |
| `/api/cron/order-overdue` | 无 | 当前上海业务日扫描 |
| `/api/cron/order-export-cleanup` | 无 | 当前上海业务日清理范围 |

调用方不得依赖响应中的金额、人员清单或逐行错误；cron 响应保持 counts/status 级别，细节在受权限保护的后台页面和日志中查看。

### 下载、导出与查询

| 方法与路径 | 认证 | 输入 | 主要响应 |
|---|---|---|---|
| `GET /api/admin/inventory-count/materials` | Permission `material:manage` | query `q`、`limit` | `200 {materials}`；未授权 `401` |
| `GET /api/orders/admin/:orderNo` | Permission `order:view:all` + ADMIN | path `orderNo` | `200 {order}`；未授权 `401`，非管理员 `403`，不可见或不存在 `404`；响应 `private, no-store` |
| `GET /api/cdr/bundles/:id` | Capability URL | cuid 风格 bundle id | 就绪后 `302` 到产物；生成中 `409` + `Retry-After`；失效或不存在统一 `404`；OSS 不可用 `503` |
| `GET /api/orders/:id/pdf` | Session + production print scope | path `id`；query `mode=order`（可省略）；durable 重试可带 `jobId` | PDF `200`；排队为可自动重试的 HTML `202`；非法模式 `400`；未授权 `401`；不可见 `404`；升版 `409`；渲染或分页失败 `500`；生成服务不可用或任务等待达到两分钟 `503`（手动查询原任务，不自动刷新） |
| `GET /api/orders/exports/:id` | Permission `order:export:all` | export id | XLSX `200`；生成中 `409`；失败 `410`；不存在或过期 `404` |
| `GET /api/salary/piecework-settlements/export` | Permission `salary:view:all`，复核数据库账号状态 | query `from`/`to`，可选 `workerId` | XLSX `200`；输入错误 `400`；未授权 `401` |
| `GET /api/salary/piecework/export` | Permission `salary:view:all` | query `date` 或 `from`/`to`，可选 `workerId` | XLSX `200`；输入错误 `400`；未授权 `401` |

Proxy 对已纳入拦截的 API 匿名请求返回 JSON `401`，不重定向到登录 HTML；页面请求仍跳转登录。路由继续校验数据库账号状态、角色及资源所有权，不依赖 Proxy 作为最终授权。PDF 的内联渲染失败与后台任务失败只返回固定错误码 `PDF_GENERATION_FAILED` 和重试建议，不返回底层异常正文或部署路径。

下载响应使用 `private, no-store`；文件名同时提供安全的 ASCII fallback 和 UTF-8 名称（适用的端点）。新增下载接口时保持内容类型、长度、缓存和 `nosniff` 语义。

工单 PDF 仅输出每页一个主码的生产主单。工序流转单已移除：`mode=tasks` 下载请求返回 `400`，浏览器打印页返回 `404`。后台任务继续绑定用户、工单和生产版本；兼容缺省或 `mode=order` 的历史任务，拒绝生成或下载旧流转单任务。浏览器打印页 `/print/orders/:id` 使用相同模板与分页规则。

生产打印范围统一由 [`lib/order/print-access.ts`](./lib/order/print-access.ts) 提供，适用于网页正文、页面标题、同步 PDF 及后台 PDF。每次读取复核账号仍启用且角色未变化：ADMIN 可查看全部，CUSTOMER_SERVICE 仅查看自己提交的工单，SALES 不可查看生产打印件。WORKER 按当前账号的固定报工岗位匹配当前版本未取消的计件工序，或读取包含当前版本公共进度工序的工单；`SUBMITTED` 不向师傅开放。旧 `ProductionTask.workerId` 派工关系不授予打印权限，无权访问的页面标题不含工单号。

打印工序只读取当前 `workOrderVersion` 的 `ProductionOperation` / `ProductionProgressStep`，排除已取消工序；缺记录时显示空态，不生成旧任务或推测进度。状态来自当前工单，待审批标记只来自真实的 PENDING 修改申请。后台渲染后、下载响应前继续复核账号、范围及生产版本；撤权不返回产物，响应前发现升版返回 `409` 并要求重新生成。

工单主码 `/wo/:orderNo?v=:version` 只读取并分流，不写报工或工资。师傅/打包账号仅进入当前岗位的当前版工序；唯一未完成工序直接进入，多个或全部完成时显示选择页。旧 `task` 参数仍精确校验工单、版本和岗位，禁止越权跳转。

管理端单笔工单响应的 `order.inlineOperations` 提供核价类型、逐票发货字段和四个提交版本，金额/重量序列化为十进制字符串。只在单笔读取附加，列表 DTO 不携带地址及可编辑收费。准备表单时再次匹配工单修订、编辑版本、生产版本、状态与无待审变更；信息已变化时返回 `null`，不把新表单附在旧抽屉快照。写入继续使用既有核价、物流确认和发货 Action 的授权、版本及幂等校验。

## Server Actions

Server Actions 位于 [`actions/`](./actions/)，不是稳定的外部 HTTP API，也不应由第三方客户端直接调用。每个领域通常由两类文件组成：

- `<domain>.ts`：授权、Zod 解析、领域调用、缓存失效和跳转。
- `<domain>.types.ts`：客户端可消费的输入/结果联合类型。

通用结果约定是结构化联合类型，例如 `success`、`invalid`、`error`；具体字段由对应 `*.types.ts` 定义。不要把异常字符串当作唯一机器契约。

新增或修改 Action 时必须满足：

1. 首先检查 permission；
2. 对所有不可信输入做 schema 验证；
3. 在 `lib/<domain>` 重验资源范围、状态机和业务不变量；
4. 将预期领域错误映射为可展示的结构化结果，未知错误继续抛给错误边界与监控；
5. 只 revalidate 受影响路径；
6. 为成功、字段错误、权限拒绝、状态冲突和重复提交补契约测试。

### 企业微信通知目标配置

实现见 [`actions/owner-notifications.ts`](./actions/owner-notifications.ts)、
[`lib/notification/admin.ts`](./lib/notification/admin.ts) 和
[`lib/settings/index.ts`](./lib/settings/index.ts)。

- 所有通知配置写操作先校验 `notification:config`；系统设置仍使用其自身权限边界。
- 新建/编辑明确要求 `transport=WECOM_SMART_BOT`。省略协议、提交旧 `WECOM_GROUP_WEBHOOK` 或携带 `webhookUrl` 字段均返回字段错误；不再静默默认到旧协议。
- 新建目标强制停用，不接受客户端启用未绑定目标；编辑时领域层重验已存协议、群绑定与 Bot ID 身份，不能把旧目标伪装成智能机器人覆盖。
- Bot ID/Secret 仅从服务端配置读取，通知配置读模型不查询或返回 Webhook；客户端只接收脱敏绑定信息。
- 旧目标的 `testChannelAction` 返回明确错误，不发送消息、不入队。智能机器人真发测试仍由 LIGHT worker 完成，Web 进程不建立长连接。
- 规则和固定角色路由拒绝新选旧目标；存量启用路由可保留或解除，关闭后携旧目标重新启用会被拒绝。历史日志与存量兼容投递不受 UI 退役影响。
- 托管事件规则中保留的旧 `channelIds` 不参与实际投递，启用事件时不重验这些隐藏历史字段；实际接收群只能从角色设置取得，其新增/重新启用校验不变。

### 工单修改与价格确认

- MODIFY 提案可携带 `promisedDate: YYYY-MM-DD | null`；省略代表不改、`null` 代表清除。允许 `items: []` 的纯交期申请，但拒绝无实际变化。预览返回 `promisedDateChange: { before, after }`，批准后才写入交期。纯交期等不影响计价的变更保留原加工费、总价和费用快照，不从历史明细重建金额，不产生客服业绩差额。
- 普通独立制版费默认 `QUOTED / 0.00`，不再生成版费待定原因。管理员逐款制版明细入口继续保留；人工金额加入应收和新费用快照。彩印烫金含版费套餐、其他未知价格和待补运费的规则不变。旧待定快照可读，重算只将尚未核价的版费转为零，不覆盖已确认人工版费。
- 待审申请不自动暂停生产。工厂可在待审期间暂停/恢复；这两个仅切换执行状态的操作不使现有申请版本失效。批准暂停中的申请保持暂停，恢复仍须提供恢复证据。已经下发生产的暂停工单可为批准的新版本创建重打任务，仍禁止首次下发绕过暂停。
- 生产改版只承接能唯一对应同一工序、款式或包装组的已完成量；过版工资不重复计入。低于已产量、已产来源无法对应或多款汇总后无法确认各款剩余量的变更整体拒绝。新版完工条件重新检查，旧版报工继续拒绝。

实现见 [`actions/order.ts`](./actions/order.ts)、
[`actions/admin-order-workflow.ts`](./actions/admin-order-workflow.ts) 和
[`lib/order/change-request.ts`](./lib/order/change-request.ts)。

- `updateOrderAction` 必须携带页面读取的 `expectedEditVersion`。基本信息按当前状态白名单保存；`customerPartyId` 只能选择活动客户（不变的历史关联可保留）。ADMIN 可修改范围内工单，SALES / CUSTOMER_SERVICE 仅可修改自己创建的工单；存在待审批申请时拒绝保存。
- 管理员编辑页的“关联外部销售”使用 `externalSalesUserId`，只列出启用的 SALES 账号。它更新工单 `submitterId`，同步销售访问范围及后续对账归属，不写入客户主数据 `customerPartyId`。仅 ADMIN 可更换 DRAFT / PENDING_FACTORY / REJECTED / SUBMITTED 的 EXTERNAL_SALES 工单；已有结算、发货、账单（含草稿）、客服业绩或重做关联时拒绝转移。非外部销售工单不得借此转换结算方向。空账号和无效账号拒绝；未更换的历史账号可保留。事务内锁定工单与目标账号并验证递增编辑版本，保留创建人、创建时角色、客户简称、配送及全部金额快照；日志记录前后账号名称与账号 ID。
- 完整编辑页用 `shipments` JSON 提交全部现有配送记录的 `id`、收件人、电话、地址、快递代码、`expectedDestinationProvince` 和 `sameDestination`。服务端校验记录集合与工单归属，拒绝新增、遗漏、重复和已发货记录的修改；外部销售需完整联系人。寄付地址变更必须明确确认原计费省份与条件未变；跨省、未核定或计费条件变化不能用普通编辑跳过物流核价。未带配送 JSON 的旧入口不能修改外部寄付地址。
- 外部销售工单显式修改 `customName` 时不得清空，领域层按工单保存的 `settlementType` 校验，不能以操作者角色绕过；未传该字段的历史局部更新仍按原白名单执行。
- `packageRequirement` / 外部创建命令 `packRaw` 保持既有字段契约，含义是选填的包装补充说明。保存该文字不变更包装组、分袋组成、实际袋数或入袋费用。
- 联系信息保存只更新工单及对应配送联系人，不重建款式、分货、包装或历史价格。主地址同步、递增编辑版本与变更日志在同一事务中完成，过期版本拒绝覆盖。
- `createOrderChangeRequestAction` 的 MODIFY 支持管理员及工单所有者（SALES / CUSTOMER_SERVICE），状态窗口由 `ORDER_MODIFIABLE_STATUSES` 统一定义，包含草稿、待工厂确认和已驳回。管理员新增的权限不开放 CANCEL 申请；取消继续沿用原有流程。申请人（包含管理员）只能撤回本人待审申请；待审批期间也禁止增删设计文件。
- 修改申请中的规格变更须同时提交 `specification` 与 `targetProductId`；服务端从活动产品目录重新解析计价身份，不接受仅改规格文字而沿用旧产品的输入。
- `previewOrderChangeRequestPricingAction` 接受 `requestId`、可选的 `expectedPriceRevision` 与 `pendingChargeResolutions`。人工物流决议只适用于本次预览实际待核的收费，需携带收费业务键、发货记录、预览数量、省份、金额和依据。
- 批准修改须提交 `expectedPriceRevision`；涉及重新计价时，还须将预览返回的 `quoteToken` 作为 `expectedQuoteToken` 提交（`order-change-approval-v1:` 前缀）。服务端持有订单锁后重新核对报价、版本及人工收费内容，变化时拒绝写入并要求刷新预览。无需重新计价的修改不提交报价令牌；拒绝申请不依赖价格版本，取消申请保留独立结算流程。
- `confirmFactoryOrderAction` 除工单修订号与生产版本外，要求提交 `expectedQuoteToken`：外部销售工单使用当前价预览的 `create-order-quote-v2:` 令牌，其他结算类型显式传 `null`。
- 以上令牌是预览一致性证据，不授予权限，也不替代资源范围、状态机及服务端金额校验。
- `finalizeOrderPricingAction` 将生产工序生成的预期校验失败返回为 `{ status: 'error', message }`，核价表单保留在当前页面。款式或包装信息缺失时不确认价格、不生成工序；事务继续整体回滚，不返回内部 `detail`，也不执行成功路径的缓存失效。未知异常仍交给错误边界处理。

## 兼容性规则

- 已被系统 cron、下载链接或浏览器流程使用的状态码和字段视为兼容性契约。
- 新增可选字段通常是向后兼容；删除、改名、改变类型或改变状态码需要显式迁移调用方。
- 错误响应不得因为调试需要泄漏敏感信息。
- Capability URL 的“过期”和“不存在”必须保持同形响应，避免探测有效 id。
- durable 与 inline 可以有执行时序差异，但输入验证和授权结果必须一致。
- 文档只描述当前代码。尚未实现的 API 放入任务清单，不写成已支持。

## 验证

目标 Route Handler 测试之外，至少运行：

```bash
pnpm typecheck
pnpm lint
pnpm test --run
```

影响认证、cron、下载或关键流程时，再运行对应 Playwright E2E。完整测试策略见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

### 管理端编辑预览与保存

`actions/admin-order-edit.ts` 的 `previewAdminOrderEditAction` 与 `saveAdminOrderEditAction` 接收工单 ID、临时申请 UUID、三种工单版本、资料增量和款式变更。保存另需预览返回的价格版本及报价 token。入口要求 `order:update:post-schedule`（仅 ADMIN），领域层再次检查 ADMIN；所有原有工单状态、历史快照、金额和资源归属校验保留。

资料增量中未传或值为 `undefined` 的字段保留原值；空字符串或字段允许的 `null` 表示主动清空，`false` 仍表示关闭布尔选项。`fields.expectedEditVersion` 必填，`fields.promisedDate` / `fields.isUrgent` 可省略。顶层 `promisedDate` 必须为有效日历日期或 `null`（清除交期），并沿用交期审批规则。`ADD` 款式仅限 DRAFT，且需满足已有包装、模板及生产记录约束；已提交工单不能通过管理端编辑预览或保存新增款式，避免生成无法上传设计文件的新款。

预览不持久化；保存把资料修改及管理员批准的款式/交期修改纳入同一事务。`UPDATE` 款式支持已有包装组的 `pack` 每包数量，服务端按分袋组成重算袋数及费用。待核运费沿用 `pendingChargeResolutions`，携带票 ID、序号、投影数量、省份、金额与依据；重新预览与保存使用相同核定数据。纯资料或交期修改不接受重算运费。详细约束与演示稿差异见 [管理端编辑工单](./docs/admin-order-edit-design.md)。


### 工单准备与生产下发（2026-09-08）

- 创建动作成功响应的可选 `readyForProduction` 表示是否已进入待下发，用于成功页提示；未提供时不得视为可生产。
- `submitOrder`、人工核价及管理员保存/修改审批完成后，在原事务自动检查保存价与生产事实；完整订单返回或进入 `CONFIRMED`（待下发），不提前创建生产/打印任务。异常订单保留待处理。
- `releaseFactoryOrderAction` 与批量 `RELEASE_AND_CREATE_PRINT` 接受满足准备校验的 `PENDING_FACTORY / SUBMITTED` 存量单。单张工单界面传 `createPrint: false`，事务仅完成准备和下发，不读取或创建打印任务；省略该可选布尔值时保留组合下发与首次打印行为，供现有批量调用使用。仍限 ADMIN，保留 revision、workOrderVersion、请求键校验；独立下发不使用打印任务作为重放凭证，过期版本按原规则拒绝，需刷新核对后再操作。领域结果 `printJobId` 在不创建打印时为 null。
- `confirmFactoryOrderAction` 保留兼容：使用已保存费用进入待下发；`expectedQuoteToken` 仅为旧请求兼容字段，不触发最新目录报价，工单版本仍须匹配。新 UI 不再展示独立确认步骤。
- 下发不形成财务结算；后续费用沿用既有更正接口，已结算记录不能覆盖。

### 管理端工单读取的工艺标识

`GET /api/orders/admin/[orderNo]` 与管理端列表共用的工单读取模型增加可选 `craftTags` 字段，值为“局部烫金”“专版烫金”“彩印”的去重数组，来源为各款式 `craft` 类型，缺少类型返回空数组。原 `craftSummary`、工单标识及权限校验保持不变。

管理端工单读取中，`DRAFT` 且报价、确认、结算快照均为空时，`fee` 返回 `{ amount: null, source: 'PENDING', estimated: false }`，表示尚未报价；已保存的真实零元报价仍按对应快照返回。

### Next.js 路由模块边界

`route.ts` 仅导出 HTTP 方法与 Next.js 路由配置。可测试的处理函数放在相邻 `handler.ts`，仍由 `route.ts` 中的 `auth(handler)` 包装；权限、资源范围和 HTTP 地址保持不变。

### 逐地址发货登记

`registerShipmentAction(FormData)` 仅允许具有 `order:ship` 权限的管理员，领域层再次检查管理员身份及地址所属工单。参数：`orderId`、`shipmentId`、`expectedVersion`（地址登记版本）、工单的 `expectedRevision/expectedEditVersion/expectedWorkOrderVersion/expectedPriceRevision`、UUID `idempotencyKey`、`trackingNo`、`carrierCode`（空/ZTO/SF/OTHER）、`carrierName`、`confirm`（true/false），可选 `photo` 文件。返回 `{ok,message}`，不返回内部错误。

保存资料不改变发货状态；确认要求完整运单及承运商、完工、已确认费用、无待审变更和未完成外协。最后一票复用整单发货及 v2 结算服务，二者和地址、图片、审计记录在同一事务提交；若发货核算改变已确认金额，整个确认回滚，须先完成物流费用复核。重复 UUID 同内容直接返回已保存，不重复结算；不同内容拒绝。

`GET /api/orders/[id]/shipments/[shipmentId]/labels/[labelId]`：校验当前有效登录状态及工单可见范围，三个 ID 必须属于同一资源链。200 返回 JPEG（private/no-store、nosniff）；未登录 401；不存在或越权 404。图片不使用公开 URL，替换后旧图仍能从历史面单查看。

### 管理员工单动态分页

`actions/order-activity.ts` 的 `loadOrderActivity(input)` 为只读 Server Action。每次请求先要求 `order:view:all`，再校验 `orderId`（1–128 字符）和 `cursor: { at: ISO UTC 时间, id: 1–128 字符 }`；领域查询再次限制管理员与工单可见范围。

按 `createdAt DESC, id DESC` 查询游标之前的记录，每页最多 20 条，额外读取 1 条判定是否存在下一页。成功返回 `{ ok: true, page: { events, nextCursor } }`，无下一页时 `nextCursor` 为 `null`；无效参数、工单不存在/不可访问返回 `{ ok: false, message }`。权限失败由授权入口拒绝。界面对网络或服务异常仅显示重试提示，不展示异常堆栈。

`events` 仅包含展示所需的操作标题、时间、人员、备注和已格式化变更；不返回原始 `changedFields` 或内部报价修订标识。首屏使用同一领域查询；非管理员详情继续使用原有授权裁剪结果，不使用该分页入口。查询不修改审计记录或财务数据。

### 管理员添加发货地址

`actions/order-shipment.ts:addOrderShipmentAction(payload, mode)`：权限
`order:update:post-schedule`，领域层再次限定 ADMIN。`mode` 为 `preview` 或
`save`；预览只读，保存必须提交预览返回的 `previewToken`。

输入包含 `orderId`、`sourceShipmentId`、`expectedRevision`、
`expectedEditVersion`、`expectedWorkOrderVersion`、`expectedPriceRevision`，
新地址的 `receiverName / receiverPhone / receiverAddress / destinationProvince`，
以及 `lines: { orderItemId, quantity }[]`。新地址的 `shippingFee`、
`packingMaterialFee` 可选，填写时必须有 `overrideReason`，仅适用于已提交的
外部销售工单。返回 `preview`（原总额、新总额、差额、各地址费用）、`saved`
或 `error`。

保存使用工单级锁及数据库行锁，在同一事务内分货、增加地址、更新物流应收、
追加价格修订与操作日志。最多 10 个地址，原地址至少保留一件；拒绝跨工单
款式/地址、超分配、待审批、已发货、已结算及来源地址已有物流登记的请求。
外部销售沿用原物流价目，保留原地址人工确认金额及历史证据；新金额进入待核价。
外部销售草稿按原流程在提交时物化费用，内部结算保持原有不产生物流应收的规则。


### 外部销售建单备注与额外地址（2026-09-12）

`createOrderAction` 的外部销售输入继续使用订单级 `remark`，选填、去除首尾空白后最多 1000 字，保留换行。
每个 `additionalShipments` 的 `receiverName` 与 `receiverPhone` 均为必填，缺失时返回对应地址及字段错误；
不得只验证主地址。金额、报价令牌及分货数量约束不变。

### 顺丰到付切换失败与待审批保护（2026-09-12）

`setOrderSfCollectAction` 保留权限、所有权、状态及履约版本校验。存在待审批申请时，
领域层拒绝切换配送方式，避免改变申请所依据的报价；销售详情同步隐藏入口。
业务校验失败返回 `{ status: 'error', message }`；非预期持久化异常返回
`配送方式更新失败，请刷新后重试`，由当前表单展示，不能导致整页错误边界。
日志只记录操作、工单 ID 和异常类型，不返回数据库细节。失败不失效页面缓存。

### 销售详情只读投影（2026-09-12）

`getSalesOrderDetailById` 继续限定 SALES 和本人工单；新增持久化款式事实的展示投影、
快递名称及发货时间，多地址费用标注地址编号。设计文件签名及源文件下载权限不变。
申请记录不再输出无展示用途的生产前后版本；现有操作所需的顶层版本字段继续用于并发校验。
管理员保存已失效详情路径，销售“刷新”重新请求当前角色的详情，不修改工单或核价记录。

### 销售列表视图与申请类型（2026-09-12）

销售 `/orders` 新增 `view=cancelled`（仅已取消）；`view=done` 只包含 SETTLED / FINISHED。
汇总新增 `cancelled`，与筛选使用相同状态范围；所有查询仍在本人工单范围内执行。
`view=todo` 查询条件不变，界面名称为“需关注”，属于进行中工单的交叉筛选。
列表及 `GET /api/orders/sales/[orderNo]` 的待审核/被拒申请投影增加 `type`（MODIFY / CANCEL），
用于区分修改申请和取消申请；不增加写入权限或内部字段。

### 外部销售补正与账单（2026-09-12）

- 建单客户选项使用 `listSalesCustomerOptions`：以 session 销售 ID 限制 `Party.customerOrders.some.submitterId`，仅返回 ID、编码、名称、简称。客户联系人、电话和地址不进入该投影。建单和编辑写入同时校验客户范围，管理员原权限不变。
- 销售工单详情及编辑共同使用 `getSalesOrderDetailById` 的显式查询与序列化；通用 `getOrderDetail` 不再用于销售编辑。工单自身收件信息继续可见，内部改价说明、成本及生产记录不进入销售 DTO。
- `cancelOrderAction` 允许 ADMIN / SALES。SALES 必须提交 `expectedEditVersion` 和取消原因；领域事务再次校验所有权、版本、无待审申请及 DRAFT / PENDING_FACTORY / REJECTED 状态。已确认订单仍走审批取消；ON_HOLD 通过已保存暂停决定还原原生产阶段后校验取消申请和结算。
- `submitOrderAction` 支持 REJECTED 补正重提：禁止待审申请、缺图或失效报价；重新计算并确认报价，回到 PENDING_FACTORY 由工厂复核。补正通知使用独立去重键。
- 图稿登记与删除只开放 DRAFT / REJECTED；驳回补正在工单锁内增加业务/编辑版本，操作记录保存文件前后标识、类型、URL 和大小，旧 OSS 对象不删除。确认/生产/暂停期间不能直接换稿。
- `/sales/bills`、详情与标题均读取 `AgentMonthlyBill`，以当前销售 ID 限定归属；金额和明细来自月账单自身保存值，草稿不计入待支付。销售入口不再读取旧 `Bill`；管理端历史归档不变。
- 销售详情返回当前驳回/暂停原因、说明、受影响款号和时间；不暴露执行人及恢复内部证据。有包装组时不提供新增款式入口，服务端原拒绝校验保留。

### 销售编辑页新增收货地址（2026-09-12）

`addOrderShipmentAction` 使用 `order:create` 入口权限；领域层仅允许管理员或工单本人销售，销售传入人工运费、纸箱费或改价说明一律拒绝。销售复用预览→确认保存协议：从未登记物流的已有票分货，数量守恒，自动核算物流费用，校验业务/编辑/生产/价格版本及预览令牌，原子更新地址、分货、报价与审计。已发货、已结算、有待审申请及超过10票仍拒绝。

销售编辑使用同一销售详情白名单，额外投影可新增/可分货布尔能力，不向客户端传递原始重量或物流登记内部字段；独立新增地址表单与未保存的编辑表单互斥。编辑页“已保存的基本信息”展示当前数据库工单的承诺交期及配送方式，不代表尚未保存的表单草稿。

### 销售非计价文字编辑（字段对照 F18）

`editSalesTextAction` 只接收目标工单、目标款式、`itemName`、文字值及编辑版本。仅本人销售可用，在工单锁内检查所有权、目标归属、可编辑状态、待审批申请与版本；只更新名称、业务/编辑版本和审计，不写价格、生产版本或审批状态。普通空名称被拒绝，管理员通过原管理编辑入口处理。

F47：同一文字编辑入口增加 `itemRemark`，最多1000字符，空字符串明确清空为 null；不修改款式名称和费用，其他锁与审计相同。

F48：同一入口增加 `packagingName`，仅更新该工单所属包装组名称，允许清空；不改变 mode、actualBagCount、成员组成、入袋费或报价。款式文字及包装组文字可在非终态、无待审申请时直接保存；工单名称的确认后锁定保持不变。

### 内部款式备注与客服配送补齐（2026-09-12）

- `editItemRemarkAction(orderId, itemId, previous, formData)`：要求 `order:create`；领域层仅允许管理员及该工单的客服创建者。接收 `expectedEditVersion` 与最长 1000 字的 `remark`，统一换行符为 LF，空白清空为 null；待审批和不可编辑状态拒绝。校验款式归属，事务内保存备注、推进编辑/业务版本并记审计；不改变金额、价格版本、纸质工单版本或生产数据。返回 `success`、带 `fieldErrors` 的 `invalid` 或业务 `error`。
- `addOrderShipmentAction` 沿用既有预览凭证与四版本校验，新增允许客服对本人创建的工单调用；客服和销售均不可传人工物流费用。其他分货、物流登记、已结算和收费历史限制保持不变。
- 共享修改申请表单支持既有款式 `pack`（每袋数量），只在领域允许的未生产阶段、且款式有唯一包装明细时提供输入。它仍经过修改申请、计价预检与管理员审批，不通过基础资料保存直接改包装或金额。

### 发布整改后的认证与表单契约（2026-09-11）

Proxy 仅将包含非空 `user.id`、合法且未过期 `expires` 的 session 视为已登录；错误对象、数组、缺字段和过期 session 均拒绝。页面跳转登录，受保护 API 返回 401；数据库账号状态、权限和资源所有权仍在服务端检查。

月账单生成、确认、收款与抵扣 action 在 strict schema 前仅过滤字段名以 `$ACTION_` 开头的 React 表单协议元数据；未知业务字段仍拒绝。该兼容处理不改变账单冻结、Decimal 金额、幂等键或历史快照。

部署 jobs gate 仅在明确的 development/test inline 模式与完整健康摘要一致时接受 optional/null 机器人状态；production 仍拒绝 null、必需 worker 缺失或版本不符。production smoke 对无效 cron token 只接受 401，缺配置的 503 失败。

PDF 生成接口仍执行认证、角色和资源所有权校验；页面下载入口使用原生链接，导航预取不得创建后台任务。P2002 仅按已识别的约束字段映射为表单业务错误，未知冲突继续抛出。

手工出入库 action 必须携带有效的 `idempotencyKey`；同键重放仅返回原流水，同键不同操作者或业务内容拒绝，成功后表单换新键。时薪重复标记为已发保留首次发放时间。数据库前向迁移与历史兼容边界见 [数据库说明](./DATABASE.md#手工出入库请求幂等2026-09-11-局部核对)。

认证预取仍完整验证会话，但 GET/HEAD 预取响应不回写代理层滚动会话 Cookie，防止晚响应复活已经登出的会话；普通导航续期策略保持。

### 跨设备 PDF（2026-09-11）

`GET /api/orders/:id/pdf` 默认 attachment；`view=inline` 使用 inline 供系统 PDF 阅读器打开，其他/重复 view 返回 400。202 轮询保留 view 与 jobId；失败恢复链接携带 `regenerate=1` 新建生成请求。同一授权内容在 15 分钟数据库时间窗口内复用任务；产物保留 1 小时，可重复下载，每次仍检查账号、所有权及当前工单版本。产物存储可选持久共享卷或私有 OSS，不提供公开下载地址。详见 [跨设备打印](./docs/跨设备打印与可用性.md)。
