---
status: local-validation-complete
last_verified: 2026-09-30
applies_to: codex/order-leave-recovery
verification_base: 7fc1818f3d41e0011cde302e89f4e3d77b96db42
verification_scope: 本分支相对基线的建单离开保护修复；未合入主分支、未部署
---

# 建单离开保护复审修复记录

依据 [UI 规范 §7、§8.3](../ui-规范.md) 修复本轮 4 个 P1、1 个 P2 和 1 个 P3。起点为 Claude 审查分支的 `7fc1818f`，在独立工作树实施，没有修改原工作树及其未跟踪文件。无数据库、权限、金额计算或服务端命令变更。

## 修复对应关系

| 审查项 | 实现与验证 |
|---|---|
| 隐藏工单、移除及撤销导致未保存文字失去保护 | 可见状态不再决定是否保护；切换、添加、移除前逐单核对保存结果，失败不切换。普通单保留最后成功保存的值，内存恢复不重置该基线；`capture()` 只读取快照。覆盖存储失败阻断、隐藏工单卸载保护、恢复默认值仍未保存。 |
| 打样／寄样品未上报实际编辑状态 | `useSampleWorkbenchDraft` 上报真实地址、要求、款式与用途的未保存状态，并提供返回失败原因的保存函数。两种用途分别覆盖 sessionStorage 写入失败，管理员和销售均经过实际 Next.js 页面验证。 |
| 完成、打开草稿、恢复报价草稿绕过守卫 | 普通单与样品完成后的导航、上传失败后的打开草稿、报价草稿链接均检查整批状态。独立 OrderForm 通过同一 Provider 边界获得确认层和 beforeunload 保护；新标签打开继续遵循 Next Link 的 onNavigate 语义。 |
| 忙碌期间完成或强制离开 | 完成按钮及保存失败后的离开按钮同时禁用，并在处理函数检查忙碌状态。完成回调等待上传、提交和 React transition 结束；覆盖未决上传、未决样品提交与已有失败提示后开始请求。 |
| 部分保存失败的损失描述不实 | 仅失败的工单保留错误原因，实际已保存内容不进入损失清单；后续成功保存会移除过期错误。服务端已创建草稿的文字计为已保存，失败上传仍受保护。 |
| 关闭失败提示丢失焦点 | “留在本页”恢复来源入口焦点；来源已卸载时定位当前可见编辑控件。浏览器组件及端到端测试验证返回链接重新获焦。 |

额外验收发现错误提示底色与 destructive 按钮的半透明底色叠加，浅色对比度为 4.02:1。本提示的按钮使用不透明语义背景承托，不修改共享 Button、不覆盖按钮颜色、不放宽 axe 门禁。六视口双主题验收通过。

## 本地验证

候选为上述基线加本次提交的完整增量。Node 24.15.0、pnpm 10.33.1，Chromium；E2E 使用独立工作树的 Next.js 16.3.4 开发服务器，端口 3137。数据库为独立可丢弃库 `erp_e2e_leave_recovery_20260930`，从已有测试库复制，179 条迁移一致；未连接生产库、未修改日常开发库。

| 检查 | 实际结果 |
|---|---|
| 修复前守卫回归 | `OrderFormLeaveConfirm.browser.spec.tsx`：6 失败、7 通过，保留复现证据 |
| 全量 Vitest | `pnpm test --run --maxWorkers=2`：721 文件通过、7 文件按条件跳过；7,881 用例通过、133 按原有条件跳过 |
| 全量浏览器组件 | `pnpm test:browser --maxWorkers=2`：70 文件、951 用例通过 |
| 补齐普通单收费／上传失败入口后的专项复测 | `OrderCreationLeave.browser.spec.tsx` 与 `OrderFormLeaveConfirm.browser.spec.tsx`：25 用例通过；包含新增 2 个路径用例 |
| 提取完成回调共用逻辑后的专项复测 | 离开保护、工作台和销售样品 4 文件，36 用例通过 |
| 新增实际页面 E2E | `order-leave-recovery.spec.ts`：7 通过；管理员／销售、普通单／打样／寄样品、六视口双主题、触控、axe 和焦点返回 |
| 原建单流程回归 | `order-create-ui-parity.spec.ts --grep 'fee details and leave protection'`：2 通过；明确选择待上传图片后验证离开保护，避免将已保存文字误称为待丢失内容 |
| 类型检查 | `pnpm typecheck` 通过 |
| 架构检查 | `pnpm check:architecture` 通过；保留原函数身份并提取共用逻辑，未放宽存量基线 |
| 差异检查 | `git diff --check` 通过 |
| 完整 lint | ESLint、UI 文案和令牌门禁通过；保留 `global-error.tsx`、`OrderCreatedSuccessView.tsx` 两条已有 Next.js 导航 warning |

本次没有降低测试断言、更新像素基线或启用写入型数据库单测的额外开关。全量单测首次因独立工作树没有 DATABASE_URL 而导入失败，指定隔离测试库后完成复测；浏览器组件一次执行连接中断，独立复测及后续全量执行通过。端到端首次发现的对比度失败保留记录，修复后通过全部 7 项。

验证日志保存在本机 `/tmp/erp-order-leave-recovery/`（`before.log`、`unit-2.log`、`browser-full.log`、`last-paths-3.log`、`e2e-2.log`、`parity.log`、`completion-refactor.log`、`architecture-2.log`、`typecheck-verified-2.log`、`lint-verified.log`）。这些开发态验证不代表生产构建、真实对象存储或通知服务验收。
