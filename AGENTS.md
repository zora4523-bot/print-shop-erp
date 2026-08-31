<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 代码审查

- 删代码前必须用 `rg` 全仓库确认无引用，检查范围包含配置文件、构建脚本、SQL、Prisma schema 与迁移。
- 判定依据必须写实际引用位置，不写“看起来没用”或其他推测。
- 每条删除后分别运行 build、test、typecheck；任一失败即回滚该条删除。
- 清理改动与功能改动不得进入同一个 commit。
- 动态 `import`、装饰器或注册表、i18n key、仅生产环境分支、对外公开 API 与迁移脚本默认保留，并列入人工复核清单。
