# 交互方案运行复验（2026-09-28）

基线 `fd2e7191`，分支 `codex/design-removal`。本轮按用户要求启动并调试项目，复验[方案](2026-09-27-interaction-remediation-plan.md) UI-01～UI-07 及之前的两端设计款删除。开始时已跟踪文件及暂存区干净；两份 09-21 first-use 未跟踪文档保留，未纳入提交。

结论：本轮覆盖的方案内流程正常，未发现新的业务功能缺陷。发现并修正仓库 E2E 的跨页读取时序问题；没有更改业务代码、数据库结构或日常库配置。此前全量单测、迁移及 Claude Code Opus 5.5 审查证据见[实施记录](2026-09-27-interaction-remediation-implementation.md)，这些历史结果不计作本轮重跑。

## 运行与覆盖

日常 `http://localhost:3000/login` 返回 HTTP 200，开发服务保留。用户原有建单页未导航或重载。本轮写入使用两个新建、独立迁移及准备夹具的可丢弃库，release 构建通过；自动测试在 3200，独立 Playwright CLI 浏览器在 3201。

| 方案项 | 本轮实际验证 | 结果 |
|---|---|---|
| UI-01 仓库/库位纠错 | 改名、停用、父仓恢复限制、库位恢复、旧页禁止向停用库位写入、库存及采购流水 | 通过；仓库专项额外连续五轮 |
| UI-02 维护入口 | 管理员桌面/移动菜单、BOM/供应商入口、销售和工人越权拒绝；独立浏览器从菜单进入 BOM | 通过 |
| UI-03 跨页续填 | 采购/BOM 新增物料、供应商、分类后的恢复；响应丢失、失败重试、身份切换、复制页冲突、存储异常及无 JS 路径 | 14 项通过 |
| UI-04 面包屑 | 定向导航用例；独立浏览器打开 BOM 新建页，面包屑为“工作台 → 新建用料清单” | 通过 |
| UI-05 外协引导 | 从列表找到发起入口，外协回厂、付款、重试及账目核验，销售拒绝 | 通过 |
| UI-06 工资规则说明 | 规则入口与员工工资页说明一致，独立浏览器从菜单进入 | 通过 |
| UI-07 未来工价取消 | 个人/统一未来版取消、保留后继和草稿、重复请求只记一次、取消后立即纠正并报工、停用员工；六视口明暗主题、axe、触控、焦点 | 通过 |
| 原设计款问题 | 管理员/外部销售整款删除、多规格移除留在当前款、重复删除焦点及报价返回保护；建单两端字段与权限 | 通过 |

此外，在独立浏览器实际发布第 9 版统一测试工价（2039-01-01 08:00 生效），依次验证：

1. 开关开启时，待生效卡片直接显示取消入口并可进入复核。
2. 仅重启本轮 3201 测试进程关闭开关：旧复核表单提交返回“取消调价计划尚未开放，请联系管理员”；刷新后仍为待生效，取消入口不存在。
3. 重新开启后取消成功，显示“调价计划已取消”，焦点回到“第 9 版 已取消”标题；375×852 下无横向溢出，复核内容及按钮可操作，浏览器 console error/warning 均为 0。
4. 单独访问首次失败的物料页，库位选择中已出现“修正仓库-936b33d8 / 库位-936b33d8”。

日常开发环境的 `PIECEWORK_SCHEDULE_CANCEL_ENABLED` 仍维持关闭；未因验证开启该配置。因此日常页面不显示取消入口是当前配置行为，并非本次修复遗漏。

## 首次失败及修正

首次 release 整批为 **35 通过 / 1 失败**。失败在 `warehouse-maintenance.spec.ts` 最后恢复库位后，另一页刷新并断言库位可选。

保留的首次日志 `/tmp/interaction-recheck-e2e.log`；当时 trace 显示（UTC）：

- 恢复 POST 开始 `17:35:28.297`，耗时约 59 ms。
- 物料页 GET 开始 `17:35:28.304`，耗时约 25 ms。

读取早于恢复事务完成，页面随后已显示库位启用和恢复成功。原测试辅助函数只等待确认按钮点击，确认层关闭并不代表 Server Action 完成。现等待对应维护区的反向操作按钮出现且可用，再继续跨页读取；保留所有原有权限、流水、审计及 pageerror 断言，没有加固定等待、强制点击或重试掩盖失败。

另一次准备复跑在 globalSetup 被前置检查拒绝：第一轮已发布纠正工价，旧测试库不再满足初始工价夹具要求，**0 用例执行，不计通过**。随后创建第二个全新隔离库、完成迁移/seed/prepare 后再跑，没有放宽夹具门禁。

## 验证命令与结果

```sh
# 首轮含 next build；最终复跑使用本轮同一 release 构建（业务代码无变化）
E2E_PREBUILT=1 node /tmp/interaction-run.cjs e2e test:release \
  tests/e2e/interaction-discoverability.spec.ts \
  tests/e2e/form-draft-recovery.spec.ts \
  tests/e2e/inventory-flow.spec.ts \
  tests/e2e/purchase-flow.spec.ts \
  tests/e2e/warehouse-maintenance.spec.ts \
  tests/e2e/piecework-cancellation.spec.ts \
  tests/e2e/order-delete-navigation.spec.ts \
  tests/e2e/order-create-ui-parity.spec.ts \
  tests/e2e/outsource-flow.spec.ts

E2E_PREBUILT=1 node /tmp/interaction-run.cjs e2e test:release \
  tests/e2e/warehouse-maintenance.spec.ts --repeat-each=5
pnpm exec eslint tests/e2e/warehouse-maintenance.spec.ts
pnpm typecheck
git diff --check
```

- 最终整批 **36 通过 / 0 失败 / 0 跳过**，约 1.4 分钟。
- 仓库重复专项 **15 通过 / 0 失败 / 0 跳过**，约 24 秒。
- 目标 ESLint、typecheck、diff-check 通过。
- 日志 `/tmp/interaction-recheck-{e2e-final,warehouse-repeat,typecheck}.log`；本机截图及页面证据 `output/playwright/interaction-recheck/`，已人工查看 BOM 桌面及取消复核移动截图。生成物不提交。

只改测试等待及复验文档，因此未重复全量 Vitest/覆盖率、所有浏览器组件与全站路由；本轮不是生产发布验收。测试通知为 mock、后台作业 inline，不能证明真实通知和 durable worker。方案排除的报工冲正 UI、已保存分货删除/合并和草稿放弃没有扩展。

## 清理

本轮独立浏览器已关闭，3200/3201 测试服务停止。确认无连接后删除本轮两库 `erp_e2e_interaction_1790530398631`、`erp_e2e_interaction_1790530649907` 及对应临时连接文件。日常 3000 仍 HTTP 200，未推送或部署。
