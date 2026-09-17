# 分档计薪审查修复

## 范围与依据

候选基线：`1428f485`，分支 `codex/memory-after-pr19`；任务开始工作区为空。本次只修复该提交 Grok 审查后独立确认的两项缺陷，不修改已应用迁移、正式数据或已结算工资。

1. 第一位师傅完成一半便领取全部固定费，工序未完成时可提前日结，导致接手后无法重新分配。结算入口现在根据报工关联的已发布分档规则检查工序，未完成／未取消时拒绝冻结。既有人工核定标记仍会阻止结算。
2. 跨上海工作日的冲正形成负金额、不可编辑分组，旧表单及输入 schema 无法提交原额。现在允许携带负数冲正原额，领域仍拒绝修改冲正组／已结算组，以及给可编辑组设置负数。历史流水不变，无差额核定不新增流水。

## 验证方法

- 缺陷回归先红：新增目标断言在旧实现上 3 失败、27 通过（`/tmp/wage-fix-red.log`）；修复后同断言通过。
- 全量测试使用独立数据库 `erp_e2e_foil_20260917`，通过 `/tmp/erp-foil-run.cjs test` 注入隔离连接，执行 `vitest run --maxWorkers=4 --coverage`。不连接正式库。
- 浏览器使用 Chromium、生产构建 `.next-release`、本地 3155 服务及同一隔离库。覆盖分档金额、第一位师傅半单时结算被拒绝、两人各 19 元、不可变流水、跨日冲正原额提交，以及六视口／明暗主题／触控尺寸／overflow／axe。
- 首轮并行构建时，全量测试的 PostgreSQL 探针超时（10 秒），其余 7024 通过、44 跳过；没有放宽超时。顺序复跑记录如下。
- 首轮浏览器已经通过跨日冲正核定，但之后发布工价触发历史保护：模拟的次日报工使旧工价不能提前截止。调整测试顺序，把模拟次日冲正放到所有调价之后；未修改生产保护或跳过断言。

## 限制

净额为负的工作日仍不能锁定结算；允许原额核定冲正不等于支持负净额工资支付。没有发布工价、推送代码或部署生产。

## 检查结果

- 全量 Vitest 顺序复跑：645 文件通过、1 文件跳过；7026 测试通过、44 跳过。覆盖率 statements 85.11%、branches 79.17%、functions 90.83%、lines 87.06%，门禁通过（`/tmp/wage-fix-full-retry.log`）。
- `pnpm typecheck` 通过（`/tmp/wage-fix-final-type.log`）。
- `pnpm lint` 通过，仅两条既有 Next 导航警告；测试末次增量 ESLint 通过（`/tmp/wage-fix-lint.log`、`/tmp/wage-fix-final-eslint.log`）。
- `pnpm check:architecture` 通过：955 模块、3777 依赖、25 项既有超长函数债务（`/tmp/wage-fix-architecture.log`）。
- 生产构建通过；重跑浏览器复用这份未变更的应用构建，仅更新测试夹具顺序及数据库断言。
- Chromium 生产构建 E2E：1 项完整场景通过（33.9 秒，`/tmp/wage-fix-e2e-retry.log`）。运行命令：`node /tmp/erp-foil-run.cjs node_modules/@playwright/test/cli.js test tests/e2e/foil-wage.spec.ts --project=chromium --config=.review/piecework-verified.config.ts`。半单结算探针、后续双人各 19 元及跨日冲正浏览器提交全部实际执行通过。
- `git diff --check` 通过。修改仅涉及结算／核定领域、表单校验、回归测试与配套文档。
