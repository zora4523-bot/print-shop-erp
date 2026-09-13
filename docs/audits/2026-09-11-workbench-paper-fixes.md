# 销售工作台纸张边界修复验收

日期：2026-09-11。复核人：Codex。审查起点：`dbbe06a5f3c9eb7ce4952d3869e736db79467b56`。

本记录覆盖 Grok 对抗审查后确认的三个纸张问题及其修复，不替代整套 ERP 的发布验收。历史审查记录保留原时点结论。本文件随修复提交入库，最终提交 SHA 见所在 commit。

## 修复结果

| 确认问题 | 修复与验收行为 |
|---|---|
| 缺货/失效说明未关联禁用纸张控件（P3） | 复用 `DisabledReason`，使用 `aria-describedby` 关联纸张下拉框；改选正常产品后清除旧说明。 |
| 关联纸张有效但缺克重，要求操作已禁用下拉框（既存 P2） | 共用目录缺项判断，字段与报价区说明缺少克重；自动计算和手动计算均保留具体原因，改选正常产品后自动恢复。 |
| 合法 32 字纸名增加克重前缀后被拒绝（既存 P3） | 显示值最多 69 字符；精确核对当前目录，再用建单规范化函数拆分名称和克重，保留订单原有 32 字名称校验并调用正式计价引擎。 |

服务端权限、目录归属、金额 Decimal 计算、价格版本、历史快照与缺价返回 `null` 的行为保持。没有迁移、价格表改写或历史订单更新；不截断纸名、不以估算金额代替待核价。

## 验证方法

工作区存在其他任务的大量未提交改动。验证副本由该起点的 Git archive 加本任务补丁构成，位置 `/tmp/erp-workbench-fix-20260911/snapshot`，依赖及生成物独立复制；未引用其他任务的源代码改动。`API.md` 仅纳入工作台契约新增段落，其余已有改动保留在工作区。

使用 Next.js 16.2.4、Prisma 7.7.0、React 19.2.4、Vitest 4.1.5。数据库由已有私有测试配置注入专用隔离库，不包含连接串。`run.cjs`、`run-production.cjs` 为仓库外验证包装器；以下 `pnpm` 命令均通过包装器在副本运行。

证据目录：`/tmp/erp-workbench-fix-20260911/`。修复前 `action-red.log` 记录长纸名断言失败，`browser-red.log` 记录缺少可访问描述的断言失败；同一断言修复后通过。

## 验证结果

| 检查 | 实际命令/模式 | 结果与证据 |
|---|---|---|
| 全量单测 | `pnpm exec vitest run`，隔离库、默认测试 jobs 模式 | 572 文件、6,006 通过、43 原有跳过；`unit-complete.log`。跳过为已有账单测试，本次未新增 skip。 |
| 工作台浏览器组件 | `pnpm test:browser components/business/workbench/__tests__/SalesWorkbench.browser.spec.tsx` | 34 通过；`browser-accepted.log`。包括六视口、明暗主题、三面板、axe/touch/overflow、键盘、异步返回、手动和自动计算。 |
| 类型 | `pnpm typecheck` | 通过；`typecheck-complete.log`。 |
| lint/文案/令牌 | `pnpm lint` | 通过，文案与令牌零新增违例；`lint-complete.log`。 |
| 架构 | `pnpm check:architecture` | 通过；`architecture-complete.log`。26 项原有超长函数债务。 |
| 生产构建 | `pnpm build` | 成功编译、类型检查和页面生成；`build-complete.log`。 |
| 生产工作台 E2E | `pnpm exec playwright test --config /tmp/erp-workbench-fix-20260911/playwright.production.config.ts tests/e2e/workbench.spec.ts tests/e2e/workbench-paper-boundaries.spec.ts --project chromium` | 10 通过、零失败/跳过（1.1 分钟）；`e2e-production-complete.log`。 |

E2E 使用同一副本的 `pnpm start --port 3122`，`NODE_ENV=production`、`BACKGROUND_JOBS_MODE=durable` 和专用隔离数据库；未启动开发服务器或重复全局 seed。通知仍采用测试配置，未启动 durable worker 消费进程。开发模式的新增边界用例也独立通过（`e2e-accepted.log`）。

生产目录遍历：3 条路线、13 个路线规格、34 个产品、124 个产品纸张选项、48 次工艺计算。结果包含 15 次明确待核价和 0 次缺克重提示，不能解释为全部组合均已有完整价格；详见 `e2e-production-results/*/catalog-selection-audit.json`。

## 测试前置与失败归因

新增 `tests/e2e/workbench-paper-boundaries.spec.ts` 使用现有隔离保护，未显式启用独立 E2E 数据库时在连接前报错。需要已有登录用户、专版烫金类别及正常纸张现价。它为本次运行生成独立名称/ID 的缺货、缺克重、长名称目录夹具；结束时仅停用自己的产品和材料，保留可能的历史引用。它不创建订单或修改价格、台账。

调试中修正了测试 SQL 参数的 text/citext 类型歧义、把全局 alert 断言限定到报价区域（Next 内置路由播报器也使用 alert），以及重复材料名称导致的目录身份歧义。后者通过唯一夹具名称解决，未放松正式引擎的身份校验。隔离库中一条此前创建的自有冲突夹具经确认无订单引用后改为唯一名称，未改正常材料。

一次 lint 扫描恰逢 Playwright 清理 `test-results`，以 ENOENT 退出；改为不与该清理并发后复验。另一次隔离开发服务首次路由返回 404，归档其构建缓存并冷启动后恢复；未确认更深层根因，不作为产品缺陷已修复的证据。原始失败日志保留，不计为通过。

## 验收范围与限制

- 可访问描述通过真实浏览器 DOM 和 axe 验证，没有执行 VoiceOver/NVDA 人工朗读验收。
- 克重和价格缺项仍需管理员维护真实资料；明确待核价属于有效业务结果。规范化后的纸名超过订单 32 字限制时给出人工核价提示，未扩展订单契约。
- 本次未发布、未推送，也未验收真实通知、durable worker 消费、PDF 打印或整套 ERP 的生产环境。生产构建下的工作台测试不能替代完整发布门禁。
