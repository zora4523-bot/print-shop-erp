---
status: maintained
owner: project-maintainers
last_verified: 2026-08-26
applies_to: repository source at last_verified
---

# 系统架构

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

定时调度由主机系统 crontab 调用八个受 Bearer secret 保护的端点。调度事实以
[`deploy/crontab.example`](./deploy/crontab.example) 为准，不使用数据库内的 `pg_cron + pg_net` HTTP 调度。

## 认证与授权

- Auth.js Credentials 配置位于 [`lib/auth/config.ts`](./lib/auth/config.ts)。
- 请求层 [`proxy.ts`](./proxy.ts) 负责把未登录页面访问重定向到登录页；它不是业务授权边界。
- 权限字典位于
  [`lib/auth/permissions-dict.ts`](./lib/auth/permissions-dict.ts)。
- Server Actions 使用 `requirePermission`；被 `auth(handler)` 包装的 Route Handler 使用 `requireSessionPermission`。
- 所有者范围、工单范围和师傅任务范围在领域查询中继续收窄，不能因角色通过粗粒度权限就跳过资源级检查。
- 生产打印使用 [`lib/order/print-access.ts`](./lib/order/print-access.ts) 的独立范围，网页正文、标题与同步/后台 PDF 共用。ADMIN 查看全部，CUSTOMER_SERVICE 限本人提交，SALES 拒绝；WORKER 按当前账号固定报工岗位匹配当前版本未取消工序，或访问当前版本公共进度工序，排除 `SUBMITTED`。查询复核账号启用状态与角色，不以旧派工关系授权；后台生成后及下载前再次复核范围与生产版本。
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
`SalesOrderEditor` 不接触通用工单 DTO。客户选项在服务端按当前销售关联工单限定，
客户表尚无独立销售分配字段，不能把无关联客户默认为销售可见。
`lib/agent-monthly-billing/sales-query.ts` 只读取本人的 `AgentMonthlyBill` 及冻结明细，
不复用包含管理员内部关系的月账单详情。旧 Bill 仅保留管理历史归档用途。

销售编辑页的新增地址复用 `add-shipment` 领域事务，与管理员共用分货守恒、自动物流报价、预览令牌及版本校验；销售权限在锁内按工单创建人限制，禁止手工指定费用。`SalesOrderEditGuard` 统一协调编辑页全部表单、页头操作、路由离开与弹窗的未保存内容；通过表单快照和提交状态阻止其他操作刷新覆盖输入。

### 发布验证进程隔离（2026-09-11）

仓库 Playwright 配置在启动服务及 globalSetup 首次连接前预检独立 E2E 数据库和显式库名确认。开发测试、生产构建测试与 durable worker 测试使用独立服务端口和构建产物；禁止复用日常开发服务。测试工价经正式发布服务建立并标明非生产，不能作为正式业务定价。命令与环境规则只在 [开发指南](./DEVELOPMENT.md#测试环境约束) 维护，远端 CI/生产验收证据在 [整改台账](./docs/release-remediation-2026-09-10.md) 跟踪。

六个账单页面位于 `app/(billing)/owner/`，复用原 AdminShellLayout、OwnerLayout 和错误/404 边界；URL 保持不变，独立分组提供原生表单初始 HTML。页面与 HEAVY 导出共享 `lib/order/admin-workspace-filters.ts` 的权限及筛选谓词，worker 不导入带 `server-only` 的页面聚合模块。

Next 16.3 默认会在 Proxy 前规范化并剥离 Flight 标头；`skipProxyUrlNormalize: true` 保留预取标识供认证代理判断。matcher 不跳过预取认证，代理仅阻止预取响应的 Cookie 写回，正常导航的滚动会话不受影响；原始路径下的公共资源、认证及受保护路由都有回归。

### 跨设备打印输出（2026-09-11）

正式打印入口使用服务端 PDF，网页模板用于预览。自托管字体与内嵌 PDF 字体共享字节，字体/分页失败关闭；版本固定由 `PDF_CHROMIUM_VERSION` 与发布验收共同约束。后台 PDF 支持持久共享卷及 private OSS，产物可重复读取而非读后删除，仍由路由验证用户/版本。该规则取代此前 PDF 仅单机、读后删除的描述，其他 XLSX/CDR 存储契约不变。范围与未验收条件见 [跨设备打印](./docs/跨设备打印与可用性.md)。


### 工单批量 PDF

管理员列表通过 `actions/order-batch-print.ts` 提交有序选择，
`lib/order/batch-print.ts` 校验并创建 `ORDER_BATCH_PDF` HEAVY 任务。
worker 逐单复用生产打印模板，以 pdf-lib 合并页，进度更新遵守任务租约 fencing。
单批最多 50 单、累计输入 PDF 最多 100 MiB；失败不发布部分产物。
产物复用现有私有 PDF 存储及保留期限，下载由任务创建者访问并复核所有工单。

批量打印按账号和内容快照缓存单张 PDF（私有存储、一小时有效），使用前仍读取当前工单并复核权限，合并后及下载前后继续校验。缓存键包含打印模板版本；相对图稿地址转为公开站点绝对地址。
