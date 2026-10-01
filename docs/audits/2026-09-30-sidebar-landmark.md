# 侧栏企业信息地标补齐

PDF 运维页六视口全量 axe 检查暴露既有 `region` 问题：AppSidebar 企业名称/账号类别位于导航和主内容地标之外。原基线 65aea587 的 SidebarHeader 无语义属性，非 PDF 修改引入。

只给该区域增加 `role="complementary" aria-label="企业信息"`，保留原 DOM 层次、CSS、交互和导航权限。无关小修按 CONTRIBUTING 单独提交，不混入 PDF 领域提交。

验证通过本批实际运行的 `E2E_PDF_RELEASE=1` queued 用例：后台任务页六视口/双主题、真实主题菜单、Escape 焦点返回、overflow 及未过滤规则的 axe；日志在 `/tmp/erp-pdf-continuation-baseline/e2e-queued9.log`。本批另完成全仓 lint 和 typecheck，最后语义属性与用例修改追加目标 ESLint，真实 Next 生产构建包含类型检查。无需像素基线变更。
