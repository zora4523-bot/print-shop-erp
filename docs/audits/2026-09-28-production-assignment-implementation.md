---
status: implemented-and-verified
date: 2026-09-28
baseline: c05dbee104f65bcabc729c45e2d258969e9bb2b2
branch: codex/design-removal
---

# 单负责人排单与完工提成执行记录

本次实现 [已确认方案](2026-09-28-production-assignment-plan.md)。验证对象为上述基线加本任务工作区增量；最终本地提交以 Git 历史中的 `feat(production): 实现单负责人排单与完工提成闭环` 为准。本次不包含两份既有的 2026-09-21 首次使用审计文档，不包含生产发布或新的 Claude Code 审查。

## 实现及验收对应

| 任务 | 已实现内容 | 回归证据 |
| --- | --- | --- |
| T1 排单归属 | 多选 1–20 单、最多 100 任务，合格师傅单一归属；原归属保留；本机草稿、核对发布；事务下发、重放及变更后重印 | PostgreSQL 整批回滚/重放/越权/重印；页面原师傅岗位调整与停用回归；真实浏览器保存恢复草稿及发布 |
| T2 完成与审批 | 默认任务量；改数量先申请，管理员按申请批准或驳回；补登无人员选择，沿用原归属和实际日期 | 本人/补登并发只计一次；非归属禁止；申请不计薪；批准数量不可篡改；停用账号补登；浏览器实际提交 |
| T3 状态与发货 | 必需生产完成即待打包发货，打包无登记闸口；两个发货写入口共用权威规则；销售读同一状态和授权物流 | 包装 PENDING 时真实发货写入及重放；销售页面状态、内部提成隔离；原有发货/权限测试 |
| T4 真实生产提成 | 正常计件及历史快照；改版新增任务人工待补价；逐款承接；已发货另建关联重做；协作最终金额差额流水 | 1000+300 保留旧工资；文字/设计改版；新增/移除款式及仅一款变更；单人异常量和多款不可识别量；待价可发货但不能漏结；人工参与人独立结算 |
| T5 历史和数据库 | 前向迁移、新旧写入口互斥；误登记受控更正；工资/成本/明细/导出接入；旧打印兼容 | 175 项 fresh 迁移；开发库前后检查；SQL 历史/流水/投影/结算保护；更正重登；旧打印像素回归 |

生产数量、生产归属、操作者和工资受益人分别记录。没有多人生产拆量，没有虚构旧报告，没有因改版清除已挣得提成。外协、核价、暂停、取消、版本和财务限制继续执行。原工序计薪次数入口保留，用于正常计件工价计算。

## 验证环境与命令

Node 24、项目已安装的 Next 16.3.4 / Prisma 7.7 / PostgreSQL 16。版本相关行为按本地 `node_modules/next/dist/docs/` 核对。写入测试使用专用 `erp_e2e_dispatch_20260928`，显式设置匹配的 `E2E_DATABASE_URL` 和 `E2E_DATABASE_CONFIRM_DATABASE`，并准备目录、账号和已发布工价。凭据不进入本记录。

本机会话编排器位于 `/tmp/erp-production-implementation/run-isolated.cjs`，仅在确认数据库主机是本机后为子进程注入隔离 URL。下列 `exec` 表示该编排器激活隔离库后执行，E2E 则保留普通 DATABASE_URL 给仓库的隔离校验器核对，测试服务器使用隔离库。

- `exec pnpm exec vitest run --maxWorkers=1`：全量串行复验，最终数量见下方结果。没有降低超时、断言或覆盖率配置。
- `exec pnpm exec vitest run lib/production/__tests__/dispatch-completion.postgres.test.ts actions/__tests__/production-dispatch.test.ts lib/production/__tests__/revision-production-quantities.test.ts --maxWorkers=1`：生产写入、权限和版本边界定向复验。
- `pnpm typecheck`、`pnpm lint`、`pnpm check:architecture`、`git diff --check`。
- `pnpm test:e2e tests/visual/production-dispatch.spec.ts`：仅该新流程文件，六个管理视口项目内部另建相同尺寸师傅上下文；375、393、768、1024、1280、1920 宽，明暗主题、overflow/touch/axe，真实表单提交。状态切换、工资核定、L3 弹窗关闭及外部销售隐私均包含断言。
- `pnpm test:e2e tests/visual/order-print.spec.ts --project=chromium --max-failures=1`：32 项打印回归全部通过，未更新任何旧像素基线。新增流程另验证纸单显示归属和简化状态。
- `node scripts/verify-fresh-migrations.mjs`：使用独立空库 `erp_e2e_dispatch_fresh_1790592385668`，完整 175 项前向迁移及既有加工费后置检查通过。
- 开发库执行 `prisma migrate deploy`，仅应用本次 4 项前向迁移。迁移前后工单 1、物流 1、旧报工/旧任务/工资结算各 0 条；所选历史字段校验和一致。没有重置开发库。

## 结果和证据

- 全量 Vitest：717 个文件通过、3 个文件跳过；7,778 项通过、46 项跳过，0 失败（`unit-delivery.log`）。跳过项未计入验收通过；本次新增生产、权限、归属页面和承接测试全部执行。
- 原归属与新增逐款承接定向复验：2 个文件、9 项通过（`final-ui-carryover.log`）。
- 类型检查通过；完整 lint 为 0 错误、2 条既有 Next 导航警告，UI 文案/令牌检查均 0 新违例。
- 架构检查通过（1065 模块、4279 内部依赖、24 项既有长函数债务，无新增豁免）。
- 六视口浏览器最终复验 6/6 通过、0 跳过/失败（`e2e-delivery.log`，2.5 分钟）；含师傅任务列表和新流程打印归属断言。旧打印像素 32/32 通过。
- 文档本地链接无缺失；差异空白检查通过。
- 普通开发服务器恢复于 `http://localhost:3000`：登录页 HTTP 200，未登录工单页 HTTP 307（授权跳转）。

会话证据目录：`/tmp/erp-production-implementation/`。文件包括 `unit-delivery.log`、`last-domain.log`、`types-delivery.log`、`lint-delivery.log`、`architecture-delivery.log`、`e2e-matrix.log`、`e2e-delivery.log`、`print-verified.log`、`fresh-final.log`、`development-migration-check.json`。临时日志不随提交永久保存，关键结果保留于本记录。

新 UI 截图候选位于 `test-results/production-dispatch-ui-baseline-candidates/`，未替换既有截图基线。已人工查看手机宽度的师傅完成页与管理员排单核对页；自动视觉门禁只证明相应几何及可访问性约束。

## 处理过的失败与验证边界

- 浏览器发现 Base UI 按钮默认不提交表单，已显式补齐 submit 类型并通过真实动作验收；审批后详情保持展开。
- 最终逐款承接测试复现了整组变化会丢掉未变款式承接的问题，修复后独立定向与冻结代码全量串行通过；修改过程中那轮测试不作为最终候选证据（`unit-before-final-carryover.log`）。
- 全量并发运行两次遇库存价格锁测试的 1 秒墙钟期限超时；相同用例定向和全量串行通过。没有修改库存实现或扩大其测试期限。
- 初期隔离库命名不符合仓库防误写校验，换为合规的专用可丢弃库后验证；生成 Prisma 客户端时与测试导入竞争的一次失败改为顺序执行。两者不计入业务通过结果。
- 新状态文案最初影响旧打印像素；按历史兼容边界恢复旧模式纸单文案后，32 项原基线通过。
- 架构门禁发现工序物化主函数超过 300 行，抽取原寄样分支后复验，不增加架构豁免。
- 旧单已有实际报工不自动转换或猜负责人；新流程由发布排单明确启用。历史多款合计异常但无法识别每款实际数量时，保守不自动承接，需管理员核对本次实际新增量，避免提前标完成。
- 浏览器未触发 pageerror，但开发服务器在提成刷新后记录一次 AdminOrderDetailView 子节点 key 警告；前一轮矩阵也有该提示，尚未确定来源，保留为后续渲染告警排查项，不宣称控制台零警告。
- E2E 使用 next dev、mock 通知/CDR 和 inline jobs。本任务未执行生产 build、真实通知、durable worker、目标环境 smoke、依赖安全审计或发布候选覆盖率命令；它们属于发布门禁，本记录不代表生产已发布。
