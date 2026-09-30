# 共享面包屑文字对齐修复

## 范围与根因

基于 `codex/order-leave-recovery` 的 `42bdda27`。开始时仅有无关未跟踪目录 `.playwright-cli/`，保留不处理。本次只调整共享 `AdminBreadcrumb` 的布局、对应回归测试、几何门禁与规范；不改业务数据或导航目标。

后台壳为链接设置 44px 最小点击高度，而父级面包屑的 `block truncate` 覆盖了链接的 flex 布局，导致文字停在点击区顶部。当前页文字仍在行内居中，真实页面约相差 12px。该样式由历史提交 `8f487401` 引入；原浏览器夹具没有 `admin-viewport`，原几何门禁也没有测面包屑文字，因此仅凭容器对齐、无溢出和截图留档无法捕获。

## 修改

- 链接改为 flex 居中，内部文字独立省略；保留 44px 点击区、完整 title、Next Link、href、prefetch=false 和当前页语义。
- 导航浏览器夹具使用真实后台壳，测量文字 Range；覆盖管理员/销售、六标准视口、明暗主题、长父级名称、不可点击分组、单节点和键盘焦点。
- 通用几何门禁检查整条可见面包屑文字中心的最大差，不超过 2px；忽略隐藏、辅助技术专用和 SVG 文字。原控件对齐规则保持不变。
- `UI-SYSTEM.md` 记录上述布局和验证契约。

## 验证

- RED：真实壳中的销售 `/orders/new` 定向用例在修复前测得 12.5px 偏差并失败。几何门禁用例先证明原规则漏掉 12px 错位、不可导航分组错位；复审后新增三节点 0/2/4px 累计偏移用例，先失败再修复。
- `pnpm exec vitest run --config vitest.browser.config.ts components/business/admin/__tests__/AdminShellNavigation.browser.spec.tsx tests/visual/__tests__/ui-gates-geometry.browser.spec.tsx`：首轮 50/50 通过，其中导航 41 项。门禁最后增加累计偏移用例后，定向复验 10/10 通过。六视口明暗主题、44px 控件、无横向溢出、axe 和键盘检查通过。
- `pnpm exec vitest run --config vitest.config.ts components/business/admin/__tests__/AdminBreadcrumb.test.tsx components/business/admin/__tests__/AdminBreadcrumb.routes.test.ts components/business/admin/__tests__/navigation-prefetch.test.ts`：121/121 通过。首次未指定配置的进程未输出结果，结束该次进程后显式指定配置执行成功；未计入通过数。
- `pnpm lint`：0 errors，2 条既有 Next 导航警告；文案及令牌门禁无新增违例。最后门禁增量定向 ESLint 通过。
- `E2E_RELEASE_MODE=1 pnpm typecheck`、隔离测试库上的 `E2E_RELEASE_MODE=1 pnpm build`：通过。
- 在更新后的本地 release 预览 `http://127.0.0.1:3336` 中，用外部销售账号打开 `/orders/new`：父级与当前页文字中心均为 27.25px，链接高 44px；点击父级成功进入 `/orders`，侧栏仍可进入 `/sales/bills`。未提交工单或修改业务数据。截图保存在 `/tmp/erp-breadcrumb-align-1001/breadcrumb-fixed.jpg`。
- 独立只读复审未发现布局、导航或长文本回归；指出的累计偏移门禁漏报已修复。
- Claude Code 已实际重试 `claude --model opus --effort high --permission-mode plan`，返回 weekly limit；未取得 Claude 审查结论，不能记录为 Claude 通过。

原始本地日志在 `/tmp/erp-breadcrumb-align-1001/`。本次是共享导航专项验收，不代表全项目所有 UI 已通过；未部署生产。
