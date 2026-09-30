# PDF 优化独立复核与修复计划

- 日期：2026-09-30；候选：`a494c4f5`；基线：`c5ba0823`。
- 范围：`80cc7086`、`a494c4f5`，共 45 个变更文件；重点读取请求入口、缓存、浏览器池、渲染、快照、授权、打印页、worker 启动、部署约束及对应测试。
- 状态：**待实施；Claude Code 审查与方案复审未完成**。本文不是修复验收或生产发布许可。
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
