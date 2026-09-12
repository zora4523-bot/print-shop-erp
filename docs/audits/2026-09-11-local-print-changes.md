# 本地打印修改提交记录

用户在 PR #16 合并后明确要求“本地的修改一并提交 后合并到主分支”。本次将此前保留的打印源码、权限逻辑、配套测试与 API/架构/UI 文档一并纳入，不再作为另一个未提交批次保留。

## 改动及审查

- 普通长名称在页眉完整换行；19、50、73、100 字样例保留一页，历史超长名称与多行地址仍完整续页。
- 页眉使用工单状态注册表；待审批标记只读取真实 PENDING 修改申请。移除由旧师傅分配推导的“生产团队待排产”。测试场景名称不再写死“待审批”，不修改现存业务记录。
- 当前工序取自同一生产版本的非取消 `ProductionOperation` / `ProductionProgressStep`，计划数量复用现有道数转换函数；移除打印查询、DTO 与模板的旧 `ProductionTask` 回退。相关消费方为网页打印、HTML/PDF 构建和后台 PDF；无数据库表或历史迁移删除。
- `print-access.ts` 共用于正文和标题，PDF 继续通过同一打印查询执行。查询核对活动账号和当前角色，客服限本人提交，销售拒绝；师傅依据固定岗位或公共进度及当前生产版本获得范围。后台生成后和下载响应前仍复核权限与版本。
- 10 张 `components/**/__screenshots__` 未跟踪图片是浏览器用例失败时自动保存的输出，相关用例没有消费这些文件的截图基线断言。本次保留在本地，不作为源码提交。

## 打印基线

按本次提交整个本地打印修改的授权，同步其必需的 13 张已有 Darwin 基线。第一次运行保留旧基线：20 项通过、13 项像素差异；均为状态、名称、当前工序与对应夹具带来的预期变化。逐张检查实际图，保留旧图/新图/差异图对照，仅复制核对过的实际图；没有调整截图容差、PDF 页数或分页断言。

对照文件为 `/tmp/erp-local-merge-20260911/review/index.html`，旧新文件摘要为该目录上一级的 `baseline-manifest.json`。一页样例和附页样例分别核对，不把长内容的合法附页描述为一页。

## 验证

候选为 `10bb33e` 加本次全部代码、测试和基线；与已合并的 `main`（`3403eef`）源码起点一致。在 `/tmp/erp-local-merge-20260911/snapshot` 独立目录验证，单测与浏览器使用各自已确认的独立测试数据库，没有写日常开发或生产数据。

- `pnpm exec vitest run --maxWorkers=2`：589 文件、6,270 通过、43 个既有 legacy bill 跳过。
- `pnpm exec playwright test --config=playwright.release.config.ts tests/visual/order-print.spec.ts tests/e2e/order-print-access.spec.ts --project=chromium --update-snapshots=none`：production build/start，33/33 通过、零跳过。包含像素、长名称、多地址、A4 物理页数、二维码、自动打印单次触发，以及网页/标题/PDF 角色与版本隔离。
- `pnpm lint`、`pnpm typecheck`、`pnpm check:architecture` 通过；lint 仅 2 条既有 Next.js 跳转警告。架构 842 模块、3235 内部依赖，保留 26 项既有长函数债务。
- `pnpm exec playwright test --config=playwright.durable.config.ts`：独立 production build/start 与实际 worker，3/3 通过；覆盖真实 IO 失败重试、导出授权和有效期、PDF 排队及重复下载。日志为 `durable.log`；CDR 外部服务使用 mock。
- 初次独立目录使用仓库外依赖软链接，Turbopack 拒绝构建；改为完整依赖副本后重新执行验证。替换依赖期间受影响的单测/静态运行均作废，以上只记录副本准备完成后的结果。

日志在 `/tmp/erp-local-merge-20260911/`：`unit.log`、`print.log`、`print-final.log`、`lint.log`、`types.log`、`architecture.log`。本次是代码合并，不是生产部署，也不代表实体打印机或真实 OSS 跨实例验收完成。
