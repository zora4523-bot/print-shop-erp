# 2026-09-18 建单两层标签与包装隔离

## 范围

基于 `e8e0d176`，开始时工作区干净。管理端和外部销售共享 `OrderForm` / `OrderFormB`；本次不改变报价公式、API、Prisma schema、已应用迁移或生产配置。

- 设计款主标签包含工艺、材料、规格子面板与设计文件；数量、包装、当前包装组人工价归规格，设计文件紧随规格面板。
- Tab 使用可访问语义、方向键和 Home/End；字段状态保存在父表单。设计款操作移到主标签旁，规格操作保留在子标签旁。
- 费用按设计款分组、显示规格及数量，点击定位规格；包装人工价错误能切换到对应规格并聚焦。
- 原包装模式处理会重建整单包装组。已提取纯函数并以“第一规格不包装、第二规格保留装盒”回归先得到失败，再修复为仅修改当前组。整单混装是显式操作，混装范围可见；新增规格独立包装，拆分混装保留其他组。
- 收货、交期、工单名称及包装补充说明仍归整单；管理员收费能力和外部销售权限边界保留。

## 验证环境

Node 24.15.0。Vitest 的专用本地数据库为 `erp_release_fix_20260917`；Playwright Release build/start 使用 `erp_e2e_releasefix20260917`、端口 3200、mock 通知与 inline jobs。不会向生产或用户本地开发库写测试数据，也未操作用户浏览器中的未保存草稿。

本地环境包装脚本为 `/tmp/erp-retire-120g-20260917/run-tests.cjs` 和 `run-browser.cjs`；只加载隔离测试配置，日志不含连接凭据。

## 检查记录

- 包装缺陷回归先失败：旧实现把第二规格盒型改成不包装，同时清除组名称、包数。修复后目标边界用例通过，含混装拆分、独立新增、容量与暂时清空输入。
- 初次全量单测与构建/浏览器同时运行，两个既有 PostgreSQL 迁移用例超出 5 秒；停止重负载并发，以 `pnpm test --run --maxWorkers=4` 重跑通过，未提高超时或降低断言。
- 首次 Release E2E 暴露旧 helper 仍查找 navigation/button、旧用例仍查找“款式名”；按已批准的 Tab 和“设计款名称”语义更新。构建期间新增测试 fixture 漏写 `reason` 的类型错误已修正。
- 架构检查发现主表单超长函数增长与仅类型导入构成的循环；拆出规格导航，直接使用领域输入类型，复查通过，没有提高债务上限。

## 最终验证结果

| 检查 | 结果 | 日志 |
|---|---|---|
| `pnpm test --run --maxWorkers=4` | 650 文件通过、1 文件既有跳过；7075 项通过、44 项既有跳过 | `/tmp/erp-tabs-full-units.log` |
| 最后补充的包装边界目标测试 | 9 项通过（含全量后新增的清空数量再切不包装用例） | `/tmp/erp-tabs-packaging.log` |
| 浏览器组件：导航、批量工作区、费用栏、提交复核 | 111 项通过 | `/tmp/erp-tabs-components.log` |
| Release E2E：分组、连续删除、输入稳定、管理员收费、寄样打样、两端一致性 | 30 项通过，无跳过 | `/tmp/erp-tabs-e2e.log` |
| 六视口，两角色，每项覆盖明暗主题 | 12 项通过，无跳过；overflow、touch、键盘、axe 通过 | `/tmp/erp-tabs-visual.log` |
| `pnpm typecheck`、Release 构建 | 通过 | `/tmp/erp-tabs-typecheck.log`、上述 Release 日志 |
| `pnpm lint` | 通过；2 条既有导航警告，UI 文案/令牌无新增违例 | `/tmp/erp-tabs-lint.log` |
| `pnpm check:architecture`、`git diff --check` | 通过，未提高债务上限 | `/tmp/erp-tabs-architecture.log` |

Release 业务命令：`pnpm test:release tests/e2e/order-creation-groups.spec.ts tests/e2e/order-delete-navigation.spec.ts tests/e2e/order-entry-stability.spec.ts tests/e2e/admin-create-pricing.spec.ts tests/e2e/sample-orders.spec.ts tests/e2e/order-create-ui-parity.spec.ts --project=chromium`。

视觉命令：`pnpm test:release tests/visual/admin-responsive.spec.ts --grep 'design and specification tabs'`，添加 `--project=admin-375x667 --project=admin-393x852 --project=admin-768x1024 --project=admin-1024x768 --project=admin-1280x800 --project=admin-1920x1080`。初次独立新视觉文件不在既有 project 收集范围内，返回 No tests found，未计作通过；现已放入正式 `admin-responsive.spec.ts` 门禁入口并实际执行。未改配置、截图基线或降低断言。

目视检查了 375px 管理端、1920px 销售端生成截图，确认两层标签、文件顺序、费用分组布局。截图在 `test-results/release/` 下，仅作本地验证产物，不提交。

Release 日志仍有既有导出目录动态跟踪警告，部分离页动作出现 Next `The destination stream closed early` 服务端日志；本次浏览器行为与数据库断言通过，没有隐藏日志或吞掉 pageerror。未验证或发布生产、真实 OSS 上传和真实企业微信通知。
