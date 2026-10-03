---
status: maintained
owner: project-maintainers
last_verified: 2026-08-26
applies_to: repository source at last_verified
---

# 系统架构

## 2026-10-04 现行入口与领域边界

最近变更与历史文档阅读规则见 [当前开发入口](docs/当前开发入口.md)。本节只更新生产入口与经营分析边界，不重签全文旧验证日期。

- `lib/order/production-readiness.ts` 在已授权写事务中复核保存的报价、收货资料、待审批和工艺／包装事实；`lib/production/routing.ts` 区分厂内安排、寄样、外协、包装、直接履约和资料异常。
- `lib/production/dispatch.ts` 在同一事务准备厂内工序、保存单负责人和打印请求；内部 release 物化仍被使用，但不再暴露独立管理员下发步骤。自动准备不产生结算，也不绕过存量报工守卫。
- `/owner/analytics` 与 CSV 导出共用 `lib/analytics/filters.ts`、`service.ts` 及分视图报表；五个视图定义于 `views.ts`。分析只读，页面分页与全量导出采用同一筛选口径；不把现金收款、加工费、出账或当前库存混成同一日期指标。

## 2026-09-28 单负责人生产与工资边界

`actions/production-dispatch.ts` 负责权限、输入验证、用户结果和路径失效；`lib/production/dispatch.ts` 负责排单事务，复用内部工序准备与状态推进；`completion-registration.ts` 负责数量申请/审批、实际完成及自动工资快照；`revision-jobs.ts` 只追加版本任务/独立重做归属；`lib/salary/production-wages.ts` 管理最终提成与差额流水。共享完成/发货门禁根据权威 `Order.simpleProduction` 排除包装登记，外协、核价和权限边界保留。

生产人、操作人、工资受益人是不同事实。生产归属在排单时确定，协作受益人仅出现在管理员提成核定入口。新旧报工写入口互斥，统一日结/导出读取两种账本；新增事实不伪装成历史报告。管理专用异步 ProductionJobPanel 不传入销售模型，师傅工资按当前会话受益人读取。

## 2026-09-27 录入页恢复边界

采购、BOM、供应商、物料及产品结构分类的五个新建页位于 `app/(admin-forms)/owner/`，URL 保持不变。该路由组复用管理端外壳和 OwnerLayout 的服务端授权，分类页继续复用规则工作区布局；不继承管理端 `loading.tsx`，避免禁用 JavaScript 时流式占位无法切换为可提交表单。其他管理路由保留原加载行为。

`components/business/form-drafts` 与 `lib/form-drafts` 只服务采购/BOM 录入，不替换工单已有草稿。服务器提供 actor 与每次登录独立的 `draftSessionScope`；浏览器按身份和表单类型隔离 sessionStorage，有限时间与容量保存白名单字段。BroadcastChannel 仅用于提示活跃标签页冲突，服务器创建记录承担实际去重保证。认证外壳负责清理非当前用户、过期或失去权限的暂存；登录页和原生登出不依赖草稿清理。

本文描述当前仓库可从代码验证的系统结构。业务规则以
[SPEC-v1.2.md](./SPEC-v1.2.md) 为准；历史决策及其原因见
[DECISIONS.md](./DECISIONS.md)。当本文与代码不一致时，先以代码保护数据，再在同一变更中修正文档。

## 系统边界

销售资料与单款快速计价入口为 `/workbench`，页面和 action 均以 `order:create` 授权。
目录、款式字段和选择联动复用建单模块；当前报价 action 接收建单同形单款事实，通过 `calculateCreateOrderQuoteFromCatalogInTx` 投影加工费。加价在浏览器用纯 Decimal 函数计算，不进入订单金额。临时款式带入使用账号隔离的 sessionStorage，建单页重新校验目录并按原流程报价、提交；独立本地草稿键保护已有工单。
销售知识独立于目录加载，不创建订单或新的价格账本，详见 [销售工作台](./docs/销售工作台.md)。

红包印刷 ERP 是一个 Next.js App Router 应用，覆盖工单、生产、外协、库存、采购、定价、账单、薪资、通知和运维页面。当前运行时由以下部分组成：

```text
浏览器 / 师傅移动端
        |
        v
Next.js Web（页面、Server Actions、Route Handlers）
        |
        +---- PostgreSQL（Prisma 7 + @prisma/adapter-pg）
        +---- 阿里云 OSS（设计图、CDR 等文件）
        +---- 企业微信智能机器人（LIGHT worker 长连接通知）
        |
        +---- PostgreSQL 后台任务账本
                    |---- LIGHT worker（通知、cron）
                    `---- HEAVY worker（CDR、PDF、工单导出）
```

生产进程、反向代理和 worker 的可执行配置在
[`deploy/`](./deploy/)；详细运行方式从 [DEPLOYMENT.md](./DEPLOYMENT.md) 进入。

## 代码分层

| 层 | 目录 | 责任 | 约束 |
|---|---|---|---|
| 路由与页面 | [`app/`](./app/) | 路由、取数、权限后的页面组合、Route Handlers | 页面不直接承载核心业务算法 |
| 交互编排 | [`actions/`](./actions/) | Server Actions、输入校验、权限检查、缓存失效与跳转 | 写操作先授权，再校验，再调用领域层 |
| 领域与基础设施 | [`lib/`](./lib/) | 状态机、计价、薪资、库存、通知、后台任务、数据库访问 | 业务不变量必须在服务端成立，不能只依赖 UI |
| 领域 UI | [`components/business/`](./components/business/) | 工单、生产、定价等业务组合组件 | 复用共享状态与基础组件 |
| 共享业务 UI | [`components/ui-business/`](./components/ui-business/) | 页面状态、反馈、业务语义外观 | 使用语义 token，不定义领域规则 |
| UI 原子件 | [`components/ui/`](./components/ui/) | 无业务语义的控件与布局原子件 | 保持可访问性、主题和键盘契约 |
| 数据模型 | [`prisma/`](./prisma/) | Schema、前向迁移与 seed | 已应用迁移不回写；财务和历史快照不可被当前规则重算覆盖 |

`@/*` 在 [`tsconfig.json`](./tsconfig.json) 中映射到仓库根目录。Prisma Client 生成到
`generated/prisma/`，不从 `@prisma/client` 创建运行时客户端。

## 典型请求路径

### 页面读取

```text
App Router 页面
  -> session / permission
  -> lib/<domain> 查询
  -> Prisma singleton
  -> PostgreSQL
  -> Server Component + Client Component 组合
```

领域数据进入业务 UI 前必须投影为 presentation DTO：底层枚举、内部 ID、规则条件和诊断元数据不能直接成为默认可见文案，具体边界以 [UI-SYSTEM.md](./UI-SYSTEM.md)“业务语言与技术标识可见性”为准。

### 业务写入

```text
表单或客户端事件
  -> actions/<domain>.ts
  -> requirePermission(...)
  -> Zod schema
  -> lib/<domain> 事务 / 状态机 / 不变量
  -> revalidatePath(...) 或 redirect(...)
  -> 结构化 action result
```

权限与输入校验是两道独立门。UI 的 disabled、隐藏按钮或确认框都不能代替服务端授权和领域不变量。

### 工单页面与领域契约

- 创建、编辑、详情和审批分别负责录入、基础资料更正、查看已保存事实和变更审批；普通编辑不重新套用当前创建默认值，也不重建款式、分货、包装或价格快照。
- 修改状态窗口统一使用 `lib/order/editable-fields.ts`。详情按钮与编辑页遵循待审批锁定，服务端继续独立校验所有权、状态和版本。
- 管理员编辑页的外部销售关联查询与冻结条件集中在 `lib/order/external-sales-association.ts`。保存由原编辑事务校验管理员身份、工单及账号锁、财务关联和编辑版本后更新 `submitterId`，使访问范围与后续对账使用同一归属；不修改 `createdById`、`submitterRole`、`settlementType` 或价格快照。内部业务、已确认或已入账工单不能通过此入口转为外部销售业务。
- 发货可用性与配送 DTO 分别放在 `lib/order/shipping-availability.ts`、`lib/order/shipping-fields.ts`。详情、抽屉及服务端操作查询消费这些纯契约；UI 目录保留兼容导出，不再由领域代码引用组件。
- 销售详情使用 `sales-detail-query.ts` 的显式 select 和映射；包装只传模式、实际袋数、每袋组成等客户可见事实，不附带内部规则、生产工资或成本快照。
- 本次跨页审查范围与证据见 [工单页面审查记录](./docs/archive/order-pages-audit-2026-09-07.md)。

### HTTP Route Handler

HTTP 接口只用于 Auth.js、健康检查、cron、下载、导出和少量查询；页面内写操作主要使用 Server Actions。当前端点、认证方式与响应约定见 [API.md](./API.md)。

### 持久后台任务

生产配置 `BACKGROUND_JOBS_MODE=durable` 后，Web 把任务写入 PostgreSQL 账本，独立 worker 领取、租约续期、记录尝试和结果。队列定义在
[`lib/background-jobs/`](./lib/background-jobs/)，进程入口在
[`scripts/background-worker.ts`](./scripts/background-worker.ts)。

- LIGHT：通知和定时批处理。
- HEAVY：CDR、PDF、XLSX 等资源密集任务；部署配置保持低并发。
- `/api/health/ready` 判断实例能否接流量。
- `/api/health/jobs` 单独表达队列积压、worker 或死信告警，避免队列故障错误地触发 Web 发布回退。
- 任务类型以 `BACKGROUND_JOB_TYPES`（与处理器表一一对应）为准。已删除功能的历史任务
  （`CRON_HOURLY_PAYROLL`、`CRON_CS_SETTLE`、`CRON_CS_PERIOD_ENDING`）与已删除事件的通知任务保留为
  运行记录，运维页不给重试，`retryDeadBackgroundJob` 抛 `RetiredBackgroundJobTypeError`；已删除事件的
  “送达未知”通知只能确认已送达或忽略（`lib/notification/resolve.ts` 的 `RETIRED_EVENT`）。

定时调度由主机系统 crontab 调用七个受 Bearer secret 保护的端点（2026-09-24 删除 `hourly-payroll`、
`cs-settle`、`cs-period-ending`）。调度事实以
[`deploy/crontab.example`](./deploy/crontab.example) 为准，不使用数据库内的 `pg_cron + pg_net` HTTP 调度。

## 认证与授权

- Auth.js Credentials 配置位于 [`lib/auth/config.ts`](./lib/auth/config.ts)。
- 请求层 [`proxy.ts`](./proxy.ts) 负责把未登录页面访问重定向到登录页；它不是业务授权边界。
- 权限字典位于
  [`lib/auth/permissions-dict.ts`](./lib/auth/permissions-dict.ts)。
- Server Actions 使用 `requirePermission`；被 `auth(handler)` 包装的 Route Handler 使用 `requireSessionPermission`。
- 所有者范围、工单范围和师傅任务范围在领域查询中继续收窄，不能因角色通过粗粒度权限就跳过资源级检查。
- 生产打印使用 [`lib/order/print-access.ts`](./lib/order/print-access.ts) 的独立范围，网页正文、标题与同步/后台 PDF 共用。ADMIN 查看全部，SALES 拒绝；WORKER 按当前账号固定报工岗位匹配当前版本未取消工序，或访问当前版本公共进度工序，排除 `SUBMITTED`。查询复核账号启用状态与角色，不以旧派工关系授权；后台生成后及下载前再次复核范围与生产版本。
- cron 使用 `CRON_SECRET`；CDR 外协下载使用不可猜测且限时的 bundle id，不依赖登录 session。

## 数据与一致性

[`lib/db.ts`](./lib/db.ts) 使用 Prisma 7 driver adapter，并在开发热更新期间复用全局单例，避免重复创建连接池。数据规则详见 [DATABASE.md](./DATABASE.md)。核心约束包括：

- 金额、单价、工时和库存数量使用数据库 `Decimal`，业务计算使用 Decimal 语义，不使用浮点金额。
- 工单计价、生产计件和薪资规则保存快照；规则更新不能改变历史记录。
- 工单主二维码是只读入口，依据当前账号岗位及生产版本定位可报工工序。工序选择不建立整单人员归属；提交报工仍由服务端以会话账号记账，烫金与打包分别计件。订单版本首次扫码记录仅表示首次开工事实，不替代每笔报工的 `reporterId`。
- 浏览器打印和后台 PDF 共用打印 DTO、模板及字体/图片就绪后的 A4 几何分页函数。主单每页保留一个带版本主码，工序数量与进度以文字表格呈现；无法安全分割的超高内容停止自动打印与 PDF 导出。
- 打印 DTO 的工序事实只来自当前 `workOrderVersion` 的 `ProductionOperation` 与 `ProductionProgressStep`，过滤已取消项，移除 `ProductionTask` 读取和渲染回退。缺少当前工序时明确显示空态，不按工艺名称合成生产任务。页眉状态使用工单状态注册表，审批提示读取 PENDING 修改申请；名称或未指定师傅都不参与状态推导。
- 状态变化由领域状态机或事务守护，不能由页面直接拼接状态更新。
- 关键写路径保存审计、幂等或唯一性证据；迁移中的 fail-fast 检查不能为“通过部署”而删除。
- 迁移只向前修复。数据库迁移已开始后，不能只回退代码并继续写入新结构。

## 外部依赖与降级

| 依赖 | 用途 | 未配置时的代码行为 |
|---|---|---|
| PostgreSQL | 主数据、业务账本、后台任务 | 应用或就绪检查失败 |
| 阿里云 OSS | 设计图直传、CDR 产物 | 上传入口禁用或下载返回明确不可用状态；不得假成功 |
| 企业微信智能机器人 | 业务通知（Bot ID + Secret，LIGHT worker 长连接） | 开发默认 mock；真发由环境、绑定与路由共同决定；旧 Webhook 仅兼容存量投递，后台只读 |
| Chromium | 工单 PDF | 生成失败并返回诊断；生产需系统 Chromium 与中文字体 |
| Sentry / OTel | 错误与追踪 | `SENTRY_DSN` 留空时不初始化 Sentry；版本标签来自 `APP_VERSION` |

环境变量契约以 [`.env.example`](./.env.example) 和
[`scripts/check-env.mjs`](./scripts/check-env.mjs) 为准，不在架构文档复制密钥或生产值。

## 设计约束

- 当前固定技术主线是 Next.js 16、React 19、Prisma 7 和 PostgreSQL。
- 写 Next.js 代码前先阅读当前安装版本的 `node_modules/next/dist/docs/` 对应章节；不能套用旧版约定。
- 安全、薪资、定价、库存、账单和状态机变更必须有与风险对应的测试。
- UI 规则以 [UI-SYSTEM.md](./UI-SYSTEM.md) 为准。
- 部署拓扑和运维事实不在本文重复，统一从 [DEPLOYMENT.md](./DEPLOYMENT.md) 进入。

## 文档维护

以下变更必须同步更新本文：

- 新增运行时进程、外部依赖或持久化系统；
- 修改代码分层或授权入口；
- 修改后台任务队列、健康检查语义或调度方式；
- 修改数据一致性、回退或快照策略。

只记录已经从代码、配置或已批准决策中验证的事实。带日期的生产快照属于部署 runbook，不应被提升为永久架构事实。

## 外部销售读取边界（2026-09-12）

销售详情及编辑复用 `lib/order/sales-detail-query.ts` 的同一查询/序列化契约；
`SalesOrderEditor` 不接触通用工单 DTO。工单“客户名称/简称”自 2026-09-27 停用，
销售端不再读取或返回客户；按工单指认归属一律用 `lib/order/external-sales-name.ts`。
`lib/agent-monthly-billing/sales-query.ts` 只读取本人的 `AgentMonthlyBill` 及冻结明细，
不复用包含管理员内部关系的月账单详情。旧 Bill 仅保留管理历史归档用途。

销售编辑页的新增地址复用 `add-shipment` 领域事务，与管理员共用分货守恒、自动物流报价、预览令牌及版本校验；销售权限在锁内按工单创建人限制，禁止手工指定费用。`SalesOrderEditGuard` 统一协调编辑页全部表单、页头操作、路由离开与弹窗的未保存内容；通过表单快照和提交状态阻止其他操作刷新覆盖输入。

### 发布验证进程隔离（2026-09-11）

仓库 Playwright 配置在启动服务及 globalSetup 首次连接前预检独立 E2E 数据库和显式库名确认。开发测试、生产构建测试与 durable worker 测试使用独立服务端口和构建产物；禁止复用日常开发服务。测试工价经正式发布服务建立并标明非生产，不能作为正式业务定价。命令与环境规则只在 [开发指南](./DEVELOPMENT.md#测试环境约束) 维护，远端 CI/生产验收证据在 [整改台账](./docs/release-remediation-2026-09-10.md) 跟踪。

六个账单页面位于 `app/(billing)/owner/`，复用原 AdminShellLayout、OwnerLayout 和错误/404 边界；URL 保持不变，独立分组提供原生表单初始 HTML。页面与 HEAVY 导出共享 `lib/order/admin-workspace-filters.ts` 的权限及筛选谓词，worker 不导入带 `server-only` 的页面聚合模块。

Next 16.3 默认会在 Proxy 前规范化并剥离 Flight 标头；`skipProxyUrlNormalize: true` 保留预取标识供认证代理判断。matcher 不跳过预取认证，代理仅阻止预取响应的 Cookie 写回，正常导航的滚动会话不受影响；原始路径下的公共资源、认证及受保护路由都有回归。

### 跨设备打印输出（2026-09-11）

正式打印入口使用服务端 PDF，网页模板用于预览。自托管字体与内嵌 PDF 字体共享字节，字体/分页失败关闭；版本固定由 `PDF_CHROMIUM_VERSION` 与发布验收共同约束。后台 PDF 支持持久共享卷及 private OSS，产物可重复读取而非读后删除，仍由路由验证用户/版本。该规则取代此前 PDF 仅单机、读后删除的描述，其他 XLSX/CDR 存储契约不变。单张 PDF 的所有入口（普通下载、失败页重新生成）在同一事务里先取该授权范围的 `pg_advisory_xact_lock`，有在途任务则复用，否则按 15 分钟窗口键或重新生成锚点创建 / 复活，同一授权范围不会同时有两个在途任务（`lib/background-jobs/pdf.ts`）。范围与未验收条件见 [跨设备打印](./docs/跨设备打印与可用性.md)。


### 工单批量 PDF

管理员列表通过 `actions/order-batch-print.ts` 提交有序选择，
`lib/order/batch-print.ts` 校验并创建 `ORDER_BATCH_PDF` HEAVY 任务。
worker 逐单复用生产打印模板，以 pdf-lib 合并页，进度更新遵守任务租约 fencing。
单批最多 50 单、累计输入 PDF 最多 100 MiB；失败不发布部分产物。
产物复用现有私有 PDF 存储及保留期限，下载由任务创建者访问并复核所有工单。

批量打印按账号和内容快照缓存单张 PDF（私有存储、一小时有效），使用前仍读取当前工单并复核权限，合并后及下载前后继续校验。缓存键包含打印模板版本；相对图稿地址转为公开站点绝对地址。

### 计件工价维护边界（2026-09-16）

`EmployeePayRulesPage` 在权限校验后读取计件版本的最小展示数据。
`PieceworkPriceBookForm` 通过 `owner-piecework-rules` Server Action 提交操作；
`piecework-admin-input` 是可供客户端使用的表单元数据与输入 schema；
`piecework-admin` 负责草稿读写，`piecework-price-book-admin` 负责统一版本发布。
数据库、审计和版本计算只在服务端执行。

发布和草稿保存使用同一工价锁；报工取得该锁的共享模式，再确定报工时间并保存取价依据。
旧日薪模块仅提供历史查询与导出，不能重新启用为新计件写入来源。

局部工序的计薪次数由 `production-payroll-pass` Action 授权，
`lib/production/payroll-pass-admin.ts` 复核管理员、当前工序版本与状态，使用与报工一致的订单→工序锁。
工序修订只影响后续报工；报工页携带计薪修订号，工资快照保存实际次数。
账号差异工价仍是待实现规划，不改变当前统一工价的选择范围。

### 账号个人工价（2026-09-17）

管理账号页复用 `PieceworkPriceBookForm`；个人编辑经 `owner-personal-piecework` Action 到 `personal-piecework-admin`，统一编辑仍走原服务。模式与价格复用版本化工价簿，不新增工资账本。
`piecework-rate-selection` 按实际报工人、数据库时间、岗位和单位选择个人或统一价；个人缺价关闭报工，师傅页只显示本人取价结果。工资统计与结算仍以 `reporterId` 及历史金额聚合。
个人发布依次取得账号薪资身份锁、全局工价发布锁；报工沿用订单→工序→幂等→账号身份→工价共享锁，取价与报工写入同事务。草稿修订检查和数据库作用域约束共同防并发覆盖；模式切换保留版本历史。

### 2026-09-17 分档计薪边界

`foil-wage.ts` 承载 Decimal 纯公式；`foil-report-wage.ts` 根据工序来源、个人有效工价和不可变报工历史计算本次金额。同人分次报工用累计金额差防止分次舍入漂移，固定费仅首次正产量领取。专版按去重颜色数，不按面数叠加。局部按计薪过版次数。

`order-wage-review.ts` 是管理员工单提成核定领域入口，按人员／工作日保留原报工并追加金额差额。多人不自动分摊固定费，统一转人工核定；账号工价仍在账号页面设置，工单页面仅核定这张工单的实际提成。

分档烫金结算还要求工序处于 COMPLETED 或 CANCELLED；未结束前固定费仍可能需要在接手师傅之间重新分配，因此不能提前冻结个人日结。判断使用报工关联的已发布工价规则，不依赖可缺失的 JSON 展示快照；旧线性工价与包装不受此限制。跨日冲正分组允许按原负数金额核定，但不可单独改价，可编辑组目标仍必须非负。净额为负的工作日仍不能锁定结算。

### 师傅未结算流水读取（2026-09-17）

工资页的 `WorkerPendingReports` Server Component 调用 `lib/salary/worker-pending-reports.ts`，在只读事务中复核当前账号角色、启用状态和计件岗位，并按本人 `reporterId` 查询无结算项的 `ProductionReport`。原报工、人工调整和冲正共用现有账本；计数和分页使用一致快照，不新增金额计算或历史数据写入。已结算汇总继续复用原工资门户服务。

## 2026-09-20 空白封单价与准入

空白封共享 `blank-price-identity` 规范化文本身份；矩阵、发布投影、目录选项和 `blank-price-admission` 从同一生效规则推导。新空白封不生成 Product，订单事实适配器直接验证纸张及标准规格；非空白路线继续使用既有产品资料。用户端选择键不作为持久 Product 外键。

创建、预览、首次提交与改单新增/身份切换检查当前正价。历史同身份上下文仅由持订单锁的领域读取提供，停售时只替换材料项，缺少已确认材料依据则要求管理员补核；完成的幂等请求仍复用原结果。补核通过独立授权查询与 Action 暴露，师傅 DTO 不含价格。

BOM 在原版本机制内支持纸张＋规格目标；历史产品目标保留，默认分类 Setting 只用于生产用料。菜单与旧组合写路径删除，旧URL仅鉴权分流。具体模型和操作见[数据库](./DATABASE.md#2026-09-20-空白封按单价管理)与[空白封说明](./docs/空白封纸张规格管理-20260913.md)。

### 无计薪进度授权补充（2026-09-21）

无计薪进度的列表、详情及提交在领域层共享 `lib/production/progress-reporter-lane.ts` 的工艺岗位/机型匹配。步骤 craftId 必须属于当前在职 WORKER 对应的有效自产工艺集合；写入在事务内复核。无配置不放行，不依赖前端隐藏或个人推荐熟练项。生产打印仍由独立 print-access 规则控制（用途权限待业务决策，不以进度页授权替代）。

### PDF worker 运行保障（2026-09-30）

HEAVY 心跳与 PDF 能力分开：`lib/pdf/capability.ts` 异步执行真实 Chromium 中文 PDF、嵌入字体与私有产物存储往返探针。初始不可用；成功后每 60 秒重检，失败按 10/20/40/60 秒退避，成功证据 120 秒过期。默认复用同一串行 HEAVY 池，探针不会额外并行启动浏览器。心跳携带可空 `pdfReady`，旧 worker 未上报为未知。失能时在 claim SQL 增加 attempts 之前排除 ORDER_PDF/ORDER_BATCH_PDF，CDR 和表格任务继续执行；运行中故障仍保留原尝试与租约审计，基础设施故障关闭本进程 PDF 能力，探针成功后恢复。HEAVY 启动时启用 `lib/pdf/browser-pool.ts`；一个浏览器串行执行，每任务独立 BrowserContext，无共享 cookie/页面。50 次、5 分钟寿命、60 秒空闲、断连或任务失败会回收；排队受 worker 并发及池上限限制，单次渲染预算 60 秒且从占用浏览器时起算（排队不消耗预算）；停机先排空任务再关闭浏览器。`PDF_BROWSER_REUSE=0` 可回退逐次启动，通用渲染函数不会自行启用池；Web 单张入口的独立池见下节。worker 结构化日志只含内部等待/浏览器准备/渲染耗时、是否复用和 Node RSS，不含订单正文、图片地址或凭证；Node RSS 不代表 Chromium 子进程峰值。模板、金额、权限、版本及任务幂等规则不变。

### 单张 PDF 直接生成（2026-09-30 后续简化）

开发单张入口默认采用 `lib/pdf/direct.ts`；生产由共享 `lib/pdf/mode.mjs` 要求显式 direct 或 queued，queued 必须使用 durable。缺少或非法配置返回 PDF_CONFIGURATION_INVALID。direct 模式，独立于后台任务模式；上一段的 HEAVY 池仍服务队列，Web 使用另一个受限的进程内池。直接路径不持久化任务或产物，避免将 worker、共享存储和状态轮询作为单张下载的必需条件。32 MiB/16 份/五分钟完成缓存，以账号、角色、工单、内容标识及 base URL 为键；四个不同在途请求上限，串行渲染，45 秒整体预算，独立 BrowserContext。字节缓存不替代路由的最终授权及内容复核。完成缓存过期时惰性清理，进程退出全部释放；浏览器 60 秒空闲后回收，取消后的回收完成前不启动下一浏览器。

### PDF 浏览器生命周期边界（2026-09-30 T1）

三处 Chromium 启动统一用 `lib/pdf/launch-options.ts`：关闭 Puppeteer 的 SIGINT/SIGTERM/SIGHUP 接管（其 SIGINT 处理会 `process.exit(130)`，打断 Next 优雅停机与 worker 排空），`protocolTimeout` 等于最长渲染预算 60 秒。池的清理有期限：上下文关闭、浏览器优雅关闭、强杀后确认退出各有上限；超时只对本池启动的 Chromium 进程组发 SIGKILL（已退出的进程不再发信号），确认退出前不启动新浏览器，仍未退出时池返回不可用并在进程真正退出后自动恢复。取消与超时只回收该任务自己使用的浏览器实例；排队中的取消不影响正在运行的任务。Web 收到 SIGINT/SIGTERM 后给在途单张渲染 15 秒宽限，随后中止，使请求在 PM2 `kill_timeout`（30 秒）前返回、进程正常退出并由 Puppeteer 的退出钩子清理 Chromium。实测证据见 [当前验证记录](docs/audits/2026-09-30-pdf-remediation-verification.md)（包含真实 Next + PM2 演练；退出码 130 本身不代表异常）。

并发和缓存上限为每个 Web 进程，不是集群配额；多副本部署需按 Web + HEAVY 进程树评估内存和 CPU。`PDF_ORDER_MODE=queued` 保留回退能力，旧 jobId 和批量打印不迁移、不删除。PDF_BROWSER_REUSE 控制 HEAVY 池；Web 直接模式的受限池随 direct 模式启用，回退整个直接路径使用 PDF_ORDER_MODE。

本次能力变化只新增 `BackgroundWorkerHeartbeat.pdfReady` 可空列，现有业务数据与历史产物不改写。jobs 探针和发布 gate 要求当前版本 HEAVY 的 PDF 能力明确为 true，旧版本心跳不可作为新发布的能力证明；Web ready 不因 PDF 单项失能停止其他页面。direct 图稿加载失败仍可下载带警告的 PDF，但不进入五分钟完成缓存；后续请求重新加载图稿。未知异常使用白名单通用错误，direct 响应 X-Request-Id 与结构化日志关联。

PDF 探测区分运行期读写能力与部署清理验收：OSS 清理失败只记录固定告警码，文件系统清理仍严格失败；CLI `check:pdf` 使用严格清理模式。任务领取规则、pdfReady 心跳和部署健康门禁不变，下载恢复重试仅作用于展示层并有时间上限。
