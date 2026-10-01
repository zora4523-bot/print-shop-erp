# Claude 第三轮独立对抗审查

以下为实际 Claude CLI 只读审查原文。评分 9.1/10；这是审查时状态，验收条件的后续验证见 [任务验收记录](2026-10-02-cdr-workbench.md)。

## 结论

**评分：9.1 / 10，无 P0、无 P1。** 第二轮的 1 个 P1 和 5 个 P2 都已修复并有证据，剩下 2 个未在本地验证的 CI 门禁（P2，列为验收条件）和若干 P3。

我只读了代码和日志，没有运行任何命令。9.1 是按代码和本地证据给的；下面两个验收条件任何一个变红，都要先修再交付。

## 前轮问题核对

| 前轮项 | 状态 | 证据 |
| --- | --- | --- |
| P1 专项被通用 durable 收进去 | 已修 | `playwright.durable.config.ts:32` 加了 `testIgnore`；`durable-collection.log` 仍是 5 项 / 3 文件；`package.json:49` 和 `quality.yml:411-412` 已接入 |
| P2-1 删除或替换附件走不到 Stale | 已修 | `bundle.ts:387-389` 有 manifest 时抛 `CdrBundleStaleError`；`bundle.test.ts:631-639` 覆盖删除和非法 manifest；`tests/durable/cdr-workbench.spec.ts:37` 实际改 design id，断言 `attempts: 1, DEAD` |
| P2-2 文件名被 50 字节截断 | 已修 | `zip.ts:292` 文件名用 240 字节，目录仍 50；`zip-streaming.test.ts:127-135` 新旧入口各一条长中文名用例；旧去重用例 `zip.test.ts:200-215` 未改动 |
| P2-3 寄样单堆在待处理 | 已修 | `workbench.ts:55` 默认排除 `SAMPLE_SHIPMENT`，全部范围可见；`Order.purpose` 非空，`not` 不会误排 NULL |
| P2-4 客户端状态机无测试 | 已修 | `client-progress.ts` 纯函数加 8 个用例，组件只调用它 |
| P2-5 证据不完整 | 已补齐 | 见下 |
| P3：进度读 manifest、指纹键序、无用 `role`、schemas 出口、截图路径、注释、测试标题、HANDOFF | 已修 | `history.ts:25` 改 `select`；`workbench.ts:37-40` 显式字段；`schemas.ts:18`；`HANDOFF.md:19` |
| P3：`bundle.ts:265` 日志写死 `CdrZipError`；`bundle.ts:393` 非法 manifest 也报"文件已更新"；import 顺序和超长行 | 未改 | 均为非阻断 |

## 证据状态（按日志实际内容）

- **全量 Vitest**：750 文件、8272 项通过，9 文件 / 142 项跳过（`full-vitest-final.log`）。
- **lint**：0 error，2 条既有警告，文案和令牌 0 违例（`lint-final.log`）。
- **架构**：通过（`architecture-final.log`）。
- **生产构建专项**：`production-cdr.log` 以 exit 1 结束，原因是 globalSetup 缺已发布的测试工价，0 项用例执行。补 `test:e2e:prepare` 后重跑，`production-cdr-final.log` 显示 `next build` 加 1 项通过（36.7 秒）。有效证据是后者。
- **typecheck**：`typecheck-final.log` 只有 typegen 成功一行，没有报错也没有结束标记，单凭它不能证明 `tsc` 已退出。旁证是生产构建里 "Finished TypeScript in 33.8s"。
- **交互回归**：3 项通过（`e2e-final-candidate.log`），但跑的是 Next dev（3112 端口），不是生产构建。

## 验收条件（P2，未验证，可能挡 CI）

1. **`pnpm check:dead-code --check` 和 `pnpm test:backup` 没有证据。**
   - 两者都在 CI static 作业里（`quality.yml:63-71`）。
   - dead-code 门禁对任何新增候选都会失败（`scripts/dead-code-scan.mjs:205-210`），而 `config/dead-code-baseline.json` 没有改动。
   - `client-progress.ts:30` 的 `CDR_POLL_WINDOW_MS` 被导出，但全仓只有本文件使用，可能被判为新增候选。我没看扫描器是否过滤"仅模块内使用"的导出，所以这是风险而非确定失败；改法是去掉 `export`。
   - 交付前本地跑这两条并留日志。

2. **CI 里的 CDR 步骤从未在 CI 上跑过。** 具体风险点：
   - `playwright.cdr.config.ts:16` 整体覆盖 `NODE_OPTIONS`，丢掉了其他构建步骤都带的 `--max-old-space-size=4096`，而这一步会再做一次完整 `next build`。建议拼接而不是覆盖。
   - 它接在通用 durable 套件之后、共用同一个库；若前面留下未完成的 HEAVY 任务，会排在 CDR 任务前面，冲击 30 秒断言。
   - durable 作业 45 分钟上限内多了一次构建。
   - `tests/e2e/cdr-workbench.spec.ts` 在 CI 里跑的是 release 构建，本地证据只有 dev。
   - 验收标准：首个 PR 的 `static`、`durable` 和 `e2e (chromium-*)` 全绿。

## 非阻断（P3）

- **分层倒置**：`lib/cdr/client-progress.ts:1` 从 `actions/foreman-cdr.types` 引类型，是 `lib/` 里唯一一处 lib → actions 的 import。架构门禁放行，但与 CLAUDE.md §3 的方向相反。
- **轮询提示残留**：`CdrWorkbench.tsx:49-54` 的 `pollMessage` 只在终态清空。点"刷新进度"续轮询或发起新包后，旧的"仍在生成 / 读取失败"提示会留在新回执旁边。
- **历史区重新生成无进度**：`BundleHistory`（`CdrWorkbench.tsx:143-157`）在 durable 模式下只提示"已创建新记录"，不轮询也不自动下载，要手动点"刷新记录"。
- **极端 ASCII 路径**：三级目录各 50 字节加文件名 243 字节，纯 ASCII 时可超过 Windows 260 字符上限；中文名不受影响。
- **寄样排除的依据**：DECISIONS 2026-10-02 把"寄样无需排版"写成了决策，但没有业主确认的出处。可逆（全部范围可见）、风险低，建议在交付说明里点明一句。
- **审计文档过时处**：第 27 行目标测试仍是修复前的"9 文件 152 项"；第 53 行"第三轮待回填"；第 61 行"生产构建已通过（`production-cdr.log`）"所指的日志实际以失败结束。
- **测试夹具残留**：`bundle.test.ts:604` 的 submitter 还带 `role: 'SALES'`，实现里已不读。

## 纯样式偏好（不计分）

- `bundle.ts:1-5`、`actions/cdr-workbench.ts:3-12`、`CdrWorkbenchSection.tsx:1-15` 的 import 顺序。
- `workbench.ts`、`CdrWorkbench.tsx`、`history.ts:12` 的 200–450 字符单行，与同目录旧代码的多行风格不一致。
- DECISIONS 条目没有用"决策 / 理由 / 影响 / 相关文档"四行格式。

## 已确认无问题的点

- 旧日期入口对工作台生成的包做"按同条件重新生成"时，日期窗口换算正确（`foreman/cdr/page.tsx:184-187` 对 `end = max + 1ms` 成立）。生成的是无 manifest 的旧契约包，属于你已声明的限制。
- `repository.ts:400` 的首轮 DEAD 只对 `CDR_BUNDLE` 加 `CdrBundleStaleError` 生效，不影响其他任务类型的重试。
- manifest 和源文件 URL 不出服务端：`history.ts`、`listRecentBundles` 的 select 都不含 manifest。
- 两个 action 第一行都是 `requirePermission`；销售重放被拒，E2E 断言了记录数不变。
- 迁移只有加列和一条 GIN 索引，索引名与 schema 一致。
