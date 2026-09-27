# 新建工单自动款名修复

- 日期：2026-09-24；开始 SHA：`37313bad4423adcc3c9e2859c5460abab539d905`。
- 范围：管理员新建工单自动款名、复制款和本地草稿恢复。候选为开始 SHA 加本记录所属提交的增量；工作区已有的账号、考勤、取消工单账单等改动不属于本任务。
- 不变量：手填名称保留；只修正可完整匹配自动命名格式的名称；生产选项和收费规则继续由原流程校验；不重写已创建工单或历史价格。

## 原因与变更

`OrderForm` 的内部建单分支完成选项归一化后，无条件写回旧 `current.name`。初始“局部烫金（通版现货）”名称因此在切换专版后继续存在，复制操作也会带走旧名称，费用栏再直接使用该款名。

新增款名识别函数，依据原材料、克重及规格识别自动名称，再使用最新选项生成名称；复制采用相同的 64 字符截断规则。恢复草稿时允许匹配旧类型标签，纠正仍可识别的自动名称。自由填写的名称或无法识别的材料不作推测覆盖。

## 验证记录

运行模式：Node 24.15.0；Vitest 节点测试及 Chromium 浏览器组件测试。浏览器组件中的报价、上传和创建动作均为 mock，不连接数据库。另在 `next dev` 的真实 `/orders/new` 页面恢复现有本地草稿，执行实际报价查询，没有创建或提交工单。

- 修复前：新增浏览器回归测试实际点击“专版烫金”，款名仍为“局部烫金（通版现货）”；2 项中 1 失败、手填名称保留用例 1 通过。
- 修复后：5 个相关节点测试文件，79 项通过；5 项浏览器回归通过，覆盖类型切换、手填名称、三款复制、旧本地草稿及批量编辑内容恢复。
- 完整 `pnpm lint`、`pnpm typecheck` 及 `git diff --check` 通过。
- 独立验证：从开始 SHA 导出仓库，仅叠加本任务 4 个实现/测试文件，复用已安装依赖及生成的 Prisma 类型，再运行同一组节点与浏览器测试；用于排除其他未提交任务的依赖。
- 真实页面：恢复后 3 款均显示“专版烫金”，2 个复制款保留“副本”；每款 2,000 个、专版报价各 570 元，入袋 200 元、纸箱 11 元，已知合计仍为 1,921 元（不含快递费）。原用户页保持打开，未通过刷新丢弃其内存中的文件选择。

实际命令：

```sh
pnpm test --run components/business/order/__tests__/order-item-name.test.ts components/business/order/__tests__/order-form-local-draft.test.ts components/business/order/__tests__/external-order-b-catalog.test.ts components/business/order/__tests__/OrderForm.pricing-routes.test.tsx components/business/order/__tests__/OrderForm.required.aria.test.tsx
pnpm test:browser components/business/order/__tests__/OrderForm-item-name.browser.spec.tsx
pnpm lint
pnpm typecheck
git diff --check
```

本机日志目录：`/tmp/erp-order-name-20260924/`，包括 `browser-red.log`、`browser-final.log`、`targeted.log`、`isolated-targeted.log`、`isolated-browser.log`、`lint.log`、`typecheck.log`。证据仅覆盖本次表单显示修复；未运行生产构建或数据库写入型 E2E，不作为全项目发布验收。

恢复说明见 [故障排查](../../TROUBLESHOOTING.md#新建工单选了专版烫金款名仍显示局部烫金)。
