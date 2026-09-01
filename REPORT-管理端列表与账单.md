# REPORT-管理端列表与账单

> 实施日期：2026-09-02
>
> 实施分支：`codex/gogndan`
>
> 计划与真值版本：以 `PLAN-管理端列表与账单.md` 第一行四份 SHA-256 为准；实施后复核未变化。
>
> 状态：业务实现与验证完成；剩余工作为逻辑提交、push、创建 PR、合并 `main` 和主分支浏览器验收。

## 1. 实施范围

本轮按已确认的两波计划完成管理端工单工作台、11 态生命周期、版本化打印、裁决与批量命令、管理通知、代理月账单 v2，以及工单数量报工、扫码认领、异常和停滞检测。真值优先级始终为规则文档、任务文档、HTML demo；demo 只用于布局和交互参考。

旧生命周期值、旧 `Bill/BillItem/BillPayment`、公开入口和历史 migration 均未删除。旧账单继续按原口径只读归档，新账单没有重解释或改写旧财务事实。

## 2. 管理端工单工作台

### 队列、看板与查询

- `/orders` 已实现待办、待打印、生产中、已发货、已结算/取消、全部六个队列。
- 看板提供待确认、待核价、变更申请、已暂停、已逾期、今日待发六个工单信号，以及新账本的待收款信号。
- 队列、信号、搜索、筛选、个人星标、未出账筛选、分页、全集合计与导出共用服务端授权和谓词边界；排序固定为 `createdAt desc, id desc`。
- 当前筛选合计按完整结果集计算，返回工单数、数量和可信费用；待人工定价且无可信金额的订单从金额合计中排除并单列数量。
- 富行一次投影缩略图、版本、客户/销售、状态、交期、费用阶段、当前版打印事实和 FOILING/PACKING 进度，避免逐行 N+1。
- `#wo=<woNo>` 深链抽屉支持直接定位详情和裁决；编辑仍进入独立编辑页。

### 个人操作、批量和导出

- 新增用户×工单唯一的个人星标，不改变默认排序。
- 批量命令支持“下发并创建打印”“创建打印”“标记已打印”“结算”；每单在服务端重新校验权限、revision、工单版本和资格，返回成功或稳定跳过原因，单条失败不掩盖其他结果。
- 订单导出扩展为 `all | filtered | selected`；所选成员以有序持久化清单保存，重试不会重新解释浏览器选择。

## 3. 生命周期、裁决与打印真值

- canonical 生命周期为 `DRAFT → PENDING_FACTORY → CONFIRMED → RELEASED → FOILING → PACKING → SHIPPED → SETTLED`，并包含 `REJECTED`、`ON_HOLD`、`CANCELLED`，合计 11 态；旧 `SUBMITTED/SCHEDULING/IN_PRODUCTION/COMPLETED/FINISHED` 继续兼容读取。
- 工厂确认、枚举驳回、暂停、按原状态恢复、下发和显式结算均通过领域命令、事务校验、revision/CAS 与审计日志执行。
- 工厂确认保留 quoted/current 价表版本和金额差异，并锁定 `confirmedFee`；结算由服务端原子写入 `settledFee`、数据库时间 `settledAt` 和 v2 contract marker。
- 变更申请支持 MODIFY、CANCEL、撤回、批准和拒绝；拒绝理由必填。批准修改会递增独立 `workOrderVersion`、重物化当前生产 generation 并创建重打事实；生产中取消按已产数量裁决结算。
- 打印记录为 append-only 请求/解析 ledger，状态区分 PENDING、PRINTED、SUPERSEDED。当前版二维码携带稳定单号、工单版本和任务；旧版扫码 fail closed，展示整页红色“已作废”提示并指向最新版本。
- 打印 DTO、HTML、PDF job 和 worker 任务只读取当前 `workOrderVersion` 的生产数据；旧 generation 不会泄漏到新工单。

## 4. 代理月账单 v2

- 新入口 `/owner/agent-bills` 按 `settledAt` 的上海日历月、订单创建时锁定的外部销售归属和 `settledFee` 快照生成账单；旧 `/owner/bills` 数据迁移到明确的只读归档入口。
- 每个代理×账期最多一张账单，状态严格为 `DRAFT → CONFIRMED → PAID`。确认后成员和调整项在应用层与数据库 trigger 双重冻结；整单收款由服务端按锁定总额原子记录，不接受客户端任意金额。
- 0 元成员保留审计，0 元账单确认后原子结清。错单采用来源成员约束的不可变 credit，在未来开放 DRAFT 中分配负调整；信用余额不丢失，也不把净负账单强行归零。
- 生成、确认、信用分配和收款使用统一锁序、advisory lock、稳定行锁和幂等键，覆盖重复生成、并发确认、双收款及月界竞争。
- 导出使用独立 durable job、过期清理和下载鉴权。请求时即固化账单、成员、credit allocation 与 receipt 的不可变 snapshot；异步 worker 不重新读取可能变化的 live bill，下载前重新校验创建者身份。

## 5. 管理通知

- 五类固定事件及角色路由已落地：新单、修改/取消申请发送工厂确认角色；报工异常、生产停滞、待确认积压发送老板角色。
- SystemSetting 只控制两个固定角色的开关和真实 channel ID，不能把事件任意改派给其他角色。
- 所有管理通知 payload 和模板禁止金额；深链统一指向 `/orders#wo=<woNo>`。
- 通知继续使用 transactional outbox、durable LIGHT job、稳定去重键、投递日志和重试；通知失败不回滚工单或报工事务。
- 管理路由配置缺失、关闭、空渠道或无有效活动渠道时 fail closed，并持久化 FAILED 投递 ledger/outcome，避免静默丢失。

## 6. W2 报工、异常和版本隔离

- 新增 append-only `ProductionWorkOrderProgress`，以工单件数表达 FOILING/PACKING 进度，与原计薪单位解耦；两道工序分别以当前工单版本的订单数量为硬上限。
- 新增 append-only `ProductionScanClaim`；只有下发后的有效新工序扫码可以创建当前工单版本的首次认领事实。
- 显式扫码 claim 和报工写入都使用稳定幂等键；重复请求复用原事实，不会绕过唯一约束产生双记。
- `packingProgress > foilingProgress` 为实时提示；进度超过订单数量为硬异常。生产停滞按当前版本 `scheduledAt`/认领事实扫描，默认阈值沿用计划的 2 天配置。
- 修改批准后的生产重物化只激活新 generation，并将 `scheduledAt` 重置为该 generation 的激活时间，防止沿用旧版本下发时间立即误报停滞。
- worker 列表、详情、count 和分页 SQL 使用同一“当前 generation”谓词；旧二维码同时校验版本、工序 lane 和任务授权。

## 7. 数据库迁移

本轮新增 9 个 additive migrations，fresh chain 已验证 `132/132`：

1. `20260902120000_admin_order_workflow_billing_foundations`：生命周期、结算、工单版本、裁决、星标、打印和 v2 月账本基础。
2. `20260902120100_order_settlement_candidate_index`：结算候选索引。
3. `20260902120200_production_work_order_progress_and_scan_claim`：工单数量进度与扫码认领 ledger。
4. `20260902120300_production_stagnation_candidate_index`：停滞扫描候选索引。
5. `20260902120400_agent_monthly_bill_exports`：月账单异步导出。
6. `20260902120500_order_print_job_superseded_resolution`：打印请求的 append-only 作废解析。
7. `20260902120600_production_work_order_version_isolation`：生产 generation 与工单版本隔离。
8. `20260902120700_management_notification_routing_setting`：类型化管理通知路由设置。
9. `20260902120800_agent_monthly_bill_export_request_snapshots`：导出请求时不可变快照。

迁移保留所有 legacy enum 值、表和历史 migration；既有表的扩展为 nullable/default/条件约束与独立索引，没有用迁移执行时间伪造历史 `settledAt`。

## 8. 安全与并发复核补强

实施后的专项审查已关闭以下高风险窗口：

- 月账单导出由“worker 执行时再读”改为“请求事务内固化不可变 manifest”，并在下载前重新鉴权。
- 月账单确认的数据库冻结 trigger 以稳定 order ID 顺序锁定成员订单，减少并发确认/结算的死锁与逃逸窗口。
- 打印确认和显式扫码认领补齐幂等键唯一冲突后的原请求复用，关闭并发重复请求孔洞。
- 固定管理通知路由异常时持久化失败结果，不再把无渠道当作成功吞掉。
- 打印、PDF、worker portal、二维码和生产聚合全部限制为当前工单版本；旧版默认拒绝继续报工。
- 生产重物化重置当前 generation 的停滞时钟，避免旧版本时间污染新版本告警。

## 9. 验证结果

| 门禁 | 当前结果 |
|---|---|
| 四份真值文档 SHA-256 | 通过，实施前后未变化 |
| Prisma format / validate / generate | 通过 |
| 独立空库 fresh migrations + seed | 通过，`132/132` migrations |
| `check:architecture` | 通过；704 modules、2,612 dependencies、32 个既有 long-function debt |
| lint | 通过 |
| typecheck | 通过 |
| `check:dead-code` | 通过；118 knip issue groups、656 ts-prune candidates、0 cycles |
| 完整 Node Vitest | 通过；490 files、4,509 passed、43 skipped，共 4,552 tests |
| 独立迁移数据库完整 Vitest | 通过；同为 490 files、4,509 passed、43 skipped，共 4,552 tests |
| Vitest browser | 通过；2 files、2 tests |
| production build | 通过；Next.js 16.2.4，59 static pages |
| Playwright 全量 | 第二次完整运行（定位器修复前）为 98 passed、6 failed、12 skipped，共 116 项；4 项移动端定位器竞争修复后定向重复验证 12/12 通过，剩余 2 项匹配既有基线 |

最终可接受的完整 Playwright 失败仅有两条已存档的既有基线签名：`tests/e2e/notification-cron.spec.ts:137` 固定期待“已逾期：5 天”，2026-09-02 实际为“已逾期：6 天”；`[worker-1024x768] tests/visual/worker-responsive.spec.ts:41` 偶发在主题切换过渡帧采样到低对比度。前者记录于 `docs/audits/2026-09-02-admin-order-list-billing-baseline.md`，后者记录于 `docs/audits/2026-08-28-print-shop-erp-baseline.md:53` 和 `AUDIT-报告.md:48,267`。本任务没有触及 worker salary、全局主题或对应 fixture，也没有通过放宽断言掩盖失败。

第二次完整运行中的另外 4 项失败均为移动端测试定位器在 RSC 导航稳定前继续操作的竞争。修复后对 375×667、393×852 的亮/暗主题执行 `--repeat-each=3`，12/12 通过（5.7 分钟）。验证工作据此完成；任何不属于上述两条既有基线签名的后续失败仍阻止合并。

## 10. 发布收口

业务实现与验证完成后，发布流程按以下顺序收口：

1. 按 schema/domain/UI/tests/docs/operations 的逻辑边界拆分 commit；架构 debt 清理保持独立 commit。
2. push `codex/gogndan`，创建 PR，待远端门禁通过后合并 `main`。
3. 保留现有 stash，不 pop、不 drop；本地 `main` 仅做安全 fast-forward。
4. 对本地开发库执行非破坏性 `prisma migrate deploy`，在 `main` 启动 3000 端口并完成浏览器验收。
