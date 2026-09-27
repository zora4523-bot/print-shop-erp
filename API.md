---
status: maintained
owner: project-maintainers
last_verified: 2026-08-24
applies_to: repository source at last_verified
---

# API 与 Server Action 契约

## 2026-09-27 仓库维护

`maintainWarehouseAction` 接收 kind（warehouse/location）、id、operation（rename/disable/restore）、expectedUpdatedAt 及改名时的 name。入口与领域均要求当前启用的 warehouse:manage 账号；编码、所属仓库和默认标记不可变。相同结果的重试不重复审计；其他旧版本提交拒绝并提示刷新。库存逐条非零时拒绝停用，默认对象不能停用，恢复父仓不改变子库位各自状态。


## 2026-09-27 采购/BOM 录入恢复

`createPurchaseOrderAction`、`createBomAction` 新表单提交 `draftId` 与 `clientRequestId`（UUID，必须成对）。服务端从当前会话取得 actor，按 actor / 表单类型 / 请求键串行核对；同键同规范化事实返回原实体并显示“该录入此前已创建”，同键异内容拒绝。旧表单两键均缺失时保留兼容，但不提供自动恢复去重承诺。BOM 行数明确限制为 1～20。

`getFormCreationStatusAction({kind,draftId,clientRequestId,payload?})` 使用对应创建权限和同一事务锁，返回 `not-created` 或 `created`（授权实体详情地址、业务差异）。查询超时不意味着创建失败，客户端只允许沿用原键续填重试；明确“另建一单”才换键。详情回执 `createdDraft` / `creationRequest` 必须经服务器核对 actor、类型、draftId 和实体，才清理浏览器草稿。

补资料只接收 `form_origin`、`form_draftId`、`form_nonce`、`form_entityType`、`form_target`；来源限定 `purchase-new` / `bom-new`，目的地由固定映射产生。成功额外返回 `form_entityId`。`resolveSupplementAction` 重新核对来源及资料权限、启用状态、供应商类型和分类适用性。采购补供应商不接受 CUSTOMER 类型。协议不接收任意返回 URL，身份标识不是授权凭证；供应商独立新建的原有受限 `returnTo` 保持兼容。

## 2026-09-13 管理员建单人工定价与拆址修复

`createOrderAction` 的管理员载荷支持 `items[].adminPrice={amount,reason,factsKey}`（整款加工费总额，两位小数）及 `packagingGroups[].adminPrice`（每袋/盒单价，四位小数）。服务端检查活跃管理员、金额、原因及当前条件，落库为既有管理员确认快照，提交时保留可信人工价。销售端禁止该字段（包含显式 null）。`factsKey` 是防止误用旧价的条件对照，不作为授权凭证。

新增地址预览增加 `requiresPriceReview`（保存后是否需重新核价）和 `packaging`（组号、旧/新盒数、小计、差额），`charges[].shippingFee`、`packingMaterialFee` 可为 null 表示待核；保存同步包装费用和价格修订。拆址改变已物化工序的盒数时，返回业务错误并要求工单修改申请。详见 [行为、权限及发布步骤](./docs/管理员建单定价与装盒修复-20260913.md)。

本项目不是面向第三方开放的 REST API。页面读取主要由 Server Components 完成，页面写入主要通过 Server Actions；HTTP Route Handlers 只承担认证、健康检查、调度、下载、导出和少量查询。

端点实现以 [`app/api/`](./app/api/) 为事实源。修改方法、认证、参数、状态码或响应形状时，必须同步修改本文件和契约测试。

## 建单包装类型（2026-09-13）

`createOrderAction` 和内外部报价仍复用同一包装计算链。`packagingGroups[].mode` 支持原有 `SINGLE_STYLE` / `MIXED_STYLE`（入袋），新增 `UNPACKED`、`BOX_RED_CARD` / `BOX_RED_CARD_MIXED`、`BOX_TACTILE` / `BOX_TACTILE_MIXED`。默认仍为入袋。

兼容字段 `actualBagCount` 在装盒时表示盒数，在不包装时必须为 0；数量由服务端按款式、包装组成和发货地址重新计算。`itemUnitsPerBag` 的正值用于保留不包装款式的组归属，不作为收费依据。不包装允许款式 `pack=null`；包装模式由通过归属校验的包装组推导。外部销售仍不得提交单价、覆盖金额或价格快照。

管理员建单报价 `shipmentQuantities` 为按地址排列的逐款数量数组，装盒必须与各款总数一致；省略时按同一地址计算。最终创建与提交总是按持久化发货事实重新计算。装盒缺失已发布规则时返回待核价，不能自动使用 0 元或前端常量。详见 [包装规则](./docs/加工费计费规则.md#4-包装包装组级)。

本地草稿仅保存可编辑事实；恢复时补回本次会话的 `clientSubmissionId`，不复用历史提交标识。

## 销售工作台计算

`actions/workbench.ts` 的当前入口 `quoteWorkbenchItemAction({ item })` 要求 `order:create`，先授权再解析。`item` 复用建单报价 schema，包含产品、路线、纸张名称和克重、规格/尺寸、整数数量、正反面颜色、覆膜及局部/专版加烫事实；不接受人工改价。金额、加价比例及报价签名不属于该输入，解析后不传给领域服务。

服务端经 `calculateWorkbenchItem` 调用 `calculateCreateOrderQuoteFromCatalogInTx`，重新校验目录、工艺及当前发布版本；只计算当前单款加工费，不纳入包装和运费。不新增价格算法、价格账本或订单。

返回 `{ status: 'success', quote }` 或 `{ status: 'error', message }`，认证失败沿用授权入口抛错。`quote` 仅含加工费及明细、核价/制版待定标记和加工价版本号。金额为十进制字符串，缺价为 `null`；不返回内部成本、规则快照或签名。为兼容现有响应形状，新入口返回的 `markupAmount` 为零、`suggestedAmount` 等于完整基础加工费（未知仍为 `null`）。工作台使用同一纯 Decimal 函数在客户端计算 0–100 的整数加价比例；加价变化不再发起报价请求。

`quote.pricingReasons` 是受控中文核价原因数组，完整报价为空数组；前端兼容省略该字段。不得把未知费用当成零或把加工费参考价当成整单总价。纸张缺货、规格失效和不支持的组合继续由建单领域校验决定结果。

旧 `quoteWorkbenchAction(raw)` 保留原签名及目录显示值解析作为兼容入口，也委托同一服务计算。旧纸张输入最多 69 字符，须精确匹配当前目录，再拆分为订单允许的名称（最多 32 字）和克重；不截断名称。当前工作台不再调用旧入口。

“按此款式创建工单”仅把经 schema 校验的款式事实保存到当前账号的 sessionStorage，30 分钟有效，以随机标识进入 `/orders/new?fromWorkbench=...`；不携带加价或金额。建单页重新核对目录，使用独立本地草稿键保留原未完成工单，并通过原建单报价/提交动作重新核价和授权。顶部普通“创建工单”链接仍进入常规新建页。

计算器使用和变更记录见 [销售工作台](./docs/销售工作台.md)。

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

以下端点都是 `POST`、Node runtime、动态响应并使用 Bearer 认证。在 `durable` 模式下正常接受返回 `202 {status:"queued", ...}`；`inline` 模式直接执行并返回任务汇总。`CRON_SECRET` 未配置返回 `503`，不匹配返回 `401`。调度时间以
[`deploy/crontab.example`](./deploy/crontab.example) 为唯一事实源。

| 路径 | 可选 JSON 输入 | 默认业务范围 |
|---|---|---|
| `/api/cron/daily-salary` | `{ "date": "YYYY-MM-DD" }` | 上海日历昨天；格式错误为 `400`，当天为 `400 open date`，未来日期为 `400 future date` |
| `/api/cron/generate-bills` | `{ "period": "YYYY-MM" }` | 上海日历上月；显式空值或格式错误为 `400` |
| `/api/cron/outsource-overdue` | 无 | 当前上海业务日扫描 |
| `/api/cron/order-overdue` | 无 | 当前上海业务日扫描 |
| `/api/cron/order-export-cleanup` | 无 | 当前上海业务日清理范围 |
| `/api/cron/pending-factory-backlog` | 无 | 当前待工厂确认积压扫描 |
| `/api/cron/production-alerts` | 无 | 报工超前与下发未认领扫描 |

`hourly-payroll`、`cs-settle`、`cs-period-ending` 三个端点已于 2026-09-24 删除（SPEC §L），请求返回 404。

调用方不得依赖响应中的金额、人员清单或逐行错误；cron 响应保持 counts/status 级别，细节在受权限保护的后台页面和日志中查看。

`generate-bills` 的执行结果保留 `errorCount`，
并增加同值 `failed` 与去重字符串数组 `errorCodes`，供后台任务错误摘要展示。
非空错误数组使用 `BillGenerationIncomplete` 类别码；不把人员、客户信息或逐行错误正文放入错误码。
v2 月账单入账前使用 Decimal 核对加工费＋对客收费明细＝工单总额＝结算金额。异常工单包含工单号写入内部 `errors`，所属销售当月账单整张保持原样，其他销售正常继续；cron 将这些失败计入 `failed/errorCount`，手动生成返回明确的部分失败结果。

无错误时 `errorCodes` 为 `[]`；`daily-salary` 成功结果另带 `failed: 0`。

### 下载、导出与查询

| 方法与路径 | 认证 | 输入 | 主要响应 |
|---|---|---|---|
| `GET /api/admin/inventory-count/materials` | Permission `material:manage` | query `q`、`limit` | `200 {materials}`；未授权 `401` |
| `GET /api/orders/admin/:orderNo` | Permission `order:view:all` + ADMIN | path `orderNo` | `200 {order}`；未授权 `401`，非管理员 `403`，不可见或不存在 `404`；响应 `private, no-store` |
| `GET /api/cdr/bundles/:accessToken` | 256-bit capability URL | 服务端生成的 43 位 base64url token；不接受数据库 id | 就绪后校验 token 并 `302` 到 60 秒 OSS GET 签名；生成中 `409` + `Retry-After`；失效、撤销或不存在统一 `404`；频率超限 `429`；OSS 不可用 `503` |
| `GET /api/orders/:id/pdf` | Session + production print scope | path `id`；query `mode=order`（可省略）；durable 重试可带 `jobId` | PDF `200`；排队为可自动重试的 HTML `202`；非法模式 `400`；未授权 `401`；不可见 `404`；升版 `409`；渲染或分页失败 `500`；生成服务不可用或任务等待达到两分钟 `503`（手动查询原任务，不自动刷新） |
| `GET /api/orders/exports/:id` | Permission `order:export:all` | export id | XLSX `200`；生成中 `409`；失败 `410`；不存在或过期 `404` |
| `GET /api/salary/piecework-settlements/export` | Permission `salary:view:all`，复核数据库账号状态 | query `from`/`to`，可选 `workerId` | XLSX `200`；输入错误 `400`；未授权 `401` |
| `GET /api/salary/piecework/export` | Permission `salary:view:all` | query `date` 或 `from`/`to`，可选 `workerId` | XLSX `200`；输入错误 `400`；未授权 `401` |

Proxy 对已纳入拦截的 API 匿名请求返回 JSON `401`，不重定向到登录 HTML；页面请求仍跳转登录。路由继续校验数据库账号状态、角色及资源所有权，不依赖 Proxy 作为最终授权。PDF 的内联渲染失败与后台任务失败只返回固定错误码 `PDF_GENERATION_FAILED` 和重试建议，不返回底层异常正文或部署路径。

下载响应使用 `private, no-store`；文件名同时提供安全的 ASCII fallback 和 UTF-8 名称（适用的端点）。新增下载接口时保持内容类型、长度、缓存和 `nosniff` 语义。

工单 PDF 仅输出每页一个主码的生产主单。工序流转单已移除：`mode=tasks` 下载请求返回 `400`，浏览器打印页返回 `404`。后台任务继续绑定用户、工单和生产版本；兼容缺省或 `mode=order` 的历史任务，拒绝生成或下载旧流转单任务。浏览器打印页 `/print/orders/:id` 使用相同模板与分页规则。

生产打印范围统一由 [`lib/order/print-access.ts`](./lib/order/print-access.ts) 提供，适用于网页正文、页面标题、同步 PDF 及后台 PDF。每次读取复核账号仍启用且角色未变化：ADMIN 可查看全部，SALES 不可查看生产打印件。WORKER 按当前账号的固定报工岗位匹配当前版本未取消的计件工序，或读取包含当前版本公共进度工序的工单；`SUBMITTED` 不向师傅开放。旧 `ProductionTask.workerId` 派工关系不授予打印权限，无权访问的页面标题不含工单号。

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

- MODIFY 提案可携带 `promisedDate: YYYY-MM-DD | null`；省略代表不改、`null` 代表清除。允许 `items: []` 的纯交期申请，但拒绝无实际变化。预览返回 `promisedDateChange: { before, after }`，批准后才写入交期。纯交期等不影响计价的变更保留原加工费、总价和费用快照，不从历史明细重建金额。
- 普通独立制版费默认 `QUOTED / 0.00`，不再生成版费待定原因。管理员逐款制版明细入口继续保留；人工金额加入应收和新费用快照。彩印烫金含版费套餐、其他未知价格和待补运费的规则不变。旧待定快照可读，重算只将尚未核价的版费转为零，不覆盖已确认人工版费。
- 待审申请不自动暂停生产。工厂可在待审期间暂停/恢复；这两个仅切换执行状态的操作不使现有申请版本失效。批准暂停中的申请保持暂停，恢复仍须提供恢复证据。已经下发生产的暂停工单可为批准的新版本创建重打任务，仍禁止首次下发绕过暂停。
- 生产改版只承接能唯一对应同一工序、款式或包装组的已完成量；过版工资不重复计入。低于已产量、已产来源无法对应或多款汇总后无法确认各款剩余量的变更整体拒绝。新版完工条件重新检查，旧版报工继续拒绝。旧版仍待开工/进行中的工序与无计件进度步骤在同一批准事务内置为已取消（报工事实不改）；其中带分档烫金报工的旧工序标记需人工核定，管理员在工单提成明细确认后，这些报工日才能锁定计件结算。

实现见 [`actions/order.ts`](./actions/order.ts)、
[`actions/admin-order-workflow.ts`](./actions/admin-order-workflow.ts) 和
[`lib/order/change-request.ts`](./lib/order/change-request.ts)。

- `quoteExternalCreateOrderAction` 同时允许 SALES 自助报价与 ADMIN 代建预览；仍使用同一已发布价目、参数校验和报价 token，其他角色一律拒绝。关联账号的有效性在实际创建事务中重验。内部/工厂直单预览 `quoteInternalCreateOrderAction` 已于 2026-09-24 删除（业主拍板：所有业务都以外部销售身份开展）。
- `createOrderAction` 的 `externalSalesUserId`：ADMIN 建单**必填**（2026-09-24 起取消工厂直单），缺失时返回 `invalid` 且 `fieldErrors.externalSalesUserId = ['请选择关联外部销售']`；只能指定启用的 SALES 账号。事务内锁定并验证账号，写入 `submitterId` 与 `EXTERNAL_SALES` 结算方向，`submitterRole=SALES` 满足结算一致性约束，实际管理员保留在 `createdById` 和创建日志。SALES 本人建单时原始输入出现该字段（包括 null）直接拒绝；其他角色不能建单。管理员新建页在没有启用的外部销售账号时不渲染表单，提示先去账号管理创建或启用。重复创建按实际创建人和原归属校验。寄样品 / 打样（`purpose=SAMPLE_SHIPMENT|PROOF`）同样适用：管理员从 `/workbench` 或 `/orders/new` 直接进入样品流程时，样品表单渲染「关联外部销售（必填）」并在保存前校验，服务端返回的同一字段错误显示在该字段下；没有启用的外部销售时显示与新建页相同的空状态。
- 工单“客户名称/简称”自 2026-09-27 停用（DECISIONS 同日）：建单页不再有客户输入。`createOrderAction` 仍接受旧客户端或旧草稿带来的 `customerPartyId/customerRef`（不校验、不查客户主数据），但领域层对 SALES 与 ADMIN 一律写入空值；重做单不再复制原单客户。既有工单已存的客户列原样保留。
- 新建的 `items[].pack` 上限为 12；`packagingGroups[].itemUnitsPerBag` 的一包合计最多 12，混装按各款相加。预报价、创建 schema、创建领域及页面同步校验，不改变旧工单包装及历史报价。数量为正整数；超限须调整，不能自动截断或按零费用放行。
- `updateOrderAction` 必须携带页面读取的 `expectedEditVersion`。基本信息按当前状态白名单保存；客户不在白名单内，旧表单带来的 `customerRef/customerPartyId` 被丢弃，已存客户列不改动。ADMIN 可修改范围内工单，SALES 仅可修改自己的工单；存在待审批申请时拒绝保存。
- 管理员编辑页的“关联外部销售”使用 `externalSalesUserId`，只列出启用的 SALES 账号。它更新工单 `submitterId`，同步销售访问范围及后续对账归属，不写入客户主数据 `customerPartyId`。仅 ADMIN 可更换 DRAFT / PENDING_FACTORY / REJECTED / SUBMITTED 的 EXTERNAL_SALES 工单；已有结算、发货、账单（含草稿）或重做关联时拒绝转移。非外部销售工单不得借此转换结算方向。空账号和无效账号拒绝；未更换的历史账号可保留。事务内锁定工单与目标账号并验证递增编辑版本，保留创建人、创建时角色、已存客户列、配送及全部金额快照；日志记录前后账号名称与账号 ID。
- 完整编辑页用 `shipments` JSON 提交全部现有配送记录的 `id`、收件人、电话、地址、快递代码、`expectedDestinationProvince` 和 `sameDestination`。服务端校验记录集合与工单归属，拒绝新增、遗漏、重复和已发货记录的修改；外部销售需完整联系人。寄付地址变更必须明确确认原计费省份与条件未变；跨省、未核定或计费条件变化不能用普通编辑跳过物流核价。未带配送 JSON 的旧入口不能修改外部寄付地址。
- 外部销售工单显式修改 `customName` 时不得清空，领域层按工单保存的 `settlementType` 校验，不能以操作者角色绕过；未传该字段的历史局部更新仍按原白名单执行。
- `packageRequirement` / 外部创建命令 `packRaw` 保持既有字段契约，含义是选填的包装补充说明。保存该文字不变更包装组、分袋组成、实际袋数或入袋费用。
- 联系信息保存只更新工单及对应配送联系人，不重建款式、分货、包装或历史价格。主地址同步、递增编辑版本与变更日志在同一事务中完成，过期版本拒绝覆盖。
- `createOrderChangeRequestAction` 的 MODIFY 支持管理员及工单所有者（SALES），状态窗口由 `ORDER_MODIFIABLE_STATUSES` 统一定义，包含草稿、待工厂确认和已驳回。管理员新增的权限不开放 CANCEL 申请；取消继续沿用原有流程。申请人（包含管理员）只能撤回本人待审申请；待审批期间也禁止增删设计文件。
- 修改申请中的规格变更：非空白路线同时提交 `specification` 与 `targetProductId`；空白封只提交 `targetBlankIdentity`（纸张、克重、规格），不能同时携带旧产品选择字段。服务端重新解析当前身份与准入，不能只改文字沿用旧产品。原样复制模板也单独检查当前正价。
- 未提交的外部销售草稿（本人或管理员代建）尚无快递 / 耗材收费行时，改数量或规格的预览与批准只重算加工费（`requotesLogisticsChargesOnChange` 为 false 时 `includeOrderCharges=false`），不刷新物流行、不做“每个地址两行”校验；提交时 `finalizeExternalOrderQuoteInTx` 按最新物流价目权威生成物流行。已提交的外部销售工单、以及已带物流行的草稿仍按原口径重算，缺行时在首次写入前拒绝。
- 任一收货地址已发货（SHIPPED）后，修改申请只能改交期；取消申请、改款式数量的预览与取消结算预览都拒绝（`lib/order/change-request-shipment-guard.ts`）。
- `previewOrderChangeRequestPricingAction` 接受 `requestId`、可选的 `expectedPriceRevision` 与 `pendingChargeResolutions`。人工物流决议只适用于本次预览实际待核的收费，需携带收费业务键、发货记录、预览数量、省份、金额和依据。
- 批准修改须提交 `expectedPriceRevision`；涉及重新计价时，还须将预览返回的 `quoteToken` 作为 `expectedQuoteToken` 提交（`order-change-approval-v1:` 前缀）。服务端持有订单锁后重新核对报价、版本及人工收费内容，变化时拒绝写入并要求刷新预览。无需重新计价的修改不提交报价令牌；拒绝申请不依赖价格版本。
- 取消参考结算预览返回原参考金额、明细及价目依据，并附 `priceRevision`、`quoteToken`。批准取消必须提交对应的 `expectedPriceRevision` 与 `expectedQuoteToken`；服务端持订单锁重算，核对材料补核、产量、发布价目与参考金额是否变化。过期预览拒绝批准；人工调整结算额仍保留原有依据要求。
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

### 添加发货地址（管理员 / 工单本人销售）

`actions/order-shipment.ts:addOrderShipmentAction(payload, mode)`：入口权限
`order:create`（ADMIN、SALES）；领域层 `lib/order/add-shipment.ts` 再次限定为
ADMIN（任意工单）或工单本人 SALES（`submitterId` 为本人），其他账号拒绝。`mode`
为 `preview` 或 `save`；预览只读，保存必须提交预览返回的 `previewToken`。
销售侧入口与限制另见下文「销售编辑页新增收货地址（2026-09-12）」。

输入包含 `orderId`、`sourceShipmentId`、`expectedRevision`、
`expectedEditVersion`、`expectedWorkOrderVersion`、`expectedPriceRevision`，
新地址的 `receiverName / receiverPhone / receiverAddress / destinationProvince`，
以及 `lines: { orderItemId, quantity }[]`。新地址的 `shippingFee`、
`packingMaterialFee` 可选，**仅 ADMIN 可填**（SALES 传入人工运费、纸箱费或
`overrideReason` 一律拒绝），填写时必须有 `overrideReason`，仅适用于已提交的
外部销售工单。返回 `preview`（原总额、新总额、差额、各地址费用）、`saved`
或 `error`。

保存使用工单级锁及数据库行锁，在同一事务内分货、增加地址、更新物流应收、
追加价格修订与操作日志。最多 10 个地址，原地址至少保留一件；拒绝跨工单
款式/地址、超分配、待审批、已发货、已结算及来源地址已有物流登记的请求。
外部销售沿用原物流价目，保留原地址人工确认金额及历史证据；新金额进入待核价。
外部销售草稿按原流程在提交时物化费用（2026-09-24 起不再有内部结算工单）。


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

- 建单与编辑不再提供客户选项（2026-09-27 客户字段停用）；原按销售限定的客户查询与写入校验随之删除。销售列表、详情与 `GET /api/orders/sales/[orderNo]` 不再返回 `customerRef/customerPartyId`。
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

### 内部款式备注与配送补齐（2026-09-12；2026-09-24 删除客服角色后更新）

- `editItemRemarkAction(orderId, itemId, previous, formData)`：要求 `order:create`；领域层仅允许管理员。接收 `expectedEditVersion` 与最长 1000 字的 `remark`，统一换行符为 LF，空白清空为 null；待审批和不可编辑状态拒绝。校验款式归属，事务内保存备注、推进编辑/业务版本并记审计；不改变金额、价格版本、纸质工单版本或生产数据。返回 `success`、带 `fieldErrors` 的 `invalid` 或业务 `error`。
- `addOrderShipmentAction` 沿用既有预览凭证与四版本校验，销售可对本人工单调用；销售不可传人工物流费用。其他分货、物流登记、已结算和收费历史限制保持不变。
- 共享修改申请表单支持既有款式 `pack`（每袋数量），只在领域允许的未生产阶段、且款式有唯一包装明细时提供输入。它仍经过修改申请、计价预检与管理员审批，不通过基础资料保存直接改包装或金额。

### 发布整改后的认证与表单契约（2026-09-11）

Proxy 仅将包含非空 `user.id`、合法且未过期 `expires` 的 session 视为已登录；错误对象、数组、缺字段和过期 session 均拒绝。页面跳转登录，受保护 API 返回 401；数据库账号状态、权限和资源所有权仍在服务端检查。

月账单生成、确认、收款与抵扣 action 在 strict schema 前仅过滤字段名以 `$ACTION_` 开头的 React 表单协议元数据；未知业务字段仍拒绝。该兼容处理不改变账单冻结、Decimal 金额、幂等键或历史快照。

部署 jobs gate 仅在明确的 development/test inline 模式与完整健康摘要一致时接受 optional/null 机器人状态；production 仍拒绝 null、必需 worker 缺失或版本不符。production smoke 对无效 cron token 只接受 401，缺配置的 503 失败。

PDF 生成接口仍执行认证、角色和资源所有权校验；页面下载入口使用原生链接，导航预取不得创建后台任务。P2002 仅按已识别的约束字段映射为表单业务错误，未知冲突继续抛出。

手工出入库 action 必须携带有效的 `idempotencyKey`；同键重放仅返回原流水，同键不同操作者或业务内容拒绝，成功后表单换新键。（原“时薪重复标记为已发保留首次发放时间”随时薪月结生成与标记发放于 2026-09-24 删除；打包历史时薪月结只读。）数据库前向迁移与历史兼容边界见 [数据库说明](./DATABASE.md#手工出入库请求幂等2026-09-11-局部核对)。

认证预取仍完整验证会话，但 GET/HEAD 预取响应不回写代理层滚动会话 Cookie，防止晚响应复活已经登出的会话；普通导航续期策略保持。

### 跨设备 PDF（2026-09-11）

`GET /api/orders/:id/pdf` 默认 attachment；`view=inline` 使用 inline 供系统 PDF 阅读器打开，其他/重复 view 返回 400。202 轮询保留 view 与 jobId；失败恢复链接携带 `regenerate=1` 新建生成请求；同一授权内容（工单、账号与角色、工单版本、内容快照）已有排队或生成中的任务时复用该任务，不再重复入队。所有入口（普通下载、`regenerate=1`，以及 `/owner/background-jobs` 的运维重试 `retryBackgroundJobAction`）在同一事务里先取该授权范围的 `pg_advisory_xact_lock`，再查在途任务：下载与重新生成复用在途任务，否则按 15 分钟窗口键或重新生成锚点在同一事务内创建或复活；运维重试遇到同范围在途任务时不复活已失败任务，返回「已有同一工单 PDF 正在生成」。同一授权范围始终最多一个在途任务（2026-09-24 修复：此前普通下载可能把已失败的窗口任务与在途的重新生成任务同时排进 HEAVY 队列；2026-09-26 修复：此前运维重试不取范围锁，可让已失败任务与在途的重新生成任务同时在途）。2026-09-11 之前的旧格式任务键（`order-pdf:<工单>:<随机>`）不含授权范围摘要，不在此保证内。同一授权内容在 15 分钟数据库时间窗口内复用任务；产物保留 1 小时，可重复下载，每次仍检查账号、所有权及当前工单版本。产物存储可选持久共享卷或私有 OSS，不提供公开下载地址。详见 [跨设备打印](./docs/跨设备打印与可用性.md)。


### 批量打印工单

`requestBatchPrintAction` 要求 `order:view:all`，领域层复核账号启用且为 ADMIN。
输入为 UUID `requestId` 和按列表顺序排列的 1–50 个不重复 `orderIds`。
成功返回 `{status: 'queued', jobId}`；选择无效返回按所选顺序编号的问题项，不创建部分任务。
使用 HEAVY 队列 `ORDER_BATCH_PDF`，不改变工单状态或创建生产下发记录。

`GET /api/orders/batch-print/:jobId` 返回私有、不缓存的进度 JSON：
`status`（pending/ready/failed/unavailable）、`completed`、`total`、`issues`；
pending/unavailable 另有 `phase`（queued/rendering/merging）。
同账号同有序内容的进行中任务复用；同一十五分钟时间窗内完整有效结果复用，不依赖客户端 requestId 相同。
仅创建者可读；账号权限每次复核。`view=download` 下载合并 PDF，`view=inline` 内联打开。
下载返回 200；未登录 401；无权限或任务不存在 404；未就绪或工单内容变化 409；
文件过期或读取失败 503；非法 view/id 400。所有响应 `Cache-Control: private, no-store`。
下载前后重新检查所有工单内容标识及创建者权限，任意变化阻止整份文件下载。

### 空白封单价与材料补核（2026-09-20）

`createCatalogPaperAction` 继续要求 `material:manage`，按名称、整数克重与复核标记创建基础纸张；该动作不授予空白封销售准入。旧 `enablePaperSpecificationsAction` 及其协议已删除。

`actions/blank-paper.ts` 的 `addBlankPaperAction` 要求 `dict:price:manage`；仅新建纸张时额外要求 `material:manage`。接收 `priceBookId`、ISO `expectedUpdatedAt`、已有/新建 `paper` 及六种标准 `specifications` 的金额。`updateBlankPriceMatrixFormAction` 以服务端绑定的格子身份读取实际提交字段；未提交字段不变，已有格清空/0 保存为停售，新空格留空不写规则。事务持价格写锁，重验纸张、收费类别、草稿版本与金额，保存价格及审计；不创建或启用 Product。成功/已知业务失败返回结构化结果，授权与未知异常不吞掉。

空白封候选和新准入仅消费当前生效正价，纸张启用/缺货和 120g 保护继续有效。新明细 `productId=null`；纸张、克重、规格、实际尺寸及工艺仍须完整。STOCK_BLANK 允许不传 Product，其他路线仍要求匹配产品或合法人工核价说明。目录键不是数据库 ID，服务端重新从价目核验；新建、正式提交、改单新增/身份切换、打样和工作台共用准入。

`confirmHistoricalBlankPriceAction` 通过活动账号会话检查 `order:price:confirm`；领域层再次验证 ADMIN 角色、款式属于该订单、可核价状态、款式身份、`expectedOrderRevision` 和 `expectedPriceRevision`。接收 `orderId/itemId`、大于0且最多四位小数的 `unitPrice`、定价 `reason`。保存独立材料单价依据，写 `PriceRevision` 与 `OrderLog`，递增价格修订号，不改既有总额、不发布新规则。原历史款式当前停售且需重算时使用可验证材料快照/补核记录；客户端不能传历史豁免。新款式和复制模板一律按正价检查。

旧 `/owner/rules/stock-skus` 列表/新建跳转空白封单价；详情鉴权后按真实类别分流。非空白产品资料入口为 `/owner/rules/product-categories/items`。空白封旧产品的创建、修改、启停在服务端拒绝。资料及操作说明见[空白封单价管理](./docs/空白封纸张规格管理-20260913.md)。

## 2026-09-15 寄样品与打样

- 工作台以 `quoteSampleOrderAction` 使用既有 `order:create` 权限和已发布价表读取器；返回整单 `total`（未知为 null）、`knownTotal`、快递/包装明细、可选包装规则及 `quoteToken`。独立 Server Action 位于现有建单报价模块，不增加 REST 路由。
- `createOrderAction` 接受 `purpose=STANDARD|SAMPLE_SHIPMENT|PROOF` 和仅寄样可用的 `samplePackagingRuleCode`。不传用途兼容普通单。`pricingMode` 由服务端推导；外部销售仍不能提交金额、状态、价目版本或管理员定价字段。用途在建单后不可切换。
- 特殊用途先存无价格草稿，再复用 `submitOrderAction(orderId,quoteToken)` 事务、所有权校验及报价变化响应。寄样保留真实数量，不要求生产工艺或设计图；打样须真实工艺与设计图片。寄样包装取当前已发布的最小数量档或指定有效规则，未录实际重量的寄付运费待核价。
- 打样复用 `previewOrderPricingReviewAction` / `finalizeOrderPricingAction`，仅管理员填写单一「整单总价」。账本唯一收费键 `ORDER:PROOF:TOTAL`（SAMPLE_FEE）；款式、入袋加工均含在整单价内，保持零分项。空值、负数、超限、额外加工费及过期版本拒绝；明确 0 元须有定价依据。确认后的打样在下发/生产/打包阶段可沿此入口调整整单价，已结算禁止调整。普通工单核价状态范围保持原样。
- 寄样下发进入 PACKING，不生成加工工序或计件工资；打样沿正常生产流程。打样发货不重算物流应收，附加收费/顺丰到付金额更正入口不适用。寄样沿原价目版本补录实际重量与运费，包装规格保持选中档位。
- 首版样品用途的生产款式修改申请暂不开放；收件信息、备注、交期和取消沿原权限路径。变更生产款式应新建工单，保留原单历史。

实现、测试及本地操作见 [寄样与打样开发任务](./docs/寄样与打样开发任务.md)。

### 管理员全项收费编辑（2026-09-16）

- `previewOrderPricingReviewAction({ orderId, editAll: true })` 返回当前可编辑的加工单价、一次性费用、包装加工费、订单级收费及逐地址快递／耗材费；默认省略 `editAll` 时仍为原待核价流程。
- `finalizeOrderPricingAction` 接受相同的 `editAll` 标志及原有版本、金额、依据字段。在同一工单锁与事务中校验价格／工单版本、待审批申请、金额精度、合计、资源归属，保存可信人工价格和价格修订。仅 ADMIN 可使用；外部销售不可通过构造参数越权。
- 全项模式用于已提交至发货后的未结算收费工单；草稿／驳回待修改／作废／结算／归档不可用。管理员新建入口“创建并编辑收费”先执行原提交与上传校验，再进入收费编辑，避免提交重新报价覆盖人工价。
- 顺丰到付快递费必须为零。2026-09-24 起不再有工厂直单与内部销售工单，全项收费编辑只对外部销售收费工单开放。
- 寄样仅快递＋包装耗材；打样仅一条整单总价。逐款制版通过现有制版明细维护，不能同时重复恢复已免收的汇总版费；附加收费、优惠继续使用现有商业明细接口。已有经审批调整允许有符号金额，普通费用不能为负数。

## 计件工价管理（2026-09-16）

`actions/owner-piecework-rules.ts` 的 `mutatePieceworkRulesAction` 要求
`salary:rule:manage`（ADMIN），领域写操作再次核验管理员有效状态。

- `intent=create`：取得唯一当前草稿；没有草稿时复制最后发布版创建连续后续版本。
- `intent=save`：提交 `version`、ISO `updatedAt`、`partial/full/bag/box` 十进制字符串、
  `sourceName`、`publishNote`、`effectiveFrom`。空生效时间表示发布时立即生效；有值必须带明确时区。
  空金额只允许保存草稿；空 `box` 表示不配置按盒工价。
- `intent=publish`：仅接收版本和修订时间，从已保存草稿取金额与说明。发布时再次校验，
  不能以客户端金额覆盖保存值。返回 `{status: 'success'|'error', message}`；意外异常不吞掉。

发布与草稿编辑共用事务锁；扫码报工在取价及写入期间取得共享锁。报工锁顺序为既有
工单/工序/身份锁 → 工价共享锁 → 报工日/人员日锁；发布不取得报工日或工序锁。
已发布版本只能创建后续版本调整，重复发布不重复记审计或改变生效时间。

### 2026-09-16：管理员调整局部工序计薪次数

`updatePayrollPassAction`（`salary:rule:manage` + 活跃管理员复核）接收
`operationId / expectedRevision / passCount / reason`；次数为 1–999 整数、原因 2–500 字。
只调整当前版本未完工局部工序，使用订单→工序锁、版本检查及工单审计。
师傅报工 Action 新增必填 `expectedPayrollRevision`；旧页面须刷新，已成功请求重试仍返回原记录。

### 师傅个人工价（2026-09-17）

`mutatePersonalPieceworkAction(workerId, previous, form)` 仅 `salary:rule:manage` 管理员可调用，领域事务再次验证管理员与目标账号状态。账号取绑定参数，表单账号不能覆盖它。
`intent=create/save/publish` 复用工价草稿流程；save 包含 `version/updatedAt/useUnifiedRates/partial/full/bag/box/sourceName/publishNote/effectiveFrom`。个人工价不再要求手填 `sourceName`；旧依据保留，缺省时发布来源自动记录为“管理员账号工价设置”。调整说明仍必填，统一工价的依据要求保持不变。只保存当前岗位字段，空金额与零金额分开。publish 只接收已保存的版本和修订时间，不能直接带价发布。
扫码报工表单新增必填 `expectedRateKey`，为当前价格簿与个人模式版本的组合键。成功重试仍返回原记录；新报工工价已变化则拒绝并要求刷新。客户端不能指定结算价格或他人账号。

### 2026-09-17 师傅分档工价与工单提成核定

- 统一／个人工价草稿增加 `partialSmall`、`partialSetup`、`fullSmall`、`fullSetup`；同一工序的包干和装版金额必须一起填写，发布后随版本冻结。省略两项的旧调用仍表示历史线性规则。
- `reviewOrderWagesAction`：仅 `salary:rule:manage`，领域层再次检查在职管理员。输入工序 ID、报工明细修订摘要、每位师傅／工作日的锚点报工 ID 和目标总额、至少两字原因。
- 核定按工单→工序→工作日→人员锁序串行化；拒绝陈旧明细、漏项、重复对象、可编辑行的负目标金额及已结算日改价。原报工不变，仅追加 `ADJUSTMENT` 差额，产量全为零。重复请求不重复记账，改变已提交请求则要求刷新。
- 多人接手或计薪条件变化标记 `payrollReviewRequired`；工单详情“工单提成明细”核定后方可锁定结算。核定不改变师傅账号工价规则。

- 分档烫金报工锁定结算前，工序须已完成或取消，且不存在待人工核定标记。未结束返回 `SETTLEMENT_STATE_CONFLICT`，不创建结算或明细。
- 提成核定 `targets[].amount` 接受带符号十进制金额以携带只读冲正行；领域校验禁止更改冲正行或已结算行，可编辑行目标不得小于零。原额核定仅清除待核定状态，不新增金额流水。

### 2026-09-17 师傅报工核对与未结算流水

扫码报工前端先核对本批数量，再调用原 `reportProductionOperationAction` 或共享进度 Action；完成数和工单件数进度默认空白。服务端数量、岗位、版本、工价及幂等校验保持不变，计件报工成功同时刷新 `/worker/salary`。

`lib/salary/worker-pending-reports.ts` 供工资 Server Component 读取本人尚未关联结算项的流水。服务端重新核对账号启用状态及计件岗位，以会话 `actor.id` 限定 `reporterId`，不接受客户端指定其他师傅。按上海日期筛选，以 `pendingPage` 独立分页，每页 20 条；原报工、人工调整、冲正按原金额及符号展示，不重算工资、不改历史快照。

### 建单设计分组与批量工作区（2026-09-18）

`createOrderAction` 的 `items[].designGroupKey` 为可选 nullable UUID。同一工单内相同标识的材料、工艺和稿件版本必须一致，规格与数量可不同；缺失标识的明细独立处理。该字段只保存分组，不参与金额计算或赋予资源访问权限。外部销售仍经过禁止收费字段的命令边界。

批量工作区复用单工单 create/quote/upload/submit，不新增绕过鉴权的批量 API。每张工单使用独立、稳定的 `clientSubmissionId`，创建结果立即记录；上传或提交失败继续已有草稿，不对已成功工单重放创建。

创建事务在首条 `OrderLog(action=CREATE).changedFields.createRequest` 保存 v1 请求指纹（规范化对象键顺序后的 SHA-256）。同一提交标识的重试必须同时匹配创建人、归属销售及首次请求事实；事务内命中与唯一键冲突恢复均执行相同检查。不同内容或旧记录缺少指纹时返回含原工单号的核对提示，不能作为新内容保存成功，也不自动生成新提交标识。该元数据不展示为费用或操作变更；历史工单与价格快照不回填。

### 2026-09-18 师傅报工问题反馈

- `createReportDisputeAction(reportId, state, formData)`：`task:dispute:create`，仅活跃 WORKER 对本人 `ProductionReport` 发起问题；说明 5–1000 字。同一报工最多一个待处理问题，重复提交不产生第二条。
- `reviewReportDisputeAction(disputeId, state, formData)`：`task:dispute:review`，仅活跃 ADMIN；处理结果 `RESOLVED` / `REJECTED`，回复 2–1000 字；已处理记录拒绝再次回复。
- 两个 action 都返回 `{ status: 'success' | 'error', message }`；领域层重复校验权限和输入，事务写异议与工单日志。不修改报工数量、计件金额或结算记录。
- `/worker/reports` 按当前会话账号分页查询计件报工与调整；`/worker/reports/[id]` 强制本人所有权。管理员在工单详情的生产记录区处理问题，师傅在报工明细查看回复。

### 报工刷新防重（2026-09-21）

扫码页面使用 `batch:N` 请求作用域；进入 `/worker/tasks/[id]` 时若地址没有合法的 `reportBatch`，页面按本人在该工序/步骤已有的报工条数（计件只数 `REPORT` 行）推导 N，并重定向到 `?reportBatch=N` 固定批次；地址栏已有的 reportBatch 只在不大于该条数时沿用（即曾推导过的批次），更大的值同样重定向到 N，避免写入后与之后推导的批次相撞。报工 action 在身份与数量验证后，将工序/步骤、当前登录人、合格/缺陷/返工数量、工单件数进度、上海日期和批次序号派生为 SHA256 标识，交给原有事务幂等校验。同一地址刷新重试复用标识；报成功后重新扫码或从列表、工单页进入得到新的批次，同量新批次照常入账；“再报一批”链接回到不带 reportBatch 的入口，由页面按最新报工条数重新推导：本批已入账得到新批次，尚未入账仍是本批（客户端不自增批次号，避免跳号后与重新进入推导的批次相撞）。命中已有报工时 action 仍返回 `status: 'success'` 且 `idempotentReplay: true`，表单提示这一批已记录、未重复计入，并指向“再报一批”。原有不带 batch 前缀的客户端请求标识仍兼容。P2024/P2028 在建单和报工 action 返回可重试错误，不暴露数据库异常。

### 无计薪进度车道（2026-09-21 业主确认）

`listProductionProgressForReporter`、`getProductionProgressForReporter` 与 `reportProductionProgress` 共用 `progressCraftIdsForReporter`。账号必须为在职 WORKER，岗位匹配有效自产 Craft 的 defaultWorkerType；机器岗位还须匹配 inHouseMachineTypes（有配置时）或 defaultMachineType。缺配置不默认放行。列表与直接详情将 craftId 限定在匹配集合；提交在事务内复核，不满足返回 ACCOUNT_NOT_AUTHORIZED，不能通过直接调用 Action 绕过页面限制。此规则不采用个人认领绑定，不改变计件工价或历史快照；生产打印用途权限沿用独立规则。师傅任务列表（`listWorkerTaskPage`）进度视图的计数与分页、扫码直达（`resolveWorkerWorkOrderScan` 的唯一未完成项与 `?task=`）同样只认本人车道；工单页（`getWorkerOrderDetail`）仍列出全部当前进度，工单级可见范围不变，他车道进度带 `reportable: false`，只读展示、不链接报工页。

### 已删除功能的历史任务与通知（2026-09-24）

- `retryDeadBackgroundJob` 以 `isRegisteredBackgroundJobType`（`BACKGROUND_JOB_TYPES`，与处理器表一一对应）判定；已删除类型 `CRON_HOURLY_PAYROLL`、`CRON_CS_SETTLE`、`CRON_CS_PERIOD_ENDING`，以及事件已不在 `NOTIFICATION_EVENTS` 的通知死信，抛 `RetiredBackgroundJobTypeError`，action 返回 `{ status: 'error', message: '该任务类型对应的功能已停用，无法重试；记录保留为运行历史' }`，历史行不改。运维页对这些行不渲染“重试”，列表只提取事件名，不把 payload 交给页面。
- `resolveUnknownNotification` 对已删除事件（`CS_PERIOD_ENDING` / `CS_PERIOD_SETTLED`）的 `NOT_DELIVERED_RETRY` 在写入前拒绝（`RETIRED_EVENT`），action 返回“该通知事件已停用，无法重发；请核对后确认已送达或忽略”；`DELIVERED` / `IGNORED` 照常可用。同组仍有 `RETRYING` 日志（升级前已确认未送达）时，已删除事件在最后一条 UNKNOWN 收尾后**不**重新入队（2026-09-26 修复：此前会把任务改回 PENDING，处理器拒绝后这些日志永远停在 RETRYING）：同一事务内以 CAS（`id` + `deliveryKey` + `RETRYING` + `deliveryStateVersion`）把它们关闭为 `FAILED`（`IGNORED` 沿用“人工忽略：理由”，`DELIVERED` 记“人工核对：未送达；事件已停用，不再重发”），任务保持 `DEAD`、`lastErrorCode` 改为 `NotificationReplayTerminalError`（运维页不再给“去通知页处置”），审计行 `after.retiredEventClosedLogs` 逐条记录；返回值 `retiredClosedCount` 供 action 提示。通知页由服务端纯函数 `lib/notification/unknown-retry-availability.ts` 给出不可重发原因，组件据此禁用按钮。
- 升级前已处于 `RETRYING` 的同组日志：对最后一条 `UNKNOWN` 选择“确认已送达”或“忽略”时，事件已删除则不再重新入队，这些日志在同一事务内按 CAS 关闭为 `FAILED`（确认已送达时记“人工核对：未送达；事件已停用，不再重发”，忽略时沿用忽略理由），任务保持 `DEAD`（`ec43cf66`）。
