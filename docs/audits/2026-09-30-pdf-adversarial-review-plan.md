# PDF 优化独立复核与修复计划

- 日期：2026-09-30；候选：`a494c4f5`；基线：`c5ba0823`。
- 范围：`80cc7086`、`a494c4f5`，共 45 个变更文件；重点读取请求入口、缓存、浏览器池、渲染、快照、授权、打印页、worker 启动、部署约束及对应测试。
- 初版状态：**待实施；当时 CLI 审查受阻**。2026-09-30 已改用 Claude 客户端 Opus 5.5 完成代码审查及两轮方案复审，见文末续录；仍未实施或取得发布许可。
- 开始状态：`codex/order-leave-recovery`、HEAD `a494c4f5`，工作区和暂存区干净。本次仅新增本文，不改业务代码、数据库、部署配置或其他工作树。

## Claude Code 调用结果

实际调用 Claude Code 2.1.283，指定 `claude-opus-5-5`，只读工具 Read/Grep/Glob、plan permission mode。请求覆盖两个提交的完整 diff 及关联调用方；未开放写文件、命令执行或 MCP 工具。

调用退出码 1，返回 `You've hit your weekly limit · resets Oct 1 at 4pm (Asia/Shanghai)`；`modelUsage` 为空，没有产生代码审查结果，也无法证明该模型请求实际执行。原始响应在仓库外 `/tmp/erp-pdf-claude-review/review.json`。额度阻塞期间不重复调用，不将下面的独立复核署名为 Claude 结论。额度恢复后仍须完成外部代码审查和方案复审。

## 已确认的问题

### F1 · P2：清理阶段不受生成超时保护，后续下载可能持续被阻塞

位置：[`browser-pool.ts`](../../lib/pdf/browser-pool.ts) 49–50、53–54、70–78 行；[`direct.ts`](../../lib/pdf/direct.ts) 69–75 行（行号基于候选 SHA）。

触发条件：渲染已返回，但 Chromium 的 `context.close()` 没有及时完成，随后生成 signal 超时。池在进入 `context.close()` 前已经移除了 abort 监听；因此此时不会调用浏览器回收。串行 `tail` 仍等待清理 Promise，后续任务不能开始。外层 `waitForPdf` 只结束 HTTP 等待，不能释放该串行队列。即使在其他阶段启动了回收，`browser.close()` 也没有应用层清理期限，`disposing` 可继续阻塞下一任务。

影响：一次 Chromium 清理异常可以使后续下载连续超时或达到池上限；用户反复点击重试不能修复池状态。不能据此断言已在生产发生永久卡死；底层是否最终超时取决于实际 Chromium/Puppeteer 故障。

复现：仓库外脚本 `/tmp/erp-pdf-claude-review/reproduce-pool.ts` 直接导入候选 `PdfBrowserPool`，注入可控的延迟 `context.close()`；进入清理后触发 abort，再排第二个任务。断言 browser.close 调用次数为 0 且第二任务未启动成立；释放清理 Promise 后两任务才结束。运行命令 `node --import tsx /tmp/erp-pdf-claude-review/reproduce-pool.ts`，退出码 0。日志为同目录 `reproduce.log`。这是故障注入证据，不是生产事故重放。

现有 `browser-pool.test.ts` 的“等待关闭后再启动”用例主动释放 close Promise，未覆盖清理不响应或清理期间才超时的情形；`direct-scope.test.ts` mock 了整个池，也无法证明真实池能恢复。

## 发布风险与改进项（不冒充已复现缺陷）

### R1 · 上线前置：direct 与 HEAVY 合计资源没有目标环境验收

[`deploy/ecosystem.config.cjs`](../../deploy/ecosystem.config.cjs) 9–20 行仍有低内存档：Web 512 MiB 重启阈值 / 384 MiB heap，HEAVY 640 MiB / 448 MiB；[`部署指南`](../部署指南.md) 记录过约 1.6 GiB 的生产主机。未读取当前生产机，不能断言这一历史记录仍是实时配置。

新增 direct 是每 Web 进程的限流，不能限制 Web 与 HEAVY 的总 Chromium 数；Node RSS 也不是进程树总资源。当前默认 direct 将改变未配置此变量的已有生产部署行为。已有审计正确说明未做生产容量测试；本轮没有复现 OOM，不将资源风险列为已确认 P1 缺陷。

### I1 · 运维改进：direct 错误日志缺少固定分类和关联标识

[`PDF handler`](../../app/api/orders/[id]/pdf/handler.ts) 的 direct catch 只记录固定 `PDF_GENERATION_FAILED`，客户端虽然有白名单错误分类，运维日志不能区分容量、字体、浏览器、超时，也不能关联一次失败。保留禁止记录原始异常的安全边界；此项为诊断改进，不是数据丢失或越权证据。

## 修复任务（均待实施）

### T1：先补回归，再修复浏览器池的取消与回收边界

范围：`lib/pdf/browser-pool.ts`、`lib/pdf/direct.ts`、必要的 `lib/pdf/render.ts`，及其测试。

1. 将 F1 外部复现转成正式回归测试，覆盖 context.close 卡住、browser.close 卡住/拒绝、清理期间才 abort、空闲回收与下一次请求竞争。测试使用可控 Promise/时钟，不以任意 sleep 代替结果断言。
2. 把渲染、上下文清理和浏览器回收纳入一致的生命周期；abort 监听覆盖清理阶段，清理必须有明确期限。45 秒生成预算与额外清理宽限分别定义，错误响应不因回收继续无限等待。
3. 回收超时后只处理本池创建并持有的 Chromium 子进程，使用 Puppeteer 暴露的进程句柄做终止和退出确认；禁止按名称全局杀浏览器、杀 Web、杀 HEAVY 或杀用户 Chrome。
4. 未能确认旧进程退出时，池进入明确不可用状态，让新请求快速失败并提供网页打印入口；不能一边放任旧进程存活一边无限启动新浏览器。确认退出后可重建池。
5. 采用任务/浏览器代次隔离，旧任务延迟完成、旧 finally 或旧定时器不得关闭新浏览器、重置新计数或污染缓存。不能仅用 Promise.race 丢弃旧清理任务。
6. 取消一个下载订阅仍不影响同一内容的其他订阅；过期结果不进入缓存，取消排队任务不执行渲染，权限与完整快照的最终复查保持。
7. 共享浏览器池同时被 direct 与 HEAVY 使用，必须验证两条调用链；HEAVY 租约失效后不能写产物。不得因池修复绕过已有 assertLease、worker 单并发或私有产物权限。

验收：复现从“队列被阻塞”改为“在规定清理窗口内恢复，或明确不可用并快速失败”；旧进程未退出时不启动新实例。恢复后下一份 PDF 可解析，失败/取消结果不缓存，无未处理拒绝、孤儿 Chromium 或上下文泄漏。

### T2：明确生产启用边界，完成资源验证

范围：模式解析、`.env.example`、`scripts/check-env.mjs`、部署检查、模式测试与相关文档；若涉及 Next 路由/构建，先读当前安装版文档。

建议生产未显式配置时保留 queued，开发可继续 direct；显式 `PDF_ORDER_MODE=direct` 才在生产启用。该默认策略是本轮待审建议，尚未改变现行决策。集中模式解析，更新 API/ARCHITECTURE/DECISIONS/DEVELOPMENT/部署指南，防止 handler、检查脚本和文档各用不同默认。queued 的生产前置必须包含 durable 与健康 HEAVY；不能把 inline 下的 direct 行为误报为队列回退成功。

在对应发布 SHA 的 production build、同生产资源限制的隔离环境测量：最大受支持工单、多页图稿、四个不同 direct 下载与 HEAVY 导出同时运行、重复下载、取消、超时和恢复。记录 Web+LIGHT+HEAVY+所有 Chromium 子进程的 RSS 峰值、CPU、业务请求延迟及重启情况；负载数据使用隔离测试数据。按现行 SLO 验收，不随意提高 PM2 内存阈值以掩盖回归。

资源验收不通过则保持 queued；扩容或专用渲染进程作为后续独立方案，不在本次池修复里再增加新基础设施。验证显式模式在真实部署配置的加载优先级，演练 queued 回退并确认实际请求执行路径。

### T3：补足安全诊断，不改变业务行为

范围：direct handler、公共 PDF 错误映射、池日志、相关测试及 TROUBLESHOOTING。

错误日志只记录随机请求关联标识、白名单 code、阶段、耗时与模式；未知异常映射通用码。不记录 error.message/stack、客户姓名/地址、原始订单内容、签名 URL、Cookie、数据库连接串。所有共享错误映射避免复制两套分类。指标明确 Node RSS 与进程树资源不同；没有测量后者时不声称总内存受控。

验收：注入超时、容量、字体、浏览器关闭失败、未知异常；响应和日志可关联且分类准确。注入含秘密的异常文本，确认响应与日志均不出现。direct 故障页不把后台任务列表当作 direct 任务记录的存在证明。

### T4：整批复审与验收

- 先跑 T1 回归及 direct cache/scope、render、route recovery、worker 生命周期测试；再按 [CONTRIBUTING](../../CONTRIBUTING.md) 跑全量 Vitest、typecheck、lint 与架构检查。
- direct/queued 两种真实浏览器 E2E：中文、二维码、图稿、多页、重复下载、缓存失效、账号禁用/角色变化/归属变化、生成期间同版本内容变化、取消与失败恢复；使用隔离可丢弃数据库。
- 增加真实 Chromium 故障恢复验证，至少覆盖渲染进程被终止后新请求恢复。不要把 mock 通过表述为生产 Chromium 故障已验收。
- 如果修改 UI，补六视口、明暗主题、键盘焦点、touch/overflow/axe；修改打印布局才需对应像素门禁，未经确认不更新基线。本轮建议不改打印模板、金额、历史快照或数据库 schema。
- Claude 额度恢复后，先提交本候选 diff 与本文做对抗复审，重点检查 T1 的超时回收、代次隔离与 T2 默认策略；实现后再审实际 diff 和真实测试结果。新增发现逐项复核，未完成项明确保留。

## 本轮方案自复审

已检查：任务范围不触及迁移/业务数据；超时不会取消其他共享订阅；回收不越过进程所有权；旧进程未退出时不会无界重启；晚到结果不进入缓存；共享池变更覆盖 HEAVY；生产默认建议与现行 direct 决策的冲突必须显式更新；容量证据与代码回归分别验收；不把本机 smoke 当作发布验收。

仍未完成：Claude 外部审查及复审、T1–T4 实现和验收、生产资源实测。本轮仅完成独立复核、故障注入证据和待实施方案；不得标记“Claude 审查通过”或“问题已修复”。


## 2026-09-30 续录：Claude 客户端审查与第二轮复审

### 调用与证据

用户澄清使用 Claude 客户端后，通过客户端 Code 模式、Opus 5.5、Plan 模式完成审查。会话：[PDF 对抗审查与修复方案复审](https://claude.ai/epitaxy/local_7d53cfc7-f532-4549-81d4-9bd24fc2df3f)。Claude 客户端建立独立工作树 `claude/pdf-adversarial-review-dd020f`，基线为 `85b35491`；提示明确只读、不实施、不提交、不读凭据或业务数据。未点击 Accept 或授权自动实施。CLI 的额度失败记录仍是当时事实，不能外推为客户端不可用。

Claude 第一轮审查实际代码和 T1–T4，第二轮审查反馈后的方案。它的发现来自源码推导，未在真实 CI/生产/故障环境执行；不能写成线上已复现。主任务额外重跑 4 个文件 48 个测试，全部通过：`browser-pool`、`direct`、`direct-scope`、`order-pdf-route`；命令 `pnpm exec vitest run lib/pdf/__tests__/browser-pool.test.ts lib/pdf/__tests__/direct.test.ts lib/pdf/__tests__/direct-scope.test.ts app/__tests__/order-pdf-route.test.ts --maxWorkers=2`，日志 `/tmp/erp-pdf-claude-review/recheck-tests.log`。它们通过不覆盖新增故障边界。

### 确认采纳的代码发现

| 编号 | 级别 | 发现与主任务复核 | 处理 |
|---|---|---|---|
| D1 | P1 | `scripts/dev-stack.mjs:62–67` 在 inline 模式先执行 Puppeteer PDF 预检；development E2E 使用该入口；`.github/workflows/quality.yml:538` 的 dev-fixtures 只安装 Playwright chromium；共享 browsers action 默认不安装 Puppeteer Chrome，且安装脚本白名单不含 puppeteer。干净 runner 缺少所需 Chrome，会在 Web 启动前失败。实际 PR CI 未运行。 | 新增 T0 补齐依赖和干净环境启动验证；不删除预检来掩盖缺依赖。 |
| D2 | P2 | direct 和 HEAVY 池默认保留 Puppeteer 的信号处理；安装版 `@puppeteer/browsers` 在 SIGINT 时执行 `process.exit(130)`。PM2 默认停机信号会绕过应用优雅退出；复用池扩大了影响窗口。 | 并入 T1；统一三条 launch 路径（含预检/不复用路径）的信号策略，并验证停机期限。 |
| D3 | P2 | F1 的清理超时缺口确认成立。CDP 默认协议超时约 180 秒，但 `BrowserLauncher.closeBrowser` 在 CDP 关闭成功后等待 `hasClosed()` 没有应用层期限。 | 不采用“严格最多 3–6 分钟”的概括，也不宣称生产永久卡死；按应用层限时清理修复。 |
| D4 | P2 | `scripts/background-worker-runtime.ts:43–49` 在注册心跳和加载 handler 前执行 PDF 探针，失败退出；因此 PDF 独有的字体/浏览器/产物探针故障会阻断 CDR、XLSX 等整个 HEAVY 队列。 | 新增 T5 设计故障隔离及恢复；不能简单 catch 后发布正常心跳。 |

D1 的级别沿用 Claude；是否为仓库强制 required check 还需 PR 实际配置验证。上述问题修复及相关门禁通过前，不把候选版本标记可发布。

### 对 Claude 建议的取舍

- 缓存身份隔离、返回前重新鉴权与完整快照校验、共享请求单个订阅取消、状态页 CSP、HTML 打印独立授权未发现新问题；只代表此次审查覆盖，不是完整安全认证。
- T1 不引入通用代次状态机，优先使用捕获的浏览器实例、身份比对、有限状态和期限；旧回调不得清理新实例。
- 协议超时不能任意降低到 15 秒而截断合法大 PDF；应用层控制清理期限，协议超时按真实渲染与 45/60 秒预算测试确定。
- 不接受“库里没有任何 SLO”的表述：已有 [生产 SLO](../production-slo-and-recovery.md)，缺的是本批 PDF 资源及非 PDF 请求延迟的专项门槛。
- 生产采用候选目录切换见 [部署指南 §14](../部署指南.md#14-日常运维)。必须检查实际发布脚本及配置门禁；**不能仅因 `check-env` 在 `update.sh` 中出现，就断言候选发布从未执行它**，历史发布记录曾记录 check-env 通过。尚未读取现网脚本和配置，不把 Claude 推断直接记为现网漏洞或直接写入 `.env`。
- D4 的能力落库是一种建议设计；现有 heartbeat 无能力字段确实成立，但“只能改 schema”未被证明。实施前比较最小可行方案。若采用字段/表，需新增前向 migration、fresh DB 和新旧 worker 兼容验证，不能受原 T4“不改 schema”建议约束而遗漏迁移，也不能在本次只读审查里直接改库。
- 不全量把权限 E2E 降成 mock；按 CONTRIBUTING 保留关键真实框架边界，测试规模与最终改动相称。
- 图稿失败但带警告的 PDF 缓存，以及业务错误触发整个浏览器回收，登记为后续体验/性能项；此轮不静默改变可下载警告 PDF 的契约。

### 修订后的任务顺序与验收（取代前文对应建议，全部待实施）

**T0 · CI 启动依赖。** dev-fixtures 安装步骤增加 `puppeteer: "true"`，核对所有 `pnpm dev` 消费方。使用独立空 `PUPPETEER_CACHE_DIR` 或 CI 冷缓存验证下载、PDF 预检成功、Web 在现有 120 秒启动期限内就绪及两视口用例通过；不删除用户全局浏览器缓存。

**T1 · 生命周期、停机、恢复。** 保留前文回归与实例隔离要求；三条 Chromium 启动统一参数，关闭 Puppeteer 对 SIGINT/SIGTERM/SIGHUP 的接管。Web 当前 PM2 `kill_timeout=30s` 小于 direct 45 秒渲染预算，因此需明确停机时停止接收新渲染、取消在途工作并在强杀前完成受限回收；遵循当前安装版 Next 启停文档，避免重复注册进程监听或改变其退出语义。HEAVY 保持已有任务租约与排空行为，启用复用时明确维持单并发或单独限定排队预算，不能把排队超时误当浏览器崩溃。

清理期限与生产预算分别定义：direct 故障响应不超过 45 秒加至多 10 秒清理宽限；停机清理期限必须短于 PM2 30 秒且留余量。进程组终止仅适用于已确认 detached 的本池自建进程，检查句柄未退出、记录身份并按平台处理；不存在有效进程句柄时快速失败，禁止按进程名称批量杀。SIGKILL 后未确认退出则返回 503，确认退出后才恢复。进程退出事件和本次启动的进程树作为证据，不能把系统全局 `pgrep chromium` 为空当作验收（其他合法浏览器可能正在运行）。

验收补充：可控 Promise 覆盖 context.close/browser.close 挂起或拒绝；真实隔离 Chromium 的 SIGSTOP/SIGKILL 注入；同一构建下 PM2 reload，记录在途普通请求/后台任务及退出码、仅本池进程树清理。取消排队任务不能杀掉别人的活跃任务；协议超时不回归最大受支持 PDF。

**T2 · 显式生产模式和容量门禁。** 撤回“生产隐式默认 queued”的初版建议。开发统一默认 direct；生产缺少显式 `PDF_ORDER_MODE` 时配置检查失败、运行时返回 `PDF_CONFIGURATION_INVALID`，不能悄悄 fallback。模式解析与验证集中维护，配置门禁覆盖实际候选目录发布流程并在停机前执行；`update.sh` 仅是另一条受支持入口。现网变量与执行模式先只读核对，保留现网已确认行为；是否启用 direct 依据容量验收和发布授权，不在本轮改生产配置。

容量候选门槛：同一主机、同一 production 构建、相同数据集，先测无 PDF 负载基线，再测四个不同 direct 请求和 HEAVY 导出并行；两阶段非 PDF 请求分别至少 1,000 个样本，采样窗口至少 10 分钟并预热。无 OOM/PM2 重启，整机 MemAvailable 不低于总内存 20% 且不少于 256 MiB；非 PDF 请求 p95 相对基线增幅不超过 20%；记录进程树 RSS、CPU、swap si/so 与 major fault，持续换页需定位并视为未验收，不能仅以可用内存达标放行。queued 对照已有队列延迟 SLO。以上是待验证候选门槛，不能反写成已批准的全站 SLO；现行更严格要求优先。目标环境无法验证时保持发布阻断。

**T3 · 最小安全诊断。** 沿用前文白名单与关联标识，不输出原始异常；临时浏览器不可用与容量满映射 503，其他错误按契约分类，补 API 和测试。只测到 Node RSS 时明确标注，不能当作 Chromium 总资源。

**T5 · PDF 能力故障隔离（设计任务先行）。** 核查并列出所有依赖 Chromium 的任务类型及其资源依赖；给出能力状态的来源、存储、过期、发布版本兼容、退避重检和恢复机制。领取 SQL/事务在增加 attempts 前按能力过滤相关任务，失能期间不得持续领取并烧掉重试次数；只改 handler 不足。同步 `waitForOrderPdfJob`、健康探针、发布 jobs 门禁和运维页，区分 HEAVY 在线与 PDF 可用。积压任务保留可恢复状态，超过现有 SLO 告警；运行中失能按原 lease/attempt 不变量处理。若采用迁移，新增前向迁移并测试旧/新 worker 混合部署，旧 heartbeat 不得自动视为新版本能力 ready。如果需要扩大架构范围，先给出独立设计及验证；不可把此任务一句“后续再说”当作本次版本可发布的依据。

**T4 · 整批验证与代码复审。** T0、T1、T3 可先实施；T2 按上述配置与发布路径要求实施；T5 完成具体设计后实施。运行前文规定的目标/全量测试及适用的真实 E2E，PR CI（特别 dev-fixtures）必须实跑；没有 PR/部署授权时明确未执行。实现后的实际 diff 仍需复审；本次两轮方案审查不替代实现验收。

### 当前结论

Claude 第一轮有条件认可，第二轮指出发布门禁、停机期限和能力隔离设计仍不完整。主任务已将这些意见及边界修订纳入本文；**可按顺序开展修复，但不能声称方案“无问题”或候选“可发布”**。T5 的具体持久化设计、实际生产发布门禁/模式核对和容量证据仍未完成。本轮仅变更审查文档，业务代码与数据库未修改，也未批准 Claude 实施。


## 实施交接（2026-09-30，基线 65aea587）

用户随后授权继续执行修复。T0 配置、T1 生命周期、T2 显式模式、T3 安全诊断、T5 持久化能力隔离及 I3 图稿警告缓存现已实现；新增 nullable `pdfReady` 前向迁移，并完成独立空库验证。实际代码、验证结果及未验收项见 [本地实施记录](2026-09-30-pdf-remediation-verification.md)。前文“全部待实施”及“本轮只读”描述的是方案审查时点，不是当前实现状态。

本地通过不替代远端 CI、现网配置核对及目标资源容量验收；发布仍须完成这些前置。Claude 第一批原始证据保留在 [浏览器生命周期记录](2026-09-30-pdf-browser-lifecycle.md)，真实 Next + PM2 停机结果以新的实施记录为准。
