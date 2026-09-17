# 个人工价取消手填调价依据

基线 `62d86e9b`，任务开始工作区为空。用户明确要求移除账号个人工价的“调价依据”。

- 个人表单和版本展示不再显示该项；统一工价仍沿用原要求。
- 个人保存 Action 接受省略该字段，领域 schema 同步为可选；省略不会清空已有依据。
- 发布时保留已有来源，缺省则自动记为“管理员账号工价设置”，并纳入版本摘要。没有伪造人工说明，也没有修改历史版本或数据库约束。
- 调整说明、权限、账号归属、工价精度、版本检查、生效时间和发布审计均保留。
- 未替用户保存或发布实际账号工价；所有写入验收使用独立库 `erp_e2e_foil_20260917`。

验证先红：无依据保存／发布两个断言在原实现失败，20 项原测试通过（`/tmp/personal-source-red.log`）；实现后目标 22 项通过（`/tmp/personal-source-green.log`），另补历史来源保留和说明必填断言。

完整检查的首轮有 7024 通过、4 项扫描／数据库探针超时、44 跳过；第二轮原 4 项均通过，结果 7028 通过、1 项全仓 SQL 扫描超时、44 跳过。所有失败均保留原超时阈值，未删断言或放宽门禁。日志：`/tmp/personal-source-full.log`、`/tmp/personal-source-full-final.log`。这些运行不能记为全量全绿或当前覆盖率通过。

类型检查曾发现装版费辅助函数的输入类型不必要地要求来源字段，已收窄为实际消费的四个费用字段。首轮并行 lint／构建在本机资源竞争时主动中止，随后顺序重新验证。

最终结果：

- 第二轮唯一超时项 `raw-sql-settlement-contract.test.ts` 单独原样复跑通过，测试耗时 850ms（`/tmp/personal-source-scan-retry.log`）。与第二轮合并覆盖 7029 项通过、44 项既有跳过；不宣称某一轮全量全绿，当前覆盖率报告因超时未完成。
- `pnpm lint` 通过，零错误、两条原有 Next 导航警告；UI 文案／令牌检查通过（`/tmp/personal-source-lint-final.log`）。
- `pnpm typecheck` 通过（`/tmp/personal-source-type-final.log`）。
- 生产构建和 Chromium E2E 两项完整场景通过，运行 `node /tmp/erp-foil-run.cjs node_modules/@playwright/test/cli.js test tests/e2e/personal-piecework.spec.ts tests/e2e/foil-wage.spec.ts --project=chromium --config=playwright.release.config.ts`，耗时 2.5 分钟（`/tmp/personal-source-e2e-final.log`）。覆盖无依据保存与发布、账号个人价／未来生效／统一价切换、历史与权限保护、分档工资及核定；六视口明暗主题／overflow／touch／axe 均执行。
- 当前用户浏览器只读检查确认字段已经消失，原草稿金额和发布确认仍在；未替用户发布。
- `git diff --check` 通过。没有数据库迁移或生产数据修改。
