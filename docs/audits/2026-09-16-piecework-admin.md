# 旧计薪退出与计件工价后台验收

日期：2026-09-16。开始分支 `codex/memory-after-pr19`，开始 SHA `cd65d881`，工作区与暂存区为空。
范围为本任务实现及其测试、迁移和文档；未包含生产部署。

## 实现与删除依据

- 员工工资规则页增加计件工价编辑、草稿保存、核对发布、指定时间/立即生效和版本查询。
- 基础三项工价必填才可发布；按盒可选；空值不转换为零。发布只读取已保存金额。
- 草稿编辑与发布共用锁及父版本修订；发布重试核对原草稿修订。报工取价持共享锁。
- 保留 CLI 发布契约，包括带时区写法的原 manifest 哈希；立即生效采用数据库锁内时间。
- `rule-catalog.ts` 已排除旧机型规则，`daily.ts` 已只读，实际生产入口为工序报工。
  `seed.ts` 是旧机型规则及包装时薪的剩余初始化入口，本次删除其初始化。
- 历史日薪详情与 Excel 仍引用 `legacy-machine-snapshot.ts`；机型仍被
  `reporter-operation-lane.ts` 用于岗位资格，因此这些消费链及历史表、迁移保留。
- 新增迁移仅调整草稿 metadata 约束；已发布历史触发器及证据要求不变。

## 验证环境

Node 24.15.0、Prisma 7.7.0、Next.js 16.3.4。版本相关实现已核对安装版 Server Actions 与
revalidatePath 文档。数据库测试仅连接本机专用 `erp_e2e_piecework_20260916` 及
`erp_e2e_piecework_final_20260916`；浏览器使用独立 3155 端口及 `.next-release` 生产构建。
测试进程使用 inline jobs、mock 通知，不代表真实通知或生产 durable worker 验收。

- 空库完整 149 条迁移通过，两套专用空库均验证；本地开发库只应用新增迁移。
- 本地业务库工价仍为第 1 版空草稿、三项规则、零项已填。测试工价只发布到隔离库。
- 全量 ESLint 零错误；两个既存导航警告在 `global-error.tsx` 和 `OrderForm.tsx`。
  追加变更的 ESLint、UI 文案和 UI 令牌门禁均无新增问题。
- 架构门禁通过；生产构建及 TypeScript 检查通过。
- 首轮全量测试误继承本机 durable 配置，造成通知 mock 路径失败。使用 CI 同款
  `BACKGROUND_JOBS_MODE=inline`、`NOTIFICATION_MOCK_MODE=true` 重新运行后通过。
- UI 初轮使用全页 alert 匹配到 Next 路由播报器，已将断言收窄到计件区域；主题测试
  修正为真实菜单键盘选择、Escape 关闭、焦点返回及等待实际动画结束，未放宽 axe 阈值。
- 六视口：375×667、393×852、768×1024、1024×768、1280×800、1920×1080。
  明暗主题、无横向溢出、移动端 44px 目标与触控、键盘焦点和区域 axe 均已通过。
  已人工查看移动端暗色截图，表单、版本与其他工资区域布局正常。

## 最终验证结果

- `vitest run --maxWorkers=4 --coverage`：635 个文件通过、1 个条件跳过；6,904 项通过、44 项既存条件跳过，无失败。跳过项不计入通过。
- 覆盖率：语句 85.02%、分支 79.12%、函数 90.78%、行 86.96%，既有门禁通过。
- `playwright test tests/e2e/piecework-admin.spec.ts tests/e2e/production-operation.spec.ts --project=chromium --config=playwright.release.config.ts`：11 项通过、零跳过。
  包含实际指定生效时间保存回显、双窗口冲突、立即发布与请求重放、旧价格和报工金额不变，
  以及调价前后分别扫码报工并核对新单价、计薪数量与金额。外部销售、师傅和客服均无编辑入口。
- 最后补充的“他人已发布新版后，过期页面不能误报发布成功”守卫也有定向测试与真实重放验证。
- 所有写入型浏览器测试均在独立库运行。该套用例会留下已发布测试工价和报工记录，重跑使用
  新隔离库或通过正常后续版本恢复 E2E 基准，不删除或改写已发布版本。
- 本机证据：`/tmp/erp-piecework-fulltest-final.log`、`/tmp/erp-piecework-e2e-last.log`、
  `/tmp/erp-piecework-final-fresh.log`、`/tmp/erp-piecework-replay-final.log`、
  `/tmp/erp-piecework-ui-375-dark.png` 等六视口截图。生成物及连接配置不提交。
- 此记录对应本任务最终工作区增量，随实现一次提交；准确提交 SHA 由 Git 历史定位。

生产未部署，正式员工工价未代填或发布；生产切换仍须按部署指南核对在途业务、历史未付工资和正式价格。
