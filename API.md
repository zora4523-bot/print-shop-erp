---
status: maintained
owner: project-maintainers
last_verified: 2026-08-24
applies_to: repository source at last_verified
---

# API 与 Server Action 契约

本项目不是面向第三方开放的 REST API。页面读取主要由 Server Components 完成，页面写入主要通过 Server Actions；HTTP Route Handlers 只承担认证、健康检查、调度、下载、导出和少量查询。

端点实现以 [`app/api/`](./app/api/) 为事实源。修改方法、认证、参数、状态码或响应形状时，必须同步修改本文件和契约测试。

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
| `GET /api/cdr/bundles/:id` | Capability URL | cuid 风格 bundle id | 就绪后 `302` 到产物；生成中 `409` + `Retry-After`；失效或不存在统一 `404`；OSS 不可用 `503` |
| `GET /api/orders/:id/pdf` | Session + order scope | path `id`；durable 重试可带 query `jobId` | PDF `200`；排队为可自动重试的 HTML `202`；未授权 `401`；不可见 `404` |
| `GET /api/orders/exports/:id` | Permission `order:export:all` | export id | XLSX `200`；生成中 `409`；失败 `410`；不存在或过期 `404` |
| `GET /api/salary/piecework/export` | Permission `salary:view:all` | query `date` 或 `from`/`to`，可选 `workerId` | XLSX `200`；输入错误 `400`；未授权 `401` |

下载响应使用 `private, no-store`；文件名同时提供安全的 ASCII fallback 和 UTF-8 名称（适用的端点）。新增下载接口时保持内容类型、长度、缓存和 `nosniff` 语义。

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

### 工单修改与价格确认

实现见 [`actions/order.ts`](./actions/order.ts)、
[`actions/admin-order-workflow.ts`](./actions/admin-order-workflow.ts) 和
[`lib/order/change-request.ts`](./lib/order/change-request.ts)。

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
