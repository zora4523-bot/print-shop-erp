# 账号分组保持展开

起始 SHA：190e730；本任务仅调整侧栏账号分组的折叠能力。
菜单元数据将账号标记为不可折叠，侧栏呈现静态标题并忽略旧的账号折叠偏好。
用户管理权限、选中高亮及其他分组保留原行为。

验证（组件 mock，无数据库写入）：
- `pnpm test:browser components/business/admin/__tests__/AdminShellNavigation.browser.spec.tsx`：30 通过；六视口、明暗主题、触控、overflow、axe、键盘，以及旧账号折叠偏好回归。
- 首轮新增测试误匹配面包屑与侧栏两个同名链接，限定后台主导航后通过。
- `pnpm test --run lib/navigation/__tests__/admin-menu.test.ts`：17 通过。
- `pnpm typecheck` 通过；`pnpm lint` 无错误、两处既有导航警告，文案/令牌通过。
- 实际页面侧栏已显示静态“账号”及“用户管理”链接。
- 日志：`/tmp/account-nav-{browser,unit,type,lint}.log`。
- 不更新截图基线；原有未跟踪截图目录及本轮测试失败截图不纳入提交。
