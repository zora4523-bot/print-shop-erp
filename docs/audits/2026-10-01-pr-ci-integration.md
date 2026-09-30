# 分支整合与 PR 验证

用户授权将 `codex/order-leave-recovery` 提交到仓库、创建 PR、运行 CI，并继续修复失败。开始于 `d025c72b`；远端 `main` 为 `038655d1`。分支有 38 个未合入提交，主分支有 7 个独有提交。起始无已跟踪文件改动，既有 `.playwright-cli/` 不纳入。

## 主分支整合

- 使用 merge 保留双方提交历史。费用编辑组件保留主分支的容器响应式布局、嵌入模式及响应丢失后的禁止重复提交；同时保留本分支的可选制版空态隐藏、历史记录和具体动作名称。
- 费用布局测试继续覆盖六视口、双主题、独立与嵌入模式。长名称夹具使用可编辑款式，避免空态隐藏后失去长文本覆盖。
- 费用请求恢复测试按实际“移除对客费用 / 移除制版明细”按钮定位，保留确认前零请求、输入保留、失败锁定和成功提示替换断言。
- 清除 PR 差异中的三处行尾空格和一处文件尾空行，不改变业务逻辑。

## 本地整合检查

- `pnpm exec vitest run --config vitest.config.ts`，限定 `OrderCommercialDetailsManager.empty`、`OrderChangeRequestForm.business-language`、`AdminRouteStates` 和 `change-request`：4 文件、248 项通过。
- 浏览器组件限定 `PlateDetailEditor`、`CommercialFeeRecovery`、`AdminOrderEditor`、`OrderChangeForms`、`AdminRouteRecovery`：137 项通过，3 项旧确认按钮断言失败；修正后 `CommercialFeeRecovery` 20 项全部通过，5 文件共 140 项最终通过。
- `pnpm typecheck` 和 `pnpm lint` 通过；保留两处既有 `location.assign` 警告，文案/令牌门禁无新增违例。
- `pnpm check:dead-code --check` 发现候选清单与实际消费方存在差异，作为后续独立 CI 修复处理；不刷新整个清单或删除未知消费方。

证据保存在本机 `/tmp/erp-pr-ci-1001/`，不纳入仓库。PR 包含之前完成的 UI、离开保护、PDF 和销售月账单任务，以及两个仅新增可空列的前向迁移；未执行生产迁移或部署。远端 CI 的候选 SHA、运行链接与最终结果记录在 PR 的检查和验证表中；此文不将待运行的检查写为通过。
