# 界面公司名称统一

起始 SHA：f5e6421。本任务将界面“红包印刷 ERP”统一为“长昆纸品有限公司”。
新增客户端安全的名称常量，供侧栏、登录页、全局错误页与根布局使用；
各页面移除硬编码品牌后缀，由 Next metadata 根模板统一生成。
已核对当前安装版 Next.js 的 generate-metadata 文档中 title.template 继承规则。

验证：

- `pnpm test:browser components/business/admin/__tests__/AdminShellNavigation.browser.spec.tsx`：29 通过，覆盖六视口、明暗主题、侧栏展开、触控、overflow、axe 与键盘操作。
- `pnpm typecheck`：通过。
- `pnpm lint`：无错误，global-error 与 OrderForm 两处既有导航警告；文案/令牌通过。
- 未登录请求 `/login`：标题为“登录 · 长昆纸品有限公司”，h1 为“长昆纸品有限公司”。
- 实际浏览器刷新 `/orders`：标题为“工单列表 · 长昆纸品有限公司”，侧栏显示新名称。
- 源码 app/components/lib/public（不含截图输出）中无旧品牌“红包印刷 ERP”残留。
- 日志：`/tmp/company-name-{browser,type,lint}.log`；不更新截图基线。

范围为系统界面及标题；不修改业务工厂配置、已生成文件、历史文档、数据库或部署。
已有四处未跟踪截图目录保留，不纳入本次提交。
