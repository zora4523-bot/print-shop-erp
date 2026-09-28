---
status: integration-checks-in-progress
owner: project-maintainers
baseline_commit: 47820c4d
scope: PR 29 合并前验证
---

# PR 29 集成验证记录

用户已授权推送、创建 PR 并合并到 main。开始时 `codex/design-removal` 比 `origin/main` 多 30 个提交、无分叉，跟踪文件及暂存区均干净。保留 `.playwright-cli/` 与两份 2026-09-21 无关审查文档，不纳入提交。本批 PR 包含此前连续任务共 317 个文件及 13 条新增前向迁移；不是单独发布最后的导航提交。

## 草稿测试时钟修复

`lib/form-drafts/__tests__/drafts.test.ts` 在固定的 `now` 写入完成回执，却通过 `completedDraftIdentity` 的默认真实时钟读取。超过草稿有效期后该断言变红；这是本分支早期新增测试的时钟前置问题。此前生产任务记录为其开始前已有失败，不能据此认定 main 已有该失败或忽略整批 PR 门禁。

2026-09-29 在 `47820c4d` 运行 `pnpm exec vitest run lib/form-drafts/__tests__/drafts.test.ts --reporter=verbose`：8 通过、1 失败，失败值为完成回执身份 `null`。修复将存储测试组的时钟固定到 fixture 日期，每条用例后恢复；补充恰好有效期边界和过期 1ms 的身份读取断言。未改变草稿有效期、生产代码、原断言或覆盖率阈值。

同一命令修复后 10 通过、0 失败/跳过；`pnpm exec eslint lib/form-drafts/__tests__/drafts.test.ts` 和 `git diff --check` 通过。此次只提交该测试及本记录。任务边界与原文件备份保存在仓库外 `erp-pr-merge-aq_jc2mu` 临时目录。

## 集成检查边界

[PR #29](https://github.com/zora4523-bot/print-shop-erp/pull/29) 已创建，完整 CI 尚在运行，最终结果以该 PR 对应 HEAD 的 Checks 和合并记录为准。之前各批次的实际局部结果见相关审查记录；尚未完成的检查不得计为通过。合并不会运行线上部署、生产库恢复或真实付款。


## 整批单测与导出边界核对

候选 `f8f4e513` 在独立库 `erp_e2e_remediation_1790605881991` 运行 `pnpm exec vitest run --coverage --maxWorkers=2 --reporter=default --reporter=json`：720 文件通过、3 文件跳过；7,827 用例通过、0 失败、46 跳过。statements 86.17%、branches 80.17%、functions 91.43%、lines 88.55%，全部既有覆盖率门槛通过。日志、JSON 及导出修复前文件备份位于本任务临时目录；未使用普通开发库写入测试数据。

`pnpm check:dead-code --check` 发现 29 条新增候选。按实际消费链核对后，仅收紧模块导出，函数体、SQL、schema、迁移及业务权限不变：

| 模块 / 符号 | 保留的实际用途 / 处理 |
| --- | --- |
| `creation-request.ts` 的 `creationKind` | 请求锁、幂等查询及创建记录在同文件调用；改为内部常量 |
| `creation-status.ts` 的 `draftCreationFacts`、`CreationDifference` | `describeCreationDifferences` 由 `actions/form-drafts.ts` 调用，辅助函数/返回类型仍保留在模块内 |
| `model.ts` 的 `PurchaseDraft`、`storedDraftSchema` | 仍参与 `FormDraftPayload`、`StoredDraft`、`parseStoredDraft` 和空草稿生成；只移除不被跨模块导入的 export |
| `actions/production-dispatch.ts` 的 `ProductionActionState` | 五个真实 Server Action 使用的返回类型；保留类型及所有 action 导出 |
| `status-machine.ts` 的 `ProductionReopenEvidence` | 状态转移函数的证据参数保留；移除单独类型导出 |
| `completion-registration.ts` 的 `CompletionInput`、`lockProductionFactDay` | 登记与核定在同模块使用；跨模块调用的 `lockProductionWageDay` 保持导出和既有锁顺序 |
| `dispatch.ts` / `production-wages.ts` 的输入类型 | `publishProductionDispatch` / `allocateProductionWages` 的输入结构保留；action 仍通过导出的 Zod schema 校验 |
| `fact-guards.ts` 的 `UNRESOLVED_FACT_STATUSES` | 两个真实前置守卫内部引用；守卫及其查询保留 |
| `recovery-projection.ts` 的 `reconcileRecoveredProductionInTx` | `reconcileResolvedHistoryInTx` 内部调用；登记和事实核定消费的外部入口保持 |
| `piecework-cancellation-input.ts` 的两层内部 schema | 仍由 `pieceworkCancellationSchema` 组合，并供 review 类型推导；公开输入 schema 和类型不变 |
| `dispatch-plan.ts` | `DispatchOrder` 只用于同模块函数签名；`dispatchOrderInclude` 仍导出，改用单独 export 列表，保留 `satisfies` 与精确推导，避免旧 TypeScript 扫描器误认 `satisfies`、`Prisma`、`OrderInclude` 为导出 |
| 发货领域与兼容模块 | 领域的 `OrderShippingBlocker` 改为内部返回类型。兼容模块显式保留 main 原有的 `orderShippingAvailability`、`buildShipOrderShipmentInputs`、`OrderShippingAvailabilityInput`，不向旧路径自动扩展新恢复 helper |

已核对对应静态 import、真实 action/page/CLI 调用链、测试引用及 API 文档；这些模块不是注册表或公开 Route Handler，不删除函数实现、配置、数据库结构或历史迁移。兼容模块按原 main 导出面保留，不能因当前仅 contract 测试引用而删除。改为显式导出后 Knip 新识别出两个原有兼容符号，逐项登记 `buildShipOrderShipmentInputs`（既有发货输入映射入口）和 `OrderShippingAvailabilityInput`（既有参数契约）；原 ts-prune 同名记录保留。这两项是有证据的兼容保留，未刷新整份候选清单或调整扫描器忽略规则。

导出修改后，8 个相关测试文件共 147 项通过、0 失败/跳过，覆盖生产登记与恢复 PostgreSQL、数量和状态、请求幂等、发货契约、action 权限以及工价取消并发。命令指定 `dispatch-completion.postgres.test.ts`、`drafts.test.ts`、`creation-request.postgres.test.ts`、`status-machine.test.ts`、`detail-ux-regressions.test.ts`、`OrderDetailShipping.contract.test.ts`、`production-dispatch.test.ts`、`piecework-cancellation.postgres.test.ts`，使用上述独立库和 `--maxWorkers=2`。完整 lint 0 错误、2 条既有 Next 导航警告；不降低断言或超时门槛。

最终 `pnpm check:dead-code --check` 通过（138 个 Knip 分组、553 个 ts-prune 候选、0 个循环依赖），`pnpm typecheck` 与 `git diff --check` 通过。当前候选的 GitHub 打印基线已通过；其余 CI 仍在运行，静态检查失败对应本节已修复的导出候选，最终以追加提交后的 Checks 为准。


## CI 隔离前置与建单跨浏览器回归

首轮远端 Quality（`f8f4e513` 的 PR 合并候选）中，Vitest 7,740 通过、133 跳过；statement 覆盖率 82.98% 未达到原 83% 门槛。新增四个 PostgreSQL 文件共 87 条全部被跳过：unit 作业使用 `erp_e2e_unit`，而确认的 E2E URL 指向 `erp_e2e_ci`，未满足这些写入测试的隔离守卫。不能将此归为业务用例已通过。

修复只调整 unit 作业：fresh 验证后的 E2E 库单独 seed、运行现有 `test:e2e:prepare` 准备正式代码所需的测试目录与已发布工价，Vitest 显式切到确认的 E2E URL。普通 CI 库的审计和完整 fresh 链继续保留，没有移除隔离校验、覆盖率门槛或原有测试。YAML 解析及关键准备/运行命令核对通过；当前配置已同步到 `DEVELOPMENT.md`。

首轮 compat 在四种浏览器中均因 `order-create.spec.ts` 的款式事实定位匹配两处而失败：改版后的摘要和折叠详情均有“工艺”。测试明确核对当前可见摘要，保留工艺、规格、纸张、真实建单/编辑/并发保存与金额历史断言，不使用 `.first()` 隐藏歧义。

重新构建 `.next-release` 后，在独立浏览器库运行 `pnpm exec playwright test --config=playwright.compat.config.ts tests/e2e/order-create.spec.ts --grep 'ADMIN 创建' --workers=1 --max-failures=1`，显式使用受控 3120 端口、fixture 账号与 `E2E_PREBUILT=1`：desktop-chromium、desktop-webkit、ios-webkit、android-chromium 四项全部通过，0 跳过/失败/flaky，全局 errors 为空（55.9 秒）。目标 eslint、`pnpm typecheck`、release build 均通过，未更新任何打印或截图基线。

另外新建空库 `erp_e2e_pr_merge_1790618288701`，完整应用 179 条迁移、seed、执行与 CI 相同的 `test:e2e:prepare`，然后在匹配且已确认的隔离库运行全量 Vitest+coverage：720 文件通过、3 文件跳过；7,827 用例通过、0 失败、46 既有跳过（103.65 秒）。覆盖率 86.21 / 80.21 / 91.47 / 88.59%，全部门槛通过。逐项核对结构化报告确认四组此前遗漏的测试实际通过 20 / 6 / 38 / 23，共 87 项，零失败及跳过。证据为 `fresh-ci-migrate.log`、`fresh-ci-prepare.log`、`fresh-ci-unit.log/json`；迁移后的首个 seed 命令曾因临时日志路径拼写错误未执行，修正路径后才依次完成 seed、prepare 与测试，未跳过前置。
