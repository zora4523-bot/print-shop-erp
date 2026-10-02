# 管理工作台 CDR 下载验收记录

## 范围与基线

- 开始 HEAD：`d8edcf8be4649f654ab2723e2d4dcadb195698e0`；工作区和暂存区均干净。
- 本任务：工作台直接下载、账号分组、异常工单、版本指纹、归档路径、进度、重打包、两条前向迁移及测试/文档。
- 当前工作树 `/Users/zhixing/.codex/worktrees/e776/print-shop-erp`；Node 24.15.0，Next 16.3.6。
- 任务只创建本地提交；没有 push、发布或配置真实对象存储。

## 业务与边界

1. `design:bundle:create` 在读取区块、创建/重打包和每次进度读取前执行；销售重放真实 action POST 被拒绝且记录数不变。
2. 默认跨日期 CONFIRMED / RELEASED / SCHEDULING，排除无需排版的寄样；普通单缺少CDR仍提示待核对，全部范围可查看寄样；日期按上海提交日，可切换全部已提交工单。每页100单，按钮明确“本页”，越界页码校正。
3. 账号按 ID 分组，显示用户名区分同名；以 submitterRole 历史快照认定销售，重做沿用原单。内部单独分组。异常工单不含在下载中。
4. 每款缺 CDR、缺销售或非法源地址阻止整单。服务端复读选择，任何文件/归属变化都拒绝整批并刷新候选；正常生产状态流转不造成版本冲突。
5. 新包冻结文件指纹和路径，worker 执行前校验；变化首轮终止，不用三次重试。ZIP 包含销售/工单/款式目录，清洗 Windows 字符、保留名、长度与大小写碰撞。
6. 只比较最新真实包的文件指纹，mock 不做版本依据；旧日期入口没有清单时显示“旧包版本待核对”，不回填或猜测旧版本。
7. 工作台只轮询当前包（5秒、最多2分钟），不受最近20条限制，失败/暂停后可手动刷新或重试；终态才刷新整页。浏览器尝试自动下载，同时保留显式按钮。
8. 打包记录不代表已下载、已排版或已打印。明文链接只在有效 READY 状态传给客户端；不传 manifest、文件URL、orderIds 或原始异常码。分享、过期和撤销继续走原令牌路由。

## 验证

证据目录：`/tmp/erp-cdr-dashboard-task/`（不进仓库）。测试使用独立一次性 PostgreSQL 数据库，未在预览数据库运行写入型测试。

| 检查 | 命令 / 范围 | 实际结果 |
| --- | --- | --- |
| 早期目标测试（后续由全量覆盖） | `pnpm exec vitest run lib/cdr actions/__tests__/cdr-workbench.test.ts lib/background-jobs/__tests__/repository.test.ts` | 9文件152项通过，见 `target-verified.log` |
| 全量 Vitest | `pnpm test --run --maxWorkers=2` | 750文件8272项通过，9文件/142项条件跳过；见 `full-vitest-final.log` |
| 类型 | `pnpm typecheck` | 通过，见 `typecheck-final.log` |
| lint | `pnpm lint` | 0 error；2条既有 location.assign 警告；文案/令牌0违例，见 `lint-final.log` |
| 架构 | `pnpm check:architecture` | 1183模块、4823依赖通过，既有24项超长函数债务；见 `architecture-final.log` |
| 原入口与新入口 E2E | `tests/e2e/cdr-bundle.spec.ts`、`tests/e2e/cdr-workbench.spec.ts` | dev与生产build/start均3项通过（生产见`release-ui-final.log`，1分钟）；含真实 action 提交及销售重放拒绝、勾选、跨日、重打包、缺文件、六视口明暗/键盘/touch/axe；见 `e2e-final-verified.log`（25.6秒） |
| durable CDR | `pnpm test:release:cdr` | 生产 build/start + 1项通过（36.7秒），见 `production-cdr-final.log`：真实 HEAVY + archiver + 本地HTTP存储 + 浏览器下载；替换附件后旧版本首轮DEAD、更新标记、分享、撤销404、过期404 |
| fresh DB | 在全新 `erp_cdr_fresh_test_20261002` 上 `prisma migrate deploy` | 185条完整迁移链通过，见 `fresh-final.log` |
| 当前预览 | `http://127.0.0.1:3107/owner` | 两条迁移已应用，实际显示 CDR 区块及已有缺文件工单；没有添加假业务数据 |

E2E 隔离库：`erp_cdr_e2e_20261002`；Vitest 库：`erp_cdr_test_verified_20261002`。
普通 E2E 为 Next dev + inline + mock；CDR 专项为 Next build/start + 实际 durable worker + 本地 HTTP 对象存储 fixture，虚拟凭证且不依赖真实桶。E2E_CDR_DEV=1 仅供诊断，早期开发模式验证不是生产证据。
专项的 loopback DNS 预加载仅映射 `cdr-test.localhost`；worker 可不具备 PDF 能力，CDR 不依赖 PDF。其他 durable 用例仍要求 PDF readiness。

### 排障与复验

- `migrate dev --create-only` 被既有 `CREATE INDEX CONCURRENTLY` 影子库事务限制阻断。最初数据库到schema差分包含已有手写索引漂移；该一次性试验库被废弃，未触及预览数据。最终使用开始schema与当前schema差分生成仅加列的SQL，人工核对，再在新空库完整迁移验证；第二条仅加GIN索引。未编辑任何已应用的共享迁移。
- 第一次全量测试2项缺管理员/纸张/库位前置；补充独立库fixture后出现4项并发超时。降低进程数至2复跑全量通过，没有放宽超时或业务断言。
- 首轮浏览器定位未计入摘要“展开”文字；修正为实际summary。触控检查排除了 Base UI `aria-hidden=true` 的内部非交互input，真实目标仍检查44px。
- 目视检查发现手机姓名被挤为窄列，改为小屏姓名独占一行并复验六视口。异常工单存在时不重复显示巨大的“无数据”区域。
- 本地存储fixture最初使用IP端点，SDK不能签发IP对象地址；改为loopback虚拟桶主机。过期fixture明确写UTC，不依赖原始pg会话时区。运行中重命名fixture导致一次无效测试，重新启动后通过；这些失败不计作验收。

## Claude 对抗审查

- 实际调用已登录的 Claude CLI，只开放 Read/Grep/Glob，禁止读取环境凭证或修改文件。
- 首轮 **7.0/10**，无P0；修复模块循环、无界历史查询、Windows路径、生产路径覆盖和失败恢复五项主要问题，并处理归属快照、单包轮询、DTO裁剪、UI组件规范等问题。
- 第二轮 **8.2/10**：修复专项误入通用durable、接入独立脚本与CI、删除/重传首轮终止、中文长文件名、寄样默认排除、客户端纯状态机测试；去除进度读取manifest、显式指纹字段顺序和测试临时路径。第三轮 **9.1/10，无P0/P1**，原文见 [Claude审查报告](2026-10-02-cdr-claude-review.md)。P2验收条件要求补死代码/备份门禁及CI隔离，进展见下。

## 限制

- 当前3107预览未配置真实文件存储，不能用该环境下载生产文件；真实 OSS 凭证与网络不在本次验证范围；生产 Next build/start 专项通过。
- 原日期汇总入口保持旧归档契约；混用旧入口后最新包没有清单时，版本标记保守显示待核对。
- 历史只在工作台展示最近20条，任务进度不依赖该窗口；大批量按100单分批。

首次 `production-cdr.log` 中生产构建阶段通过，但整条测试命令失败：全局前置检查缺少已发布测试工价，执行 `pnpm test:e2e:prepare` 补齐。复用构建尝试被已有 prebuilt 门禁固定要求 `.next-release` 拒绝，改为重新完整构建，不绕过前置；最终 `production-cdr-final.log` 完整构建和专项1项通过。通用durable收集仍为原5项/3文件，专项不混入（`durable-collection.log`）。

最后界面复验曾在主题动画中间帧取色而触发axe对比度失败；沿用项目现有视觉门禁，设置colorScheme并跨连续绘制等待真实动画结束，未关闭规则。最终3项全通过。

暂存区 `git diff --cached --check` 唯一提示为 Prisma 生成的首条新迁移末尾空行。该迁移已在预览和隔离库应用，为保留校验和，遵守“已应用迁移不修改”而保留；仅忽略 `blank-at-eof` 的复核无其他空白问题。未修改 Git 持久配置或任何验证规则。

Claude验收条件的后续处理：备份23项通过；CDR CI步骤改用单独 `erp_e2e_cdr_ci` 库，避免其他durable任务干扰；NODE_OPTIONS拼接保留内存参数，CI显式4096MiB。未推送，不能声称远端CI已运行；将由首个PR的static/durable/chromium检查确认。

补充门禁：`pnpm test:backup` 23项通过；去除客户端轮询窗口常量多余export后，纯状态机8项复验通过。独立 `pnpm typecheck` 的工具进程明确返回exit 0，日志无尾行不代表未结束；两次生产构建另有TypeScript成功证据。

死代码门禁最终仍失败，但只剩任务前已有的侧栏4个导出（knip/ts-prune共8条）：SidebarFooter、SidebarMenuSub、SidebarMenuSubButton、SidebarMenuSubItem。将开始HEAD `d8edcf8b` 导出到仓库外干净目录，使用相同已安装工具独立扫描，得到完全相同8条（`dead-code-baseline.log` 对照 `dead-code-verified.log`）。本次新增常量导出已修复；未修改共享侧栏、扩大基线或掩盖CI失败。按CONTRIBUTING区分既存问题，留给侧栏任务修复；本提交不能宣称整体CI全绿。
