# CDR 侧栏重复入口移除验收

- 日期：2026-10-03；开始 SHA：ac5489c55a250c6127cf2d85376d7165ab8a54cc；开始工作区干净。
- 范围：按用户标注移除管理员侧栏「CDR 汇总」；候选为本记录所在提交。只修改模块的 menuRoles，保留注册元数据供面包屑使用。
- 功能对照：原侧栏入口移除；管理工作台 CdrWorkbenchSection 的「CDR 下载 → 按日期汇总」保留，仍到 /foreman/cdr。页面、字段、默认筛选、下载操作、权限 design:bundle:create、审计与数据模型不变。销售菜单不变。
- 删除依据：owner/page.tsx 渲染 CdrWorkbenchSection；其「按日期汇总」链接指向原路由；AdminBreadcrumb 消费 ADMIN_MODULES，因此保留模块而不删除整个注册项。未修改构建配置、SQL、schema、迁移或业务实现。
- 运行环境：本地 next dev、隔离预览数据、E2E 管理员；文件存储未配置，下载按钮按既有规则禁用。没有创建下载包或写业务数据。

## 按序 Design QA（Codex）

1. 视觉层级：通过；实屏工作台仍显著展示 CDR 下载及按日期汇总，侧栏减少重复项。
2. 排版与留白：通过；未新增样式，浏览器导航矩阵检查尺寸、对齐、展开与折叠几何。
3. 色彩与对比度：通过受影响导航范围；沿用原 token，明暗主题 axe 门禁通过。
4. 组件一致性：通过；复用菜单注册表和既有角色过滤，无局部样式或新组件。
5. 交互反馈：通过适用导航状态；浏览器测试检查选中、焦点、移动菜单；实屏展开/收起正常。此项入口移除不产生新的 Loading/Success/Error 状态。
6. 动效：通过；现有 Reduced Motion 折叠测试通过，无新增动效。
7. 响应式：通过导航范围；本次实际运行 ADMIN/SALES × 明暗 × 320/375/390/393/430/768/1024/1280/1920 宽度矩阵，包含 overflow、44px 控件、折叠裁切与命中检查。实屏工作台截图为 1280×720。
8. 功能质量：通过本次入口变更范围；实屏用 Enter 从工作台到 CDR 汇总下载页，再返回工作台；原面包屑正确、侧栏无重复项，捕获的 console error 为 0。真实 OSS 下载未验证，未将其记为通过。
9. 可访问性：通过受影响导航自动检查及 Enter 导航实测；包含 axe、键盘焦点保持和 Reduced Motion。未额外执行 200% 字体放大：本次仅移除菜单项，不修改字号、布局或控件。
10. 原创性：不适用新增资产检查；无新增参考、资产或布局。

## 验证

- `pnpm test --run lib/navigation/__tests__/admin-menu.test.ts components/business/admin/__tests__/AdminBreadcrumb.test.tsx`：64/64 通过。首次 2 条旧菜单数量断言失败，按用户批准的移除同步 37→36、26→25，保留路由和权限断言，复跑通过。
- `pnpm test:browser components/business/admin/__tests__/AdminShellNavigation.browser.spec.tsx`：62/62 通过。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过；2 条既存 location.assign 警告（global-error.tsx、OrderCreatedSuccessView.tsx），文案/token 新增违规均为 0。
- `git diff --check`：通过。
- 临时截图 `/tmp/erp-cdr-nav-20261003/owner.jpg`，仅本机临时证据，无长期保留保证；浏览器测试截图在被忽略的测试输出目录。

结论：本次菜单入口移除通过，无范围内 P0/P1，停止扩展。未声明全站或生产验收；未发布。实际文件下载不在本次菜单改动的验证结论内。
