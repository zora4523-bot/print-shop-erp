# PDF 复审修复与本地验证

- 基线：`codex/order-leave-recovery` / `65aea587`，开始时工作区和暂存区干净。
- 用户授权：继续完成 Claude 已实现的第一批 PDF 修复及其余复审项，按项目规范本地提交；未授权本次 push/生产发布。
- 纳入 Claude 的 10 个 PDF 相关文件，从其 `85b35491` 工作树复制至本工作树；原工作树不修改。开始补丁、文件快照保存在仓库外 `/tmp/erp-pdf-continuation-baseline`。下述验证针对本基线的完整任务增量；提交号通过本文件所在提交查阅。

## 实现与复核

| 任务 | 本地实现与证据边界 |
| --- | --- |
| T0 / D1 | dev-fixtures 安装 Puppeteer Chrome；未运行远端 PR CI，不能写远端绿灯。 |
| T1 / D2 / D3 | 保留 Claude 的池与信号改动；补上创建上下文不响应取消的边界、一次性浏览器使用同一限时清理机制、停机清理拒绝处理。正式回归覆盖挂起、取消、旧实例、恢复与未确认退出。 |
| T2 | 共享模式解析：开发默认 direct，生产必须显式 direct/queued，queued 要求 durable；check-env 与路由失败关闭。更新候选目录发布前检查步骤，不改生产环境变量。 |
| T3 | 白名单分类、503 可用性错误、随机 X-Request-Id 和安全结构化日志；异常正文、URL、堆栈不进入新日志或恢复页。 |
| T5 / D4 | 可空 pdfReady 心跳；初始失能、成功有效期、单探针及退避恢复。两类 PDF 在 claim SQL 增加 attempts 前过滤；领取返回时再检查能力，变化则使用原有未执行 claim 释放路径保留 fencing 并还原预算。当前版本与活跃心跳同时满足才认作 PDF 可用。jobs、发布 gate、等待端点、运维页和 dev-stack 同步。旧 worker NULL 不算 ready。 |
| I3 | 图稿失败仍可下载带原有警告的单张 PDF，但不写入 direct 完成缓存；批量严格图稿校验、队列产物保留和授权复核不变。 |

只添加迁移 `20260930160000_pdf_worker_capability`（一个 nullable Boolean 列），不回写工单、金额、尝试记录或历史迁移。Prisma migrate dev 在影子库重放既有 CONCURRENTLY 索引时失败；最终候选 SQL 限定为新增列，通过独立空库完整 migrate deploy 与后置检查验收。初始一次性试验库不作为验收库；正式验证库为 `erp_e2e_pdf_ready_0930`，与常规开发库/生产库分离。

## 执行过的验证

证据统一在 `/tmp/erp-pdf-continuation-baseline`，不入库测试输出、生成的 Prisma Client、PDF 或凭据。

- `pnpm test:migrations:fresh`：正式独立空库完整 180 条迁移及后置检查通过；随后 seed、E2E catalog/计件/包装测试前置准备通过。
- `DATABASE_URL=<独立测试库> pnpm exec vitest run --maxWorkers=2 --reporter=default --reporter=json ...`：730 个文件通过、7 个文件跳过；7,953 项通过、133 项跳过、0 失败。没有数据库导入失败。跳过项包括原有账单未启用用例、未传专用隔离开关的仓储/建单/分产/计薪/导出测试，以及专用薪资/定价迁移场景；不是这些场景已验收的证据。
- 新增 PostgreSQL 用例实际运行：PDF 失能不增加待处理 PDF attempts，非 PDF 正常领取，恢复后可领取；旧心跳未知、当前版本能力与删除心跳正确区分。
- 全量之后补充的上下文创建取消、领取后能力失效、图稿警告缓存边界，目标回归 14 文件 84 项通过，随后缓存/配置 2 文件 28 项通过（日志 `final-target.log`、`cache-config-tests.log`）；未将不同轮次重复用例相加为测试总数。
- `pnpm typecheck`、`pnpm lint`、`pnpm check:architecture`：通过；lint 保留 2 项既有导航警告，架构保留 24 项既有超长函数债务。
- `node --import tsx scripts/pdf-lifecycle-check.ts`：真实 Chromium 渲染中 SIGSTOP、关闭上下文前 SIGSTOP、浏览器主进程 SIGKILL，之后的新请求均可生成可解析 PDF；脚本断言只属于本次启动的进程组清空。
- `E2E_PDF_RELEASE=1 E2E_PDF_ORDER_MODE=direct ... playwright.pdf.config.ts`：真实 production build/start；多页图稿、重复下载复用、匿名拒绝、不入队、HTML 打印准备通过。
- queued 同样运行 production build/start，最终 `e2e-queued9.log` 为 1 项通过（用例 43.5 秒），覆盖无 worker、恢复、轮询、下载、重复读取、多页彩色图稿、六视口双主题与 axe。新增运维能力展示检查通过实际主题菜单切换，关闭菜单并验证焦点返回后检测页面；不禁用 axe、不更改基线。全规则还检出既有侧栏企业信息缺少地标，独立补上 complementary 语义并单独提交（见侧栏审计记录）。
- `PDF_TEST_PM2_CLI=<临时工具目录>/pm2/bin/pm2 node scripts/pdf-shutdown-check.mjs`：真实安装版 Next + PM2 构建/启动/reload，使用本任务 PDF 模块的隔离夹具，无业务库；慢图片 PDF 收到可恢复失败，重载中的普通请求完成，新实例可生成 PDF，旧 Chromium 进程组清空，无 SIGKILL。带普通在途请求一轮耗时 5,106ms（本机测量）。

### 测试中修正的前置和判断

- 初轮旧 fixture 缺少 pdfReady 或 durable 环境，契约更新后重跑通过；迁移生成后的 Prisma schema 空格格式通过 prisma format/generate 同步。
- E2E 初次缺测试管理员密码和已发布测试计件价簿，按现有受控准备入口补齐；未删除前置检查。
- PM2 reload 命令结束并不代表新 Next 已监听；脚本改为等待真实 HTTP 就绪，再验证 PDF。
- 当前安装的 Next `start-server.js` 在正常 cleanup 后按信号返回 130（SIGINT）/143（SIGTERM）。Claude 的模拟进程退出 0 不能作为真实 Next 的验收标准；130 单独不能证明 Puppeteer 抢占退出。本轮检查请求排空、时间窗口、子进程与有无 SIGKILL。
- 新增运维页测试初轮在主题切换过程采样，随后又在未关闭的主题菜单上执行页面检查；改为真实切换、等待主题/动画、Escape 关闭及焦点返回，保留完整 axe 规则。

- 运维页多视口检查曾延长队列等待；移到下载断言之后。失败运行还会留下确定性夹具的旧待处理任务，新前置与 finally 仅取消隔离库该夹具尚未领取的 PDF，保留尝试/历史，避免复用上一轮任务；不改变生产队列超时或去重契约。

## 仍属于发布前置的事项

本次未推送、未创建 PR、未运行远端 CI、未执行生产迁移或部署。未读取/变更当前生产发布脚本与配置，候选目录门禁已写入受控 runbook，但尚无本 release 的生产执行凭据。

目标生产或同资源隔离环境的容量测试仍未完成：Web/LIGHT/HEAVY/Chromium 进程树内存、CPU、换页、并行 PDF 与普通请求 p95，必须按复审方案 T2 验收。当前结果可以审查本地修复，不是生产发布许可。通用业务失败后回收浏览器仍保留保守行为，本次未进一步进行该项性能优化。
