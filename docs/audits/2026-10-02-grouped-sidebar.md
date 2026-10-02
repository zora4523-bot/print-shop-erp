# 后台侧栏分组调整验收（2026-10-02）

## 候选与范围

- 起点：`e47f59e8b8abf34d7febe167423af33b72990a88`，工作树 `/Users/zhixing/.codex/worktrees/e776/print-shop-erp`；任务开始时工作区、暂存区均为空。
- 候选为上述 SHA 加本次侧栏、模块目录、同源标题、测试及文档增量。任务提交主题为 `fix(navigation): 优化后台侧栏分组与规则目录`，最终 SHA 以 Git 日志为准。
- 用户要求：针对侧栏优化「执行修复任务，确保符合规范」。实现按 [UI 规范](../ui-规范.md) §7、§8 与 [后台导航契约](../../UI-SYSTEM.md#后台导航) 校验。
- 环境：Node 24.15.0、冻结锁文件安装；Next 16.3.6 的本地 Link、usePathname、useSearchParams、generateMetadata 文档已核对。未改变依赖、构建配置、数据库结构或迁移。

## 实现与消费链核对

- 常用区固定管理工作台、销售工作台、工单列表、经营概览；「新建工单」独立置顶。生产与采购、财务结算、基础资料、系统管理按需展开，兼容旧偏好键；进入组内页面自动展开，当前页允许手动收起，图标模式保留所有授权入口。
- `getAdminMenuItems` 仍以现有权限字典过滤完整菜单，管理员 37 项（含规则子项）。`getAdminSidebarGroups` 仅投影全局侧栏为 26 个入口；销售仍为 5 项，师傅没有后台菜单。规则 11 个子项的数据、权限和查询参数匹配全部保留。
- 移除的旧侧栏嵌套渲染器是 `AppSidebar` 内部实现，调用链由全局投影与 `RuleCenterNavigation` 接替。规则布局取得当前用户的授权目录；总览复用原分类卡片，子页展示原生 details/summary 目录。`(admin-forms)` 的规则布局重新导出同一布局，继续继承后台授权与外壳。
- `RuleCenterWorkspaceBar`、版本发布与业务命令未改。价格编辑器的 `PriceWorkspaceNavigationGuard` 在 document capture 阶段拦截站内链接，新目录仍经过该链路；没有移除离开保护。
- 两个工作台移除重复的通用建单链接，替代入口是共享侧栏置顶操作；报价带入当前款式的操作与工单列表上下文操作保留。管理员首页、工作台的菜单、面包屑、PageHeader 和 title 使用同源命名。
- 删除范围只涉及上述 UI 渲染与旧展示断言；无公开 API、动态注册入口、SQL、Prisma schema、已应用迁移、生产配置或构建脚本删除。
- 同步原 E2E 规则目录定位、管理员首页标题与响应式验收标题，未降低金额、权限或持久化断言。

## 验证结果

日志存于本机 `/tmp/erp-sidebar-task-e776/`；均为本地开发测试，未发布。

| 检查 | 结果与证据 |
|---|---|
| 导航、工作台页面、规则布局等目标 Vitest | 19 文件通过，227 项通过、1 项数据库检查跳过；`targeted2.log` |
| 扩大非 PostgreSQL 单测范围 | 713 文件通过、1 文件跳过；8154 项通过、44 项跳过；`unit3.log` |
| 导航、手机抽屉、销售工作台浏览器组件 | 3 文件、73 项全部通过；`browser2.log` |
| 增加成功截图后重跑导航组件 | 42 项全部通过；`browser3.log` |
| 类型检查 | `pnpm typecheck` 通过；`typecheck3.log` |
| lint、文案及令牌 | `pnpm lint` 通过，0 错误；保留两个无关文件原有 Next 导航警告；`lint3.log` |
| 架构 | `pnpm check:architecture` 通过；`architecture.log` |
| 变更涉及的 E2E/视觉用例收集 | 4 文件、168 项成功收集；`e2e-collection2.log`；仅收集，不计运行通过 |
| 文档与差异 | 新增本地文档链接存在，`git diff --check` 通过 |

浏览器矩阵为 375×667、393×852、768×1024、1024×768、1280×800、1920×1080，管理员与销售各明暗两种主题。检查包含横向溢出、44px 交互区域、axe、键盘展开/收起、焦点返回、权限入口集合、唯一当前项、旧偏好兼容、导航后抽屉关闭和图标模式可达性。直接查看了 1280 浅色与 375 深色组件实屏截图；成功截图在 `components/business/admin/__tests__/__screenshots__/grouped-sidebar-*.png`（忽略的本地产物），这是组件测试外壳，不是生产页面验收。

### 可复现命令与环境边界

命令使用 Node 24.15.0 的 PATH。目标测试：

```sh
pnpm test --run lib/navigation/__tests__ components/business/admin/__tests__ \
  'app/(admin)/__tests__/rule-center-layout.test.tsx' \
  'app/(admin)/__tests__/workbench-page.test.tsx' lib/__tests__/database-session.test.ts
pnpm test:browser components/business/admin/__tests__/AdminShellNavigation.browser.spec.tsx \
  components/business/admin/__tests__/AppSidebarMobileClose.browser.spec.tsx \
  components/business/workbench/__tests__/SalesWorkbench.browser.spec.tsx
```

扩大单测使用明确不可连接的占位地址，满足模块导入的环境变量要求，不连接日常或生产数据库：

```sh
DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/erp_sidebar_unit_test \
  pnpm test --run --maxWorkers=2 --exclude '**/*.postgres.test.ts' \
  -t '^(?!.*applies UTC through a real Prisma adapter)'
```

- 42 个 `*.postgres.test.ts` 文件未执行；未准备本次独立可丢弃测试库。44 项跳过包含原有 legacy 账单用例、需要隔离库的导出快照集成检查，以及明确排除的 1 项真实 Prisma UTC 会话检查；不计通过。
- 初次无 DATABASE_URL 的扩大运行发生导入前置失败并中止。补充占位 URL 后暴露 1 项真实数据库连接失败，另有规则布局断言仍要求旧分类名称；已将后者改为实际目录名称并通过重跑。最终非数据库范围通过，数据库检查保持未验收。
- 第一轮浏览器有 15 项测试定位失败：原生 summary 的角色定位及隐藏链接定位不适用；改为实际元素定位，仍真实执行键盘/点击与可见性断言，未改产品行为、禁用 axe 或增加强制点击。
- E2E 初次收集缺少管理员密码前置；用仅收集的占位密码重新收集成功。未执行登录、数据库写入、完整 Next E2E、生产 build/start 或发布 smoke；当前任务验证结论限于本次 UI 改动，不构成发布放行。
