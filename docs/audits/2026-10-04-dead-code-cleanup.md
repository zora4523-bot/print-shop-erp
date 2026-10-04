# 2026-10-04 死代码清理：未接入的 UI 模板组件

## 范围与不变量

用户授权执行死代码清理并防止持续积累。起点 `e0d35aa1`，分支 `codex/production-release-f084d34e`，工作区和暂存区干净。
本批清理六个组件模块的未使用模板函数，不改变现有页面结构、文案、交互、权限或业务流程；不删除依赖包、路由、后台任务、SQL、schema、迁移和历史兼容。

这是可验证的低风险批次，不宣称全仓所有候选均已清理。扫描候选不是删除授权，类型、模块内使用和工具误报仍需分类。

## 删除依据

基线扫描的 896 条候选标识与起点基线完全一致（Knip 355、ts-prune 541；同一符号可能被两个工具分别报告）。
核对静态导入与消费者源代码、内部调用、动态加载、配置、脚本和模块副作用；`package.json` 是 private 应用，无组件包 exports，`components.json` registries 为空。
这些函数仅定义 React 包装组件，没有注册或初始化副作用；六个模块仍保留，无删除模块加载入口。

| 模块 | 删除函数 | 当前消费者与保留内容 |
|---|---|---|
| `components/ui/avatar.tsx` | AvatarImage、AvatarBadge、AvatarGroup、AvatarGroupCount | UserMenu 只导入 Avatar／AvatarFallback，账号头像仍保留 |
| `components/ui/breadcrumb.tsx` | BreadcrumbEllipsis | AdminBreadcrumb 使用导航、列表、项、链接、当前页和分隔符，均保留 |
| `components/ui/dropdown-menu.tsx` | DropdownMenuPortal、DropdownMenuSub、DropdownMenuSubTrigger、DropdownMenuSubContent、DropdownMenuCheckboxItem、DropdownMenuShortcut | UserMenu、ThemeToggle、AdminOrderBatchActions 使用的菜单、触发器、内容、组、标签、选项及单选均保留；Content 内部直接使用 Base UI Portal，不能一并删除 |
| `components/ui/sidebar.tsx` | SidebarRail、SidebarGroupAction、SidebarMenuAction、SidebarMenuBadge | 管理 layout、AppSidebar、AdminHeader 使用的 provider、容器、分组、菜单按钮、触发器及 hook 保留；图标注册表消费 Lucide，不动态加载这些组件 |
| `components/ui/table.tsx` | TableFooter、TableCaption | Analytics、账户、销售、采购、物料、BOM、产品等表格使用的 Table／Header／Body／Row／Head／Cell 保留；横向滚动和可访问区域不变 |
| `components/ui/tooltip.tsx` | TooltipProvider | SidebarMenuButton 使用 Tooltip／Trigger／Content，保留其弹层和 Base UI 实现 |

共删除 18 个函数及其导出、随之无用的 React／图标导入。AST 对照确认所有保留函数的源码内容逐字一致。
Knip 配置、Next 配置、构建／部署脚本、依赖锁和数据库文件无需变更；没有给扫描器添加忽略规则。
仅从基线删除这 18 个符号对应的 36 个标识，保留其余候选的原状。

## 保留与待核实

- `changedAdminOrderFields` 被 AdminOrderEditor 保存／离开保护使用；`feeRowAmount` 被费用汇总内部调用；`badgeVariants` 被 Badge 渲染使用；`PRINT_ASSET_TIMEOUT_MS` 被打印准备消费。扫描“未被外部导入”不等于这些实现可以删除，本批保留。
- 其余候选中的类型、兼容重导出、任务错误类、旧工具解析的 `Record/satisfies` 等须分别核实，不能批量删或扩大基线豁免。
- 工单内部 release／物化仍用于自动准备和安排；下载接口与历史任务可能有存量消费方；已应用迁移不编辑、不删除。这些不进入本批清理范围。
- 后续按模块继续采用“候选 → 消费方与副作用证据 → 删除／保留／待确认 → 风险对应验证 → 独立提交”。有历史数据或外部调用依赖时先证明兼容窗口，不能凭扫描无引用处理。

## 验证与失败记录

现有 CSS 测试原来按整个文件出现至少五次触控／焦点样式判断通过，包含本次删除的两个未使用控件；首轮 237 项通过、1 项因此失败。
改为逐一验证仍在使用的 Trigger／Item／RadioItem 的 44px 与焦点样式，保留每个控件的要求，不降低点击区域标准，也不删除失败用例。

最终验证：

- `pnpm typecheck` 通过；测试调整后再次运行通过。
- `pnpm lint` 通过，保留 global-error 与 OrderCreatedSuccessView 两条既有 Next 导航 warning；UI 文案／令牌无新增或失效豁免。调整后的 CSS 测试文件另经 ESLint 通过。
- `pnpm check:architecture` 通过：1,219 个模块、5,018 条内部依赖；24 项既有超长函数债务未扩大。
- `pnpm check:dead-code --check` 通过；896 → 860 条候选，恰好减少本次 36 条，新增 0、失效基线 0、循环依赖 0。初次扫描在后台完成时基线已缩小，因此旧扫描结果对新基线报新增；冻结该报告并与起点基线比较为新增／失效均 0，修改后的完整重扫通过，未据此扩大豁免。
- 目标 Vitest：19 文件、250 项通过，无失败／跳过；范围为 ui、admin 测试、settings client-boundary、dead-code-scan。
- 浏览器：AdminShellNavigation、AppSidebarMobileClose、AccountsTable.touch 共 67 项通过；AdminOrderBatchActions 另 32 项通过，共 99 项，无失败／跳过。验证菜单开关、主题、用户菜单、侧栏焦点、面包屑、表格触控和批量菜单；Shell 自身九视口用例执行，账户表格专项只覆盖其定义的三种宽度，不冒充全站九视口验收。
- `git diff --check` 通过，文档链接检查通过；审查实际变更只含六个组件、一个相关测试、精准缩小的基线与任务文档。

没有运行生产构建、数据库／财务全量回归、远端 CI 或部署；本批无相应领域代码或入口变化。源码变化只有未消费组件的删除，没有用户可见 UI 设计变更；验证现有消费者，不宣称重新完成全站十项设计验收或生产业务验收。
原始运行日志位于开发机 `/tmp/erp-dead-*.log`；不提交生成物或完整扫描产物。
