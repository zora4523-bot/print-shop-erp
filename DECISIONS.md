# 关键决策记录

> 本文档记录"为什么这样做"。避免三个月后自己或 AI 看代码时一头雾水。
>
> **记录规范**：每条决策包含日期、决策、理由、影响范围、相关文档。**追加式**——不删旧条目，只追加新条目。新条目放在文件**底部**（按时间正序）。

---

## 2026-04-22：技术栈定为 Next.js 16.2.4 + Prisma 7 + Node 24 LTS

- **决策**：运行时锁 Node 24 LTS（Krypton），框架锁 Next.js 16.2.4，ORM 锁 Prisma 7（rust-free client，generator = "prisma-client"），认证锁 Auth.js v5 精确版本。
- **理由**：Node 20 EOL 2026-04-30，Node 24 支持到 2028-04-30；Prisma 7 是当前主线，新项目避免未来升级债；Auth.js v5 仍在 beta，锁精确版本避免次版本突袭 breaking。脚手架初始化时今日装出的稳定版即 Next 16.2.4，业主拍板"以当前稳定版 + 锁精确版本为准，不回退到 15"。
- **影响**：`package.json` 全部核心依赖锁精确版本（无 `^` / `~`），CLAUDE.md §2 全文按此规范，所有后续依赖升级走 PR、禁 Renovate/Dependabot 自动合主版本。
- **相关文档**：CHANGELOG v1.2.1（脚手架校准）、CHANGELOG v1.2 §"运行时与核心库"、CLAUDE.md §2。

---

## 2026-04-22：薪资规则快照化（salaryRuleSnapshot）

- **决策**：所有薪资记录（`ProductionTask.pieceworkAmount`、`DailyWorkerSalary`、`CustomerServiceCommission`、`HourlyWorkerPayroll`）写入时，必须同步把当时生效的 `SalaryRule` 完整序列化进 `salaryRuleSnapshot` 字段。
- **理由**：薪资算错 1 元老板信任就崩。薪资规则随时可能调整（提成档位、计件单价、保底金额），如果只引用 `SalaryRule.id`，改规则会回溯篡改历史工资，引发劳资纠纷且无法稽核。快照化后改规则只影响新建记录，历史可追溯。
- **影响**：所有 `lib/salary/*` 业务函数都必须在生成记录前 fetch active rule + write snapshot；Prisma schema 相应表必须有 `salaryRuleSnapshot Json` 字段；测试覆盖必须验证快照内容与 rule 一致。
- **相关文档**：CLAUDE.md §4.4（铁律）、SPEC v1.1 §"薪资体系-关键机制"、CHANGELOG v1.1。

---

## 2026-04-22：工单不含价格字段，价格只在账单/报价系统体现（已取代）

> **已被 2026-07-31“工单修改走审核版本流，业绩、收款、成本使用独立流水”取代。** 现行工单保存 `totalAmount`；客服业绩由工单提交/批准变更/取消事件记账，客户付款不改业绩。以下保留为历史背景，不再是当前规范。

- **决策**：`Order` / `OrderItem` 表**不存**最终成交价；`OrderItem.suggestedPrice` 仅作为系统建议价展示，不参与账单计算。最终金额由销售/客服**手填进账单**，客服业绩按手填金额累计。
- **理由**：业主明确"尊重实际成交价"——红包印刷有大量临时议价、老客户折扣、人情单等场景，强制系统算价会失真。把"工单"和"价格"解耦，工单专注生产流转，账单/报价独立模块负责金额。
- **影响**：Prisma schema 中 `Order` 不加 `totalAmount`；账单模块（P0-6 应收账单）独立建表；客服业绩聚合直接读账单的手填金额，不读工单。
- **相关文档**：SPEC v1.1 §"价格策略调整"、CHANGELOG v1.1 §"价格策略调整"、CHANGELOG v1.2 "MVP 范围调整 P0 含全套薪资体系"。

---

## 2026-04-22：数据库使用独立的 Pigsty 实例

- **决策**：PostgreSQL 16 通过 Pigsty 部署管理，本项目使用**独立**的 Pigsty 实例（不与其它业务共享）。备份用 Pigsty 自带的 `pgbackrest`，不自己写备份脚本。
- **理由**：Pigsty 对应用层完全透明（Prisma 连接字符串无差异），但能拿到生产级备份/监控/扩展管理（pg_cron、pg_stat_statements）。独立实例避免薪资数据与外部业务混用导致的隔离与合规问题。
- **影响**：`schema.prisma` 无需任何 Pigsty 适配；`DATABASE_URL` 指向独立 Pigsty 即可；定时任务（如客服周期结算、每日师傅日薪）可借 `pg_cron`，不需引入 Redis/MQ。
- **相关文档**：CLAUDE.md §2 "关于 Pigsty"。

---

## 2026-04-22：OSS 直传方案（前端拿 STS token 直传），禁止后端代传

- **决策**：阿里云 OSS 文件上传走"前端直传"——后端通过 `lib/oss/` 签发临时 STS token，前端拿 token 直接上传到 OSS，后端只接收回调 + 落库元信息。**禁止**让前端把文件 POST 到 Next.js 服务器再由后端转发到 OSS。
- **理由**：CDR 源文件可达几十 MB，代传会吃满 ECS 出口带宽并阻塞 Next.js 请求池；直传由 OSS 自己扛流量，服务器只签 token + 写表（毫秒级）。
- **影响**：`lib/oss/` 必须实现 STS token 签发；上传组件用阿里云 OSS Browser SDK 或 ali-oss；CSP / CORS 需配置允许浏览器跨域 PUT 到 OSS bucket；Next.js API route 不接收文件 body，只接收回调元数据。
- **相关文档**：CLAUDE.md §2"文件存储"行、CHANGELOG v1.2 §"运行时与核心库" 文件上传行。

---

## 2026-04-22：密码策略 A/B/C（登录 + 自服务改密 + 老板重置）

- **决策**：
  - **A**：密码 ≥ 8 位；老板重置和用户自服务改密时 **≤ 72 UTF-8 字节**（纯英文约 72 字符、含中文约 24 字符）。登录校验不强加字节上限（兼容历史密码）。
  - **B**：Auth.js v5 只用 Credentials + JWT，不接 Prisma Adapter（MVP 不需要 Account / Session / VerificationToken 表）。
  - **C**：JWT session 有效期 **7 天**。（**已被 2026-07-08 决策覆盖为 30 天**）
- **理由**：
  - bcrypt 只哈希前 72 字节,允许更长密码会让用户在登录时能用任意后缀匹配,安全削弱。老板重置 / 用户改密是"新设密码"场景,必须硬拒。登录是"核对既有"场景,保留宽松避免锁住存量。
  - 不接 Prisma Adapter 省一套 migration + 表;以后要加 OAuth / 邮件验证再补。
  - 7 天 JWT 对工厂日常操作足够;JWT 撤销靠 `AUTH_SECRET` rotate（生产事件再说）。
- **影响**：`lib/auth/schemas.ts` 的 `changePasswordSchema.newPassword` 和 `resetUserPasswordSchema.newPassword` 用单个 `superRefine` 短路实现 char-cap + byte-cap 双重守卫(Codex round 10 → 12)。`lib/auth/config.edge.ts` `session.maxAge = 60*60*24*7`。Auth.js Adapter 包虽在依赖里但不启用。
- **相关文档**：CLAUDE.md §2（"认证 Auth.js v5"行），`lib/auth/schemas.ts` 头注释，memory `workflow_codex_review`。

---

## 2026-04-23：最后一位活跃 OWNER 的原子不变量（PG advisory xact lock）

- **决策**：所有修改 OWNER 角色或活跃状态的操作（`updateUser` / `setUserActive`）**必须**在 `db.$transaction` 里 + `SELECT pg_advisory_xact_lock(hashtext('print-shop-erp:account:owner-invariant'))` 前置锁。
- **理由**：没有锁时，两个并发请求可以各自观察到"还有 1 位活跃 OWNER"然后一起 commit → 0 位活跃 OWNER,系统无人能管理。advisory lock 每事务粒度,廉价,无需改隔离级别,任何第二事务拿同一把锁会阻塞到第一个 commit(Codex round 13)。
- **影响**：`lib/account.ts` 里 `assertNotStrandingSystemInTx(tx, …)` 基于 `tx.user.count` 在事务内做,不能用默认 `db`。新写的任何跨行一致性守卫（比如"至少一位活跃车间主管"、"客服周期唯一"等）都按同款 advisory lock key 命名空间（`print-shop-erp:<domain>:<invariant>`）。
- **相关文档**：`lib/account.ts` `OWNER_INVARIANT_LOCK_KEY` 附近注释、Codex round 13 commit message。

---

## 2026-04-23：Codex review 自动化（`codex exec -m gpt-5.4`）

- **决策**：Codex review 由 Claude Code 自己用 `codex exec --sandbox read-only -m gpt-5.4` 非交互调用，不再要求业主手动跑 TUI 并回贴结果。`codex-auto-review` 模型（TUI `/review` 专用）**不通过 exec 暴露**，用 `gpt-5.4` 配自写 prompt 等效替代。
- **理由**：CLAUDE.md §11 原文划分是"人驱动 Codex"，实际上 Codex 的 CLI 支持 headless 执行。早期 15 轮 review 每轮要业主手工触发 + 粘贴结果 + Claude 修，摩擦太大。自动化之后 Claude Code 一次 commit 就能自审,业主只看分水岭决策。
- **影响**：新的工作流——commit → `codex exec` 自审 → 有 actionable 就修再 commit → clean 就继续下一切片。大决策或首次方向选择仍由业主拍板。`.codex/` 里已登录 ChatGPT 账号,无额外配置。**Prompt 必须用 stdin 管道传入（`echo "..." | codex exec -m gpt-5.4 -`）**,不能作为 positional argument — 观察到带 backtick 的 prompt 被 shell 吃掉后 codex 挂在 "Reading additional input from stdin..."。
- **相关文档**：memory `workflow_codex_review.md`、CLAUDE.md §11（未改，实操和文档有差,待下一次文档修订对齐）。

---

## 2026-04-23：字典类 CRUD 的 activation 单源（`setXxxActive` 独占）

- **决策**：所有 `/owner/{resource}/[id]` 编辑页上，**基本信息表单不包含 `isActive` 字段**；激活/停用只通过独立的 `ToggleActiveButton` 卡片触发。对应 `updateXxxSchema` 不再声明 `isActive`（schema 会 strip 任何意外提交的 `isActive` key），`lib/xxx.ts updateXxx` 的 `UpdateXxxData` 也不含 `isActive`。
- **理由**：Codex round 24 指出双控件风险——表单里的 `isActive` checkbox 和下方的 ToggleActiveButton 都能改活动态，操作者保存表单时可能意外翻转，同时另一块 UI 声称自己是唯一入口。对账号模块尤其危险（可能误停用最后一位 OWNER）。拆开后："保存修改"只动基本信息，"停用/启用"是专门的二次确认动作。
- **影响**：account / craft / product 三套 CRUD 均按此规范；后续字典类模块（如薪资规则、推送渠道）同款处理。`setUserActive` / `setCraftActive` / `setProductActive` 继续承担不变量检查（最后一位 OWNER、自停用等）。
- **相关文档**：`lib/auth/schemas.ts`（`updateXxxSchema` 注释）、`lib/account.ts updateUser` 注释、Codex round 24 commit。

---

## 2026-04-23：create action 成功后 redirect 到新记录的编辑页

- **决策**：所有 `createXxxAction`（account / craft / product，后续工单等同款）在成功路径**不返回** `{ status: 'success' }`，改为 `revalidatePath(列表路径)` 后 `redirect('/owner/{resource}/<新 id>')`。操作者直接被送到新记录的编辑页。
- **理由**：Codex round 24 指出：返回 success 后表单短暂显示"✓ 已保存"就没了，操作者容易没看见就重复点击 → 创建重复记录。送到编辑页一次性解决三件事：明确的视觉反馈、避免重复提交、如需调整可直接继续改。
- **影响**：Server Action 调 `redirect()` 后抛 NEXT_REDIRECT，`useActionState` 不会看到 success 状态。现有表单组件的 "✓ 已保存" 分支对 update 路径仍有效（update 不 redirect），对 create 路径因 redirect 抢先而基本看不到 —— 可接受。测试要 mock `next/navigation` 让 `redirect` 抛可识别的错误。
- **相关文档**：`actions/owner-accounts.ts createUserAction`(同款在 crafts/products)、Codex round 24 commit。

---

## 2026-04-23：OSS 直传脚手架先于 STS SDK（"占位打桩"）

- **决策**：P0 #3 Slice C 把 OSS 上传流程拆成两半。`lib/oss/config.ts` 读齐 env 并返回 `{ configured: true, cfg }` / `{ configured: false, missing }`；`signDesignUpload` 做完 validate + 权限 + 路径注入防御后调用 `signViaSts`，后者是故意抛 `OssNotWiredError` 的桩。UI 层看到 `status: 'not-configured'` 显示禁用态 + 缺失 key 列表；看到 `OssNotWiredError` 知道 env 配齐了但 STS SDK 还没装。
- **理由**：红包厂 OSS 账号/STS role 得业主申请后才到，但工单创建 / 设计图列表展示不能阻塞到那一天。"占位打桩"让 UI 契约稳定（`SignUploadResult` 四态 discriminated union 不会变），真实 SDK 落地时只替换 `signViaSts` 的 6 行实现。
- **影响**：`lib/oss/types.ts` `SignUploadResult` 是稳定契约——实现 STS 不改这个文件。`lib/oss/config.ts deriveBucketUrl` 从 `OSS_ENDPOINT` 派生 upload 主机（Codex round 31–33），支持 VPC / 内部 / HTTP-only / custom-port。`publicBaseUrl`（CDN / 自定义域名）只用于读，永远不写。路径前缀 `design/<orderId>/<orderItemId>/<fileType>-<uuid>.<ext>`；orderId / orderItemId 过 `SAFE_ID_RE = /^[A-Za-z0-9_-]+$/` 防 `..` / `/` 注入（round 29）；扩展名按 `fileType` 核对，防 `application/octet-stream` 的 CDR 通道被任意文件复用。
- **相关文档**：`lib/oss/` 全文件、SPEC v1.2 附录 H、Codex rounds 29 / 30 / 31 / 32 / 33。

---

## 2026-04-23：工单打印 + PDF 双通道共享同一组件

- **决策**：`/print/orders/[id]` 是独立的 top-level 路由段，不走 `/orders` 下的导航 layout。浏览器打印通道链接到 `?autoprint=1`，client 端 `AutoPrint` 组件 `useEffect` → `window.print()` → `afterprint` 关闭窗口。PDF 通道是 `GET /api/orders/[id]/pdf`，服务端 `renderToStaticMarkup(<OrderPrintLayout />)` 得到 HTML，Puppeteer `page.setContent(html, { waitUntil: 'networkidle0' })` → `page.pdf()`，不做本机 HTTP 二次 round trip，不用转发 session cookie。
- **理由**：SPEC 附录 E.1 明确"两通道共用同一个 React 组件"。走 localhost hop 要解决 cookie 透传 + 自引用 URL 解析，复杂度高且重复鉴权。`setContent` 方案让 PDF 路由完全在进程内渲染，只有 OSS 图片 URL 会触发外部请求（由 `networkidle0` 等）。拆 `/print` 为独立 segment 是因为 Next.js App Router 没有"跳过父 layout"的正交开关。
- **影响**：`lib/order/print-layout.tsx` 是纯函数组件，接收 `PrintOrder` 视图模型（craft IDs 在 page 层被解析成名字、role enum 解成中文 label）。`lib/pdf/render.ts` 是通用 wrapper，未来薪资单、账单都走同一个 `renderHtmlToPdf`。`lib/order/print-html.tsx` 的 `<title>` 注入用 `escapeHtml` 硬化（早期 review 确认 orderNo 目前是 ASCII，但加防御）。PDF route 回传 RFC 5987 双份 `Content-Disposition`（round 34）。`qrcode.react` SVG 变体用在 server-render 完全 OK。
- **相关文档**：`app/print/orders/[id]/page.tsx`、`app/api/orders/[id]/pdf/route.ts`、`lib/pdf/render.ts`、SPEC 附录 E、Codex rounds 34–35。

---

## 2026-04-23：P0 #3 工单编辑走 E-lean（top-level 字段 only）

- **决策**：P0 #3 Slice E 的编辑能力只覆盖 Order 表顶层字段（customerRef / 收货信息 / 包装要求 / 备注 / isUrgent）。款式（OrderItem）的增删改（use field array、per-row diff）**不进 P0**，业主临时处理方式是"取消旧工单、新建"。SPEC §3.6 的"DRAFT / SUBMITTED 全部可改"在 E-lean 诠释下指向"全部顶层字段可改"。
- **理由**：E-full 的实质复杂度是 OrderLog 按字段 diff 渲染 + RHF useFieldArray 联动 + item 级 OSS 设计图增删同步。业主明确判断：款式级编辑在实际业务里是低频操作（大多数修改是改收货信息 / 备注），把这部分放 P1 单独跟，不拖 P0 #3 的节奏。
- **影响**：`lib/order/editable-fields.ts` 实现 FULL / SHIPPING_ONLY / NONE 三档，`FULL_EDITABLE_FIELDS` 和 `SHIPPING_EDITABLE_FIELDS` 是 readonly tuple 常量，防御性地做 pickEditableFields 二次过滤——就算 action 层 schema 放行 customerRef，lib 层在 SHIPPING_ONLY 状态下也会 drop。`updateEditableOrderSchema` 所有字段都 `.optional()`（partial update 语义：缺 key = 不改，空串 = 清空为 null）；`optionalFormBoolean` 把 undefined 和 false 严格区分，防止表单缺 checkbox 时 isUrgent 被意外翻成 false。UI 在 detail 页按 `isOrderEditable(status)` + ownership 条件渲染 "编辑" 链接和急单 toggle；edit page 再次 check fieldset，NONE 直接 redirect 回 detail。
- **相关文档**：`lib/order/editable-fields.ts`、`lib/order.ts updateOrderFields`、`components/business/order/EditOrderForm.tsx`、SPEC §3.6、P1 ticket TODO "工单款式级编辑（E-full）"。

---

## 2026-04-23：生产计件口径定为"合计压片数"（completed + defect + rework）

- **决策**：`reportTask` 把 `totalPressed = completedQty + defectQty + reworkQty` 作为喂给 `calcMachinePiecework` 的数量。每一次下压——无论合格、不良还是返工——都消耗了师傅一次操作，计件金额按总压片付。不良 / 返工 数量只做 QC 追溯，不影响薪资。
- **理由**：SPEC §5.2 算法伪代码里 `quantity = task.quantity`，例子里的"下数 = 数量 × 倍率"是基于总压片次数的，不区分好坏。把 completedQty 作为唯一计件口径会让师傅在不良率高的任务上被扣双倍工资（操作数还是付了但不算钱）——不公平。业主如果将来想推"按合格数付"的激励机制，在 `calcMachinePiecework` 的入参处改一行即可，snapshotted rule 保护历史数据。
- **影响**：`lib/production.ts reportTask` 明确注释这一口径；测试里"合格 4900 + 不良 50 + 返工 50 = 总压 5000"对应 SPEC §7.1 的 T2 期望（40 元）。前端 `ReportTaskForm` 描述里写明&ldquo;合计压片 × 单价&rdquo;的语义。
- **相关文档**：`lib/production.ts:560` 注释、`components/business/production/ReportTaskForm.tsx:46` 文案、SPEC §5.2 / §7.1 / §7.2、`lib/salary/machine-piecework.ts`。

---

## 2026-04-23：工单状态级联由 lib 层统一做，两道 advisory lock 分别管不同不变量

- **决策**：Order 状态级联（SCHEDULING → IN_PRODUCTION → COMPLETED）集中在 `lib/production.ts beginTask / reportTask` 完成，UI 层和 action 层都不重复。两个独立的 advisory xact lock namespace：
  - `print-shop-erp:schedule:order:<id>` 序列化 `scheduleOrder` 的"提交→排产"入口；
  - `print-shop-erp:task:<id>` 序列化单个 ProductionTask 的同时读写；
  - `print-shop-erp:order-cascade:<orderId>` 序列化同一 Order 下多个任务的并发级联。
  进入 cascade 锁后必须 re-read Order.status（`order.findUnique` 新鲜读），不信任事务开头的 snapshot。
- **理由**：状态机之外，Order-level 和 Task-level 的跨行不变量是两类竞争（调度双击 vs 报工双击同任务 vs 不同任务同时完工），三把锁刚好切开。Cascade 锁后再读 Order 是 Codex round 39 明确的 race：并发报工最后两个任务时，第二个 tx 会持着 stale `status=IN_PRODUCTION` 去发重复的 `STATUS_CHANGE` OrderLog——fresh-read 才能检测"另一个 tx 已经替我完成级联了"。
- **影响**：`EditTxClient` / `TaskTxClient` / `ScheduleTxClient` 都带 `$queryRaw` 条目；任何新的跨行不变量（比如发货 / 完工的计数守卫）按同款 `print-shop-erp:<domain>:<invariant>` 命名空间做；cascade 分支必须 `if (freshStatus === expectedStatus)` 再写。
- **相关文档**：`lib/production.ts` `scheduleLockKey` / `taskLockKey` / `orderCascadeLockKey`、Codex rounds 37 / 39、`lib/account.ts OWNER_INVARIANT_LOCK_KEY` 的命名先例。

---

## 2026-04-23：外协单作为独立记录，不阻塞 Order 级联（MVP）

- **决策**：`OutsourceOrder` 是独立的 CRUD 记录；`scheduleOrder` 见到外协工艺时"skip + 记外协数"，不生成 ProductionTask，也不要求外协 RECEIVED 后才能排产。外协回货只是状态更新，**不触发** Order 任何状态级联。
- **理由**：SPEC §3.2 文字上暗示"外协回货后 → 工单可排产"的串行依赖，但业主实际场景里是"内部任务和外协并行跑，回货和完工各自记账"。强制串行化会让 UI 变复杂（需要在 foreman 视图里阻塞排产按钮、做二次确认），MVP 不值得。Slice C 做到"可录入、可标记回货、可取消"就足够覆盖老板日常看板需求。
- **影响**：`lib/outsource.ts` 所有函数都是单表操作，无 tx、无 advisory lock（跨行不变量不存在）；`lib/auth/schemas.ts` 新增的 `optionalDateField` 用严格 `YYYY-MM-DD` 正则 + UTC 回环校验拒绝 `2024-02-31` 之类的日历非法日期（Codex round 41）。如果业主将来希望把外协 RECEIVED 作为某个状态转换的前置条件，加一条 `WHERE status = 'RECEIVED'` 的 gate 即可，不影响现有数据。
- **相关文档**：`lib/outsource.ts`、`lib/outsource/status-machine.ts`、`lib/auth/schemas.ts` `parseStrictYmd`、SPEC §3.2 / §4.3、Codex round 41。

---

## 2026-04-24：已发放薪资记录拒绝重算（finance-of-record 守卫）

- **决策**：`DailyWorkerSalary` / `HourlyWorkerPayroll`（以及所有未来同构的薪资结果表）一旦 `isPaid=true`，重算流程一律抛错 `DailySalaryError`/同类；owner 必须先点&ldquo;撤销发放&rdquo;才能触发重算，然后重新标记已发。`CustomerServiceCommission` 同理以 `isFullyPaid` 作为 gate。
- **理由**：薪资记录在师傅 / 客服签收之后就是 finance-of-record。Codex round 43 指出当时 `computeDailyWorkerSalary` 的 upsert `update` 分支虽然没写 isPaid，但仍会用新规则 / 新汇总覆盖 baseSalary / actualSalary / salaryRuleSnapshot，历史可能被悄悄改写。拒绝重算 + 要求显式撤销是唯一能让审计链路保持可见的做法。
- **影响**：`lib/salary/daily.ts` 在 upsert 前先 `findUnique` 读 isPaid；`CustomerServiceCommission.salaryRuleSnapshot` 写在 settle 时一次定版后就不再覆盖（配合 migration `20260424015000_cs_commission_snapshot`）。Slice C 时薪工实现时沿用同规则。
- **相关文档**：`lib/salary/daily.ts` `computeDailyWorkerSalary`、Codex round 43 / P0、CLAUDE.md §4.4。

---

## 2026-04-24：客服业绩流的并发序列化 — 锁 CS user 不锁 period（部分取代）

> **锁粒度决策仍有效，“账单付款累加业绩”已被 2026-07-31 事件账本决策取代。** 现在 `recordCsSalesEntryInTx`、周期结算和客服工资发放共用 CS user advisory lock；`BillPayment` 不参与客服业绩。

- **决策**：`accumulateCsSales`（每笔账单付款累加业绩）和 `settleCsPeriod`（周期结算）之间的并发正确性通过 `pg_advisory_xact_lock(hashtext('print-shop-erp:cs-user:<csUserId>'))` 序列化——锁**以客服 id 为键**，不是 period id。
- **理由**：per-period 锁解不了"找 period → 拿锁"之间的竞争：accumulate 必须先查当前 IN_PROGRESS period 才能拿到 period id 去加锁，而两次读之间 settle 可能已经把这个 period 切到 SETTLED，accumulate 拿到锁后仍会向已 SETTLED 的 period 累加 totalSales，导致 `SalaryPeriod.totalSales != CustomerServiceCommission.totalSales`（Codex rounds 45 P0 → 46 P0）。锁 CS user 让两个流程都能在读 period **之前**拿到锁，critical section 内 period 状态是稳定的。
- **影响**：`lib/salary/cs.ts csUserLockKey` 命名空间；`settleCsPeriod` 先做 `findUnique select csUserId`（ID 不可变，不 race），再拿锁，再全读；`accumulateCsSales` 直接用传入的 csUserId 拿锁。P0 #6 账单 mark-paid 调 `accumulateCsSales` 时会自动走这个保护。未来同类型的&ldquo;用户+当前活跃记录&rdquo;模型（例如新的销售周期 / 会员累计）可以按同款范式。
- **相关文档**：`lib/salary/cs.ts csUserLockKey`、Codex rounds 45-47、`lib/production.ts orderCascadeLockKey` 的&ldquo;级联锁命名&rdquo;先例。

---

## 2026-04-24：CS 提成规则全快照（CustomerServiceCommission.salaryRuleSnapshot）

- **决策**：`settleCsPeriod` 在结算时把完整的 `{ tiers: CS_TIERS规则全量, monthlyBase, durationMonths, activeAtSettle: { monthlyBase, durationMonths } }` 写入 `CustomerServiceCommission.salaryRuleSnapshot` Json 列（migration `20260424015000_cs_commission_snapshot`）。单独的 `tierRate` 列已经能复算提成金额，但回答不了&ldquo;2026-Q1 时 tier 5 的档位是什么&rdquo;这种审计问题。
- **理由**：Codex round 45 P1 指出只存 `tierRate` 等于&ldquo;金额可复算但不可审计&rdquo;。tier 表改了之后，月报 / 年审 / 劳资纠纷排查都要回看当时规则，不存全量就只能靠 SalaryRule 历史版本拼回——而 SalaryRule 的版本化是 effectiveFrom/To 区间，改规则不一定会落一条新行。直接在 commission 上冻结快照是最便宜、最直接的审计手段。
- **影响**：所有 `CustomerServiceCommission` 写入都附带 snapshot；读侧的前端目前不展示（Slice D 只聚合金额），但审计需要时可以按 id 读出完整规则快照。P0 #5 Slice C 的 `HourlyWorkerPayroll` 沿用同样的冻结策略（schema 已有 `salaryRuleSnapshot Json` 列）。
- **相关文档**：`lib/salary/cs.ts settleCsPeriod`、`prisma/migrations/20260424015000_cs_commission_snapshot/migration.sql`、CLAUDE.md §4.4、Codex round 45。

---

## 2026-04-24：Cron 端点统一 shared-secret Bearer，CRON_SECRET 未设置时 503

- **决策**：所有 `/api/cron/*` 端点采用 `Authorization: Bearer $CRON_SECRET` 鉴权。当 `CRON_SECRET` 环境变量**未设置**时，端点返回 **503 Not Configured**（不是 401/200）；设置后未匹配才是 401。目前已有 `/api/cron/daily-salary`、`/api/cron/cs-settle`，Slice C 的 `/api/cron/hourly-payroll` 会沿用。
- **理由**：生产环境若把 CRON_SECRET 忘了设置，401 会让 cron 无声失败（pg_cron 不一定告警），200 会让 endpoint 变开放。503 是&ldquo;明确拒绝服务&rdquo;——监控 / 告警会立即发出，不会静默数据。
- **影响**：部署 checklist 必须加&ldquo;设置 CRON_SECRET 环境变量&rdquo;。CI 测试无需配置此变量——端点未被触发时不会检查。pg_cron 或外部调度器调用时，`curl -H "Authorization: Bearer $CRON_SECRET"` 带上即可。
- **相关文档**：`app/api/cron/daily-salary/route.ts`、`app/api/cron/cs-settle/route.ts`、HANDOFF.md 约束提醒。

---

## 2026-04-24：厨师请假 MVP 按"不折扣月薪"处理（TODO 需业主确认）

- **决策**：COOK workerType 的月薪 `monthlyBase`（默认 3000）与 `normalHours` / `otHours` 完全解耦——请假整月照发 3000，请假 + 代班打包则额外 + `spareHours × PACKER 时薪`。`calcHourlyPayroll` 的 COOK 分支对 normal/ot 一律忽略。（已被 2026-09-24「删除清废/厨师工种与清废工艺」取代）
- **理由**：SPEC §5.4 / §7.4 只给了 `base + spare_pay` 公式，未定义请假扣款；业主没明确表达过扣款需求。MVP 简化为"月薪常量"避免引入应出勤天数 / 自然天数 / 法定假日等配置项。如果未来业主说"请假多了要扣"，改 `calcHourlyPayroll` COOK 分支一行 + 加 `absenceDays` migration 即可，历史 snapshot 保护已发放月份。
- **影响**：`lib/salary/hourly-payroll.ts calcHourlyPayroll` + `lib/salary/__tests__/hourly-payroll.test.ts "请假整月"` 用例 pin 住当前语义。PROGRESS.md 列为待澄清问题；DECISIONS 重审时如业主推翻，测试会先 red。
- **相关文档**：`lib/salary/hourly-payroll.ts:88`、`lib/salary/__tests__/hourly-payroll.test.ts "场景: 请假整月"`、SPEC §5.4 / §7.4、Codex rounds 48-49。

---

## 2026-04-24：加班边界采用闭区间下限（>= otStart 即计入）

- **决策**：`WORK_HOURS.otStart`（默认 `18:00`）定义加班计时的**下限闭区间**——`otHours = max(0, endTime − 18:00)`。到达 18:00 本身 otHours=0；18:30 → 0.5；19:00 → 1.0。
- **理由**：SPEC §5.4 语焉不详；闭区间下限是最直观的&ldquo;从这一刻起的分钟都算加班&rdquo;语义，与&ldquo;加班从 18:00 开始&rdquo;的业务共识最贴。
- **影响**：MVP 考勤录入是主管手填三个数字（normal/ot/spare），后端不再从 startTime/endTime 自动切分——这条语义主要影响 UI hint 文档 + 未来如果加入自动派生会参考。`getActiveWorkHours` 返回的 `otStart` 字符串就是这条边界。
- **相关文档**：`lib/salary/rules.ts WorkHoursConfig`、SPEC §5.4 "加班起始 18:00"、Codex rounds 48-49。

---

## 2026-04-24：考勤 = 每日一行；请假 = 无行

- **决策**：`Attendance` 模型按 `@@unique([workerId, date])` 一人一天一条；主管每天录入三个小时数字；**请假 = 删除该行**或**从未录**。月结聚合直接 `findMany` 当月所有行并 `sum` —— 无行的日子自动不贡献工时。
- **理由**：比引入 `isLeave` 枚举状态简单；主管删除即代表"这天没上班"；聚合 SQL 不需要过滤 status。副作用：COOK 月薪 flat（DECISIONS 同条），无行的月份也发 3000——符合"不折扣月薪"约定。
- **影响**：`recordAttendance` upsert 幂等（主管重录覆盖；createdById 保留原作）+ `removeAttendance` idempotent delete（row 不存在也返回 success）。车间主管 UI `/foreman/attendance` 日历网格里用 Badge "未录" 标识请假态。如果将来业主要求区分"请假 vs 漏录"，加 `isLeave` 字段。
- **相关文档**：`lib/attendance.ts recordAttendance / removeAttendance`、`app/foreman/attendance/page.tsx`、Codex review constraint walk round 49。

---

## 2026-04-24：Cron 响应只返回计数，细节走 owner UI

- **决策**：所有 `/api/cron/*` 端点（daily-salary / cs-settle / hourly-payroll）**响应 COUNTS ONLY**，不返回 `settled` / `errors` 的完整消息。Owner 需要看每行详情 / per-worker 失败原因时，走 `/owner/salary/*` 页面（认证 session 内）。500 路径也 scrub `err.message`，用通用"批处理失败；查看 owner 页面确认"替代。
- **理由**：Codex rounds 49-50 连续打到：（a）`settled` 数组直接携带 per-worker totalSalary，流到 pg_cron / 调度器日志；（b）paid-row 拒绝重算的 `err.message` 里 embed 了 `existing.totalSalary`（for UI 可读），批处理 abort 时走 500 路径把消息原样返回。两者都在**认证链路之外**（cron 调用是 server-to-server shared secret）落到**可能被留存的日志**里——薪资数据不应该在 ops 日志里出现。
- **影响**：`computeDailyForAllMachineWorkers` 改成 per-worker try/catch 返回 `{ settled, errors }`（round 50，统一三个批处理的模式）。Owner 端 action（如 `recomputeDailySalaryAction`）**仍**返回完整 errors[]（通过认证 HTTPS，直给 owner 看）——`RecomputeDailyForm` 渲染 errorCount + 失败列表。未来新增 `/api/cron/*` 端点按同模式处理。
- **相关文档**：`app/api/cron/daily-salary/route.ts` / `cs-settle/route.ts` / `hourly-payroll/route.ts`、`actions/owner-salary.ts`、Codex rounds 49-51。

---

## 2026-04-24：HourlyWorkerPayroll 的 per-(worker, month) advisory lock + now 贯穿

- **决策**：`computeHourlyPayroll` 全程跑在 `db.$transaction` 内，开头拿 `pg_advisory_xact_lock(hashtext('print-shop-erp:hourly:<workerId>:<month>'))`；`markHourlyPayrollPaid` 取同一把锁。规则解析的 `now` 一路贯穿到每个 `getActive*` 调用。
- **理由**：Codex round 48 打到两处：（a）isPaid check 与 upsert 之间 finance 若并发 mark-paid，upsert 会覆盖一条&ldquo;已发放&rdquo;行的金额列（P0）；（b）批处理里每个 worker 的规则解析各自调 `new Date()`，如果中途规则被改，同一批次的不同 worker 会 snapshot 不同规则版本（P1）。Lock + 贯穿 now 是同样的双管齐下——锁挡并发、时间戳挡版本漂移。
- **影响**：后续每条薪资写入路径（如未来的 bonus / deduction 表）按同款双保护；daily-salary 也有同类 race（Codex round 48 注意），但 PROGRESS.md 记为&ldquo;待补&rdquo;；如果业主 push 就先补 daily，再动手 P0 #6。
- **相关文档**：`lib/salary/hourly-aggregate.ts hourlyLockKey`、Codex rounds 48 / 49，对应已有 CS 的 `csUserLockKey`（rounds 45-46）先例。

---

## 2026-04-25：应收账单 mark-paid 与 CS 累计共享同一个事务（tx threading，已取代）

> **已被 2026-07-31 事件账本决策取代。** 客服业绩现在与工单提交/批准变更/取消共享事务；客户收款只原子追加 `BillPayment` 并更新应收快照，不调用业绩累计。以下保留为历史背景。

- **决策**：`lib/salary/cs.ts accumulateCsSales(csUserId, amount, at, tx?)` 接受可选第 4 参数 tx。当账单 `recordPayment` 在自己的 `db.$transaction` 里调用时，传入 tx 让 CS 业绩累计的 `SalaryPeriod.totalSales += delta` 与 bill.paidAmount 的写入 **共享原子性**——一起 commit 一起 rollback。standalone 调用（未来可能的其他入口）不传 tx，自己开事务。
- **理由**：Codex round 52 / P1 指出 Prisma 的 `$transaction` 不是真的嵌套——`recordPayment` 外层 tx 里再 `await accumulateCsSales(...)`，内部会再开一个独立事务。内部先 commit，如果外层后续 rollback（比如 Decimal.js 精度断言失败 / 写 OrderLog 失败），`SalaryPeriod.totalSales` 已经涨了 delta，但 `bill.paidAmount` 回到旧值——payroll ledger 跑到 billing ledger 前面，提成多算。
- **影响**：`accumulateCsSales` 拆成 `accumulateCsSalesIn(tx, ...)`（真实逻辑）+ `accumulateCsSales(csUserId, amount, at, tx?)`（公开 API 包壳）。所有跨模块调 CS 累计的路径都应该传 tx。未来同款模式：如果 bill module 再长出 `cancelPayment` / `issueRefund`，也应该走 tx-threading 而非独立事务。同模式未来再出现跨模块累计（比如客服退单扣回业绩），API 已经就位。
- **相关文档**：`lib/salary/cs.ts accumulateCsSalesIn` / `accumulateCsSales`、`lib/bill.ts recordPayment`、Codex round 52。

---

## 2026-04-25：应收账单 paid-ledger 语义 — FULLY_PAID 终态（部分取代）

> **负数账单部分已被 2026-08-02 财务账本决策取代。** `FULLY_PAID` 仍为终态；现行系统禁止负数账单，退款/贷项功能尚未实现。以下保留为历史背景。

- **决策**：`Bill.status` 状态机里 `FULLY_PAID` 是终态，不允许回退到 `PARTIAL_PAID` / `ISSUED`。如果业务发生退款 / 冲账，正确做法是 owner 新建一条负数金额的 Bill 做冲账记录（不改已结清的原单）。自反迁移（自我 → 自我）也一律拒绝；例外是 `PARTIAL_PAID → PARTIAL_PAID`（续收部分款），lib 层主动在状态未变时**跳过**状态机调用。
- **理由**：finance-of-record bedrock（DECISIONS 2026-04-24 薪资铁律）同样适用于账单。一旦打标 FULLY_PAID，付款流水与应收快照已成为财务事实，回退账单状态会让历史金额不可信。客户付款不改变客服业绩。续收的场景下金额在变但状态不变，是合理的 no-transition；状态机保留&ldquo;自反即 bug&rdquo;的严格性用来抓 re-issue / re-pay 误用。
- **影响**：`lib/bill/status-machine.ts BILL_TRANSITIONS` 不含任何 self-loop；`lib/bill.ts recordPayment` 显式 `if (targetStatus !== bill.status) transitionBill(...)` 跳过续收的 self-transition。UI 在 detail 页要隐藏 `FULLY_PAID` 单的&ldquo;录入付款&rdquo;按钮（Slice B 落地）。未来 P1 加退款功能时，新加 `ADJUSTED` 或 `CREDITED` 状态、或者保持双账单模式。
- **相关文档**：`lib/bill/status-machine.ts`、`lib/bill.ts recordPayment`、Codex round 52。

---

## 2026-04-26：老板 Dashboard 排行 / 分布按 `Order.submittedAt`，客服周期读事件账本（已修订）

- **决策**：本月销售排行与产品线分布按 `Order.submittedAt` 聚合，不按 `finishedAt` 或客户付款时间。即将结算客服周期的预测直接读 `SalaryPeriod.totalSales + initialSales`，其结算证据是 `CsSalesEntry`，不在 Dashboard 重算。&ldquo;待发货&rdquo;关注列表继续按 `Order.completedAt` 排序。
- **理由**：`submittedAt` 能即时反映当月开单趋势；客服工资结算则必须可对账，因此由提交正数、批准变更差额和取消负数组成的事件账本提供证据。客户付款是应收事实，不是业绩归属时点。
- **影响**：`lib/dashboard/owner-watchlist.ts` 的 `getEndingPeriods` 使用已对账的周期累计；`getSalesRanking` / `getCategoryDistribution` 继续按 `submittedAt` 月聚合。两者服务不同视角，页面文案必须明示时间口径。
- **相关文档**：`lib/dashboard/owner-watchlist.ts`、`lib/dashboard/owner-charts.ts`（Slice C）、`SPEC v1.2 §6 销售业绩看板`。

---

## 2026-04-26：老板 Dashboard 图表选 recharts，锁版本 3.8.1

- **决策**：Slice C 的 3 个图（30 天产量曲线 / 销售排行 horizontal BarChart / 产品线分布 PieChart）用 `recharts@3.8.1`（精确版本，无 `^` / `~`，按 CLAUDE.md §2 锁版本规范）。Server 端 lib 只产纯数据数组；`'use client'` 包裹的 chart 组件接 props 直接渲染。`<ResponsiveContainer>` + `isAnimationActive={false}` 是必备配置（前者解决 SSR 高度 0，后者保证视觉回归基线稳定）。
- **理由**：候选 chart.js / visx / nivo / Apache ECharts 都看了；recharts 选中是 4 条原因的并集——(1) React 19 peer 兼容（v3.x 系列；2.x 不支持），(2) SVG 输出对视觉回归友好（pixel-stable，不像 Canvas-based chart.js 抗锯齿在不同 GPU 上飘），(3) TypeScript 类型完备且 SSR 友好（next/dynamic 兜底也容易），(4) 项目已经用 shadcn 风格，recharts 的纯 component API 比 ECharts 的 `option = {...}` 配置式更贴。代价：bundle ~150KB（接受，dashboard 是 OWNER 内部页，不在公开访问者关键路径）。
- **影响**：Slice C 第一步 `pnpm add recharts@3.8.1`（精确版本）；如果首次 `pnpm dev` 加载报 React 19 相关 hydration warning，回退方案是 `dynamic(() => import('...'), { ssr: false })` 包裹各 chart 组件，但默认走 SSR；图表 props 全部用 `string` / `number`（不传 Decimal，避免序列化崩溃）；视觉回归基线 fixture 走 `seedDashboardChartFixture()` 插入确定性数据，每个 chart 单独 snapshot。未来 P2 如果 dashboard 性能 > 500ms，引入预聚合表（DashboardSnapshot），不换 chart 库。
- **相关文档**：`lib/dashboard/owner-charts.ts`（Slice C）、`components/business/dashboard/*Chart.tsx`、CLAUDE.md §2 版本锁定策略。

---

## 2026-04-27：notify() 是 best-effort 永不抛，业务永不感知推送失败

- **决策**：`lib/notification/notify(event, payload)` 内部 catch all → 永不向调用方抛异常。任何阶段（rule 查询 / 模板渲染 / webhook fetch / NotificationLog 写入）的错误都吞掉，转写到 NotificationLog（status=FAILED + errorMessage）或最坏情况下打 console。调用方（Server Action / cron）写法：`await notify(...)` 后不需要 try/catch，业务事务也不会被推送失败回滚。
- **理由**：SPEC §8.2 已约定&ldquo;失败重试 3 次后写 NotificationLog.status=FAILED，老板 Dashboard 显示告警&rdquo;——这本身就否定了&ldquo;推送失败 → 业务回滚&rdquo;的语义。工单已提交、薪资已结算、外协已超期，这些是业务事实；&ldquo;群消息没发出去&rdquo;不是事实变化、不应回滚事务。把 notify 设计成永不抛后：(a) 调用点写法极简（无 try/catch 噪音）、(b) tx 在 notify 之前已 commit，没有相互污染、(c) NotificationLog 是单一证据来源，dashboard 直接读这张表显示告警。
- **影响**：notify.ts 顶层 `try { ... } catch { /* swallow + best-effort log */ }`；webhook.ts 内部失败 throw 给 notify 上层处理，但永不冒到调用方；调用点（lib/order.ts、lib/production.ts、cron 路由）不写 try/catch；单测断言 `await notify(...)` 不抛；E2E 通过 NotificationLog 行内容检查推送是否触发。**严禁** notify 内部把业务字段（特别是金额）写进 errorMessage——那个字段只存 HTTP 状态码 / 异常类型字符串（DECISIONS 2026-04-24 推论）。
- **相关文档**：`lib/notification/notify.ts`、CLAUDE.md §7、SPEC §8.2、DECISIONS 2026-04-24（cron 响应只返计数）。

---

## 2026-04-27：notify dev / 测试默认 mock-mode，prod 显式 false

- **决策**：`process.env.NODE_ENV !== 'production'` 时 `NOTIFICATION_MOCK_MODE` 默认开启；`production` 时默认关闭，显式 `NOTIFICATION_MOCK_MODE=true` 也支持（演练 / debug 期）。Mock-mode 行为：跳过真实 fetch，写 `NotificationLog{ status: SUCCESS, errorMessage: 'MOCK' }`，给开发 / 测试以"推送已触发"的可见证据。
- **理由**：(a) 测试环境跑 E2E / 单测时 webhook URL 是 fake (`https://qyapi.weixin.qq.com/...key=test`)，真发会被企业微信拒（4xx）然后 NotificationLog 全是 FAILED，混淆"代码 bug"与"测试 webhook 不通"。Mock-mode 让 NotificationLog status=SUCCESS（with errorMessage='MOCK'）作为&ldquo;notify 流程跑通&rdquo;的最简证据。(b) Dev 期 owner 在 /owner/notifications 点&ldquo;测试&rdquo;按钮：mock-mode 下立刻写 SUCCESS+'MOCK'，让 owner 看到&ldquo;链路通了，只差真 webhook URL&rdquo;，不会以为坏掉。
- **影响**：`.env.example` 默认 `NOTIFICATION_MOCK_MODE=true`；prod 部署时改 `false`（README 上线运维章节加一句）。webhook.ts / notify.ts 第一行读 env，dev 默认走短路。E2E 跑在 `NODE_ENV=development`，自然走 mock-mode；不需要在 spec 里手动 set env。
- **相关文档**：`lib/notification/notify.ts`、`.env.example`、README §🚢 运维。

---

## 2026-06-28：Pigsty 扩展采用白名单分阶段引入，不替代应用层认证鉴权

- **决策**：Pigsty 扩展只作为 PostgreSQL 能力增强，按白名单分阶段引入。第一阶段优先 `pg_trgm` / `pg_bigm` / `citext` / `pg_stat_statements` / `pg_cron` / `pg_net`；第二阶段再看商品动态属性、价格区间、多级分类和拼音搜索（`pg_jsonschema` / `btree_gist` / `ltree` / `pg_pinyin`）；第三阶段处理库存聚合、流水分区、脱敏和审计（`pg_ivm` / `pg_partman` / `anon` / `pgaudit` / `auto_explain` / `index_advisor`）。数据库 JWT、DB 账号安全类扩展不替代 Auth.js、bcrypt、JWT session 和 `PERMISSIONS` RBAC。
- **理由**：项目当前架构已经稳定在 Next.js App Router + Server Actions + Prisma 7 + PostgreSQL + Auth.js。Pigsty 对应用层透明，最适合补搜索、观测、cron、库存聚合、分区、脱敏等数据库能力；把登录/业务权限下沉到数据库 JWT 扩展会和现有 Server Action 权限模型冲突，也无法表达工单归属、薪资快照、账单状态机这些业务规则。分阶段引入能先拿到工单/商品搜索收益，同时避免一开始把生产数据库配置复杂化。
- **影响**：新增 `PIGSTY-EXTENSIONS.md` 作为扩展实施计划。后续扩展 PR 必须先确认属于白名单，并标明启用层级：普通 migration、hand-written SQL migration、还是 Pigsty 集群配置。需要 `shared_preload_libraries` 或后台 worker 的扩展不得只靠 Prisma migration 偷偷启用。所有搜索、库存、分区改动都要保留现有权限 scope、薪资快照和账单 finance-of-record 语义。
- **相关文档**：`PIGSTY-EXTENSIONS.md`、README 文档索引、Pigsty Extension Catalog。

---

## 2026-06-28：商品/账号/物料编码大小写不敏感，产品内部编码命名为 `Product.code`

- **决策**：启用 `citext` 承载大小写不敏感标识。`User.username` 和 `Material.code` 原字段迁移为 `citext`；产品字典新增可选 `Product.code` 作为内部 SKU / 快速检索编码，唯一且大小写不敏感。迁移前用 `lower(...) GROUP BY` 显式检查既有账号名/物料编码是否存在大小写冲突，发现冲突就中止迁移。
- **理由**：ERP 操作员不会稳定区分 `HB001` / `hb001` 这类大小写；让数据库按业务语义保证唯一，比在每个表单里手写 `lower()` 去重更可靠。`Product.code` 先做可选字段，不强迫历史产品补码，也不阻断当前工单录入；真正需要严格 SKU 体系时再把字段改为必填。
- **影响**：产品创建/编辑表单新增“产品编码（选填）”；产品列表和产品搜索包含编码；P2002 唯一冲突映射到 `code` 字段错误。Auth.js 登录仍走 `username` 查找，迁移后由 citext 保证大小写不敏感匹配。
- **相关文档**：`prisma/migrations/20260628001000_add_citext_product_code/migration.sql`、`prisma/schema.prisma`、`components/business/product/ProductForm.tsx`、`actions/owner-products.ts`。

---

## 2026-06-28：报价字典先加数据库不变量，完整报价 UI 后置

- **决策**：PR-4 先落数据库约束，不提前扩展报价 UI。`PriceTier` 启用 `btree_gist` 并增加两个不变量：`effectiveTo` 必须为空或晚于 `effectiveFrom`；同一 `productId + minQty` 的有效期窗口不能重叠。`PriceAdjustment.triggerCondition` 在 Pigsty 环境存在 `pg_jsonschema` 时增加 JSON Schema check，当前只约束为 JSON object，避免在业务语义未确认前过度限制字段结构。
- **理由**：SPEC 已把完整价格阶梯和加价规则降为 P1/P2，但数据库层可以先防止最危险的数据污染：同一商品同一数量档出现多个同时生效价格。`triggerCondition` 目前没有冻结业务 schema，强行定义 required fields 会让后续报价规则难以调整；先保证它是 object，后续报价 UI/规则引擎确定后再收紧 schema。
- **影响**：`PriceTier` 历史数据若已存在重叠窗口，migration 会用明确错误中止。`pg_jsonschema` 约束在本地非 Pigsty PG 缺扩展时会跳过并打印 NOTICE；生产 Pigsty 环境应安装并启用。应用层报价逻辑不变。
- **相关文档**：`prisma/migrations/20260628002000_price_constraints/migration.sql`、`PIGSTY-EXTENSIONS.md`。

---

## 2026-06-28：商品分类树使用 `ltree` 生成列，保留 legacy enum 快照

- **决策**：PR-5 新增 `ProductCategoryNode` 作为商品分类树。应用和 Prisma 写入普通文本 `path`，PostgreSQL 通过生成列 `"pathLtree" ltree GENERATED ALWAYS AS ("path"::ltree) STORED` 做树校验和 GIST 索引；`Product` 新增 `categoryNodeId` 外键。`Product.category` 暂时保留为 denormalized legacy enum，由选中的分类节点 `legacyCategory` 派生写入。
- **理由**：Prisma 7.7 目前不能用 `@db.LTree` 原生表达 ltree；直接让业务代码操作 unsupported 类型会增加维护成本。文本 `path` + 生成列可以让表单、Server Action 和 Prisma Client 维持普通字符串模型，同时把 Pigsty/PostgreSQL 的树索引留在数据库层。保留旧 enum 可以避免订单录入、报表、历史统计一次性重构。
- **影响**：产品创建/编辑从 enum select 改为分类节点 select；老产品迁移时按 enum 映射到默认节点。未来要做真正多级分类管理时，只需要扩展 `ProductCategoryNode` 的管理 UI 和树查询，不需要再改现有产品写入路径。
- **相关文档**：`prisma/migrations/20260628003000_product_category_ltree/migration.sql`、`prisma/schema.prisma`、`lib/product.ts`、`components/business/product/ProductForm.tsx`。

---

## 2026-06-28：拼音搜索优先用 `pg_pinyin` 生成列，不引入 `pg_search`

- **决策**：PR-6 为 `Order`、`Product` 和 `Material` 增加 `searchPinyin` 全拼列和 `searchPinyinInitials` 简拼列，并用 `pg_trgm` GIN 索引加速。Pigsty `pg_pinyin` 可用时，这两列是 `public.pinyin_char_romanize(...)` 驱动的 generated column；非 Pigsty 本地库缺少扩展包时，migration 退化为普通可空列以保持 schema 可部署。应用层仍保留一个 `q` 输入框，查询条件在原中文字段之外追加拼音列 `contains q`。
- **理由**：Pigsty 的 `pg_pinyin` 文档给出了 generated column + trigram search 和 word tokenization + `pg_search` 两条路线。本项目当前搜索目标是工单号、客户名称/简称、收货信息、商品名、物料名这类短文本；先用生成列能覆盖中文/拼音输入，同时不引入 BM25、tokenizer、排序权重和额外扩展依赖。
- **影响**：生产 Pigsty 数据库必须安装 `pg_pinyin` 才算拼音搜索 ready；本地非 Pigsty PostgreSQL 仍可跑完 migration，但 `/owner/pigsty` 和 `app_ops.search_index_readiness` 会把缺失 `pg_pinyin` 报告为 blocker。后续如果搜索需要“精确优先、相似度排序、权重排序”，再单独引入排序表达式或评估 `pg_search`。
- **相关文档**：`prisma/migrations/20260628004000_pinyin_search/migration.sql`、`lib/order.ts`、`lib/product.ts`、`lib/material-inventory.ts`、Pigsty `pg_pinyin` 文档。

---

## 2026-06-28：库存看板聚合使用 `pg_ivm` 优先、普通 view 兜底

- **决策**：PR-7 为 `MaterialTransaction` 增加两个读取对象：`material_inventory_movement_summary`（按物料累计入库、出库、净变动）和 `material_inventory_daily_summary`（按物料 + 上海日期聚合当日入库、出库、净变动）。如果数据库已安装且 preload `pg_ivm`，migration 使用 `pgivm.create_immv(...)` 创建 IMMV；否则创建同名普通 view。应用层通过 `lib/material-inventory.ts` 读取这些对象并结合 `Material.currentStock`、`safetyStock`、`averageCost` 形成库存看板数据源。
- **理由**：`pg_ivm` 官方要求 `shared_preload_libraries` 或 `session_preload_libraries`，不能在普通 Prisma migration 里假装已经完成集群配置。用同名普通 view 兜底可以让本地开发和测试不依赖 Pigsty 包；生产 Pigsty 配好 preload 后才获得增量维护收益。`Material.currentStock` 仍是事务内事实字段，IMMV 只服务看板聚合，不改变库存扣减语义。
- **影响**：物料流水量增大后，Dashboard/物料页可直接调用 `getMaterialInventoryDashboard()`，避免每次请求扫描全量 `MaterialTransaction`。批量导入或大规模回补流水前，需要考虑暂时禁用/重建 IMMV 或执行 `pgivm.refresh_immv(...)` 的运维流程。
- **相关文档**：`prisma/migrations/20260628005000_inventory_ivm_summary/migration.sql`、`lib/material-inventory.ts`、Pigsty `pg_ivm` 文档。

---

## 2026-06-28：`pg_partman` 先落 readiness，不直接重写现有日志表

- **决策**：PR-8 不在普通业务 migration 中直接把 `MaterialTransaction`、`OrderLog`、`NotificationLog` 改成分区表。先创建 `app_ops.partition_candidate` 和 `app_ops.partition_readiness`：列出候选表、分区键、月分区、保留策略、`pg_partman` 可用/安装状态，以及阻塞项。若环境有 `pg_partman` 包，migration 会创建 `partman` schema 并 `CREATE EXTENSION pg_partman WITH SCHEMA partman`。
- **理由**：当前三张表都是 `id` 单列主键；PostgreSQL 原生分区表上的唯一/主键约束必须包含分区键。直接改成按 `createdAt` / `occurredAt` 分区，会牵动 Prisma 主键模型和外键切换。`pg_partman` 的 `create_parent` 适合已经设计为 partitioned parent 的表；对现有生产表应走单独 cutover runbook，而不是静默迁移。
- **影响**：运维可以先查询 `app_ops.partition_readiness`，看到 `parent_table_is_not_partitioned`、`primary_key_does_not_include_control_column`、`incoming_foreign_keys_need_cutover_plan` 等 blocker。未来新建 `AuditLog` 或重构流水表时，先把主键设计为包含分区键，再用 readiness 里的 `create_parent_sql` / `run_maintenance_sql` 接入 `pg_partman`。
- **相关文档**：`prisma/migrations/20260628006000_partition_readiness/migration.sql`、`lib/partition-maintenance.ts`、Pigsty `pg_partman` 文档。

---

## 2026-06-28：`anon` / `pgaudit` 先落敏感策略与 readiness，不在 migration 中执行脱敏

- **决策**：PR-9 新增 `app_ops.sensitive_column_policy`、`app_ops.sensitive_column_readiness`、`app_ops.security_audit_table_readiness` 和 `app_ops.security_extension_readiness`，登记敏感列、生成 `anon` 安全标签建议、生成 `pgaudit.role` 表级授权建议，并检查扩展可用/安装/preload 状态。migration 不执行 `anon.anonymize_database()`，也不设置全局 `pgaudit.log`。
- **理由**：Pigsty `anon` 文档把静态脱敏定义为原地改写数据；这类操作不能混入普通业务迁移。动态脱敏和 `pgaudit` 都依赖 Pigsty/PostgreSQL 集群层 preload 与角色配置，不能由 Prisma migration 单独完成。薪资、账单金额是快照化事实数据，随机化会破坏对账和复现；演示库导出时应显式 redaction，生产库则依赖 Auth.js/RBAC、数据库审计和最小化导出流程。
- **影响**：测试/演示库脱敏流程改为先查询 `app_ops.security_extension_readiness`，再执行 `recommended_anon_steps`、`sensitive_column_readiness.apply_anon_label_sql` 和手工金额 redaction。DBA 直连审计按 `security_audit_table_readiness.audit_grant_sql` 授权到 `erp_auditor`，并建议 `pgaudit.log = 'write, ddl, role'`、`pgaudit.log_parameter = off`、`pgaudit.log_relation = on`，避免全库 SELECT 和 SQL 参数把业务正文刷进日志。
- **相关文档**：`prisma/migrations/20260628007000_security_masking_audit_readiness/migration.sql`、`lib/security-readiness.ts`、Pigsty `anon` / `pgaudit` 文档。

---

## 2026-06-28：`pg_cron` / `pg_net` 和观测扩展先落 manifest + readiness，不自动启用生产任务

- **决策**：PR-10 新增 `app_ops.cron_http_job_candidate`、`app_ops.cron_http_job_readiness`、`app_ops.ops_extension_readiness`、`app_ops.query_observation_candidate` 和 `app_ops.query_observability_readiness`。6 个 `/api/cron/*` endpoint 作为 HTTP cron job manifest 登记，readiness 输出 `cron.schedule(...)` + `net.http_post(...)` SQL；查询观测登记工单搜索、商品搜索、Dashboard、账单、库存、薪资等候选路径。migration 不直接调用 `cron.schedule`。
- **理由**：`pg_cron` 和 `pg_net` 都依赖 Pigsty/PostgreSQL 集群层 preload；`pg_cron` 还要求 `cron.database_name`，`pg_net` HTTP 调用还需要生产域名和 `CRON_SECRET`。这些配置不齐时自动 schedule 会造成无声失败或错误重试。把任务写成 manifest + generated SQL 可以让运维在确认 `app.erp_base_url` / `app.cron_secret` 后显式启用，同时保留外部 cron / 手工 curl 的兜底路径。
- **影响**：生产切到 Pigsty 调度时先查 `app_ops.ops_extension_readiness` 和 `app_ops.cron_http_job_readiness`。只在 `ready_to_schedule=true` 时执行 `schedule_sql`。`pg_stat_statements` 用于持续观察 calls / mean_exec_time / rows；`auto_explain` 只用于短诊断窗口并建议 `auto_explain.log_parameter_max_length = 0`；`index_advisor` 只在诊断环境给索引建议，不把输出自动写进生产 migration。
- **相关文档**：`prisma/migrations/20260628008000_ops_scheduler_observability_readiness/migration.sql`、`lib/ops-readiness.ts`、Pigsty `pg_cron` / `pg_net` / `pg_stat_statements` / `auto_explain` / `index_advisor` 文档。

---

## 2026-06-28：搜索 V1 上线必须有数据库侧 readiness 和 EXPLAIN 清单

- **决策**：新增 `app_ops.search_surface_candidate` 和 `app_ops.search_index_readiness`。工单搜索与商品搜索各登记必需扩展、可选扩展、必需索引、可选 `pg_bigm` 索引、样例查询和上线前 EXPLAIN SQL；`/owner/pigsty` 直接展示这些结果。
- **理由**：`pg_trgm` / `pg_bigm` / `pg_pinyin` 索引是否创建成功，不能只靠 migration 文件存在来判断。生产 Pigsty 可能缺某个扩展包，也可能因为迁移顺序或权限问题缺索引；没有 readiness 时，搜索表面可用但实际退化成全表扫描。把 EXPLAIN SQL 写入数据库侧 manifest，可以让运维按同一条查询检查真实计划。
- **影响**：搜索相关 PR 必须同步更新 `app_ops.search_surface_candidate`，不能只改页面查询条件。`pg_bigm` 仍是可选增强，不作为 blocker；`pg_trgm`、`pg_pinyin` 和必需 GIN 索引缺失会让 readiness 报告 blocker。`Product.code` 是 `citext`，搜索索引统一使用 `code::text` 表达式。
- **相关文档**：`prisma/migrations/20260628009000_search_readiness/migration.sql`、`lib/search-readiness.ts`、`app/(admin)/owner/pigsty/page.tsx`、`PIGSTY-EXTENSIONS.md`。

---

## 2026-06-28：物料先做库存看板和搜索，不在 Pigsty PR 中扩展 CRUD

- **决策**：新增 `/foreman/materials` 作为只读库存看板，使用 `material:manage` 权限，读取 `lib/material-inventory.ts` 汇总结果，展示安全库存、当日出入库、累计出入库和库存金额。物料搜索覆盖 `Material.code`、`Material.name`、`Material.specification`、`Material.unit` 和 `pg_pinyin` 生成的全拼/简拼列，并追加 `pg_trgm` / 可选 `pg_bigm` 索引与 search readiness。
- **理由**：本轮目标是落 Pigsty 扩展路线，而不是补完整物料 CRUD。`pg_ivm` 的业务价值在“流水增长后看板不重扫全表”，所以先把看板和搜索入口打通，让扩展能力可见；物料入库、出库、盘点、CRUD 仍应作为后续库存业务 PR 单独设计状态、审计和库存事务。
- **影响**：FOREMAN 侧边栏“物料”从占位变为 `/foreman/materials`。OWNER 可因 `/foreman` layout 允许 OWNER+FOREMAN 直接访问，但暂不把该入口加入 OWNER 菜单，避免老板后台菜单继续膨胀。后续新增物料写入路径时，必须保证 `Material.currentStock` 和 `MaterialTransaction` 同事务更新，不能只写流水或只改事实字段。
- **相关文档**：`app/(admin)/foreman/materials/page.tsx`、`lib/material-inventory.ts`、`prisma/migrations/20260628008500_material_search_indexes/migration.sql`、`prisma/migrations/20260628009000_search_readiness/migration.sql`。

---

## 2026-06-28：搜索结果先做应用层相关度重排，SQL 仍保留业务稳定排序

- **决策**：新增 `lib/search-ranking.ts`，在 `listOrders`、`listProducts`、`getMaterialInventoryDashboard` 的 `q` 搜索结果上做稳定重排：精确命中优先，其次前缀命中、包含命中、拼音/简拼命中；相同 rank 保留数据库返回顺序。空查询仍完全使用原有业务排序。
- **理由**：当前三个搜索入口都要保留既有权限 scope 和业务默认排序。直接改成 raw SQL `ORDER BY similarity(...)` 会放大鉴权和 Prisma 类型维护面，尤其工单搜索必须保留销售/客服只能看自己工单的 scope。先用应用层稳定重排，可以解决最常见的“精确订单号/编码命中被排到后面”，同时继续让 `pg_trgm` / `pg_bigm` / `pg_pinyin` 负责过滤和索引加速。
- **影响**：搜索列表返回对象会多选隐藏搜索字段用于排序，UI 不展示这些字段。后续如果生产 EXPLAIN 和 pg_stat_statements 证明排序成本或结果质量不够，再单独引入数据库侧 `similarity()` / `word_similarity()` 排序或 `pg_search`，但必须同步更新 search readiness 和权限测试。
- **相关文档**：`lib/search-ranking.ts`、`lib/order.ts`、`lib/product.ts`、`lib/material-inventory.ts`、`PIGSTY-EXTENSIONS.md`。

---

## 2026-06-28：Agent 自动开发只能开 draft PR，不允许自动合并或执行生产操作

- **决策**：新增 `docs/AGENT-BACKLOG.md` 作为自动化任务队列，新增 `docs/AGENT-ROUTINES.md` 作为 routine 执行协议，新增 `scripts/agent-next-task.mjs` 生成下一条 `agent-ready` 任务 prompt，并新增 GitHub PR 模板。自动 agent 可以选择任务、建分支、实现、测试、提交、推送并打开 draft PR；不能自动 merge，不能执行生产 Pigsty 操作，不能处理 `needs-owner-input` / `manual-ops-only` 任务。
- **理由**：项目里还有 OSS、物料事务、分类管理、报价 UI、E2E、Pigsty 生产 runbook 等后续工作，适合用 routine 批量推进。但薪资、账单、库存、分区 cutover、生产 cron、脱敏审计都带业务或生产风险，必须通过 backlog 状态和 PR 审查把自动化边界固定下来。
- **影响**：后续 routine 统一先运行 `pnpm agent:next` 获取 prompt，再按 `docs/AGENT-ROUTINES.md` 执行。每个自动 PR 必须包含选中 backlog 项、验证命令、数据库影响、风险和人工 follow-up。没有 `agent-ready` 任务时 routine 应失败关闭，而不是自行发明任务。
- **相关文档**：`docs/AGENT-BACKLOG.md`、`docs/AGENT-ROUTINES.md`、`scripts/agent-next-task.mjs`、`.github/pull_request_template.md`。

---

## 2026-07-05：STOCK_ALERT 采用出库跨越检测，不用 cron 轮询

- **决策**：SPEC §8.1 最后一个未接线事件 STOCK_ALERT（物料低于安全库存 → 管理群）wire 在库存写路径上：`lib/material.ts applyMaterialStockMovement` 计算跨越标记（本次变动使库存从 >=安全库存 跌破到 <安全库存），由事务外的调用方（`createMaterialTransaction`、`cancelPurchaseReceipt`）在 tx 提交后走 `dispatchNotification` 推送。持续低位的后续出库不重复告警；库存回补到安全线以上后再次跌破会重新触发。`safetyStock` 为空的物料不告警。
- **理由**：跨越检测在事件发生的瞬间告警且天然去重，不需要 cron 轮询 + 已告警状态表；管理群收到的每条告警都对应一次真实跌破。推送在 tx 提交后 dispatch 是 P1 #2 Slice C 的既有铁律（tx 内发送会在回滚时留下幽灵消息）。采购收货是入库方向不可能跌破，仅手工出入库与取消收货两条 OUT 路径接线。
- **影响**：修改 `safetyStock` 阈值本身不触发告警（只影响后续出库判断）；若业主需要"上调安全库存立即提醒"或"低位周期性重复提醒"，再补 cron 扫描端点（复用现有 payload 与模板）。`MaterialStockMovementResult` 增加 `stockAlert` 字段，纯函数内不做 IO。
- **相关文档**：`lib/material.ts`、`lib/purchase.ts`、`lib/notification/events.ts`、SPEC §8.1、`prisma/seed.ts` STOCK_ALERT 默认模板。

---

## 2026-07-05：OSS STS 真实接入 —— ali-oss 单包 + 双凭证模型（A06）

- **决策**：`signViaSts` 与 CDR 打包用 `ali-oss`（官方 JS SDK，一个包同时覆盖 STS AssumeRole、对象读写、预签 URL），ZIP 用 `archiver`。凭证分两条路：(1) **浏览器直传** 走 STS AssumeRole，session policy 收缩到本次签发的单个 objectKey（比角色策略 design/*+bundles/* 更窄），有效期 1h；(2) **CDR 服务端打包** 用 RAM 子账号长期凭证直连——预签 GET URL 的寿命受签发凭证寿命限制，STS 临时凭证最长 1h 签不出 24h 下载链接，因此对象读写策略除挂在角色上外，还必须直接挂在子账号上。
- **理由**：单依赖降低维护面；session policy per-key 收缩让泄漏的临时凭证只能写它自己那一个路径（真实冒烟已验证越权被拒）。CDR 24h 链接与 DesignBundle.expiresAt 语义对齐，只能用长期凭证签。
- **影响**：`OssNotWiredError` 桩删除，`signDesignUpload` 把 AssumeRole 失败折叠成 `{ status: 'error' }`（SDK 错误只进服务端日志不回显浏览器）；`bundle.ts` 把打包失败翻译成 CdrBundleError。新增 `CDR_BUNDLE_MOCK_MODE` env（本地开发已配真实凭证时显式设 true，防 E2E 往真 bucket 写包；生产留空即真实路径）。RAM 侧要求写入 .env.example 注释。策略无 DeleteObject——孤儿清理（P1 待办）实现时再最小化增授。
- **相关文档**：`lib/oss/sign.ts`、`lib/cdr/zip.ts`、`.env.example`、`docs/AGENT-BACKLOG.md` A06、SPEC §3.1 / 附录 H。

---

## 2026-07-05：设计图上传 UI 走预签 PUT 直传，增删仅限 DRAFT

- **决策**：上传三步：Server Action 铸凭证前先过授权闸（款式真实存在 + 工单 DRAFT + 所有权）→ 浏览器用 STS 临时凭证签发的预签 PUT URL（绑定 Content-Type、15 分钟）裸 fetch 直传 → `recordOrderItemDesign` 以 OSS HEAD 的 Content-Length 为权威文件大小（兜类型上限）后在 order-cascade advisory lock 内 fresh-read 重校并写行 + OrderLog。设计图增删**仅 DRAFT**——提交后的增删属 A05 款式级编辑，业主拍板前不开口子。删除只删 DB 行（策略无 DeleteObject，孤儿对象归 P1 清理任务）。
- **理由**：预签 URL 让前端零 SDK（ali-oss 浏览器包 ~200KB+）；客户端申报的 fileSize/路径一律不信，服务端 HEAD + objectKey 形状校验双兜底；与 submit 共享同一把锁堵"提交与登记并发"的 TOCTOU。凭证压到 15 分钟是对"预签 URL 在寿命内可重复 PUT 覆写已登记对象"的窗口压缩。
- **影响**：工单详情页款式卡片新增设计图面板（缩略图/CDR chip/上传/删除）。**已知残余风险（P1）**：登记后 ≤15 分钟内上传者仍可用同一预签 URL 替换对象内容；彻底修复需 OrderItemDesign 加 ETag 列 + 消费端校验。
- **相关文档**：`lib/order-design.ts`、`lib/oss/sign.ts`、`components/business/order/DesignUploadPanel.tsx`、SPEC §3.1 / 附录 F。

---

## 2026-07-07：产品分类 UI 不暴露 ltree 路径，层级由"上级分类"表达

- **决策**：`/owner/product-categories` 列表移除"路径"列（层级用分类名缩进表达）；新建表单从"手写 ltree 路径"改为"上级分类"下拉（不选 = 顶级），path 段名由服务端自动生成（`n` + UUID 前 10 位 hex，满足 ltree label 字符集）；编辑表单不允许改层级——移动子树需级联改所有后代 path + 产品归属，属独立功能，当前实现改 path 不级联子节点反而是数据隐患，直接关闭入口。
- **理由**：ltree path 是树索引的内部实现（DECISIONS 2026-06-28），A03 交付时的表单让业主手写 `product.custom.flat_foil` 是开发者捷径——要求用户理解英文段名、点分隔、前缀规则，纯增负担。业主视角只需要"这个分类挂在哪个分类下面叫什么"。
- **影响**：`createProductCategoryNodeSchema` 从 path 改 parentId；`updateProductCategoryNodeSchema` 只剩 name/legacyCategory/sortOrder。既有节点 path 不变，无 migration。未来若需要"移动分类"，做成独立操作（级联后代 + 校验产品归属）。
- **相关文档**：`lib/product.ts`、`lib/auth/schemas.ts`、`components/business/product-category/`、DECISIONS 2026-06-28（ltree 选型）。

---

## 2026-07-07：承诺交期字段 + 交期预警 + ORDER_OVERDUE 推送（业主拍板新增）

- **决策**：`Order.promisedDate`（可空，migration `20260707010000`）承载对客户的承诺交期。预警口径集中在 `lib/order/promised-date.ts`：只对未发货状态（DRAFT..COMPLETED）预警，上海日历日比较，逾期红 / 3 天内到期黄；详情页徽标、dashboard「交期预警」关注列表、每日 cron 三处共用。新推送事件 `ORDER_OVERDUE`（SPEC §8.1 之外的业主新增，事件规则第 11 条）由 `/api/cron/order-overdue` 每日扫描触发——只推"已逾期"，"即将到期"留在 dashboard 不进群刷屏。编辑规则：promisedDate 属 FULL 字段集（DRAFT/SUBMITTED 可改，排产后锁定），修改进 OrderLog diff。
- **理由**：交期是老板最关心的履约风险，但 SPEC 原文没有此字段；预警阈值 3 天与客服周期"7 天预警"区分（生产周期短）。逾期推送每日重复直至发货或改期，同 OUTSOURCE_OVERDUE 语义。
- **影响**：seed 事件规则 10 → 11 条；README cron 6 → 7 端点，生产 crontab 需加一行。工单打印视图页眉新增"承诺交期"行。
- **相关文档**：`lib/order/promised-date.ts`、`app/api/cron/order-overdue/route.ts`、`prisma/migrations/20260707010000_order_promised_date/`。

---

## 2026-07-07：工单二维码内容从裸 id 改为绝对 URL（微信扫码直达）

- **决策**：打印工单的二维码内容从 `order:<id>` / `task:<id>` 纯文本改为 `{base}/orders/<id>` / `{base}/worker/tasks/<id>` 绝对 URL。base 推导抽成 `lib/public-base-url.ts`（APP_PUBLIC_URL 优先 → 请求头推导 → localhost 兜底），与 CDR 下载链接共用同一套头部解析/校验纯函数；foreman-cdr action 的本地实现随之去重。
- **理由**：SPEC §3.3 的设计意图就是"扫码直达报工页"，裸 id 需要专用扫码器，微信扫出来只是一串文本。URL 化后师傅微信"扫一扫"→（未登录先登录回跳）→ 任务详情开始/报工，零新依赖。
- **影响**：打印视图视觉基线全部重生成（QR 图案变化 + 新增交期行），按惯例截图经业主确认后提交。生产部署时 `APP_PUBLIC_URL` 必须配置为公网域名，否则打印出的码指向反代推导域。
- **相关文档**：`lib/order/print-view.ts`、`lib/public-base-url.ts`、README §🚢 env 表。

---

## 2026-07-08：JWT session 免登时长 7 天 → 30 天

- **决策**：`lib/auth/config.edge.ts` 的 `session.maxAge` 从 `60*60*24*7`（7 天）改为 `60*60*24*30`（30 天）。登录方式不变（工号 + 密码 Credentials）。覆盖 2026-04-22 密码策略决策 C 的 7 天。
- **理由**：师傅端归属靠"排产分派 workerId + 报工时登录核对身份"，而师傅只用**个人微信**（工厂无企业微信成员账号，故不做企业微信免密 OAuth）。扫码报工每次遇到 session 过期就要重输工号密码是主要摩擦点；拉长到 30 天让师傅一个月只登一次，明显降低车间使用阻力。
- **影响**：JWT 与登录 cookie 存活期同步延长到 30 天（Auth.js v5 JWT 策略下 `session.maxAge` 同时驱动二者）。安全权衡：会话失窃后有效窗口更长，但工厂内网 + 手机自持设备场景风险可接受；紧急撤销仍靠 rotate `AUTH_SECRET`（会一次性踢掉所有会话）。老板改师傅密码不会立即踢掉其已有会话——如需即时失效，rotate secret。
- **相关文档**：`lib/auth/config.edge.ts`，覆盖 DECISIONS 2026-04-22 决策 C。

---

## 2026-07-09：架构体检批次——去重收敛的边界与"不做清单"

- **决策**：实施 7 个"行为零变化"重构切片（日期格式化 / cron 认证 / OSS 客户端工厂 / order-cascade 锁 key 单一出口 / 通知策略常量归位 / collectFieldErrors 收敛 / createOrder 批量校验 / 薪资规则查询单一实现），同时**明确否决**五类"顺手优化"：React cache() 包 detail getter（请求级作用域会让审计日志 after==before、取消后返回旧状态）、cron scrub-500 统一 wrapper（各路由 500 响应体差异是刻意设计）、shanghai-clock 并入 lib/format/dates.ts（zod 巨石进 client bundle）、timingSafeEqual 顺手升级（行为变更需独立 commit）、非 order-cascade 锁 key 集中化（单模块私有，搬迁无收益）。
- **理由**：每条提案先经独立 agent 四项核查（测试 mock 耦合 / client-server 边界 / import 环 / 貌似重复实则有差异），验证否决的方案均有具体损坏场景佐证；只收敛"同一约定的多份手工拷贝"，不动任何刻意差异。
- **影响**：跨模块唯一的共享锁不变量（order-cascade）从"5 处字符串别打错字"升级为编译期保证；后续新增 Order.status 写入路径 import `lib/order/locks.ts` 即自动入队。完整问题清单与路线图见 `docs/archive/架构体检报告-2026-07-09.md`。
- **相关文档**：`docs/archive/架构体检报告-2026-07-09.md`、commits `06ecc62`/`b449b68`/`d57a2ec`/`610096a`/`a310e23`/`d3c700e`/`f4b6ab7`。

---

## 2026-07-17：后台任务用 PostgreSQL 持久化账本，不引入 Redis/MQ

- **决策**：通知、7 个 cron、CDR 与 PDF 统一写入 `BackgroundJob` / `BackgroundJobAttempt`。worker 用 `FOR UPDATE SKIP LOCKED` 抢任务，通过租约心跳恢复崩溃任务，重试耗尽进 DEAD。业务幂等性由唯一 `dedupeKey` 保证。
- **理由**：项目已经依赖 Pigsty/PostgreSQL，MVP 新增 Redis/RabbitMQ 只会扩大部署和备份面。PostgreSQL 足以承载当前低中吞吐后台任务，且任务审计与业务数据同库备份。
- **影响**：生产 `BACKGROUND_JOBS_MODE=durable`；cron 成功响应变为 HTTP 202 queued。OWNER 可在 `/owner/background-jobs` 查死信、取消 PENDING 或给 DEAD 增加 3 次尝试（不重置 attempt 序号）。
- **相关文档**：`prisma/migrations/20260717090000_background_jobs/`、`lib/background-jobs/`、`app/(admin)/owner/background-jobs/`。

---

## 2026-07-17：Web/LIGHT/HEAVY 三进程隔离，PDF 用单机共享产物目录

- **决策**：PM2 运行一个 Web、一个 LIGHT worker 和一个 HEAVY worker。CDR 流式压缩与 Chromium PDF 只在 HEAVY 中运行，并发固定为 1。PDF 完成后以 0600 原子写到 `PDF_ARTIFACT_DIR`，Web 读取后删除，worker 清理超 1 小时孤儿。
- **理由**：Puppeteer/ZIP 的 CPU 和内存峰值不应与登录、开单、报工争抢同一 Node 进程。当前基线是单机 PM2，共享本地目录比把 PDF 大二进制存进 PostgreSQL 更合理。
- **影响**：多机扩容前必须把 PDF 产物迁到 OSS/共享存储；ready 探针要求 LIGHT/HEAVY 两种心跳都存在。Nginx 对登录和 PDF 请求限流作为额外保护。
- **相关文档**：`deploy/ecosystem.config.cjs`、`lib/background-jobs/pdf.ts`、`app/api/health/ready/route.ts`。

---

## 2026-07-17：备份由 Pigsty/pgBackRest 执行，应用仓库只提供可失败验收门禁

- **决策**：备份目标固定为每日 full、连续 WAL、30 天、本地+异地两 repo；RPO ≤ 5 分钟，RTO ≤ 60 分钟，每月恢复演练。`pnpm check:backup` 只读取 `pgbackrest info --output=json`，任一 repo/full/WAL 不达标即非零退出。
- **理由**：应用自己调备份会分裂 Pigsty 的恢复链和凭证边界；但只写运维文档无法阻止备份实际早已过期。因此仓库负责验收而不负责执行备份。
- **影响**：本地无 stanza/pgBackRest 时检查刻意失败，不伪造绿灯；生产上线须在 Pigsty 节点注入 stanza 后运行。
- **相关文档**：`scripts/check-backup-readiness.mjs`、`docs/production-slo-and-recovery.md`。

---

## 2026-07-19：OWNER 与 FOREMAN 合并为唯一 ADMIN 管理员角色

- **决策**：权限模型只保留一个后台管理角色 `ADMIN`，拥有原 `OWNER` 与 `FOREMAN` 权限的并集；销售、客服、师傅角色保持不变。
- **理由**：当前工厂由同一批管理人员同时承担经营管理与生产管理职责，继续区分 OWNER / FOREMAN 会增加账号选择、授权解释和菜单切换成本，却没有形成真实的职责隔离。
- **迁移**：数据库迁移把 `User.role`、`Order.submitterRole`、`BusinessAuditLog.actorRole` 中的 OWNER / FOREMAN 原子转换为 ADMIN，并把早期 seed 写入的精确默认姓名“老板/车间主管”改为“管理员”。Auth.js JWT 回调继续识别旧会话中的历史角色与默认姓名，避免已登录用户在 30 天会话窗口内失去权限或继续看到旧称呼；真实姓名和“王老板”等昵称不改写。
- **兼容**：`/owner/*` 与 `/foreman/*` URL 暂时保留，避免书签、二维码和已有链接失效；侧边栏统一展示经营、生产和运维入口，不再出现两个管理身份。账号安全不变量改为“系统至少保留 1 位活跃管理员”。
- **相关文档**：`prisma/migrations/20260719190000_merge_owner_foreman_into_admin/`、`prisma/migrations/20260719193000_normalize_legacy_admin_display_names/`、`lib/auth/config.edge.ts`、`lib/auth/permissions-dict.ts`、`lib/navigation/admin-modules.ts`。

---

## 2026-07-19：新工单号采用 GD-YYMMDD-XXX，历史编号原样保留

- **决策**：新建工单号从 `YYYYMMDD-XXXX` 调整为 `GD-YYMMDD-XXX`，例如 `GD-260719-001`。`GD` 表示“工单”，中间是上海业务日期，末尾是当日三位流水号。
- **理由**：新格式保持年份和日期信息，同时用类型前缀与分段符提升辨识度，员工在电话、微信群和纸质单据中更容易口头复述、查找与核对。当前工厂日单量远低于 999；达到上限时系统明确拒绝继续发号，不静默扩位。
- **兼容与并发**：历史 `YYYYMMDD-XXXX` 和其它既有编号不更新，避免打印件、账单、薪资明细、CDR 目录及外部引用失效。新流水继续在创建工单事务内按上海业务日获取 PostgreSQL advisory lock，同日并发创建不会重号；新旧格式使用不同前缀，不会相互占用流水。
- **相关文档**：`lib/order/order-number.ts`、`prisma/migrations/20260719200000_update_order_number_format/`、`tests/e2e/order-create.spec.ts`。

---

## 2026-07-17：终态任务允许重入队，worker 资源限制必须落在真实 PID

- **决策**：唯一 `dedupeKey` 对 PENDING/RUNNING/SUCCEEDED 继续保持幂等；命中 DEAD/CANCELLED 时重启同一账本行并追加 retry budget，保留原 attempt 审计。CDR 的取消、最终失败和租约耗尽同步更新 DesignBundle。PM2 worker 不再执行会 spawn 子进程的 `tsx` CLI，改为 `node --import tsx scripts/background-worker.ts`；生产环境变量由入口先用 `@next/env` 加载，再动态 import Prisma/业务模块。
- **理由**：终态 key 永久占位会让人工重跑静默空转；CDR 业务状态不能与权威任务账本永久分裂。`tsx` CLI 的包装 PID 让 V8 heap 上限和 PM2 memory restart 都监控错进程，无法兑现 Web/LIGHT/HEAVY 的资源隔离。
- **影响**：同一 cron scope 在成功后仍不会重复执行，但死信/取消后再次触发可恢复；worker OOM 由真实 heap 上限和 PM2 阈值约束。`dispatchNotification` 在 durable 入队失败时记录脱敏错误并 best-effort 降级，保持业务提交后永不抛。
- **相关文档**：`lib/background-jobs/repository.ts`、`lib/background-jobs/worker.ts`、`lib/notification/dispatch.ts`、`scripts/background-worker.ts`、`deploy/ecosystem.config.cjs`。

---

## 2026-07-30：顺丰到付统一自行预约，物流费不进入工单金额

- **决策**：`Order.isSfCollect` 作为唯一顺丰到付标识。勾选即表示“顺丰到付、内部自行预约”，不再拆分第二个“自行预约”字段；工单 `totalAmount` 仍只汇总款式小计，不增加物流费用。管理端列表和详情同时展示提交人与生产任务实际分配的师傅。
- **后期更正**：顺丰到付属于履约信息，DRAFT 至 SHIPPED 均只能通过详情页独立命令补录或取消，不再混入普通收货字段编辑。FINISHED / CANCELLED 保持终态不可变；外部销售工单变更后进入待管理员整单核价，所有变更写入 `OrderLog` 和价格修订快照。
- **理由**：同一业务事实不应由两个布尔字段组合表达；独立后期更正入口既满足临发货时补录，又不重新开放已冻结的款式、金额和生产数据。
- **相关文档**：`prisma/schema.prisma`、`lib/order.ts`、`components/business/order/SfCollectToggleForm.tsx`、SPEC §3.1 / §3.4 / §3.6。

---

## 2026-07-31：多地址用发货子表，售后重做用免计费关联工单

- **多地址**：保留 `Order.receiver* / trackingNo` 作为主地址兼容快照，新增 `OrderShipment + OrderShipmentLine` 记录每个地址及款式数量。创建时校验数量守恒；编辑主地址同步第 1 条 shipment；发货时必须提交与数据库顺序完全一致的全部地址，并在同一 order-cascade 锁事务内更新，防漏发、串单和旧页面覆盖。
- **重做**：不回退已发货/已完成原单，也不篡改原应收或历史工资；新建 `kind=REWORK`、`billingMode=NO_CHARGE` 的关联子工单，复制所选款式/设计证据后直接进入 `SUBMITTED`，继续走现有排产、报工与计件链。客户账单查询只收 `billingMode=CHARGE`。
- **批量派工**：复用原有“一张工单完整派工后单事务确认”的领域命令；界面增加工艺行多选与共同兼容师傅筛选，只批量填充草稿，不拆成多个部分提交，避免半排产。
- **打印**：A4 边距由 15mm 收紧到 10mm；恰好 3 个款式时启用物理尺寸更小的紧凑样式。Chromium fixture 同时填满自定义名称、长红色关键备注和多色烫金，并以 PDF page object 断言只生成 1 页。
- **相关文档**：SPEC §3.1 / §3.2 / §3.4 / §3.4.1 / §3.6 / §E，migration `20260731090000_order_shipments_and_rework`。

---

## 2026-07-31：工单修改走审核版本流，业绩、收款、成本使用独立流水

- **工单修改**：销售/客服不得直接覆盖已经提交的生产数据，而是创建带 `baseRevision` 的 `OrderChangeRequest`。管理员审核时在 order advisory lock 内重读版本；版本不一致转为 `STALE`，数量变更遇已开工/完工任务直接拒绝。批准后原子更新款式、地址数量、待生产任务和金额，并递增 `Order.revision`，所有端口读取同一权威状态。
- **混合工艺**：彩印+烫金可同时 `isOutsource=true` 并配置 `inHouseMachineTypes=[HAND_PRESS,WINDMILL]`。排产必须生成外协记录，同时把回厂烫金分给兼容师傅，避免用“外协或厂内”单选丢掉第二段生产。
- **财务账本**：客服提成口径改为工单销售额；提交、批准修改、取消分别追加 `CsSalesEntry` 正向/调整/冲销流水。每次客户结款只追加 `BillPayment`，不再重复增加客服销售额。材料、物流、伙食、电费、外协、上板装板和其他成本追加 `OrderCostEntry`；已入账记录不覆盖，错误用正负调整项纠正。
- **薪资与考勤**：风车机默认规则为 1000 个及以下 ¥20，1000 个以上按 `数量 × ¥0.01 + ¥10/款`；个人机型规则可覆盖默认规则且报工时继续快照。全体在职正式员工的上班/请假按 0.5 天记录，师傅工资页按日期区分“计件高于保底 / 计件等于保底 / 按保底补足”。
- **理由**：生产数据需要审批、并发和审计边界；销售额、现金回款与成本是三个不同事实，不能互相代替；薪资必须可追溯到报工当时规则。
- **相关文档**：migration `20260731160000_order_changes_finance_and_attendance`、SPEC §3.2 / §3.6–§3.10 / §5.2。

---

## 2026-07-31：跨工单批量排产按兼容工艺分步派工

- **决策**：待排产列表先选择师傅，再从最多 30 张工单中批量创建该师傅能够承接的**剩余内部工艺任务**。混合机型工单可先派手动烫金、再派风车机；不再要求单个师傅整单兼容。本决策替代同日早先的“单师傅整单兼容”限制。
- **草稿边界**：分步创建的 `ProductionTask(PENDING)` 在全部内部工艺分配完毕前属于排产草稿，Order 保持 `SUBMITTED`。师傅列表、工单和任务详情均排除这类草稿，`beginTask/beginTasks` 也在领域层拒绝开工；最后一个任务分配完成后，持有同一 order advisory lock 原子切换 `SCHEDULING`，此时任务才对师傅开放。
- **兼容与纠正**：批量命令只从数据库推导所选师傅兼容且尚未分配的款式×工艺对；唯一键避免重复任务。单工单排产页预填已暂存师傅，可补齐或改派后一次确认。纯外协、缺外协单、停用/缺失工艺仍硬阻断。
- **事务边界**：每张工单独立事务，跨工单批次允许部分成功；并发状态变化逐单返回，已成功分配不因另一张失败而回滚。
- **理由**：真实工单会同时经过手动烫金与风车机，整单兼容限制导致无法批量操作；直接把半排产任务暴露给车间又会破坏状态机。把 PENDING 任务定义为受 Order 状态门控的排产草稿，兼顾分步效率与“全部派工后才能生产”的安全不变量。
- **相关文档**：`lib/production/batch-scheduling.ts`、`components/business/production/PendingSchedulingBoard.tsx`、SPEC §3.2。

---

## 2026-07-31：JWT 只作乐观会话提示，授权使用数据库当前账号

- **决策**：Auth.js JWT 继续保存 30 天以减少工厂现场重复登录，但 `getSession / requireSession / requirePermission` 在服务端使用前必须按 `user.id` 查询数据库，确认账号仍存在且启用，并以数据库当前用户名、显示名、角色、工种和机型覆盖 JWT 旧声明。
- **理由**：删除或停用账号后，旧 JWT 仍能通过只看 token 角色的权限入口；本次在批量排产写 `OrderLog.operatorId` 时才由外键拒绝，导致事务虽回滚但页面进入 500 错误边界。Next.js 16 本地认证指南也区分 Proxy/JWT 的乐观检查与数据源附近的安全检查。
- **影响**：删除、停用和角色调整在下一次服务端请求立即生效；嵌套布局与页面通过 React `cache` 在同一请求复用一次 token 解码和一次用户主键查询。批量排产对失效会话返回显式 `unauthorized` 状态与重新登录入口，不再吞掉整页。
- **相关文档**：`lib/auth/session.ts`、`lib/auth/permissions.ts`、`actions/production.ts`、`tests/e2e/batch-scheduling.spec.ts`。

---

## 2026-07-31：管理员最终派工，多设备是硬能力，熟练工艺只作推荐

- **决策**：师傅继续保留单一岗位类型，但开机师傅可登记主机型与多个 `machineCapabilities`；`WorkerCraftCapability` 记录熟练工艺。排产优先推荐熟练师傅，管理员可把工艺分给岗位/设备硬条件匹配的其他师傅，但必须填写原因；停用账号、岗位不匹配、缺必要设备和纯外协仍硬阻断。
- **理由**：把每个师傅伪装成“能做所有工艺”会掩盖设备与安全边界，而单一主机型又无法表达现实中的临时支援。硬能力与推荐能力分层，既让管理员保留最终调度权，又能阻止物理上不可能的派工并保留可追责记录。
- **影响**：单工单、跨工单批量排产和未开工任务改派统一使用同一资格判断；非推荐原因写入 `OrderLog`。派工把实际匹配机型快照到 `ProductionTask.machineType`，个人计件规则可针对师傅登记的每种机型配置，报工按任务实际机型取规则。
- **相关文档**：SPEC §2.1 / §3.2 / §5.2 / §6.1、migration `20260731210000_worker_capabilities_and_assignment_override`、`lib/production.ts`、`lib/account.ts`、`lib/salary/piecework-admin.ts`。

---

## 2026-08-02：重做归属与跨机型日保底口径

- **重做归属**：禁止从 `REWORK` 工单再发起嵌套重做；后续质量或物流售后必须回到最初的原工单新建另一张免计费重做单。这保证原单的直接重做关系就是完整成本边界，避免账单只汇总一层时遗漏嵌套成本。
- **日保底**：师傅同日完工多种机型任务时，计件金额仍使用每个任务完工时的实际机型规则快照；当日保底取“实际完工机型的生效 `dailyBase` 最大值”。只有当日没有完工任务时，才回退到账号主机型的保底。
- **快照**：`DailyWorkerSalary.salaryRuleSnapshot` 保留最高保底规则的原有顶层字段，并增加 `dailyBasePolicy / baseMachineType / workedMachineTypes / machineRules`，可重放保底选择原因。
- **旧规则兼容**：补偿 migration 只为风车机个人规则缺失的 `smallOrderInclusive=true` 与 `largeOrderSetupFee=10` 补默认，已显式设定的个人值保留不覆盖。
- **相关文档**：`lib/order/rework.ts`、`lib/salary/daily.ts`、migration `20260802093000_salary_and_rework_integrity`、SPEC §3.4.1 / §5.2。

---

## 2026-08-02：客服业绩、客户付款与工资发放是三本独立账

- **业绩归属**：收费客服工单提交时追加 `CsSalesEntry(ORDER_SUBMITTED)`；批准金额变更时追加新旧差额；取消时追加全额负数。事件键幂等，流水与 `SalaryPeriod.totalSales` 在同一事务更新。没有覆盖业务日期的进行中周期时，工单操作必须整体失败，不得静默漏记。（已被 2026-09-24「删除客服角色与内部/工厂直单结算」取代）
- **应收与工资**：客户付款只追加 `BillPayment` 并更新 `Bill.paidAmount`，绝不修改客服业绩。客服底薪/提成发放另外追加 `CsPayrollPayment`：底薪可在周期内分次发，提成只能在结算后发，已入账流水不覆盖。
- **账单不变量**：`Bill.totalAmount = openingAmount + 当前收费工单金额 + 追加调整项`；草稿重算不得吞掉历史已保存调整。账单总额必须大于等于零，已收不得超过总额；当前不提供退款/贷项工作流，也不以负数账单伪装冲账。所有付款和成本请求使用幂等键且相同键必须匹配完整业务载荷。
- **周期边界**：创建在职客服账号时按当前规则自动建立周期。`periodEnd` 是包含式的上海自然日；定时结算只处理 `periodEnd < 今天`，即结束日的次日才结算。提成档位按 `totalSales + initialSales` 计算，结算后为仍在职的客服无缝建立下一周期。
- **取代关系**：本决策连同 2026-07-31 财务账本决策，取代 2026-04-22 的“账单手填金额计客服业绩”和 2026-04-24/25 的“收款累加业绩”。旧决策仅作历史背景，不再指导实现。
- **相关文档**：SPEC §3.7 / §5.3 / §7.3、`lib/salary/cs-sales.ts`、`lib/salary/cs.ts`、`lib/order.ts`、`lib/order/change-request.ts`、`lib/bill.ts`。

---

## 2026-08-02：金额分项必须对平，外协金额使用可追溯事实账本

- **分币口径**：时薪工资先把普通/底薪、加班和空闲打包各分项四舍五入到分，再从已舍入分项求总额，保证页面、导出和数据库恒有“分项之和 = 总额”。前向 migration 自动修正未发放旧记录；已发放不一致记录必须人工确认，迁移主动中止。
- **外协成本**：外协创建请求使用 UUID 幂等键和完整载荷比对；金额可在报价未知时留空，确定后通过 `OutsourceAmountChange` 追加确认/更正事实，并与 `OutsourceOrder.amount` 快照和业务审计同事务更新。网络重试返回原结果，同键不同内容拒绝。
- **人工薪资调整**：奖金、扣款和修正同样是不可覆盖的金额流水；每次请求使用 UUID `SalaryAdjustment.idempotencyKey`，并在同一 advisory lock 内比对工资记录、类型、金额、原因和完整业务载荷。重试同一请求返回原结果，同键不同内容拒绝，避免按钮重试造成重复加款或扣款。
- **批处理可靠性**：日薪、时薪和账单批次只把明确业务错误归入 `errors[]`；数据库、网络或程序异常携已提交进度重新抛出，让 durable job 重试，禁止把部分漏算标记为成功。
- **历史可解释性**：账单提成归属是跨周期估算，实际发放以客服工资流水为准；迁移前累计收款无法恢复精确日期时明确显示“历史期初 · 时间未知”。旧客服工单在逐单业绩流水未与当前金额对平时，修改/取消整体阻断，等待财务校准，绝不猜测负冲。
- **相关文档**：migrations `20260802100000` / `20260802103000` / `20260802110000` / `20260802113000`、`lib/salary/daily.ts`、`lib/outsource.ts`、`lib/salary/hourly-payroll.ts`、`lib/cron/tasks.ts`、`lib/bill/cs-attribution.ts`。

---

## 2026-08-03：生产 PDF 固定使用系统 Chromium，发布检查必须复用真实运行时

- **决策**：Debian 生产机以 `/usr/bin/chromium` 为唯一 PDF 浏览器，由 `deploy/ecosystem.config.cjs` 通过 `PUPPETEER_EXECUTABLE_PATH` 同时注入 Web 和 HEAVY worker。Puppeteer-managed Chrome 只用于本地/CI，不再作为生产部署口径。
- **目标门禁**：生产 preflight/smoke 必须使用与 `lib/pdf/render.ts` 相同的 `--no-sandbox / --disable-setuid-sandbox`，并验证可执行文件、浏览器启动和 `page.pdf()` 实际产出；只检查 Puppeteer 缓存或只看 HTTP ready 都不能证明 PDF 可用。当前 `deploy-smoke` 仍只验证浏览器启动，补齐脚本前必须另跑部署指南 §13 的内存 PDF 命令。
- **理由**：pnpm 可能跳过 Puppeteer postinstall，导致缓存 Chrome 缺失；反过来，缓存 Chrome 可用也不能证明 PM2 指向的系统 Chromium 正常。2026-08-02 发布中已实测系统 Chromium 生成 37,646 字节中文 PDF，证明真实运行时可用，同时暴露旧 smoke 会因未继承路径/root sandbox 参数产生假失败。
- **运维边界**：`deploy-smoke` 与 `deploy/update.sh` 尚未完全复用该配置，修复前必须按部署指南显式传入生产变量。当前 1.6 GiB 主机走 low-memory PM2 档位；至少 4 GiB RAM 仍是整改目标。备份“两 repo + 30 天”同样保持目标基线，当前 repo1-only 不得被文档反写成已达标。
- **相关文档**：`deploy/ecosystem.config.cjs`、`lib/pdf/render.ts`、`scripts/deploy-smoke.mjs`、`deploy/update.sh`、`docs/部署指南.md`、`docs/production-slo-and-recovery.md`。

---

## 2026-08-07：工单列表使用服务端稳定分页，全量导出使用私有重任务产物

- **列表口径**：默认排序固定为 `Order.createdAt DESC, Order.id DESC`，急单只作筛选/标识，不再覆盖日期顺序。总数、分页、排序和所有筛选在 PostgreSQL 中执行；人员、款式、任务、发货和外协条件仍先与角色数据范围做 `AND`，同类条件必须命中同一条子记录，禁止跨地址/跨款式误命中。
- **筛选状态与编码**：规范化 URL 是筛选表单的提交后事实源；chip、清除全部、排序等客户端导航改变筛选状态时必须重建原生非受控表单，禁止旧 `defaultValue/defaultChecked` 再次提交。烫金色保留旧逗号列表兼容，颜色名内逗号编码为 `\,`、反斜杠编码为 `\\`，列表、chip、导出与 Prisma 谓词共用同一 codec。
- **导出边界**：只有 ADMIN 可发起和下载工单导出。生产环境先写 `OrderExport + BackgroundJob(HEAVY)`，worker 在开始时一次性物化匹配工单清单，再按 500 张分批、分工作表流式生成 XLSX。这保证同一文件的各工作表成员一致，但 `snapshotAt` 表示入选截止口径，不伪装成数据库历史版本。
- **金额与隐私**：工单、款式、生产任务、地址、地址分配、外协、成本、修改申请、操作记录、设计文件和账单关联分表导出，避免扁平 JOIN 造成金额重复。`Decimal` 以精确十进制单元格写入，不经 `Number`。禁止导出 OSS URL/对象 key、内部 ID、密码/令牌、工资规则快照、后台任务载荷和 raw JSON 变更快照。
- **产物安全**：XLSX 目录为 `0700`、文件为 `0600`，仅发起人本人且当前仍为有效 ADMIN 可下载，响应 `private, no-store` 并在生成后 24 小时过期。请求、生成、下载都写业务审计；终态只保留不含参数的 scope 收据，不保留可被低熵枚举的搜索/收件 PII 哈希。READY 文件保留 24 小时；无账本 orphan 为避免事务结果不确定时误删，经约 48 小时安全窗口再由每日 cron 回收。当前单机 PM2 使用 `ORDER_EXPORT_ARTIFACT_DIR`；多机扩容前必须迁往共享对象存储。
- **相关文档**：migration `20260807170000_order_list_filters_and_exports`、`lib/order/list-query.ts`、`lib/order/export.ts`、`app/(admin)/orders/page.tsx`。

---

## 2026-08-07：结算方向在工单创建时冻结，五类资金事实分账

- **决策**：新增 `Order.settlementType`，把外部销售应收、内部客服业绩、工厂直接业务和免费工单在创建时冻结。角色只决定权限和创建时默认方向，不得用账号当前角色重算历史资金归属。（部分已被 2026-09-24「删除客服角色与内部/工厂直单结算」取代）
- **账本边界**：外部销售只进入 `Bill/BillPayment`；客服销售额和工资走 `CsSalesEntry/SalaryPeriod/CsPayrollPayment`；开机师傅、时薪员工各走原工资账本；供应商应付走 `OutsourceOrder/OutsourceAmountChange/OutsourcePayment`。外部销售自助账单使用服务端最小投影，不查询或展示工厂计件、外协、重做、伙食、电费等内部成本。
- **外协边界**：外协款式必须在 order lock 内证明属于当前工单，合计数量由服务端从款式派生；客户端数量只作旧页面/篡改探针。尚无供应商合同价模型时，管理员人工确认应付比复用对客价格规则更安全；每次更正和付款追加留痕，禁止超付。
- **迁移**：历史工单按创建时角色快照回填方向。旧账单若已发、已付、有付款、所有权不一致或期初方向不可证明，migration 明确中止；只自动清理可证明安全的未发未付草稿污染项。

---

## 2026-08-07：对客加工费由服务端规则引擎计算并保存不可变快照

- **公式**：产品数量阶梯/基础单价 + 命中的按个、按张、每万个、每款一次收费项；款式小计固定为 `round(数量 × 成交单价, 2) + 一次性费用`，整单总额为款式小计之和。`PER_ORDER` 仅保留数据库枚举名，界面统一显示“每款一次”。
- **权威边界**：浏览器报价只作即时反馈；创建工单和批准影响价格事实的修改申请都在同一业务事务内重新读取规则并报价。完整报价默认自动应用；人工差价或规则不完整必须留下原因。只改名称不重新套用后来版本。
- **快照与并发**：每款保存基础价来源、命中规则、分项、实际成交价和时间。报价读与产品/价格规则写使用共享/独占 advisory transaction lock，整套规则只取同一版本边界；工资批次同理先读取一份不可变规则 bundle，再分员工结算。
- **安全边界**：单价、一次性费用、款式小计和整单总额在纯报价器与领域写入前双重检查数据库精度/上限。active 旧调价 JSON 不符合现行 13 字段合同时，migration 在财务 DDL 前 fail-fast，禁止一条旧规则让所有生产报价失效。
- **取代关系**：本决策取代 2026-04-22“工单金额仅手填”和 2026-06-28“完整报价 UI 后置”的实现口径；临时议价仍通过显式人工改价原因保留。

---

## 2026-08-07：最小起订量失败关闭，历史建议单价不改义

- **起订量**：`Product.minOrderQty` 是自动报价前置约束，不再只是展示备注。数量低于起订量时报价标记为不完整，不静默产生自动价；特殊小批量单仍可手工填写成交单价/一次性费用，但必须保存人工改价原因。
- **历史字段**：`OrderItem.suggestedPrice` 保留为旧版“建议单价”，不得在无迁移时改解为小计。新版系统建议小计单独写入 `suggestedSubtotal`；历史行按“建议单价 × 数量”受控回填，数量、负值或溢出异常一律在 DDL 前中止。
- **审批可见性**：影响价格的工单修改在管理员批准前必须显示旧总额、新总额、差额和逐款报价结果。预览只读且不入账；批准事务仍用最新规则重算，不接受浏览器回传金额。
- **展示边界**：师傅通用工单查询不读取客户成交价、建议价、改价原因或结算方向，也不提供金额筛选/排序。外部销售页面从销售视角统一显示“应付/已支付”，工厂管理端账本仍是应收。

---

## 2026-08-07：外部销售报价使用独立版本化价目簿，原表歧义失败关闭

- **规则隔离**：`EXTERNAL_SALES` 只读取当前唯一生效的 `CustomerPriceBook`，不得回退到内部销售/工厂直客沿用的 `Product.baseUnitPrice / PriceTier / PriceAdjustment`。没有价目簿、多个价目簿重叠、零个或多个基础规则命中时均停止自动报价。
- **来源可追溯**：价目簿保存源文件名与 SHA-256；规则保存收费类目、版本、工作表和单元格范围。工单报价快照同时冻结这些证据，后续报价调整必须发布新版本，禁止覆盖历史规则来改变旧单解释。
- **计算口径**：现货明确单价按个；专版烫金和彩印固定总额仅使用原表明确数量锚点，不插值、不套相邻档。无歧义加价可叠加，互斥纸张项按规则组唯一选择；实际烫金色数量来自 `foilColors`，不能用布尔“双色”字段代替。
- **歧义策略**：彩印缺规格行、7001–7999 空档、15000 边界冲突、机仔烫金 1000 边界与万元封叠加、包装替代关系、打样计费粒度、彩印多色及专版三色以上均保留为 `REFERENCE`；可识别的危险条件主动阻断自动报价，其余仅展示来源说明，禁止代码臆测。
- **产品/工艺围栏**：产品基础价不是忽略工艺的通行证。彩印产品缺少对应彩印工艺、混入 UV/跨纸种工艺，专版产品缺少平烫或实际烫金色，现货加烫，以及彩印+烫金低于原表附加费起始锚点时均以阻断型 `REFERENCE` 失败关闭；未来未知工艺也必须落在显式白名单之外并转人工。
- **金额语义**：按个规则保留原表四位小数单价，款式小计再按分四舍五入；例如 ¥0.1350 × 1 个保存为单价 ¥0.1350、小计 ¥0.14，不能为了反推对平而把来源单价改写成 ¥0.1400。固定总额与非按个收费继续进入一次性费用。
- **扩展方式**：收费类目与规则是数据行而非 Prisma 枚举；以后增加制版、物流或其他类目不需改 schema。涉及金额的调价必须复制为新草稿、通过来源审计与发布校验后生效；已发布和历史版本永远只读，禁止原地改写正在被工单引用的规则。
- **入口**：外部销售在 `/sales/quote` 查价并从 `/orders/new` 触发真实报价；管理员在 `/owner/prices/external-sales` 审计来源、有效期和人工项。内部客服报价入口继续保持占位，避免误用外部销售口径。

---

## 2026-08-08：外部销售快递与打包耗材采用独立对客应收流水（历史重量口径已取代）

- **账本边界**：快递费与打包耗材费是外部销售应付工厂的对客应收，记入 `OrderCustomerCharge`；工厂实际支付的快递、材料或包装成本仍记入 `OrderCostEntry`。两本账不互抵、不复用类目；`Order.totalAmount = processingAmount + 有效对客收费合计`，经营看板的加工业绩仍使用 `processingAmount`，不把代收快递/耗材费冒充加工销售额。
- **价目隔离**：同一结算方向下，加工费使用 `CustomerPriceBookPurpose.PROCESSING`，快递/耗材使用 `LOGISTICS`；每种用途单独版本化、生效和冻结，禁止一本价目簿的类目误被另一种公式读取。
- **报价来源**：中通价格来自 `长昆中通报价表(1).xlsx`（SHA-256 `a92088a9ba0093afcbb96c6b3b182ab29e4f7d675cacf929c6745987bf4d6060`，`A1:D29`）；纸箱建议来自 `纸箱价格表1(1).xlsx`（SHA-256 `9f0c30333a737ab9d36398b8af2c84ece599317f9df21af5dacb8f365fa5401b`，`A1:B6`）。规则行保留原工作表、单元格范围和来源哈希，新价只能发布新版本，不覆盖旧工单证据。
- **快递公式（费率仍有效，重量口径已取代）**：每个 shipment 按一票独立计首重。普通地区为首重 1kg，广东首重 ¥2.8/续重 1kg ¥1.5；江西等区域续重 ¥2.8，京沪等区域续重 ¥3.5，云南等区域续重 ¥4.5。新疆/西藏首重 ¥12，甘肃/青海/宁夏/内蒙古首重 ¥10，两组偏远地区续重均为 0.5kg ¥5.3。此处“只接受承运商已进位重量”的结论当时仅核对费率工作簿，遗漏了之后确认为权威来源的《加工费计费规则.md》§6，现已被 2026-08-27“服务端估算、履约实际重量优先”决策取代。港澳台、海外、省份缺失或其他承运商仍必须人工确认。
- **多地址/多包裹**：当前模型把每条发货记录视为一票运单，每票重新起算首重和纸箱建议。即使收件地址相同，只要拆成多个运单，也必须在录单时拆成多条 shipment；系统不会根据同一地址自动推测包裹数。
- **耗材口径**：纸箱表只给出每票分配数量 1–500 / 501–1000 / 1001–2000 / 2001–3000 / 3001–5000 个时 ¥1 / ¥3 / ¥5 / ¥7 / ¥8 的参考值，未说明按工单、箱数还是地址收费，因此只能作非强制建议。销售必须确认实际耗材费；超过 5000 个或与建议不同时必须填写调整理由。
- **冻结与终审**：外部销售创建工单时在服务端重新核价，以 `ESTIMATED` 保存每票快递与耗材收费及价目版本。管理员发货时填写最终计费重量和收费，仍按工单创建时冻结的价目重算，差异必须说明，并转为 `FINAL`；外部销售工单未准备好完整收费时不得结案。
- **履约事实与后期更正**：非顺丰到付的外部销售工单未填写每票“承运商最终计费重量”时不得发货，创建时估算重量不能冒充正式重量进入 `FINAL`。已发货后的顺丰到付更正只允许管理员处理；取消到付必须逐票补录省份与最终重量，使用冻结价目恢复快递应收，人工差价必须留原因和工单日志。
- **改单同步**：管理员批准数量变更或新增款式时，要按原 shipment 分货关系投影修改后每票数量，并使用该工单冻结的 `LOGISTICS` 价目刷新耗材档位、建议金额和快照。已确认实际金额不自动覆盖；新建议与实际不同时，必须沿用历史调整原因或由审核人留言说明。
- **顺丰到付**：快递费行固定为 `WAIVED / ¥0`，但纸箱、胶带、防水袋、标签等打包耗材仍需确认并计入应收；“到付”不等于“整票免费”。
- **历史与权限**：旧外部销售工单只回填为零元结构化收费，不根据数量追溯猜价，也不改动旧账单总额。外部销售只查本人工单/账单的对客收费；管理员可审计来源并在发货时终审；师傅查询不读取 `OrderCustomerCharge`、价目版本或对客金额。
- **取代关系**：本决策取代 2026-07-30 “工单 `totalAmount` 仍只汇总款式小计”在**外部销售结算**下的口径。旧决策仍解释顺丰到付标识与后期更正权限，但新外部销售工单总额必须包含已确认的耗材费及非到付快递费。
- **入口与相关文档（历史口径）**：外部销售在 `/sales/quote?section=logistics` 查看只读快递/耗材价目；本日最初约定的管理员 `/owner/prices/external-sales?section=logistics` 已被 2026-08-11 的 `/owner/prices/external-sales/items?purpose=logistics` 工作台取代，旧 `/sales/quote/logistics` 与 `/owner/prices/external-sales/logistics` 仅作兼容跳转。真实计价仍从 `/orders/new` 发起。相关实现为 migration `20260808100000_external_sales_logistics_charges`、`lib/price/external-order-charges.ts`与 `lib/price/order-charge-service.ts`。

---

## 2026-08-09：外部销售报价统一入口，调价使用草稿版本发布

- **统一入口**：管理端只保留 `/owner/prices/external-sales`，以 `section=processing|logistics|versions` 切换加工费、快递/打包耗材与版本发布；外部销售查询统一为 `/sales/quote?section=processing|logistics`。旧物流路径保留 redirect，不再形成第二套管理页。
- **业务界面与审计分层**：管理端和销售端只显示中文收费项目、适用范围、数量、计价方式、金额、版本状态与调价原因；价目簿/规则代码、JSON、Excel 范围与 SHA-256 只保留在数据库和服务端审计记录中，不进入日常业务页面。历史工单金额明细同样只展示中文分项与计算式。
- **版本生命周期**：管理员必须填写调价原因，从当前生效版复制唯一草稿；只有草稿规则可编辑/停用。发布先校验再结束旧版的半开生效窗口，新版可按上海时间立即或未来生效；历史工单仍引用原版本和金额快照。
- **并发与追溯**：复制、改规则、发布和放弃都取得统一价格写锁；规则与草稿的 `updatedAt` 作为乐观锁，陈旧页面不能覆盖、发布或删除他人刚保存的价格。发布记录操作人、原因、基线版本、规则集 SHA-256 和业务审计。
- **发布失败关闭**：加工费与物流类目互不可见；产品与 `productCodes`、数量区间、互斥组、金额精度/单项/必然叠加上限必须通过。物流规则只接受计算器真正使用的标准省份、首续重和耗材数量合同；任何“页面可填但运行时忽略”的字段均拒绝发布。

---

## 2026-08-11：收费日常操作与版本发布拆页，技术条件不得进入客户端

- **管理入口**：左侧“字典”提供高频业务入口“外部销售收费”，直达 `/owner/prices/external-sales/items`；加工费与物流由 `purpose` 切换。版本历史、校验、发布和放弃集中到 `/owner/prices/external-sales/versions`。`/owner/prices` 只保留内部销售/工厂直单兼容规则并标为低频；旧 `section` URL 只作兼容跳转。
- **查找模型**：收费项目必须在 PostgreSQL 侧搜索、组合筛选、稳定排序和分页，不能把整本 121 条规则发到浏览器再过滤。加工费按类目、产品、数量、规则类型、计价方式、自动/人工、启停和变更状态筛；物流地区直接匹配规范省份 JSON 条件，不能复用产品筛选。隐藏匹配条件由服务端翻译成中文业务摘要，未知或受限条件只作诚实概括，不得谎称“通用”。
- **编辑边界**：客户端只接收名称、类目、产品、数量、计价方式、金额、首续重、自动/人工和启停等可见业务字段。规则 code、原始 `triggerCondition`、`exclusiveGroup`、`priority`、source/SHA/Excel 范围不得进入 RSC 客户端属性或 hidden input。保存时服务端在价格写锁内读取原规则并只合并允许字段；更换产品时同步已有 `productCodes`，物流匹配器永远由服务端保留。
- **生命周期**：CURRENT、DRAFT、SCHEDULED 与无可用版本必须显式区分。已有计划生效版本或没有当前生效版时，不显示一个后端必然拒绝的“发起调价”；草稿修改只展示当前价与草稿价差异，发布前不影响工单。发布、放弃和单规则保存继续用 `updatedAt` 乐观锁。
- **响应式**：桌面保留列表与右侧编辑面板，长编辑表单限制在 `100dvh` 内自行纵向滚动且不使用超高 sticky；手机按“已选编辑器 → 列表”单列排列，筛选默认折叠。两端都必须通过根横向溢出、隐藏裁切、触控目标和 axe 门禁。

---

## 2026-08-12：精确数量锚点只在管理界面合并，持久化规则仍逐档独立

- **展示模型**：外部销售加工费先按纸张分区，再以“工艺 · 规格”作为产品行标题。同一产品的多个精确数量锚点显示为一个价格阶梯，管理员只需在一个编辑器中查看“数量 / 当前价 / 草稿价”；不同克重、产品、规格或匹配条件不得为了少显示文字而混在一起。
- **合并条件**：只有 `BASE + productId + minQty = maxQty` 的精确锚点可合并，并且价目版本、类目、产品、规则类型、计价方式、首续项、规范化匹配条件、互斥组、优先级、自动报价限制、来源文档/工作表和说明必须完全一致。数量、金额、启停、展示名称和单元格范围是阶梯行差异；范围规则、附加费、人工参考或任何条件不一致项仍保持单项。
- **报价语义不变**：合并只发生在管理读取 DTO 与界面，数据库仍保存每个数量锚点的独立规则，报价器继续要求精确数量命中，不新增插值、外推或相邻档回退。页面的稳定组 ID 优先使用当前版本首档 ID，创建草稿或刷新后仍能定位到同一产品组。
- **原子编辑**：数量档首版只读，管理员可修改金额和启停。客户端只提交草稿簿、锚点和各行可编辑值；服务端持写锁重新推导完整成员，拒绝缺行、重复、跨组和陈旧 `updatedAt`，用 `Prisma.Decimal` 逐档写入后只执行一次整套发布规则校验，并在同一事务记录逐行及整组审计。任一成员失败时整组回滚。
- **计价单位与展示精度**：`FIXED_AMOUNT` 才显示整批总价并按数量计算折合单价；`PER_PIECE / PER_SHEET / PER_10K / PER_ITEM` 必须分别显示元/个、元/张、元/万个、元/款，禁止把单价再次除以数量。金额范围、折合单价和涨跌百分比使用 Decimal 计算，不经 JavaScript 浮点数；规则 code、原始条件 JSON、来源范围、SHA、内部成员 ID 和并发时间戳不得作为可见文本或表单字段下发。

---

## 2026-08-17：零 JS 降级收敛为三条路径的硬约束，其余降级为写法偏好

- **背景（来源考证）**：本条之前，「表单必须在未 hydration 时也能提交」被当作既有铁律反复援引，但它**从未被拍板**。SPEC-v1.2.md、CLAUDE.md、README.md、PROGRESS.md、HANDOFF.md、AGENTS.md 与本文件前 77 条决策中，相关关键词命中数均为 0；276 个 commit 里只有 `38bea7c` 一条 message 提过。真正的原点是 `e0070f6`（2026-04-22，Codex review round 10 的 P2 条目）修复「未 hydration 时点退出登录只刷新页面、不清 session」这个具体缺陷，随后 14 小时内被泛化成三处不相关文件的注释，此后四个月再未被复述。三处注释的措辞也全是「for free」「and gives」，即**描述白送的属性，不是提出要求**。
- **决策**：只有 **登录（`LoginForm`）、登出（`LogoutButton` / `UserMenu` 的 signOut form）、改密码（`ChangePasswordForm`）** 三条路径的零 JS 可提交性是硬约束，由 `tests/e2e/no-js.spec.ts` 在 `javaScriptEnabled: false` 的 `no-js` project 下断言。其余全部表单：新写时默认 `<form action={serverAction}>` + 非受控控件 + `name`（这是 React 19 / Next 16 白送的，不要主动扔掉），但它**不构成任何技术选型的否决理由**，也不进门禁。
- **理由**：① 选定的三条失败后用户无法自救——进不去系统、清不掉 session；其余后台 CRUD 的失败模式是「慢网下点了没反应，再点一次就好」。② 实测 92 个 `<form>` 中 19 处（18 个文件）早已被 `action={(fd) => startTransition(...)}` 静默破坏，其中 `EditOrderForm.tsx` 的注释与破坏**在同一次提交里同时诞生**，四个月无人发现——说明无门禁的约束不是约束。③ SPEC 自身在三处**强制要求 JS**：§H.1 强制浏览器直传 OSS（且 React 明确不支持 progressive form 传 File/Blob）、§E.1 打印视图自动弹窗、§0 浏览器端计算建议价；SPEC 对网络质量与设备档次则一字未提。④ 71 个 `useActionState` 文件里只有 2 个属于师傅端，97% 的成本花在办公室 PC 用户身上，成本收益倒挂。
- **影响**：本次同步修复师傅端两处真实破坏（`ReportTaskForm`、`BeginTaskButton`，后者需新增 form 形状的 `beginTaskFormAction` 包装，因为客户端 `async () => boundAction()` 闭包没有 `$$FORM_ACTION`），以及两处「注释与自身代码矛盾」的位置（`EditOrderForm`、`UrgentToggleForm`）。**未修复且明确接受现状**：`OrderForm`（建单，RHF + `onSubmit`，且受 §H.1 直传约束在架构上无法零 JS）、`WorkerTaskBatchList`（一键开工/完工是纯 `onClick` 多选，改造需重设计交互，另行评估）、以及其余 15 处后台表单。`components/business/order/OrderForm.tsx` 用 react-hook-form 是 `38e4ef6` 里业主拍板过的（`Owner decision: react-hook-form is the form layer`），本决策不推翻它。
- **相关文档**：`tests/e2e/no-js.spec.ts`、`playwright.config.ts`（`no-js` project）、`CLAUDE.md §15.8`、`components/business/production/ReportTaskForm.tsx`、`components/business/production/BeginTaskButton.tsx`、`actions/production.ts`（`beginTaskFormAction`）、`components/business/order/EditOrderForm.tsx`、`components/business/order/UrgentToggleForm.tsx`

---

## 2026-08-19：厨师空闲打包时薪缺失时按 0 计，是 §15.5 的唯一显式例外

- **决策**：维持 `lib/salary/hourly-aggregate.ts` 的 `spareHourlyRate: cookSpareRate ?? 0`。同一 if/else 里 PACKER_HOURLY、CLEANER_HOURLY、COOK_MONTHLY 三个分支继续 `throw`，只有厨师的**空闲打包**时薪走 0。（已被 2026-09-24「删除清废/厨师工种与清废工艺」取代）
- **理由**：空闲打包对厨师是可选职责，没配 `COOK_SPARE_HOURLY` 更可能表示「这个厨师不打包」，而不是「配置漏了」。改成 throw 会让已有未配该规则的厨师**整月月结直接失败**，用一个更响的故障替换一个语义正确的 0。该行为并非疏忽：`lib/salary/__tests__/hourly-payroll.test.ts:186` 有一条名为 `COOK without spare rate: sparePay = 0 even with spare hours` 的用例，传 20 小时空闲工时并断言 `sparePay === '0'`，即当前行为是被测试固定的设计。
- **影响**：CLAUDE.md §15.5 补写这条例外，代码现场也加了注释说明「为什么和另外三个分支不同」——此前它看起来就是一处待修的 bug，合规审查确实把它报成了违反。**不改行为、不改测试**。若将来要收紧，正确做法是先在规则表层面加「厨师是否承担空闲打包」的显式开关，而不是让缺失配置去 throw。
- **相关文档**：`lib/salary/hourly-aggregate.ts:296,301`、`lib/salary/hourly-payroll.ts:87-88`、`lib/salary/__tests__/hourly-payroll.test.ts:186`、CLAUDE.md §15.5

---

## 2026-08-19：批量任务状态流转以 SQL where 子句表达守卫，是 §4.5 的显式例外

- **决策**：`lib/production.ts` 的 `beginTasks` / `reportTasks` 保留 `updateMany({ where: { status: <前置状态> }, data: { status: <后置状态> } })` 的写法，不改为逐行调用 `transitionProductionTask`。单条路径（`beginTask` / `reportTask`）不适用本例外，仍须走状态机。
- **理由**：`updateMany` 无法逐行校验，改走状态机意味着先查出每行当前状态再逐条转换，丢掉单条 SQL 的原子批量更新——批量开工/完工是师傅端的高频操作（`WorkerTaskBatchList` 的两个按钮），事务形状变化的回归风险大于收益。守卫并未缺失：`where` 子句在 SQL 层表达了与状态机转换表相同的前置条件，复核确认当前没有任何非法转换可达。
- **影响**：CLAUDE.md §4.5 补写例外并写明代价——**没有编译期保障**，改这两处时必须自己维持 `where` 子句与转换表一致。同时改掉 `lib/production/status-machine.ts` 里那句「every TaskStatus write must flow through this function」——它是绝对化的、与代码事实矛盾的声明，比违反文档更糟。
- **相关文档**：`lib/production.ts:1355,1452,1496,1613`、`lib/production/status-machine.ts:34`、`actions/production.ts:255,281`、`components/business/production/WorkerTaskBatchList.tsx:166,175`、CLAUDE.md §4.5

---

## 2026-08-19：覆盖率 100% 收窄到算钱纯函数与状态机，并第一次真正配上门禁

- **决策**：引入 `@vitest/coverage-v8`（devDependency，版本跟随 vitest 的 `^4.1.5`），在 `vitest.config.ts` 配 `coverage.thresholds`：`machine-piecework.ts`、`cs-commission.ts`、`hourly-payroll.ts` 与 `lib/**/status-machine.ts` 要求 100%；`lib/**` 其余部分按当前实测水位设阈值（statements 83 / branches 75 / functions 88 / lines 85），只防倒退。
- **理由**：§4.3 原先要求 `lib/salary/*`、`lib/notification/*` 全量 100%，但 `@vitest/coverage-v8` 从未安装，`pnpm vitest run --coverage`（§14 列出的命令）直接报 `MISSING DEPENDENCY`——这条硬指标**从未被机器校验过**，这正是它能长期漂到 salary 89% / notification 92% 的原因。实测 20 个未覆盖函数全是读路径与管理 CRUD（`listActiveCsUsers`、`getCsPeriodDetail`、notification 的 CRUD 读），而算钱的核心反而覆盖最好。对 UI 查询函数强求 100% 只会催生占位测试，不如把 100% 用在算错就发错钱的地方。
- **影响**：为达标补了 5 条守卫路径测试（客服业绩非有限数、档位门槛非法、小单规则不完整），8 个目标文件现已全部 100%。**顺带修了一处 §15.5 违反**：`machine-piecework.ts` 原本在小单一口价缺失时走 `?? 0`，即配置漏填就按 0 结算小单；类型上 `smallOrderThreshold` 与 `smallOrderFlatPrice` 是两个独立可空字段，该状态可达。已改为抛错拒绝继续（与厨师那条例外不同：小单一口价不是可选职责，缺失就是配置错误）。门禁有效性已验证：把阈值指向未达标文件时 `exit 1` 并逐项报错。
- **相关文档**：`vitest.config.ts` coverage 段、`package.json` devDependencies、`lib/salary/machine-piecework.ts`、`lib/salary/__tests__/{machine-piecework,cs-commission}.test.ts`、CLAUDE.md §4.3 / §14

---

## 2026-08-19：Setting 表接线，`order_no_prefix` 退役

- **决策**：把 `Setting` 表从「只写不读」改成真正驱动行为的配置源。
  - 新增 `lib/settings/`：`definitions.ts` 是 key / 校验 / 默认值 / 表单渲染方式的**唯一定义处**（纯数据，零副作用，比照 `lib/auth/permissions-dict.ts`），`index.ts` 负责读写。
  - `factory_name`、`outsource_overdue_days`、`cdr_link_expire_hours` 三项接到各自消费点；新增 `/owner/settings` 编辑页 + `setting:manage` 权限。
  - `order_no_prefix` **退役**，seed 会删掉这一行。
  - `prisma/seed.ts` 改为从 `SETTING_DEFINITIONS` 取默认值，且**只 create 不 update**——业主改过的值不能被下一次 seed 冲掉。
  - 配置读取校验失败时**退回内置默认值**，不抛错。
- **理由**：
  - 这张表从建表起就只有 `prisma/seed.ts` 一个写入方、零个读取方，四个 key 全部在别处有硬编码副本。最直观的后果是**打印视图的厂名永远印默认值**——`OrderPrintLayout` 的 `factoryName` 是默认参数，而三个渲染入口（打印页 / PDF 路由 / PDF background job）一个都没传过；连 seed 的 `佛山红包印刷厂` 和组件默认的 `红包印刷厂` 都对不上，也没人发现。
  - `outsource_overdue_days` 原先写死的 `expectedDate < todayStart` 恰好等价于阈值 1，纯属巧合；`cdr_link_expire_hours` 的 24 小时在三处各写死一份（占位行、预签 URL、mock 路径）。
  - **`order_no_prefix` 不该接**：它存的是格式串 `GD-YYMMDD-XXX`，而序号位宽是代码常量。放开它有真实危险——`parseSerial` 要求尾段位数恰为 `SEQ_PAD`，业主把 3 位改成 4 位会让**当天余下的开单全部抛错**；最大序号查询又靠字典序，位宽可变会让 `-1000` 排在 `-999` 前面。决定性理由是 `lib/daily-document-number.ts` 里 `PO`/`PR`/`ST`/`IC` 四个兄弟单号前缀全是代码常量：五个单号里四个写死、一个可配，比五个都写死更糟。
  - **兜底策略与 §15.5 相反是刻意的**：§15.5「没有生效规则就拒绝继续」管的是薪资和报价，静默按 0 结算会直接算错钱。这三项都不碰金额，印错厂名、阈值回到 1 天都是一眼可见且随时可改的；反过来，让一行手工改坏的配置把开单、打印、每日推送同时打挂才是真正的事故。写入侧走同一份 schema 且是严格的，正常路径上非法值进不来。
- **影响**：
  - `OrderPrintLayout` 的 `factoryName` 改为**必填 prop**，`buildPrintHtml` 的 options 同理——下一个渲染入口忘了传就是编译错误，而不是又一次静默用默认值。
  - `lib/cdr/zip.ts` 保持不读库（它是 OSS 适配层），有效期由 `lib/cdr/bundle.ts` 读好传入。
  - 新增门禁三处：打印厂名透传、外协阈值消费、CDR 有效期消费，均已验证「改回硬编码就红」。
  - `Setting` 表的既有行不受影响（seed 不再覆盖写）；升级已有库只需跑一次 `pnpm db:seed` 清掉退役 key，不跑也不影响功能。
- **相关文档**：CLAUDE.md §4.7 / §15.5、`docs/archive/规范合规审查-2026-08-19.md` §二「Setting 表」。

---

## 2026-08-21：登录限流挂在 `location = /login`，并按请求方法豁免 GET

- **决策**：防登录爆破的 `limit_req zone=erp_auth` 挂在 `deploy/nginx.conf.example` 的 `location = /login` 上；`erp_auth` 桶的 key 不再是裸 `$binary_remote_addr`，而是 `map $request_method $erp_auth_limit_key` 的产物——只有 POST 产生非空 key，GET 求值为空字符串因而不计数。`/api/auth/callback/credentials` 的块保留，作为纵深防御共用同一个桶。
- **理由**：本项目登录走 Server Action，浏览器 POST 的是 `/login` 本身，**根本不会**访问 `/api/auth/callback/credentials`（`signIn` 是进程内调用）。此前文档与配置注释都宣称「登录端点已限流」，是一条完整的假事实：真正的爆破路径一直裸奔。而 nginx 的 `limit_req` 不区分方法，直接挂 `location = /login` 会连渲染登录页的 GET 一起限流——未登录用户来回点几下就被自己的登录页 429 挡在门外，比不限流更糟；nginx 官方语义里 key 为空即不计数，`map` 正是干净的表达方式。
- **影响**：`map` 与 `limit_req_zone` 必须都在 `http {}` 层，改完务必 `sudo nginx -t`（重复 include 同名 zone 会直接报错）。**删掉那条 `map` 就等于把 GET 也拖进限流**，这是本条最容易被后人「简化」掉的地方。`docs/部署指南.md` §9 的「三个关键点」已改为四条并写明成因。将来在 ECS 前加阿里云 SLB / CDN 时，`$binary_remote_addr` 会变成 SLB 的 IP、全站共用一个桶，必须先用 `set_real_ip_from` + `real_ip_header X-Forwarded-For` 还原真实客户端 IP。仍待业主拍板：厂区 NAT 出口 IP 是否需要 `geo` 白名单、429 是否配 `error_page` 给友好提示、应用层是否另立项做账号级失败锁定（现状 grep 确认完全没有）。
- **相关文档**：`deploy/nginx.conf.example`、`docs/部署指南.md` §9、`lib/auth/config.ts`、`app/(auth)/login/`

---

## 2026-08-21：`hasPermission` 只允许用于 `generateMetadata` 这类不能抛错的软判断

- **决策**：`lib/auth/permissions-dict.ts` 新增纯谓词 `hasPermission()`（不抛错、不查库、只对角色-权限映射求值）。它**只**用于 `generateMetadata` 这类「不能抛错的软判断」，永远不作为唯一授权闸口；真闸口仍是页面组件的 `requirePermission` 与 `lib/` 里的 scope 过滤。
- **理由**：流式 metadata 会先把首屏冲出去、metadata 解析完再追加，此时在 `generateMetadata` 里抛异常未必还能干净落到 `error.tsx`。所以标题查询走 `getSession()` + `hasPermission()` 而不是 `requirePermission()`。这不是绕过 §4.6：权限谓词本身仍在权限字典里，规则只有一处。
- **影响**：本次把 9 个详情页的 `generateMetadata` 从 `id.slice()` 改成查真实业务编号，其中 `owner/bills`、`owner/salary/cs`、`foreman/outsource`、`foreman/scheduling` 四页的 lib 读取是全局无 scope 的——**若只换查询不过一次 `hasPermission`，SALES 直连 `/owner/bills/<id>` 会被页面挡住，但标签页标题已经把账期和销售姓名漏出去了**，所以这不只是可用性修复。另外四页（orders / print / worker-tasks / sales-bills）靠 `where` 里的 scope 过滤兜底（`getOrderScopeFilter` / 新增的 `getWorkerTaskScopeFilter` / `salesUserId`）。新增 `lib/auth/task-scope.ts`（与 `lib/auth/order-scope.ts` 同构的纯 where 片段），`getWorkerTaskDetail` 随之从 `findUnique` + 事后过滤重构成 `findFirst` + `where`。下次合规审计看到 `app/**` 里出现 `hasPermission` 时，请对照本条，不要当作 §4.6 违规「修掉」。
- **相关文档**：`lib/auth/permissions-dict.ts`、`lib/auth/task-scope.ts`、`lib/page-title/refs.ts`、CLAUDE.md §4.6 / §15.2

---

## 2026-08-21：死信告警走独立的 `/api/health/jobs`，刻意不动 `/ready` 的状态码

- **决策**：新增匿名端点 `/api/health/jobs`：有死信、超时 RUNNING、worker 心跳缺失或版本不一致时返回 503；只有会自愈的积压时返回 200 `degraded`。`/api/health/ready` 的状态码语义**不变**（仍只由 DB 连通 + worker 心跳决定），只在响应体附加 `jobs` 计数（`pending` / `running` / `staleRunning` / `deadLast24h`）。
- **理由**：`deploy/update.sh` 用 ready 判定发布成败，非 200 会让 Web / LIGHT / HEAVY 三个进程保持停止。死信通常是**上一版留下的历史事实**，让它进 ready 的状态码等于「有死信就不许发布」。但 `docs/production-slo-and-recovery.md` 一直把死信响应目标的验收方式写成「ready 端点 `deadLast24h` 告警」，而 ready 从不因死信非 200——这条 SLO 的验收方式在代码里根本不成立。两难的正解是拆端点，不是改 ready。
- **影响**：SLO 文档的验收方式改为「外部监控每 1 分钟请求 `/api/health/jobs`，非 200 即告警（连续 2 次失败再通知）」，并明确注明**接进监控之前该 SLO 不生效**——代码只是把信号暴露出来了，没有任何东西会自动去拉它；把「描述假事实」换成「承诺一条不存在的监控」性质更糟。去抖必须放在监控侧：HEAVY 队列并发固定 1、`runLane` 只在 claim 时扫租约，唯一 lane 跑长任务期间一条崩溃遗留的 RUNNING 会持续计入 `staleRunning`，探针会稳定 503 一段时间，**不要为此把代码阈值调松**。`scripts/deploy-smoke.mjs` 会拉一次该端点，但只打 WARNING、**非致命**，不是发布门禁。端点匿名（跟随 `proxy.ts` 对 `api/health` 的整体排除），只回计数与告警码，不回 worker 明细 / 任务 id / 类型 / 错误信息。
- **相关文档**：`app/api/health/jobs/route.ts`、`app/api/health/ready/route.ts`、`lib/background-jobs/health.ts`、`scripts/deploy-smoke.mjs`、`docs/production-slo-and-recovery.md`、`docs/部署指南.md` §14

---

## 2026-08-21：cron 密钥不进 curl 的命令行参数

- **决策**：`deploy/run-cron.sh` 及所有文档示例一律改用 `printf '%s\n' "Authorization: Bearer $secret" | curl … --header @-` 从 stdin 喂 Authorization 头，不再写 `-H "Authorization: Bearer $CRON_SECRET"`。`lib/__tests__/cron-deployment-config.test.ts` 增加源码级门禁挡住回退（shell 脚本没有别的自动化验证手段）。同时 `lib/cron-auth.ts` 的比较换成 HMAC 摘要 + `timingSafeEqual` 的恒定时间比较。
- **理由**：`-H` 的密钥在 shell 展开后进入进程 argv，同机任何用户一句 `ps -efww | grep Bearer` 就能读走完整 `CRON_SECRET`，并且会落进 shell history。`--header @-` 让密钥只经过管道，既不进 argv 也不落盘，因此不需要临时文件和 chmod；脚本里既有的 `tr -d '\r\n'` 顺带保证只会喂进一行，密钥里的换行注入不出第二个头。
- **影响**：**新增部署环境要求 `curl >= 7.55`**（`--header @-` 是 2017 年 curl 7.55.0 引入的）。Ubuntu 22.04（7.81）/ Debian 12（7.88）/ Alibaba Cloud Linux 3（7.76）都满足；万一更老，curl 会把 `@-` 当字面头名发出去 → 服务端 401 → 脚本走 HTTP 401 分支 `exit 1` 并写 syslog，是**响的失败**不是静默失败。README §🚢 的 8 段示例、`docs/deployment-smoke-checklist.md`、`docs/部署指南.md` §10 / §13 已同步；smoke checklist 里字面量 `Bearer invalid` 的 401 反例**刻意不改**（不含真实密钥）。`lib/ops-readiness.ts` 生成的 `manualCurl` 展示文本仍带 `-H`，**刻意未改**：它是 SQL 里拼给运维看的字符串，pg_cron 走 `net.http_post` 不经 shell，不构成 ps 泄漏。DECISIONS 2026-04-24「Cron 端点统一 shared-secret Bearer」的影响一节里也有 `curl -H "Authorization: Bearer $CRON_SECRET"` 写法，按追加式规范不回改旧条目，以本条为准。
- **相关文档**：`deploy/run-cron.sh`、`lib/cron-auth.ts`、`lib/__tests__/cron-auth.test.ts`、`lib/__tests__/cron-deployment-config.test.ts`、README.md §🚢2、`docs/部署指南.md` §10

---

## 2026-08-21：薪资结算只拒绝「严格未来」的日期与月份

- **决策**：`/api/cron/daily-salary` 在 `body.date` 严格晚于上海日历今天时返回 `400 {"error": "future date: <date>"}`；`/api/cron/hourly-payroll` 在 `body.month` 严格晚于上海本月时返回 `400 {"error": "future month: <month>"}`。**当天与当月仍可结算。** 谓词唯一实现在 `lib/dashboard/shanghai-clock.ts` 的 `isFutureShanghaiDate` / `isFutureShanghaiMonth`，闸口在 `lib/salary/daily.ts` 的 `assertNotFutureSalaryDate` 与 `lib/salary/hourly-aggregate.ts` 的 `assertNotFutureSalaryMonth`。
- **理由**：cron 凌晨跑的是昨天，业主手工重算的典型场景恰恰是「今天有人补报工了，重算今天」；`lib/salary/__tests__/daily.test.ts` 也有一条「注入 `now` = 当天、算当天」的用例把这个规则钉住了。把边界设成 `>=` 会同时打掉正常用法。
- **影响**：原有 `202 queued` / `200` / `401` / `500` / `503` 的响应形状一律不变，crontab 里不带 body 的默认调用（`yesterdayShanghai()` / `previousShanghaiMonth()`）**永远不会**命中新分支——只有人工带 body 重跑才可能踩到。路由的 400 只挡 HTTP 入口：若有人直接往 `BackgroundJob` 表插一条 `payload.date` 是未来日期的 `CRON_DAILY_SALARY`，worker 会命中 lib 层守卫抛错、按 `maxAttempts=4` 重试后落 FAILED——安全（不会写出工资），但会在告警里留 4 次噪音，已评估为可接受，不额外加入队校验。**当天/当月仍有两块残余风险待业主拍板**（见 HANDOFF「卡住的问题」）：上午重算当天会给还没报工的师傅写出只有 `dailyBase` 的正式行；月中重算月结会让 COOK 的 `monthlyBasePay`（整月 flat、不按天折算）立刻发满一个月。
- **相关文档**：`lib/dashboard/shanghai-clock.ts`、`lib/salary/daily.ts`、`lib/salary/hourly-aggregate.ts`、`app/api/cron/{daily-salary,hourly-payroll}/route.ts`、`docs/部署指南.md` §10

---

## 2026-08-21：交期看板与逾期推送刻意用两个查询，推送 fan-out 上限 200 是工程阀不是业务阈值

- **决策**：① 看板 `getDueOrders` 与推送 `scanOverdueOrders` 保持两个独立查询，不合并。② `/api/cron/order-overdue` 响应体**新增** `truncated` 字段（只加不减、不改名）。③ 每日逾期推送新增 fan-out 安全阀 `ORDER_OVERDUE_NOTIFY_CAP = 200`（`lib/order/overdue-scan.ts`）。逾期边界由 `lib/order/promised-date` 的新函数 `overdueCutoff()` 统一给出。
- **理由**：看板要的是「首屏能看完的前 N 条（逾期 + 3 天内到期）」，推送要的是「今天该催的每一单（仅逾期）」，边界要求相反；共用一个查询时看板要替推送背整个预警窗口的全表扫描、推送要替看板背 due-soon 的行再在 JS 里 filter。上限 200 是**工程上限不是业务阈值**：企业微信机器人有每分钟条数限制，几百条会被限流并刷爆 durable 队列。
- **影响**：**如果长期天天撞到 200，正确应对是回去回答两个业务口径问题（草稿单要不要预警、逾期多少天后停推），而不是把 200 调大** —— 这句话专门写在这里，免得下一个 agent 顺手调参。`deploy/crontab` 的 curl 只看 HTTP 状态码、`tests/e2e/notification-cron.spec.ts` 只断言 status 与 `overdueCount`，都不受 `truncated` 影响；若别处（监控脚本）对响应体做过 strict 校验需同步。已知残留风险：`db.order.count` 仍是 O(N)（只是不再把 N 行搬进 RSC payload）；「查看全部」链接与看板窗口的等价性依赖 `promisedDate` 存 UTC 零点——列表页 `promisedTo` 展开成 `lt: 次日 UTC 零点`，看板 horizon 是 `lt: 次日上海日界`，中间差 8 小时，应用层写入一律走 `parseStrictYmd` 落不进这 8 小时，只有直接写库的 fixture（`tests/e2e/_helpers.ts` 的 `seedOrderOverdueForCron`）造得出。
- **相关文档**：`lib/order/overdue-scan.ts`、`lib/order/promised-date.ts`、`lib/dashboard/`、`app/api/cron/order-overdue/route.ts`

---

## 2026-08-21：`/worker/orders` 改为 `createdAt desc` 分页，不再急单置顶

- **决策**：师傅端「我的工单」排序口径从「急单置顶 + `createdAt asc`」改为「`createdAt desc` + `id desc`」，并分页；`listWorkerOrders` 返回值由 `T[]` 变为 `PaginatedResult<T>`（`rows` / `total` / `page` / `pageSize` / `pageCount`），复用 `lib/admin/table.ts` 的 `paginationWindow` + `paginatedResult` 契约。每页条数常量 `WORKER_ORDER_PAGE_SIZE = 20`，与 `ORDER_LIST_DEFAULT_PAGE_SIZE` 对齐。急单仍以红色徽标呈现。
- **理由**：该页是**含已完成历史的归档查询视图**，真正的待办队列是 `/worker/tasks`（`listWorkerTasks` 仍按急单分组、旧单在前，且被 PENDING / IN_PROGRESS 天然收窄）。若继续以 `isUrgent` 为第一排序键，老员工的历史急单会永久霸占第一页，等于没修这条无界查询。
- **影响**：`listWorkerOrders` 全仓唯一调用点就是该页面，页面只用 `orders.length` 和 `orders.map`，无 `orders[0]` / `slice` / 位置语义依赖。`WORKER_ORDER_PAGE_SIZE` 是**我们自定的阈值、SPEC 无依据**，业主想调只改这一个常量。两项待业主拍板见 HANDOFF「卡住的问题」。**同一类无界查询 `listWorkerSalaries` 本次未改，且不能照抄本补丁**：`app/(worker)/worker/salary/page.tsx` 的 `salaryTotals()` 是从整个数组 reduce 出「累计工资 / 尚未发放」的，直接分页会把这两个金额静默变成「本页合计」——给师傅看错自己的工资总额比慢更糟，正确修法是行分页 + 用 `db.dailyWorkerSalary.aggregate` 单独算 total/unpaid。`listWorkerHourlyPayrolls` **确认不需要分页**：`@@unique([workerId, month])` 决定每人每月最多一行，十年也只有 120 行，结构上有界，且它同样有「总额从列表 reduce」的耦合，更不该为了统一而分页。
- **相关文档**：`lib/worker-portal.ts`、`app/(worker)/worker/orders/page.tsx`、`lib/admin/table.ts`、`lib/production.ts`（`listWorkerTasks`）

---

## 2026-08-21：background-jobs 模块的时间戳一律来自数据库时钟

- **决策**：`lib/background-jobs/` 的租约判定与心跳时间戳一律用数据库时钟（`clock_timestamp()` / `now()`），不用 Node 进程的 `new Date()`。`heartbeatBackgroundJob` 因此从类型化 `updateMany` 改成 `$executeRaw`。
- **理由**：web 与两个 worker 是独立进程、将来可能是独立主机，用各自的挂钟去判「租约有没有过期」等于把时钟漂移变成正确性问题——偏快的 worker 会抢走别人还持着的任务。库时钟是唯一所有参与方都同意的时间源。
- **影响**：raw SQL 会绕过 Prisma 的 `@updatedAt`，所以 `heartbeatBackgroundJob` 的语句里**显式写了 `"updatedAt" = clock_timestamp()`；日后有人再动这条 SQL，删掉那行会让线上 `BackgroundJob.updatedAt` 停止推进**。唯一已知例外是 Prisma 托管的 `@updatedAt`——`enqueue` / `complete` / `fail` / `cancel` / `retry` 这些类型化写入的 `updatedAt` 仍由客户端用 Node 时钟盖戳；已确认全仓从不读它做任何判定（只出现在 3 条 raw SET 里），彻底修需要去掉 `@updatedAt` + 加 DB 触发器（一次 migration + 全模型行为变更），本补丁刻意不做。本补丁改的是「谁说了算」而非数据格式，**新旧 worker 可以混跑滚动发布**，混跑期间新 worker 的租约判定只会更保守。两条已知遗留（危害低于本缺陷，另开 backlog）：`enqueueBackgroundJob` 的 DEAD/CANCELLED 复活路径仍是 `input.availableAt ?? new Date()`（要改须把 `EnqueueClient` 从 `Pick<TransactionClient,'backgroundJob'>` 拓宽到含 `$queryRaw`，会波及 `lib/order/export.ts` 与 `lib/cdr/bundle.ts` 的测试 mock）；`assessBackgroundJobHealth` 仍是同步纯函数、用 web 进程时钟算积压时长（它只产出 `light/heavy-backlog-old` 两个 warning，而 `available` 只由 worker-missing / version-mismatch 决定，后两者已锚到库时钟）。**审查提醒**：`databaseNow()` 与所有 `now()` 都必须在主库执行；目前 `lib/db.ts` 只有单一 `DATABASE_URL`，将来若把只读查询路由到 Pigsty 只读副本，`getBackgroundJobHealth` 这条纯读路径要重新审。
- **相关文档**：`lib/background-jobs/`、`lib/db.ts`、`docs/production-slo-and-recovery.md`

---

## 2026-08-21：`React.cache()` 的 key 逐参数比对，包装函数的签名必须只收 primitive

- **决策**：`lib/page-title/refs.ts` 里所有被 `cache()` 包装的查询，签名一律只收 primitive 参数。
- **理由**：`React.cache()` 的 key 是**逐参数比对**——primitive 走 `Map`，对象/函数走 `WeakMap` 引用相等。把现成的 `getOrderDetail(id, { id, role })` 直接包一层 `cache` 是**无效的**：两个调用点各造一个对象字面量，缓存永远 miss、库照打两次，而且没有任何报错，看起来像生效了。
- **影响**：`products` / `boms` 两页的重复查询靠这条约定用 `cache()` 真正收敛。这条注释已写在 `refs.ts` 文件头，但仍记进本文件，以免后人为了「统一签名」把 primitive 参数改回 options 对象、静默把优化删掉。同批还立了另一条可断言的不变量：`lib/order/export.ts` 的 11 个工作表 generator 一律用显式 `select`、**禁止 `include`**，由 `lib/order/__tests__/export.test.ts` 的回归闸看守——`pricingSnapshot` / `salaryRuleSnapshot` / `beforeSnapshot` / `proposedChanges` 四个大 JSON 从不导出，用 `include` 会把整表拉回来。
- **相关文档**：`lib/page-title/refs.ts`、`lib/order/export.ts`、`lib/order/__tests__/export.test.ts`

---

## 2026-08-21：`revalidatePath` 已经会刷新客户端 RSC 缓存，6 处 `router.refresh()` 是冗余（口径待业主确认）

- **决策**：**先只订正认知，不清代码**（口径 B）。本次新写的按钮一律不再补 `router.refresh()`；已有的 6 处保留原样，待业主在 A/B/C 之间拍板后再统一处理。
- **理由**：仓库里存在一条被写进注释的**错误认知**——`components/business/notification/DeleteChannelButton.tsx:55-57` 写着「`revalidatePath` alone 不刷 client RSC 缓存（直调 server action 没经过 Form 自动 refresh）」。核过 Next 16 源码，这句不成立：`revalidatePath` 会置 `pathWasRevalidated`、action-handler 下发 `x-action-revalidated`、client 的 server-action-reducer 把 `freshnessPolicy` 提成 `RefreshAll` 并对当前 URL 重新取数，**与调用形式无关**（`<form action>` / `useActionState` dispatch / 直接 `await` 都一样）；`node_modules/next/dist/docs` 的 `revalidatePath.md` 也明写 Server Functions 会「Updates the UI immediately (if viewing the affected path)」。据此，在 action 已 `revalidatePath` 的前提下再补 `router.refresh()`，等于同页连打两次全路由 refetch。
- **影响**：涉及 6 处 —— `DeleteChannelButton`、`TestChannelButton`、`PendingSchedulingBoard`、`WorkerTaskBatchList`、`OrderChangeReviewForm`、`ReassignTaskForm`。可选口径：(A) 清冗余 refresh + 订正注释 /(B) 只订正注释 /(C) 反而照抄 refresh。**在业主拍板前，不要拿那条注释当依据给新代码补 `router.refresh()`。** 同批产出还包括 `OrderForm` 的 `TextField` 必填语义修复（`required` / `aria-required` 透传 + 红星 `aria-hidden`）、`TextareaField` 语义对齐、`AttendanceRecordDialog` 补 `role="status"` 保存回执，以及 2 个 SSR markup 测试文件共 7 个用例。顺带发现但**刻意未动**：`OrderForm` 的逐字段错误挂了 `role="alert"`，与 `29334e0` 就 `EditOrderForm` 拍板的「逐字段错误不给 `role="alert"`，避免每次校验抢播报」相冲突（`OrderForm` 是 RHF `mode: 'onBlur'`，每次失焦重算都会重新播报，正是那条决策要避免的场景）——属独立一致性问题，另开 backlog。
- **相关文档**：`components/business/notification/DeleteChannelButton.tsx`、`node_modules/next/dist/docs/.../revalidatePath.md`、CLAUDE.md §15.3

---

## 2026-08-21：`reportTasks` 已改为「任务 advisory 锁 + 逐条 update」，2026-08-19 那条例外只剩 `beginTasks`

- **决策**：记录一条**文档订正**，不是新的行为决策。`lib/production.ts` 的 `reportTasks` 现在的实现是：先对选中的每个 taskId 取 `pg_advisory_xact_lock`，再取 order cascade 锁，然后读状态、在 JS 里逐条校验（`status !== IN_PROGRESS` 直接 `throw ReportError`），最后逐条 `tx.productionTask.update()`。它**不再**是 2026-08-19 条目描述的 `updateMany({ where: { status } })`。`beginTasks` 仍然是原来的 `updateMany({ where: { id: { in: ids }, status: PENDING } })`，那条例外对它继续成立。
- **理由**：报工路径必须为每条任务读薪资规则、算计件、写 `salaryRuleSnapshot`（§4.4 铁律），本来就无法用单条 `updateMany` 表达；改成先取任务锁再读写之后，「先读后写」在锁内是安全的，比原描述的 SQL 守卫更稳，只是没有编译期保障这一点没变。
- **影响**：CLAUDE.md §4.5 与 DECISIONS 2026-08-19「批量任务状态流转以 SQL where 子句表达守卫」两处的措辞都还停在旧实现上。**按追加式规范不回改 2026-08-19 那条，以本条为准**；CLAUDE.md §4.5 的同步由业主决定是否落笔（本轮文档 agent 按纪律未改 CLAUDE.md）。建议改法：把「`beginTasks` / `reportTasks` 用 `where: { status }`」收窄成只讲 `beginTasks`，`reportTasks` 另写一句「逐任务 advisory 锁内先读后写，守卫在 JS 层，同样没有编译期保障」。
- **相关文档**：`lib/production.ts`（`beginTasks` / `reportTasks`）、`lib/production/status-machine.ts`、CLAUDE.md §4.5、DECISIONS 2026-08-19

---

## 2026-08-21：`/owner/salary` 未发聚合下推数据库，前提是这条路径上没有逐行 clamp

- **决策**：`/owner/salary` 的「未发」汇总由数据库聚合给出：日薪走 `count` + `_sum`，客服「剩余未发」拆成四列 `_sum` 再在应用层组合，不再把行拉回内存 reduce。同时新增 migration `20260821090000_salary_unpaid_summary_indexes`，用 `CREATE INDEX CONCURRENTLY` 建三条索引（`DailyWorkerSalary_isPaid_date_idx`、`HourlyWorkerPayroll_isPaid_month_idx`、`CustomerServiceCommission_isFullyPaid_settledAt_idx`）。
- **理由**：本次修复没有引入新阈值、新窗口、新降级分支，SPEC 口径完全未动（`dailyToday.count` 含已发未发全部行、`csUnpaid` 只算已结算周期的剩余底薪+提成、`periodEnd` 最后一天不算到期）。
- **影响**：**客服「剩余未发」之所以能拆成四列 `_sum` 再组合，前提是这条路径上没有逐行 clamp / 取正**；将来若要加「单个周期不能算负数」的规则，这个下推必须回退成 `groupBy` 逐周期算。新迁移无数据校验、无 fail-fast 分支，纯加速；但 CONCURRENTLY 中途失败会留下 INVALID 索引需手工 `DROP` 重建，正好被发布前既有的「无效并发索引为 0」检查覆盖，不需要新增流程。顺带订正一处长期漂移的口径：README 与部署指南都钉着「71 项 migration / 尾项 `20260807184000_pricing_compatibility_fence`」，**在本次改动之前它就已经落后 3 项**（仓库实际 74 项、尾项 `20260808100000_external_sales_logistics_charges`）；加上本次 1 项，正确说法是 **75 项 migration、尾项 `20260821090000_salary_unpaid_summary_indexes`**。
- **相关文档**：`lib/salary/`、`app/(admin)/owner/salary/`、`prisma/migrations/20260821090000_salary_unpaid_summary_indexes/`、README.md §🚢7、`docs/部署指南.md` §14

---

## 2026-08-21：单条报工数量守卫判据用 `>=`，超报照付但必须配「超计划报工」看板

- **决策**：师傅单条报工时，`合格 + 不良 + 返工` 的合计 **达到** `计划数 × N` 一律硬拒（不可确认、不可绕过）；N 由新 `Setting` 键 `report_qty_max_multiple` 配置，默认 3、可配范围收在 1–10。合计超过计划数但未达上限时，由师傅自己勾选「确认超出计划数」通过，并在 `ProductionTask.remark` 与 `OrderLog(action='TASK_OVER_REPORT')` 两处留痕。**计件金额仍按实际合计数全额付**（业主拍板，算钱链路一个字都没改）。批量「一键完工」按计划数报，不受此项影响。
- **理由**：判据必须是 `>=` 而不是 `>`。守卫唯一真正要挡的场景是「多打一个零」——计划 P 打成 10P；严格大于时只要 N = 10，`10P > 10P` 为假，这一次都挡不住，守卫等于白装。同理默认值取 3 而不是 10，`field.max` 收到 10 而不是 100：允许配到 100 等于把守卫关掉。下限 1 是严格模式（limit = 计划数，任何超报硬拒，确认分支自然失效），保留它是给业主一个「先收紧再放开」的开关。数量框刻意**不设 `max`**：原生约束校验在关掉 JS 时也生效，手机上只弹一个原生气泡且极易滚出视野，那条精心写的「已达到 N 倍上限」中文提示就永远看不到——上限判定只留在服务端。
- **影响**：**批准权落在被发钱的人自己手上**，所以这条决策有两半，缺一不可：守卫 + 老板看板的「超计划报工」表。二者是一个决策的两半，**不能只留守卫、砍掉看板**——砍掉看板等于让师傅可以自助批准加薪且无人知情。看板数据源就是 `OrderLog where action='TASK_OVER_REPORT'`（近 7 天），刻意不新增推送事件（那要同步改 `lib/notification/events.ts` 与 `prisma/seed.ts` 的默认模板，成本明显更高）。`ProductionTask.remark` 由此从「全仓无写入方的死列」变成有唯一写入方，格式 `[超计划报工] YYYY-MM-DD 计划 N / 合计 M（合格 a / 不良 b / 返工 c），报工人 <id>，已勾选确认`，多次写入以 `\n` 追加；看板「明细」列原样渲染这个字符串，**格式改动要当成对外契约看**。`OrderLog.action` 新增 `'TASK_OVER_REPORT'`（`action` 是 String，无 DDL），`lib/order/log-format.ts` 同时顺手补上既有缺口 `TASK_REASSIGN`（`lib/production.ts` 一直在写它却没有中文标签）以及 `FIELD_LABELS` 的 `completedQty` / `defectQty` / `reworkQty`。`Setting` 表由此有 4 个键，`report_qty_max_multiple` 是唯一 money-adjacent 的那个（守着会算出计件金额的路径），但 `resolveSetting` 的「校验不过退回 fallback」对它仍然安全：它不参与任何金额计算、只是一个上界，退回 3 只会更严。上线成本：超报确认要多一次提交往返（零 JS 下是整页 POST + 重渲染），弱网车间的师傅会感知到这个延迟，**这是拍板方案的固有成本，不是实现缺陷**。
- **相关文档**：`lib/settings/definitions.ts`、`lib/production.ts`（`reportTask`）、`lib/order/log-format.ts`、`lib/dashboard/owner-watchlist.ts`、`app/(admin)/owner/page.tsx`、`components/business/production/ReportTaskForm.tsx`、SPEC-v1.2.md §3.3、CLAUDE.md §4.4 / §15.8

---

## 2026-08-21：工单完工闸口收紧为款式级外协覆盖，粒度残留缺口显式接受

- **决策**：完工闸口由「有外协单且全部 `RECEIVED`」改为「每个含外协工艺的款式都被至少一张本工单未取消的外协单覆盖」。判定粒度是**款式**，不是「款式 × 外协工艺」。不改表，复用 `OrderItem.crafts` 与 `OutsourceOrder.orderItemIds`。同时新增导出谓词 `outsourceCoverageApplies(order)`（判 `requiresOutsource === true`），**闸口与工单详情页横幅必须共用它**。
- **理由**：原闸口完全不看覆盖了哪些款式——三款式工单只给其中一款发了外协单并收货，工单照样完工发货，属于会真出货错的漏洞。谓词必须共用：`requiresOutsource` 是排产那一刻的快照且无重算路径（`scheduleOrder` 对已排产工单必抛 `InvalidOrderTransitionError`），而 `updateCraft` 可以把 `isOutsource` 从 false 翻成 true；不共用就会出现「页面说不能完工、闸口其实照样完工」的反向漂移，主管照提示补出来的外协单会带 `amount`，变成一笔凭空的外协应付。
- **影响**：`ProductionCompletionTx` 新增 `orderItem` / `craft` 两个 model 的窄接口，返回值由 `boolean` 改为 `ProductionCompletionOutcome{completed, blockedBy, uncoveredItems}`；五个调用点改取 `.completed`（`lib/production.ts` 三处 + `lib/outsource.ts` 两处）。**`lib/production.ts` 的 `reportTasks` 批量那处原本写成 `if (await maybeComplete...)`，改成对象之后 tsc 一个字都不报、工单会被无条件判为完工**，已改成显式取 `.completed` 并在注释里写明。`markOutsourceReceived` 有两个 return，事务外那个逐字段重建对象，`pendingOutsourceItems` 必须两处都带（可选字段，tsc 不报，只有 lib 层用例守得住）。新增查询只在「内部任务全完 + 外协全部收货」这一刻跑，报工路径成本不变；非外协工单一条新查询都不跑。**已知残留缺口：同一款式两道外协工艺、只发一道时仍放行**——业主已接受。**别当 bug 修**：堵口需要给 `OutsourceOrder` 加 `craftIds`（改表），而历史外协单的 `craftDescription` 是自由文本无法回填，强行升级会把在产工单集体卡死。这条已在 `lib/outsource/coverage.ts` 顶部注释 + `lib/outsource/__tests__/coverage.test.ts` 的「【残留缺口回归锁定】」用例 + 本条决策三处写明；将来任何人想改成按工艺判定，先看本条的影响一节。**上线必须分两步**：2a（零行为变更的读路径 + 详情页横幅）先上，让主管照横幅把存量缺口补完；2b（闸口收紧）是「部署当天可能一批在产工单突然完不了工」的那一步，上线前必须先跑 `docs/上线前置操作清单.md` 的两段只读 SQL，并把查询 1 列出的存量缺口全部补完。
- **相关文档**：`lib/outsource/coverage.ts`、`lib/production-completion.ts`、`lib/production.ts`、`lib/outsource.ts`、`app/(admin)/orders/[id]/page.tsx`、`docs/上线前置操作清单.md`、SPEC-v1.2.md 外协章节、CLAUDE.md §4.5

---

## 2026-08-21：盘点并发守卫用「逐行钉住的账面回声 CAS」，时间戳基线方案整体否决

- **决策**：库存盘点的并发守卫采用**逐行账面回声 CAS**——页面把「录入这一格时操作员看到的账面数」钉在该行上一并回传，服务端在行锁之后与库内余额比对，不等就判该行冲突。业主原意（别人动过就拒绝）完整保留，只是换了机制。冲突行**剔除后继续过账余下的行**（部分过账），一条都不剩时才整单回滚。零 schema 变更、零 migration、零新 `Setting`。
- **理由**：被否决的是「整页共用一个基线时刻」这个设计，而不是守卫本身——原方案的 4 条 blocking/major **全部源自那一个设计**：(1) 分批盘点时基线被整页推进，已数未录的行漏检；(2) 快照过期抛的是普通 invariant error，降级后不带 `staleKeys`/`checkedAt`，客户端无从恢复，只能 F5，而 `counts` 是纯 `useState`、全部蒸发，是**不可恢复的死路**；(3) 成功后的新基线来自未 await、可能失败的 fetch，且上一轮自己写的 `INVENTORY_COUNT` 流水 `createdAt` 必然晚于旧基线 → 自噬；(4) 账面数取自最近一次 fetch 而基线刻意不跟 fetch 走，点一次「刷新/搜索」两者就分叉、CAS 恒等成立。而账面回声只要把账面数钉在**录入那一刻**，就不需要任何基线时间戳、不依赖客户端诚实、也不依赖后续 fetch，能捕获所有「改变了余额」的变动。部分过账则解决「一行冲突整单驳回，忙碌库位永远盘不完」——原设计下 99 行合格数据陪葬且没有 override。
- **影响**：**唯一残留缺口是净额为零的往返**（先出 20 再进 20，余额回到原值）：CAS 检测不到，而时间戳基线能。堵这个口需要逐行 `snapshotAt` + `MaterialTransaction` 复合索引 + ledger scan（定稿 §3b），已拆出单独设计评审，**本批不做**。代码注释里已写「别把这条当 bug 顺手改成时间戳基线」，本条决策是它的背书。**部分过账语义需业主点头**：一次提交现在可能只过账一部分行，`InventoryCount` 单据上只有被接受的那些，冲突行原样退回要求重数；风险评估为低（盘点行本来就是逐 (物料, 库位) 独立的），但要确认。**部署瞬间有一个刻意的 fail-closed**：浏览器里开着旧版盘点页的操作员，提交会因缺 `bookQuantity` 被判 invalid，提示「缺少账面数快照，请刷新页面后重新盘点」；刷新即可，但已录入的数据会丢（`counts` 是纯 `useState`），建议低峰期发布或先口头通知盘点岗。
- **相关文档**：`lib/inventory-count-posting.ts`、`lib/inventory-count-entries.ts`、`lib/auth/schemas.ts`（`postInventoryCountSchema`）、`actions/owner-inventory.ts`、`components/business/material/InventoryCountClient.tsx`、`docs/上线前置操作清单.md`

---

## 2026-08-21：OSS 直传重放加固本批不做，已知风险显式接受

- **决策**：「临时 key + 服务端 copy」方案（前端只拿 `upload-tmp/` 前缀的预签 PUT，服务端 HEAD 量真实字节后 copy 到 `design/`，正式 key 只由服务端派生）**本批不实施**。保持现有缓解：STS session policy 收窄到单个 objectKey + 15 分钟过期。
- **理由**：业主决定本批先上四条修复里风险收益更清楚的三条。这一条的前置动作全在阿里云控制台（RAM 前缀权限 + 生命周期规则），且顺序不能反——RAM/生命周期没先生效就上代码 = 全员上传失败，不适合和其它修复挤在同一个发布窗口。
- **影响**：**这是已知接受的风险**，不是「已修复」：在 15 分钟预签窗口内，拿到 URL 的浏览器仍可以覆写自己刚登记的对象（申报小文件通过大小校验、登记后再换成大文件）。窗口已经从 1 小时压到 15 分钟，但没有关掉。将来真去实施时，有两个**必踩的 blocking 陷阱**，写在这里免得下次重新踩一遍：(1) **ali-oss 的 `copyObject` 对 headers 只加前缀、不删原键**（`lib/common/object/copyObject.js:20-23` 遍历 `options.headers` 逐个补 `x-oss-copy-source-` 前缀副本），所以裸写 `If-Match` 会让线路上同时出现裸 `If-Match`，被 OSS 当成对**目标对象**的条件写求值，而目标 key 每次新铸 uuid、必然不存在 → **copy 恒 412**；正确写法是直接传 `'x-oss-copy-source-if-match'`。而 `If-Match` 本身不是可选项——摘掉它等于把「申报小文件、copy 前换大文件」这条路留着。(2) **etag 缺失被当成成功会写出悬空指针**：ali-oss 的 `successStatuses = [200, 304]`，客户端只看状态码、**从不检查 200 响应体是不是 `<Error>`**，这两种情况下 `data.ETag` 都是 undefined；写成 `if (copiedEtag && copiedEtag !== sourceEtag)` 会短路跳过、事务照常提交，`fileUrl` 指向不存在的对象 → 详情页图裂 + `lib/cdr/zip.ts` 的 `getStream` NoSuchKey 把整个 HEAVY 打包任务打挂。判据必须是**严格相等**（简单 copy + metadata-directive COPY 下目标 etag 恒等于源 etag；这也是不能换 `multipartUploadCopy` 的理由——分片拷贝的 ETag 带 `-N` 后缀，永远不等于源）。另记一条与之配套的红线：**`design/` 前缀永远不能挂生命周期规则**，它是业务数据，将来有人为了清孤儿顺手挂上去就是删设计图。
- **相关文档**：`lib/oss/sign.ts`、`lib/order-design.ts`、`docs/上线前置操作清单.md`（「未来实施时的前置项」一节）、`docs/部署指南.md` §6

---

## 2026-08-21：通知投递失败改为可重试并进死信，幂等靠 `NotificationLog.deliveryKey`

- **决策**：durable 路径的通知投递失败不再是终局。`NotificationLog` 新增 `deliveryKey`（取 `BackgroundJob.dedupeKey`，同一条逻辑投递在多次 attempt 之间稳定不变）与 `@@unique([deliveryKey, channelId])`，worker 开跑前先查这次投递已 `SUCCESS` 的 channel 并跳过，写日志走 `upsert` 就地翻转状态而不是层层堆 FAILED 行。**瞬时失败写 `RETRYING`**（而不是 `FAILED`），重试耗尽才落 `FAILED`；**永久性投递失败仍让 `BackgroundJob` 判 `SUCCEEDED`**。
- **理由**：CLAUDE.md §15.4 禁止的是「把漏算的批次标成成功」，而 channel 关停 / webhook key 失效属于**已判定终局的投递**——重试 5 次结果一样，只会灌满 ops 无法处置的死信队列。这类失败的通报渠道是 `NotificationLog(FAILED)` + 首页 24h 告警条 + ops 页错误码列（现已能显示 `job.result` 的 `failed` / `errorCodes`），不是死信探针。
- **影响**：**直接改变业主天天在看的 `/owner` 首页「24 小时推送失败」告警条计数**：瞬时抖动不再点红，重试成功还会把历史 `FAILED` 行就地翻成 `SUCCESS`。上线前应当告知业主，别让人以为数据丢了。`/api/health/jobs` 的 `jobs` 对象新增 `deadNotificationLast24h`（只加不减），且**通知类死信只让该端点返回 200 `degraded`、不再 503**，新告警码是 `dead-notification-jobs-last-24h`；`/api/health/ready` 的状态码语义完全不变。相应地 `docs/production-slo-and-recovery.md` 的「死信 30 分钟响应」采样点现在只覆盖非通知类死信（`dead-jobs-last-24h`），通知投递失败的采样点改为 `/owner/notifications` 的 `NotificationLog(status=FAILED)` 与首页告警条。**将来若给 `NotificationLog` 加保留期/清理任务，必须排除「所属 `BackgroundJob` 仍在 `PENDING`/`RUNNING`」的行**——`deliveryKey` 行是幂等凭证，删早了会导致重试对已收到消息的群重复推送。两个新 migration：`20260821120000_notification_log_delivery_key`（纯加列，可空无默认，历史行留 NULL、老路径行为不变）与 `20260821120100_notification_log_delivery_key_unique`（`CREATE UNIQUE INDEX CONCURRENTLY`，**先 DROP 再建、刻意不写 `IF NOT EXISTS`**）。**这条索引是正确性依赖，不是「失败只是少个优化」**：CONCURRENTLY 中途失败会留下 `indisvalid=false` 的 INVALID 索引，而 PostgreSQL 不会拿 INVALID 索引当 `ON CONFLICT` 的 arbiter，`notify` 的 upsert 会每次进 catch、幂等凭证全丢、重试对所有群重复推送——部署后必须人工验收（SQL 见 `docs/上线前置操作清单.md`）。**已知缺口**：最后一次 attempt 期间 worker 猝死（PM2 reload / OOM）时，租约清扫直接把 job 判 `DEAD`，`notify` 不会再跑，那一轮写下的 `RETRYING` 行永远翻不成 `FAILED`，而 `countRecentFailures` 只数 `FAILED` —— 这条真正丢掉的推送会在 `/owner/notifications` 上一直显示「重试中」、首页告警条计数为 0。修法是在 `lib/background-jobs/repository.ts` 的租约清扫之后，把 DEAD 通知任务对应 `deliveryKey` 的 `RETRYING` 行收敛成 `FAILED`；本次没做是因为该文件正被并发 agent 做数据库时钟重构。
- **相关文档**：`lib/notification/notify.ts`、`lib/notification/webhook.ts`、`lib/background-jobs/notification.ts`、`lib/background-jobs/health.ts`、`app/api/health/jobs/route.ts`、`prisma/migrations/20260821120000_*`、`prisma/migrations/20260821120100_*`、`docs/production-slo-and-recovery.md`、CLAUDE.md §7 / §15.4

---

## 2026-08-21：批量通知扇出按 `index × 3500ms` 摊开，是限额工程阀不是业务阈值

- **决策**：一次 cron 触发的批量通知（典型是逾期工单扫描）按序号把 `availableAt` 摊开，间隔 3500 ms ≈ 17 条/分钟。
- **理由**：企业微信群机器人有 20 条/分钟的限额。不摊开就会在限额上撞墙，撞出来的失败全部变成重试、把死信队列灌满，而这些失败没有任何一条是业务问题。摊开让出队速率天然低于限额，留了一点余量给同一个群的其它事件。
- **影响**：**200 张逾期单的最后一条会比 cron 触发晚约 12 分钟到达**，这是刻意的取舍。这个数是限额推出来的工程阀，不是业务阈值——将来若换推送渠道或渠道放宽限额，改这一个常量即可，不要当成「业主定的提醒节奏」。与既有的 `ORDER_OVERDUE_NOTIFY_CAP = 200` fan-out 上限是两件事：上限决定推几条，摊开决定推多快。
- **相关文档**：`lib/background-jobs/notification.ts`、DECISIONS 2026-08-21「交期看板与逾期推送刻意用两个查询」

---

## 2026-08-26：管理后台默认只展示业务语言，技术标识不得增加理解负担

- **决策**：面向业务用户的管理前端不得直接展示数据库枚举、字段名、规则 code、JSON key / 公式 DSL、内部 ID、哈希、导入坐标或英文匹配操作符。`STOCK_BLANK`、`CUSTOM_SINGLE_FLAT_FOIL`、`COLOR_PRINT` 等值只作为存储、接口、日志、表单 value 和测试契约；页面通过集中映射显示中文业务名称。
- **例外**：工单号、SKU、物料/仓库编码、审批编号和版本号属于业务标识，允许展示。诊断细节只能在具备相应权限、用户显式开启的高级/诊断界面中按白名单展示，默认不取数、不显示。
- **信息密度**：一个业务事实只保留一个主展示位置。列表只展示完成当前决策所需内容；没有草稿时不重复显示“未调整 / 无需补全 / 暂无草稿”等无行动价值的状态；低频适用条件默认折叠。
- **功能边界**：精简只发生在 presentation 层，不删除底层 enum、版本快照、结构化匹配条件、发布校验或审计记录。需要编辑的内部值必须投影为中文选项，不能通过直接删字段破坏计价能力。
- **验收**：UI 测试检查可见文本和无障碍属性，但允许内部值存在于 `value` / `href` / `data-*`。未知枚举不得将原 token 回显给用户。
- **相关文档**：`UI-SYSTEM.md`“业务语言与技术标识可见性”、`docs/ORDER-PRICING-AND-DISPATCH-V2.md` 第 6 节、`docs/UI-REMEDIATION-BACKLOG.md` `UI-F15`

---

## 2026-08-27：入袋费保持自动计价，费率由当前加工费版本决定

- **决策**：包装组、每袋组成和实际袋数模型已经具备，入袋费继续自动计价，不再把 `0.1/0.2` 一律转给管理员确认。当前已发布规则版本为单款装 `0.1` 元/袋、混装 `0.2` 元/袋；这两个金额是版本数据，不是永久业务常量。
- **计价事实**：服务端根据各款数量和每袋组成重新推导实际袋数，不信任浏览器提交的袋数。单款装只能包含一个款式，混装至少包含两个款式且各款必须推导出相同袋数。每个包装组按模式唯一命中当前已发布、当前有效的加工费 `PER_BAG` 规则，小计为“实际袋数 × 每袋费率”，各包装组小计只汇总一次并计入客户加工费应收。
- **失败关闭**：包装组成非法或无法推导唯一袋数时直接拒绝创建并要求修正，不能把错误事实交给管理员猜价。订单事实合法，但当前加工费版本不唯一、模式规则缺失/冲突/阻断或金额非法时，不猜价，也不把零元占位当成最终价；工单进入“待管理员确认”。只有这些未确认项允许管理员填写最终每袋价格，并必须保存原因和新价格修订；完整自动价以版本规则为准，不接受静默覆盖。
- **版本与追溯**：新建和显式整单重算读取操作发生时最新有效的加工费版本，并在逐包装组快照中保存价目簿、版本、模式、袋数、规则、费率、小计和舍入方式。发布新版本不静默改写已冻结工单；存量工单只有显式整单重算才切换到新规则。
- **取代关系**：本决策取代 2026-08-07“包装替代关系保留为 `REFERENCE`”以及 `docs/ORDER-PRICING-AND-DISPATCH-V2.md` 早期“包装组完成前必须人工确认”的口径，仅限入袋费。事实或规则不完整时转人工、历史版本不可变等失败关闭原则继续有效。
- **展示缺口已解决**：Form B 不再显示静态 `0.1/0.2` 费率；包装模式只陈述订单事实，费用栏展示服务端当前版本报价金额，避免价格版本调整后页面说明滞后。
- **相关实现与验收**：`lib/order/packaging-bag-count.ts`、`lib/price/order-packaging-quote.ts`、`lib/order.ts`、`lib/price/__tests__/order-packaging-quote.test.ts`、`lib/order/__tests__/pricing-review.test.ts`、`docs/ORDER-PRICING-AND-DISPATCH-V2.md` 第 2、7、8、9 节。

---

## 2026-08-27：移除 Server Action 成功后的重复全路由刷新

- **决策**：业主已批准执行 2026-08-21 待定口径 A。当 Server Action 已对当前页或其数据源执行 `revalidatePath` 时，客户端不再在成功分支追加 `router.refresh()`。
- **理由**：Next 16 的 Server Function 再验证会立即更新正在查看的受影响路径；追加刷新会对同一 RSC 树再发起一次请求，而 render 期调用还会制造重复读取。
- **保留边界**：导出/打包后台任务轮询、设计稿上传完成、用户手动点击重试，以及 Server Action 传输结果不明时的手动恢复仍保留 `router.refresh()`；导航成功页仍使用 `router.push/replace`。
- **相关实现与验收**：`components/business/production/`、`components/business/order/OrderChangeRequestForm.tsx`、`components/business/order/OrderChangeReviewForm.tsx`、`components/business/order/OrderPricingReviewForm.tsx`、`components/business/order/OrderCommercialDetailsManager.tsx`；以 Next 16 `revalidatePath` 契约、全量单测和浏览器验收为门禁。

---

## 2026-08-27：外部销售快递费只使用承运商确认重量（已证伪、已取代）

- **历史结论**：本条曾要求快递费只读取 `OrderShipment.weightKg`，并在缺少履约重量时保持“待管理员确认”。
- **证伪依据**：权威文件《加工费计费规则.md》§6 明确给出按整单款式数量与单个克重求净重、向上取整到 kg、最低 1kg 的公式；其 SHA-256 为 `3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817`。因此把该公式认定为“无来源猜算”是错误的。
- **使用限制**：本历史条目不得再作为实现、审查或验收依据。浏览器提交的 `quotedWeightKg` / `billableWeightKg` 仍不是可信事实，且不得覆盖已经保存的履约实际重量。
- **取代关系**：由下方“外部销售快递重量由服务端估算，履约实际重量优先”决策完整取代。

---

## 2026-08-27：外部销售快递重量由服务端估算，履约实际重量优先

- **权威来源**：《加工费计费规则.md》§6，SHA-256 `3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817`。该规则随 `LOGISTICS` 价目版本发布，不写死为 UI 或浏览器公式；费率行继续保留中通工作簿的逐行来源证据。
- **适用边界**：仅中通且整单总数量不超过 `2000` 个时自动估算；超过 `2000` 个走物流并保持运费待管理员终价。顺丰到付仍记为 `WAIVED / 0`，纸箱与其他费用照常计算。
- **估算公式**：订单净重为各款 `数量 × 单个克重` 之和；`120g=4.5g/个`、`150g=6g/个`、`160g=6g/个`、`180g=6.75g/个`、`200g=8g/个`、`230g=10g/个`，万元封固定 `10g/个`。计费重量为 `max(1, ceil(净重克数 / 1000)) kg`。
- **事实优先级**：已有管理员或履约流程保存的实际重量时，以实际重量覆盖估算；缺少实际重量时才由服务端从结构化款式事实估算。浏览器提交的报价重量、金额或历史更正重量既不作为估算输入，也不得覆盖实际重量。
- **示例**：`2000` 个 `160g` 产品估算 `12kg`；发往上海按当前中通 C 档计算为 `2.8 + 11 × 3.5 = ¥41.30`，不再显示“待管理员终价”。
- **版本与历史**：迁移 `20260827104000_external_logistics_weight_policy_v3` 为当前段及每个已发布的未来物流段分别派生前向 successor：当前 successor 从迁移时刻接管到原段截止时间，未来 successor 保持各自原有半开生效区间、费率、规则与来源事实，并统一叠加本条重量策略。当前旧段只闭合有效期；未来旧段只停用，原 notes、规则和审计时间不改写；历史工单与收费快照继续引用原版本。这样未来调价按原计划生效时不会重新落回已证伪的承运商单一重量口径。
- **相关实现与验收**：`actions/order-logistics-quote.ts`、`lib/order.ts`、`lib/order/pricing-review.ts`、`lib/order/change-request.ts`、`lib/price/external-order-charge-facts.ts`、`lib/price/external-order-charges.ts`及物流估算、实际重量覆盖和迁移时间线测试。

---

## 2026-08-27：外部报价目录与事实合法性不再由编码或旧能力清单决定

- **决策**：外部销售创建工单时，可选报价 SKU 只来自唯一当前生效的 `EXTERNAL_SALES / PROCESSING` 价目版本中启用基础规则绑定的 `productId`。`EXT-`、`PRD-` 等产品编码不参与可报价性判断；当前版本缺失或重叠时失败关闭，不降级为全部启用产品。
- **事实与价格能力分离**：请求 schema 只拒绝结构上非法或自相矛盾的工艺事实。专版双面、彩印反面烫金等合法但当前不自动定价的组合必须进入版本化规则引擎，由当前阻断规则返回“待管理员确认”；不得在 schema 中复制一份固定的自动价能力清单。
- **理由**：产品编码是管理标识，不是价格版本。用前缀筛选会让管理员新建并发布的 `PRD-*` SKU 在创建页消失；在 schema 提前拒绝合法事实则会让已经发布的人工核价规则永远无法命中，两者都会绕开规则配置中心的权威性。
- **影响**：管理端发布价格版本时负责绑定稳定产品 ID；创建页只消费该版本投影。每面超过 3 色、缺少必要颜色/工艺等非法事实继续直接拒绝，合法但未定价的事实保留完整快照并等待管理员终价。
- **相关实现与验收**：`lib/product.ts`、`app/(admin)/orders/new/page.tsx`、`components/business/order/external-order-b-catalog.ts`、`lib/auth/schemas.ts`、`lib/price/external-sales-quote.ts`及其回归测试。

---

## 2026-08-27：改单必须原子维护计价事实、包装金额与历史兼容

- **决策**：改单申请、预览和审批使用同一套结构事实校验，但历史 `MANUAL_QUOTE` 工单保留兼容入口；只有实际变更后的事实非法时拒绝，合法但未被当前版本覆盖的组合继续转管理员终价。新建工单仍不允许主动选择人工路线。
- **包装与金额**：修改款式数量后，服务端必须根据包装组明细重新推导实际袋数；外部销售按审批时有效版本重新报价，内部结算按冻结单价重算，并把逐组变更写入不可变审计。当前改单合同不能表达“新增款式如何装袋”，已有包装组的工单新增款式时失败关闭，不得按旧袋数或零元放行。
- **SKU 身份**：规格、产品 SKU、实际尺寸和产品结构属于同一个计价身份。当前合同不能原子携带整组身份，因此禁止只改规格；新增款式默认继承模板规格，空值表示不覆盖，不制造“新规格＋旧 SKU”的矛盾事实。
- **工艺事实**：正反面颜色数组为权威来源，每面最多 3 色；旧聚合颜色字段只用于历史兼容，不能误杀正反面各 3 色，也不能把无侧信息的 6 色解释为合法单面事实。
- **相关实现与验收**：`lib/order/change-request.ts`、`lib/auth/schemas.ts`、`components/business/order/OrderChangeRequestForm.tsx`及改单回归测试。

---

## 2026-08-27：彩色生产工单采用显式 A4 分页，声明页码必须等于物理 PDF 页数

- **决策**：款式、图稿、生产工序、多地址、长备注和长页眉均由打印布局显式分页；Chromium 不得依靠内容溢出暗中增加物理页。页脚声明总页数必须与实际 PDF 页数一致。
- **信息保留**：主页和重复页眉使用有界预览，完整客户名、生产团队、备注、地址和结构化事实保留在附页；不能以截断全文换取分页稳定。图稿附页对单图和少图设置最大宽高，避免纵向图片撑破 A4。
- **确定性**：同一时间戳的图稿和任务使用稳定 ID 作为次级排序；分页权重、页码偏移和二维码位置在相同事实下必须可复现。
- **验收边界**：至少覆盖 1–10 张图稿、20/50 款、正反面最长合法文本、10 个地址、50 个长姓名师傅、8 款/8 图密集主页，以及单图被长文本移入附页；每张 `.sheet` 高度不超过 A4，DOM 页数等于 Chromium 生成 PDF 页数。
- **相关实现与验收**：`lib/order/print-layout.tsx`、`lib/order/print-types.ts`、`lib/order/print-view.ts`、`lib/order/print-html.tsx`、`tests/visual/order-print.spec.ts`。

---

## 2026-08-28：销售直接建单，独立报价 / 询价入口已废止

- **决策**：外部销售和客服均直接创建工单；工单预览与提交由计价引擎读取已发布价表。不再提供独立查价、询价页或客服占位入口，旧深链直接返回 404，不做兼容跳转。
- **取代关系**：本条取代本文 2026-08-09 和 2026-08-11 关于销售查价页、物流查价深链以及客服报价占位的历史口径；这些记录仅供追溯，已废止，不得再作为实现或验收依据。
- **保留边界**：规则配置中心的数据模型、价格编辑、发布机制和版本快照原样保留；销售建单、工单列表、详情、账单与生产 UI 不属于本次删除范围。

---

## 2026-08-29：日常调价默认立即发布，预约生效降为可选高级操作

- **保存与生效边界**：价格格保存仍只写入唯一未生效草稿；已发布版本继续只读。发布必须创建新的半开生效窗口、运行整簿校验和真实建单候选投影，并保留 `priceVersion` 锁、历史工单快照、乐观锁与审计。不得把“保存格子”改成原地覆盖当前价表。
- **默认发布方式**：普通调价不再要求管理员选择时间。省略生效时间时，服务端在取得价格写锁后采样一个统一时刻，并同时用于当前版本选择、旧版截止、新版开始、候选投影和审计记录；浏览器不得用分钟精度的本地时间模拟“立即”。未来预约仍作为折叠的可选操作兼容，已有 `SCHEDULED / CANCELLED / HISTORICAL` 记录不迁移、不删除。
- **发布说明与确认**：草稿创建时必填的调价原因同时作为默认发布说明；只有需要补充时才另填。发布页合并为一次差异审阅和一次明确的“确认并立即发布/确认预约发布”，不再重复要求必填时间、第二份说明、进入确认按钮和 checkbox。高风险涨跌、历史工单影响和全表检查结果仍必须在提交按钮前可见。
- **失败关闭**：规范化规则集与当前版完全相同时，预览和最终事务都拒绝发布，禁止制造空版本。预览的“通过”必须包含真实双价簿建单投影，不得只用结构校验冒充完整通过；最终发布在写入前重复投影。
- **导航与历史**：发布差异和校验问题按持久化规则身份映射回所属业务板块并聚焦真实草稿输入，不再使用已废止的 `?item=#selected-charge-detail` 工作台深链，也不得按名称猜板块。历史版本按价目谱系分组但不显示内部 code；停用且未来从未生效的旧发布版本显示为“已取消”，不能冒充普通历史生效版本。
- **取代关系**：本条取代 2026-08-09“每次发布都由管理员选择上海时间”和 2026-08-11 将预约状态作为日常发布主流程的交互口径；底层未来生效能力、版本窗口和历史兼容继续保留。

---

## 2026-08-30：考勤是时薪工资的源事实，已发月份冻结、未发快照随源变更失效

- **决策**：`recordAttendance`、`removeAttendance`、时薪重算和标记已发共用唯一的 `(workerId, month)` PostgreSQL advisory transaction lock。当 `HourlyWorkerPayroll.isPaid=true` 时，该月考勤不得新增、覆盖或删除；考勤真实变更时，同一事务删除未发工资派生快照，由下次重算重建。（部分已被 2026-09-24「删除清废/厨师工种与清废工艺」取代）
- **理由**：只加 `isPaid` 查询会留下 TOCTOU；只锁考勤写入也会让“先修考勤、后把旧金额标已发”成立。未发工资是可重算的派生数据，考勤才是事实源。
- **边界**：完全相同的幂等重录不使未发快照失效；删除只把真实 Prisma `P2025` 视为幂等不存在。直接 SQL 绕过应用仍不受 advisory lock 契约保护，如需开放直连写入必须另加数据库 trigger。
- **相关实现与验收**：`lib/attendance.ts`、`lib/salary/hourly-lock.ts`、`lib/salary/hourly-aggregate.ts`及 PostgreSQL 并发测试。

---

## 2026-08-30：物料计量单位在创建后不可变

- **决策**：物料创建后不再允许原地更换单位。要换单位必须新建物料，不自动换算任何数量。
- **理由**：仅在“已有数量事实”后禁止修改，无法保护单位修改前已打开、修改后才提交的采购/BOM/库存表单；这些请求只携带 `materialId + quantity`，会把旧单位数量按新单位解释。创建后不可变从根本上消除该竞态。
- **边界**：单位未变时仍允许修改名称、编码等字典属性；UI 中单位只读，领域层重复强制该约束。
- **相关实现与验收**：`lib/material.ts`、`components/business/material/MaterialForm.tsx`及旧单位表单回归测试。

---

## 2026-08-30：工单全量编辑表单使用数据库递增版本，不自动合并过期快照

- **决策**：编辑页加载时把 `Order.editVersion` 作为必填隐藏令牌。保存时先在事务内比较，最终通过 `WHERE id = ? AND editVersion = ?` CAS 写入；过期或 CAS 失败明确要求刷新，不写 Shipment/OrderLog，也不猜测字段级合并。
- **版本所有权**：PostgreSQL `BEFORE UPDATE` trigger 对每次 `Order` 写入强制执行 `OLD.editVersion + 1`，不依赖应用时钟。`updatedAt TIMESTAMP(3)` 可在同一毫秒重复，不再用作严格 CAS 令牌。
- **理由**：表单提交的是完整页面快照，无版本守卫时会用旧值覆盖另一个编辑者已保存的无关字段。`Order.revision` 是改单/计价业务语义，不复用为通用行版本。
- **边界**：`setOrderUrgent` 等单一意图命令保持专用输入形状和同一工单锁，不提供“任意全量更新可省版本”的公共逃生口。
- **相关实现与验收**：`app/(admin)/orders/[id]/edit/page.tsx`、`components/business/order/EditOrderForm.tsx`、`actions/order.ts`、`lib/order.ts` 及 PostgreSQL CAS 测试。

---

## 2026-08-30：客户自动计价对缺失、冲突和越界一律失败关闭

- **决策**：建单、预览、提交与改单共用同一纯计价引擎和规范化事实。唯一键规则重复、阶梯重叠/空档/非法端点、金额或数量越界、逐票分配与整单数量不符时，不按数组顺序猜一条、不把缺价当零元，而是转人工核价或拒绝写入。
- **纸张身份**：通用 `CUSTOM` 产品按规范化别名与克重唯一解析纸张；零个、多个、停用或无生效价格都失败关闭。提交顺序固定为价目快照共享锁后再锁所有纸张行；纸张创建、改价与停用先取快照排他锁，防止幻读和已预览价绕过复核。
- **改单边界**：改价时旧制版费不得带入新已知合计；只剩制版费未定时保留唯一 `PENDING_AMOUNT` 行。`DRAFT` 历史报价不可在纸张停用或价格改变后直接复用。
- **相关实现与验收**：`lib/price/create-order/`、`lib/order/create-order-quote-facts-adapter.ts`、`lib/order/submit-external-order.ts`、`lib/order/change-request.ts`、`lib/price/external-order-charges.ts` 及 42 个 §8 金门案例。

---

## 2026-08-30：源表空白价是人工核价边界，不是零元也不可回落前档

- **决策**：彩印源表的明确空格使用末端 `COLOR_BASE` 空金额哨兵表示。它必须是绑定产品的 `BASE / FIXED_AMOUNT` 单点数量档，非阻断，且保留单一彩印路线、产品/规格/纸张身份和完整来源坐标。它命中后必须转人工，不得回落到上一个有价档。
- **数据库边界**：`CustomerPriceRule_values_valid` 只对上述行结构开放 `amount IS NULL`，哨兵分支整体用 `COALESCE(..., FALSE)` 封住 PostgreSQL `CHECK` 三值逻辑；其他非 `REFERENCE` 空金额仍由同名约束拒绝。“唯一且末档”由发布校验和迁移后置断言保证。
- **版本语义**：迁移 `20260830170000_external_processing_print_null_sentinel` 识别当前仍生效的真值修复谱系，兼容全新迁移链的 v5 和既有环境的 v7，闭合其半开区间并发布下一版本；原 144 条规则作为历史证据不改写，新版本复制后新增一条 Q2000 哨兵。
- **相关实现与验收**：`prisma/migrations/20260830170000_external_processing_print_null_sentinel/`、`lib/price/external-sales-rule-validation.ts`、`lib/price/customer-price-book-draft-validation.ts` 及复刻生产约束的 PostgreSQL 回归测试。

---

## 2026-08-30：已出账单不回写，迟到应收进入唯一补充单

- **决策**：同一销售与月份以 `sequence` 区分月结单和补充单。已签发/已收款账单不追加新工单；迟到的可收款工单进入下一个序号的草稿。`BillItem.orderId` 全局唯一，一张工单不能被两张账单重复收款。
- **派生与幂等**：草稿合计只从已持久 `BillItem` 与本次新增项重算，不信任旧派生总额。采购收货以规范化业务命令 SHA-256 指纹校验请求键；同键异载荷拒绝，同键同载荷只回放原结果。收款、运费和手工成本的幂等回放同样校验完整审计载荷。
- **边界**：应收、收款、成本和工资金额在进入 Prisma 前检查分精度、符号和 Decimal 上限，不依赖数据库静默舍入或溢出。
- **相关实现与验收**：`lib/bill.ts`、`lib/purchase.ts`、`lib/purchase-locks.ts`、`prisma/migrations/20260830180000_financial_derivation_integrity/` 及 PostgreSQL 并发幂等测试。

---

## 2026-08-30：工资计算只使用受雇区间内事实，结算截止由数据库时钟判定

- **决策**：`employmentStartDate` / `employmentEndDate` 是含首含尾的受雇区间。时薪、客服周期和计件资格只读区间内事实；完全不相交的月份/周期拒绝，不发明日均折算规则。`User_employment_dates_order_check` 防止直接 SQL 写入倒置区间。
- **并发与时间**：账号身份/角色/工种/受雇日期变更与考勤、已发时薪、报工和计件结算取同一资格锁契约。计件结算日的“已截止”判断和批次发现使用数据库时钟，两种跨午夜提交顺序都不留遗漏报工。上海当月不可标记时薪已发。
- **数值边界**：数据库工资列宽度覆盖已关闭规则输入的最大合法组合；应用在写入前仍校验费率精度和最终金额上限。
- **相关实现与验收**：`lib/salary/employment.ts`、`lib/salary/hourly-lock.ts`、`lib/salary/piecework-lock.ts`、`lib/salary/hourly-aggregate.ts`、`lib/salary/cs.ts`、`prisma/migrations/20260830190000_salary_decimal_and_employment_guards/` 及双客户端 PostgreSQL 并发测试。

---

## 2026-09-01：报价纸张身份读取不再锁库存行

- **决策**：外部销售提交仍先取价目快照共享 advisory lock，再读全量纸张完成失败关闭的身份判定，但不再对 `Material` 取 `FOR SHARE` 行锁。本条取代 2026-08-30 条目中“再锁所有纸张行”的并发实现约束，不改变零个、多个或停用纸张均失败关闭的业务语义。
- **理由**：纸张创建、改名和停用都取同一把快照排他锁，共享锁已能防止幻读和身份漂移。库存移动不取该锁却会对 `Material` 取 `FOR UPDATE`；报价再取纸张行锁会在多物料事务中形成跨域 ABBA 死锁。
- **边界**：库存数量不参与纸张身份匹配，`outOfStock` 当前也没有运行时写入方。未来新增纸张身份字段或 `outOfStock` 写入时，必须纳入价目快照排他锁；不能以恢复 `Material` 行锁代替。
- **相关实现与验收**：`lib/order/submit-external-order.ts`、`lib/material.ts`、`lib/order/__tests__/submit-external-order.test.ts` 及 `lib/__tests__/material-price-snapshot-lock.postgres.test.ts`。


## 2026-09-08：版费默认零与工单变更完结

用户确认独立版费默认 0 元，保留工单管理员人工制版收费。取代先前“每单制版费必待核价”的默认策略；历史人工及待定快照保留，新建与正常重算使用零默认。加工、物流未知规则继续失败关闭。人工版费重算后仍参与确认价，原报价快照保留。

修改提案补齐真实交期字段。待审期间允许工厂暂停/恢复，执行状态变化不使提案自行失效，批准时按暂停前阶段校验并保持暂停。
生产版本增加不可改写的已产承接基数；只匹配同来源工序，遇歧义或超量拒绝整笔事务。承接不产生报工/工资，新代完成条件重新计算。取消的已产下限和各端进度保持同一口径。销售最新 DENIED 和 SETTLED 纳入对应待办及完结列表。

## 2026-09-08：主单共享扫码入口，报工按工序和提交人归属

用户确认师傅与打包共用一个工单二维码。默认 PDF 每页保留一个带工单版本的主码；同岗多工序进入选择页，不再任取首个工序。旧精确任务码继续校验所属工单、岗位和当前版本；需要独立流转时显式选择 `mode=tasks`。

不修改现有计件账本及首次开工记录约束。首条开工事实不拥有整单，后续不同人员仍以各自会话账号提交报工。包装按包装组实际袋数限定计划，以合格袋数和已发布工价快照计件；已完成承接量不重复发工资。

PDF 溢页源于固定条数预算未计入真实二维码和内容高度。模板先做紧凑、保守的逻辑分页，再共用字体/图片稳定后的几何校正，移动真实内容生成续页、重算页脚；不缩小二维码模块，不隐藏内容。无法安全分割时失败关闭。

## 2026-09-08：移除独立工序流转单

用户确认不需要独立打印工序流转单，因此移除详情入口、专用打印模板、逐工序二维码生成及打印模式传递。工单仅保留每页一个主码和完整的工序文字表格。

旧流转单 URL 与后台任务明确拒绝，不将旧任务产物作为主单下载。已印出的精确工序二维码仍通过原扫码入口校验岗位和版本；报工、计件工资及历史事实不变。


## 2026-09-08：核价后自动准备、显式下发与费用历史

根据用户确认，正常工单不再重复人工确认。提交、核价与编辑/修改审批完成后，使用已保存的费用明细和生产事实，在同一事务自动准备为 CONFIRMED（待下发生产）。自动准备不创建工序或打印；ADMIN 下发才物化生产。旧待确认单在下发事务中同样校验，批量复用单单事务。

确认兼容接口沿用保存价，不再套当前价表；原报价不覆盖。费用调整保留现有版本/并发校验、独立版费默认零与人工维护入口，已结算不可直接改价。页面 GET 只读；缺项和待审批不能自动通过。本次不批量回填旧工单，不新增财务调整类型。

## 2026-09-08：UI 规范定稿为唯一来源，令牌门禁分级生效

- **决策**：`docs/ui-规范.md` 成为 UI 唯一规范来源，后续 UI 任务只引用条款号。令牌以四份原型 `:root` 为基准归并进 `globals.css`（`primary` 即朱红 seal，不新增 `seal`/`gold`/`ok` 别名；`gold` 归 `warning`，`ok` 归 `success`）；字号只用 Tailwind 档位，不新增 11px 档；字重保留仓库 500/600 方向。手写卡面、通知块、页内反馈形态、筛选与表单提交写法收编为现状，不迁移。
- **理由**：盘点显示颜色层已 0 调色板字面量，漂移集中在一个 CSS Module 与从原型搬入的半像素字号 / 非标圆角；组件层缺口（卡面 284、select 68、pending 55）中只有违反四原则或用户可感知混乱的进 P0。
- **影响**：`pnpm lint` 新增 `scripts/ui-tokens/check.mjs`：裸色 / 内联金额格式化 / deep import，`baseline.json` 登记的 132 处存量只 warn，新增即 error，迁移完成须同时删豁免否则 stale 报错。P1-1 全站主色 / 底色对齐原型属全站可见变化，合并前需业主目视确认。金额三态 DTO（P1-9）未拍板前不开工。
- **相关文档**：`docs/ui-规范.md`、`docs/UI现状盘点.md`、`docs/UI迁移清单.md`、`docs/audits/2026-09-08-UI对照裁决表.md`。

## 2026-09-09：UI 规范三项待拍板按默认最优取值定案

- **决策**：业主授权由实施方按最优取值定案。(1) 阶梯价与费率共用新增的 `formatRate`（`¥ ` + 千分位 + 2–4 位小数去尾零），阶梯价不再固定四位、费率不再裸拼字符串；`formatUnitPrice`（固定四位）只保留给需要对齐的单价列。(2) 薪资发放、出账、批量操作保持 L2：这些 action 不接收理由字段，按 §5.3「只有服务端已保存理由才能要求填写」不升 L3；需要审计理由时另立需求补字段再升级。(3) 金额三态不新增 `confirmedFee` / `quotedFee` DTO：`pricingStatus = PENDING_ADMIN_CONFIRMATION` 即「待工厂核价」，费用行 `estimated` 标记即「估」，其余为已确认；销售列表 `salesOrderAmountPresentation` 与管理端工作台 `fee.estimated` 已按此实现，剩余站点统一收编到共享 helper（迁移项 P2-13）。
- **理由**：三项都可以在不改数据契约、不新增服务端字段的前提下用现有事实解决；固定四位小数会让整批价显示为 `¥ 295.0000`，trimmed 标签又与金额 formatter 口径冲突，2–4 位去尾零两边都可读。
- **影响**：`docs/ui-规范.md` §4.1 / §4.3 / §5.3 与附录 A 相应更新；`baseline.json` 的费率、阶梯价永久豁免删除；P1-9 由「等 DTO」改为「收编现状 + P2-13 审计」。
- **相关文档**：`docs/UI迁移清单.md`、`docs/audits/2026-09-08-UI对照裁决表.md` §F。

## 2026-09-11 逐地址登记与整单应收确认

- 管理员可先保存物流资料、按地址确认实际发货。部分发货期间整单保留原生产完成状态，地址显示已发货；最后一票通过既有整单发货命令统一复核全部地址和物流费用，再复用 v2 结算写入 settledFee/settledAt。
- 这是对此前“只能一次提交全部地址”的交互扩展：最终整单核对仍提交数据库顺序一致的全部地址。先前已发货地址的 shippedAt 不被最后一票覆盖。
- 新流程先获取月账单 cutoff 共享锁再获取 order-cascade 锁。发货、结算、凭证及登记日志原子提交；历史正式账单不改写，外部销售收费单成为现有月份归集候选，不自动记收款，不为其他结算类型强造代理商账单。
- 最终发货重算若改变已确认金额，拒绝本次确认；管理员须先通过物流费用复核确认金额。面单使用有界私有数据库存储并保留历史，不复用设计稿上传权限。

## 2026-09-12：开放多地址录单与管理员分货添加地址

- 建单页所有录单身份共享“添加地址 2”入口，后续依次编号，总计最多 10 个地址；复用款式数量分配、逐票快递报价及提交校验。
- 管理员在完整编辑页从未登记物流的地址分货新增地址。预览展示数量、各票费用及工单金额差额；保存后重新核价。已发货、已结算、待审批和旧版本请求不允许修改。
- 已提交外部销售工单沿用原物流价目；重算原地址估算费用、计算新地址费用，保留已有人工确认金额及证据；纸箱沿用既有价目口径。无法自动报价时可填写新地址人工金额与原因。内部结算不新增物流应收，外部销售草稿仍在提交时统一计价。
- 沿用 OrderShipment / OrderShipmentLine；仅移除本次分货后归零的来源分配行，不删除地址、历史收费或价格修订。列表的多地址计数、详情、发货、打印和导出继续消费这套数据，无 schema 迁移。

## 2026-09-12：外部销售驳回补正与读取隔离

用户明确授权完整补正：DRAFT / REJECTED 可上传及删除设计图；确认、生产、暂停仍禁止直接换稿。
本条替代 2026-07-05 的“仅 DRAFT”窗口限制。驳回换稿保留旧对象及操作记录中的文件事实，
在工单锁内增加业务和编辑版本；重提重新核价并回到工厂处理，不自动跳过补正复核。
早期销售取消增加所有权和编辑版本守卫；暂停单允许申请取消，已产费用仍由原审批结算规则处理。
客户归属暂以当前销售关联工单为依据，只给客户标识/名称；不新增推定的全局客户读取权限。
详情及编辑使用同一销售 DTO，销售月账单切换到 AgentMonthlyBill，旧账本不再进入销售入口。
既有 OSS 预签 URL 复用风险未在本条中被宣称已解决，仍按原存储决策管理。

## 2026-09-11：冰白纸专版烫金由管理员手动核价

- **决策**：业主明确要求冰白纸专版烫金改为管理员手动核价。正式计价引擎对冰白纸的 FULL 路线返回明确的人工核价原因与未知金额，即使价格表存在匹配行也不自动出价；工作台及建单使用相同结果。
- **范围**：只针对冰白纸专版烫金，不改变冰白纸彩印或其他纸张规则，不改历史订单及已保存报价。现有提交、管理员录价、金额确认与审计流程继续生效。
- **文案**：冰白纸专版烫金由管理员手动核价，请提交工单后等待核价。

## 2026-09-11：统一打印字体与标准 PDF，存储支持重复读取及多实例

用户选择并要求实施自托管字体、服务端标准 PDF 和跨设备功能验证。采用项目内 Noto Sans SC / Noto Sans Mono，服务端内嵌同一字体，浏览器预览加载同源字体。字体与分页检查失败时停止输出。打印入口打开 PDF，保留网页预览与下载。

PDF 产物改为 1 小时重复读取，可选持久共享卷或私有 OSS；授权/版本/租约保留，同一授权内容按数据库时间 15 分钟窗口合并任务。取代 2026-07-17 对 PDF 的单机读后删除限制。生产 Chromium 必须登记完整版本并验收，不能以安装了任意系统字体作为打印正确的证明。

不为每个操作系统新增像素基线；跨引擎比较功能和几何，固定环境保留像素门禁。新字体基线仍需审查确认。验收与发布边界见 [跨设备打印](./docs/跨设备打印与可用性.md)。


## 2026-09-13：管理员代建关联外部销售与包装容量

- 用户明确要求管理员创建工单关联外部销售而非工单客户。仅 ADMIN 可选活动 SALES；事务内校验并锁定账号。选择后冻结 `EXTERNAL_SALES`，归属账号写 `submitterId`，`submitterRole=SALES` 与结算方向一致，实际操作者保留 `createdById` 和创建日志；未选择仍为 `FACTORY_DIRECT`。此条补充 2026-08-07 创建身份默认结算规则，不授权转换既有工单资金方向。
- 管理员创建不再录入工单客户及简称。手填版组、计价组从建单页移除，旧浏览器草稿不带回；历史制版/计费数据及已应用迁移保留。费用继续由现有报价与核价程序处理。
- 新建每包上限为 12 个，混装计算一包各款总数；正整数校验在预报价、创建接口和领域共同执行。超限明确报错，不自动改数量；历史包装与价格快照不追溯改变。

---

## 2026-09-14：款式分项与小计的对平容差、管理员可修正存量工单

- **决策**：
  1. 「纯引擎分项与小计」两处守卫（`lib/order.ts` 建单、`lib/order/change-request.ts` 改单）由严格相等改为容差 **0.01 元**，常量集中在
     `lib/order/subtotal-reconciliation.ts`。业主曾问能否放到 1 元，执行口径定为 0.01：守卫防的是算错与篡改，四舍五入最多差半分；
     1 元会让真实错误静默通过。要放宽只改那一个常量。同时修根因，`splitItemAmount` 按 2 位小数取固定费，纯引擎项不再出现 0.01 的假固定费。
  2. 就绪校验不得锁死管理员。核价终价不再因校验不通过而回滚，价格照存，缺项作为提示列出、不禁用确认；新增「补录生产资料」路径
     （`order:production-facts:repair`，ADMIN），管理员可为存量工单指定工艺、按旧 `OrderItem.pack` 生成包装组。
     **下发生产的闸口不动**：没有工艺与包装组生成不出生产任务，那是数据前提，不是权限。
  3. 历史账单 `cmsbmplo40008850rahu58pb4` 与本地开发库跑不了旧发布候选一事，业主决定忽略，不再列为待办。
- **理由**：业主 2026-09-14 拍板「管理员有决策权放行、可修正工单所有字段，而不是锁死权限」；金额口径由业主定、容差数值由执行方按风险收窄并留可调常量。
- **影响**：3 位小数档位 × 奇数数量可正常建单 / 改单；存量单部署后可由管理员自救；`e2e` 夹具是否改走领域层创建仍待拍板。
- **相关文档**：HANDOFF「待业主拍板（存量工单过不了生产就绪校验）」「半分金额下不了单」、`lib/order/legacy-production-facts.ts`、`lib/order/pricing-review.ts`。

## 2026-09-16：管理员显式编辑全部适用收费

- **依据**：用户要求管理端具备完整收费编辑能力，并明确与外部销售权限区分，授权执行且保留既有功能。
- **决策**：保留自动报价与原待核价流程；新增管理员显式全项收费编辑，完整自动价格也可在提供依据后修改，保留参考金额、旧修订和审计。此项取代“完整自动价只能保持不变”的管理员交互限制，不允许销售改价或后台静默覆盖。
- **边界**：仅已提交且未结算／未结束的收费工单；存在待审批申请或版本冲突时拒绝保存。寄样仅物流与耗材，打样仅整单价，结构化制版仍由原明细维护。工厂直接业务可补录物流及商业附加费用。新建完整改价置于原提交复核之后，避免提交报价覆盖人工输入。

## 2026-09-16：退出旧计薪配置，管理员维护工序计件工价

- **依据**：用户要求“移除旧版的，完善新版”，并批准执行对应计划。
- **决定**：新版烫金与包装统一使用工序工价。局部按合格数×正反面颜色过版次数×单价，
  专版按合格数×单价，包装按合格袋/盒数×单价。缺陷、返工不自动增加计薪数量。
  旧小单一口价、装板费、日保底、个人机型单价和额外双色/双面倍率不带入新报工。
- **取代范围**：取代旧任务机型计薪及日保底政策在新扫码报工上的适用性，包括本文
  2026-04-23、2026-08-02 等旧计件规则；旧历史工资及其原有解释保留，不重算。
- **维护**：管理员在员工工资规则页面保存草稿、核对变更并发布，支持立即或指定时间生效。
  工价可零但不可缺；单价四位小数，结算金额两位小数。按盒可不配置，此时按盒报工受限。
- **边界**：客户报价与员工工价分离；机型仍用于账号工序资格。历史日薪查询、导出和迁移保留。
  新初始化不再创建旧机型工价或包装时薪。发布与报工取价协调锁定，保护版本和历史工资。

## 2026-09-16：局部烫金允许管理员调整计薪次数

补充同日工序工价决策：颜色数只作默认计薪次数，管理员可在当前未完工局部工序设置次数和原因。
同一工序的所有款式共用次数，页面列明适用款式；生产计划、工单件数进度和已报工资不变。
师傅页面提交携带计薪修订号，调整后的旧页面先刷新核对。个人工价按师傅账号维护的后续规划见
[师傅个人工价方案](docs/archive/worker-personal-piecework-plan-2026-09-16.md)，该账号功能尚未实现。


## 2026-09-17：包装计件工价暂缓发布

- 业务负责人明确本次先发布局部、专版烫金工资；包装入袋与装盒工价暂缓，不填测试值或零价替代。
- 统一工价必须包含局部和专版规则，包装规则可省略；后台留空时删除未发布草稿中的对应包装规则，已发布历史不变。缺少对应包装规则时继续拒绝该工序计件报工。
- 个人工价仍须符合账号工序；包装师傅个人工价仍要求入袋规则。使用统一工价的包装账号在缺价期间不能自动计件。
- 新增前向迁移同步数据库发布触发器，不修改已应用迁移；保留审计、版本锁、有效期与历史快照约束。

## 2026-09-18：批量建单、设计款与规格分层

- 顶部“增加工单”创建独立工单草稿，分别获得工单号、地址、费用、状态与提交结果。一次工作区最多十张，逐张沿用现有核对和提交流程；一张失败不重新创建已保存工单。单张创建维持原详情跳转或销售提交成功页。
- 设计款主标签旁“增加设计款”沿用当前材料、工艺及规格，设计文件独立选择。规格子标签旁“增加规格”共用当前设计文件、材料与工艺，各规格数量、包装和生产明细独立。
- `OrderItem.designGroupKey` 只表达设计分组，不能合并数量阶梯、减免版费或绕过管理员收费权限。每条明细仍走原报价、生产、薪资、发货与审计链。
- 同一设计款的工艺/材料修改同步到所属规格；不能共同支持的材料组合拒绝修改。规格选项受当前纸张和克重约束，产品、材质、克重、尺寸作为完整事实更新，禁止拼接旧产品字段。
- 文件选择一次，创建后通过现有上传接口关联到每个规格明细；失败只重试未上传文件。刷新后已创建工单进入详情继续，不重新建单；未上传文件受浏览器限制，刷新后需重新选择。
- 历史空分组不推断、不回填；既有改单界面继续按生产明细编辑，不新增历史重新分组权限。

### 2026-09-18 补充：批量上限与失败恢复

- 用户要求满额提示、保存后开始下一批。保留每批 10 张，标签自适应换行；满额禁用新增并显示提示，不按屏幕宽度改变业务上限。
- 全部工单已保存即可开始新批次；恢复后仍待上传或提交的工单到详情继续。未保存的工单不能随新批次清空。新批次使用全新提交标识。
- 网络响应丢失后的创建重试必须匹配首次请求指纹；不匹配或历史无指纹时明确报错，指向原工单人工核对。不自动改变提交标识或重算历史金额。
- 普通、寄样和打样共用批量内存恢复边界；sessionStorage 失败不能造成页内切换丢失编辑内容。刷新丢失未上传文件的浏览器限制仍然适用。

### 2026-09-18 补充：两层建单标签与包装范围

- 管理端和外部销售共用“设计款主标签 → 规格子标签”。主标签包含工艺、材料、规格与数量包装、设计文件；设计文件紧随规格面板，切换规格共用，切换设计款独立。工单名称、地址、交期、整单包装补充说明归整单。
- 每条规格继续独立报价。设计分组不合并数量阶梯，不减免机烫、装版等费用。费用栏按设计款归类、逐规格列出，点击明细切换到对应规格。
- 常规包装类型修改仅影响当前规格，保留其他规格包装和人工价。选择混装明确覆盖整单全部规格；已混装时变更类型作用于当前混装组，转常规装拆分当前组，其他组保持原值。
- 增加设计款／规格时新明细独立包装，不隐式加入原混装组。混装组成仍受原有数量、容量和发货校验，错误不能以自动改数量或零费用掩盖。
- 管理员仅在当前规格显示其包装组人工价；切换标签保留编辑值，报价依据变化继续要求重新核对。外部销售没有管理员收费编辑权限。

## 2026-09-18：纸张退役拦截只在新建入口，共享报价适配器保持中立

- 决策：`isRetiredPaper` / `hasRetiredPaperItem` 只在新建业务入口调用——`createOrder`、`quoteInternalCreateOrder` / `quoteExternalCreateOrder`、打样提交 `finalizeSampleOrderInTx`、内销旧草稿首次 `submitOrder`、销售工作台，外销提交沿用 `assertSelectedPapersAvailable`。`buildCreateOrderQuoteInputFromCatalog` 不做业务可用性裁决。
- 理由：适配器被改单整单重算与取消结算复用，拦截放在这里会让含退役纸张的历史工单改不了、算不了，违反 2026-09-17 审计记录里「历史工单保留」的边界。
- 影响：以后新增「停用 / 退役」类规则不要往适配器加判断，统一走 `lib/rules/paper-availability.ts`；历史工单因「关联物料 `isActive=false`」仍被挡是另一条既有规则，待业主拍板。
- 相关文档：`docs/audits/2026-09-17-retire-120g-paper.md`、HANDOFF「卡住的问题」。

## 2026-09-18：保存后跳转的反馈用「URL 回执 + ActionNotice」，仍不引入 toast

- 决策：Server Action 成功后 `redirect()` 的路径一律用 `lib/admin/receipt.ts` 的 `appendReceipt` 带上固定字典 `RECEIPT_KEYS` 里的回执，目标页 `readReceipt(searchParams)` 交给 `components/ui-business/ReceiptNotice` 渲染；挂载后 `ReceiptUrlCleanup` 用原生 `history.replaceState` 清掉回执参数。维持 ui-规范 §5.4「不引入 toast 库」。
- 理由：`useActionState` 的状态随旧页面丢失，18 处 redirect 里 13 处保存后毫无反馈，是业主感知最强的缺口；计件 / 时薪页已用私有 `appendReceipt` 跑通同一模式，推广它零依赖、服务端渲染、零 JS 可见。开源候选里 Base UI Toast 虽已随 `@base-ui/react` 装好（shadcn `base-nova` 风格自带），但 toast 只是展示层，跳转后仍需回执机制才触发得了，且是瞬态、与现有 45 个内联 role 断言冲突；两个 cookie flash 包一个 peer 锁 Next 15、一个已停更；next-safe-action 要求 JS `execute()`，与 138 个 `useActionState` action 的形状冲突。
- 影响：新写的 redirect 必须带回执，否则视同无反馈；新增回执类型先登记 `RECEIPT_KEYS`；子表单若会因 revalidate 卸载，成功回执要么提升到页面级（redirect + 回执），要么让表单常驻、终态只留回执（`TaskDisputeReviewForm` 的 `open`）。若业主日后要全局瞬态提示，走 `pnpm dlx shadcn@latest add toast`（Base UI，零新依赖），叠加在回执机制之上，并回来改本条。
- 相关文档：`docs/ui-规范.md §5.4`、`CLAUDE.md §15.3`、`lib/admin/receipt.ts` 头注释。

## 2026-09-18：内部工单与外销共用同一本物流价目自动计费

- 决策：客服工单（`INTERNAL_SALES`）与工厂直接业务（`FACTORY_DIRECT`）的快递费与打包耗材，与外部销售使用**同一本已发布 LOGISTICS 价目**自动计价——建单预览显示并计入合计，提交时由共享 finalizer 在同一快照内落 `OrderCustomerCharge` 与价目版本锁，发货逐地址确认承运商计费重量与终价。顺丰到付维持「运费 `WAIVED / 0`、打包耗材照收」。免费工单（`NO_CHARGE`）不计物流。（已被 2026-09-24「删除客服角色与内部/工厂直单结算」取代）
- 理由：管理员自建工单多是补录与代录，功能必须完整；原设计只让外销自动算、直客靠详情页「编辑收费」补录，忘补就漏收运费。业主 2026-09-18 明确「价目一样、客服工单与外部销售一致、顺丰到付维持」。
- 影响：取代 2026-07-30「工单 `totalAmount` 只汇总款式小计」与 2026-09-15「内部结算不新增物流应收」在这两类结算下的口径（顺丰到付标识与后期更正权限等其余内容仍有效）。**客服业绩口径不变**：`CsSalesEntry` 一律按 `csSalesBasisAmountInTx`（工单总额 − 代收快递费 / 打包耗材）记账与对平，代收物流不冒充客服销售额。判定统一走 `lib/order/settlement.ts`：新建/预览用 `settlementBillsLogistics`，履约与核价用 `orderBillsLogistics`（以工单**是否已有物流收费行**为准）——2026-09-18 之前提交、没有物流行的老工单维持原加工费流程，完整编辑仍可补录。SPEC §193 / §248 的旧口径待同步。
- 相关文档：`SPEC-v1.2.md §J`、`lib/order/settlement.ts`、`lib/order/create-order-quote-service.ts`、`lib/order/submit-external-order.ts`、`lib/salary/cs-sales.ts`。

## 2026-09-19：顺丰到付一律不收快递费，补录的运费在标记到付时清零

- 决策：工单标记「顺丰到付」时，快递费一律为 0。按价目计物流的工单本来就把运费置 `WAIVED / 0`；管理员在完整费用编辑里**补录**的快递费（`priceBookId` 为 null）此前只改到付标记、金额照收，现在同样置 `WAIVED / 0`，总额与已确认终价同步扣减，并追加一条 `SF_COLLECT_MANUAL_FREIGHT_WAIVED` 价格修订。打包耗材照收。
- 理由：业主原话「都到付了，自然没有运费」——到付由收件方直接付给顺丰，工厂不代收。完整费用编辑早就有「顺丰到付工单的快递费必须为 0」的约束，切换入口不清零是同一条不变量的漏网之处。
- 影响：价格状态沿用当前值、不打回待核价——金额由硬规则决定，不是新的人工判断，而这类工单在履约状态没有重新核价入口，打回会卡死。取消到付**不恢复**原金额（人工录入、没有价目可重算），需要收取时在编辑收费里重新录入。补录物流不进客服业绩基数（`csSalesBasisAmountInTx` 减去全部物流行），`CsSalesEntry` 不受影响。详情页切换按钮下提示将被清零的金额。
- 相关文档：`lib/order.ts` `setOrderSfCollect`、`lib/order/pricing-review.ts:1354`、`components/business/order/SfCollectToggleForm.tsx`。

## 2026-09-19：冲正 = 作废原报工，作废的报工不可再核定、残留人工差额自动抵消

- 决策：业主授权「按最佳实践定语义」。采用记账惯例——台账只增不改，`REVERSAL` 是把原 `REPORT` **整笔作废**：① 被冲正的报工连同它的冲正行、挂在它上面的 `ADJUSTMENT` 在工单提成核定里单独成**只读组**（分组键为「师傅 × 上海日 × 是否作废」），不能改价，只能原额确认；② 冲正只否定原报工金额、不含后来的人工差额，所以确认核定时为每笔作废报工按残留额**反向记一条 `ADJUSTMENT`**（同锚点、同报工日，满足 `validate_foil_wage_report` 的约束），让作废的工作净额归零；③ 原报工日已结算、无处可记时**明确拒绝**并保留「需人工核定」，不悄悄少发或多发；④ 同一天仍有效的其它报工单独成组、照常可核定。
- 理由：此前原报工日那组仍可编辑——D1 报工 +24、D2 冲正 −24 后，把 D1 改成 0 师傅净额 −24（倒扣），改成 48 等于冲正后又发一遍；先核定（−5）再冲正则留下 −5 的孤儿差额。grok 对抗审查 PR #22 时发现。
- 影响：应用层**仍然没有冲正入口**，`REVERSAL` 只能由技术人员写 SQL（触发器是生产守卫）；日后做冲正入口必须沿用本语义，并在同一事务里处理已结算日的情形。规则只在应用层（`reviewOrderWages` 是 `ADJUSTMENT` 的唯一写入方），没有改触发器——抵消用的差额本身就要锚定在已作废的报工上，触发器不能一刀切拒绝。
- 相关文档：`lib/salary/order-wage-review.ts`、`lib/salary/__tests__/order-wage-review.test.ts`、`tests/e2e/foil-wage.spec.ts`。

## 2026-09-19：寄样品维持默认最小包装档

- 决策：寄样品不按数量档匹配包装，默认取已发布的最小包装档；数量照实记录，可手动选更大的已发布档。不改代码。
- 理由：业主原话「寄样没有大批量的说法，因为是寄样」。grok 对抗审查把「数量 3000 仍取最小档」报成少收纸箱费，与 `docs/寄样与打样开发任务.md` 第 54 / 92 / 103 行的既定设计不符，属误报。
- 影响：`lib/price/external-order-charges.ts` 的 `tiers[0]` 默认与 `sample-order-charges.test.ts` 的断言保持不变；以后不要把它当 bug「修」成按数量档。
- 相关文档：`docs/寄样与打样开发任务.md`、`lib/price/__tests__/sample-order-charges.test.ts`。

## 2026-09-19：师傅工资页只按师傅显式选择的日期筛选

- 决策：师傅端「我的工资」（扫码报工计件）的工资单列表不再默认套「本月 1 日～今天」，日期框默认留空；只有师傅自己选了日期才筛选（允许只选一边），「全部结算 / 待发放 / 已发放」三个页签口径一致，仍按 20 条分页。「待发放」= 已按日结算锁定、尚未标记已发放的工资单（`PieceworkSettlement.status <> 'PAID'`），与工单是否完成无关。
- 理由：顶部「尚未发放」金额统计全部未发工资单，列表却只列本月，上月未发的在列表里找不到、对不上；预填的当月区间被原样提交后，还会把上月未结算的报工藏起来。业主 2026-09-19 确认按此口径改。
- 影响：纯展示口径，不影响任何金额。选日期时保留当前页签。
- 相关文档：`lib/salary/worker-settlement-page.ts`、`app/(worker)/worker/salary/page.tsx`。

## 2026-09-19：CI 等待时间优先——快门禁先出结果，PR 两视口、main 六视口

- 决策：业主单人开发、「改一点推一次」，40 分钟才知道 lint 挂了是主要痛点，因此 CI **等待时间优先、计费分钟其次**。第一步（零风险）：① `static`（架构 / 备份脚本 / lint / typecheck / 死代码 / 依赖审计）与 `unit` 拆成独立作业并行先出结果；② Browser 组件契约、业务 E2E、durable、compat、dev fixtures 各自独立作业，各带自己的一次性库；③ **六视口门禁改为「PR 只跑 375×667 与 1280×800，合并进 `main` 后跑全部 6 个」**（管理端、师傅端、dev fixtures 同一口径）；④ `push: main` 只跑 `static` + 六视口，不再重复 PR 已验证过的全套；⑤ 纯文档改动（`**/*.md`、`docs/**`）不触发；⑥ `print-darwin` 拆成独立 workflow，仅打印相关路径变动或手动触发（macOS 按 10 倍计费）；⑦ Playwright trace 在 CI 改 `on-first-retry`；⑧ `.review/` 每次上传、报告与 trace 只在失败时上传（原先每次 493 MB）；⑨ Playwright / Puppeteer 浏览器缓存并按需安装（WebKit 只给 compat，Puppeteer Chrome 只给 E2E / durable）。第二步（E2E 分片）等第一步跑通后，用 `.review/*.json` 的实测耗时定分片数，不按估算拆。
- 理由：原 `verify` 是单作业全串行 61–75 分钟，其中 274 个 Playwright 用例 `workers: 1` 串行占约 38 分钟；2026-09-01 以来 60 次 run 里 38 次失败，很多跑到第 40–60 分钟才红。
- 影响：只在中间视口出现的问题会晚到合并后才发现（`viewports-main` 红了要回头修）；`print-darwin` 的路径清单过窄会漏掉回归，改到清单外却影响打印的文件时要手动触发。`concurrency` 取消旧 run 的设置此前已存在，本次只统一了分组名。`main` 没有分支保护，`paths-ignore` 不会卡住合并。
- 相关文档：`.github/workflows/quality.yml`、`.github/workflows/print-darwin.yml`、`.github/actions/`、`CLAUDE.md §8.2`。

## 2026-09-19：CI 第二步——E2E 按实测耗时分片、共享一次 release 构建

- 决策：在第一步基础上，`build` 作业用 `scripts/e2e-release-build.ts`（与 release web server 同一份环境）构建一次 `.next-release`，E2E 拆成 6 个分片——`chromium` 1/3–3/3、`admin-375x667`、`admin-1280x800`、`worker + no-js`——各自 `E2E_PREBUILT=1` 复用该构建；`browser-components` 分 2 片。分片数按第一步 `.review/*.json` 的实测定（chromium 150 例 12.6 分钟、两个 admin 视口 4.4 / 3.2 分钟），暂不拆四片，先观察波动。
- 理由：第一步后关键路径是 `e2e` 单作业 24.8 分钟。每个分片独占 runner / 数据库 / 服务，片内仍 `workers: 1`，「所有 spec 共用同一个库、不能并发」的约束不变。实测（run 35447718850）全绿 9.1 分钟（改动前 61.4、第一步 24.9），各作业分钟数合计 62.8，与改动前持平。
- 影响：**共享构建必须用 tar 传**。Turbopack 把外部包（sharp、ali-oss、@prisma/client…）以相对符号链接放在 `.next-release/node_modules`，`actions/upload-artifact` 不保留符号链接，`sharp` 在拷贝出来的位置找不到 `detect-libc`，凡是处理设计图的页面都进错误边界——症状却是「提交后工单停在 DRAFT」，两轮 CI 才定位到（第一轮误判为丢了 `cache/.rscinfo`）。`e2e-preflight` 在 `E2E_PREBUILT=1` 时会检查这些链接，坏了直接报因。新增 spec 不要依赖别的 spec 文件留下的数据：分片按文件切，顺序依赖会在分片后才暴露。
- 相关文档：`.github/workflows/quality.yml`、`scripts/e2e-release-build.ts`、`scripts/e2e-preflight.ts`、`DEVELOPMENT.md`「当前 CI 与发布验证缺口」。

## 2026-09-20：纸张、规格方案缩小为启用适用规格，下架另立后续方案

- 决策：本期启用的 Product 承载适用关系，不新建适用关系表，只做空白封启用及配套保护；下架/禁用/不适用另立后续方案；120g 保持物料停用、退役过滤、产品与价格保留的现状，不收尾；彩印本期不做。改单新增款式（含不切换目标、原样复制模板）按新准入拦截，模板原款式历史重算不受影响，这条决定约束后续下架方案。
- 理由：业主决定缩小范围，并于 2026-09-20 确认下架另立后续、120g 不收尾、彩印不做三项；独立关系状态带来的回填、入口校验和发布兼容成本超出本期需要，现有产品/规则停用又会影响在途工单重算，不能把它当作无副作用的下架方式。
- 影响：本期不改 schema 或目录读取方，不做关系回填、入口准入校验及两次发布约束；专版保持现状，产品组合页保留并收紧空白封/彩印身份编辑。仍待确认两项：新纸张是否默认进入专版；历史重算是否忽略产品与物料当前启用状态，后者为下架后续方案前置问题。此决定不表示功能已经实现，不改变已有权限、计价或历史快照约束。
- 相关文档：[缩小方案](docs/archive/PLAN-纸张规格独立管理.md)、[第四轮评审](docs/audits/2026-09-20-paper-spec-plan-review.md)、[交接](HANDOFF.md)、[进度](PROGRESS.md)。

## 2026-09-20：空白封改为按生效正价管理，移除独立建单组合维护

- 决策：业主确认空白封不存在免费供货，要求直接使用「空白封现货单价」配置和计算，移除独立「可建单产品组合」及重复信息。按本轮对话确定新空白封业务以当前生效已发布单价大于 0 为销售配置条件，0 或空白表示未启用；历史订单与其他功能不得受损。本次只要求规划，尚未实施。
- 理由：现有计价键本来是纸张、克重、规格文本；再维护产品启用状态增加重复配置和操作成本。「不适用」把未配置与不能生产混在一起。
- 影响：取代同日上一阶段决定中「产品承载空白封适用关系、保留空白封组合管理」的后续建设方向，上一阶段实现和验收事实保留。无引用旧数据拟经预检清理，有历史/其他路线引用的记录保留，不删除已应用迁移和历史证据。本文不确认具体历史停售重算取价策略，不改变专版/彩印、120g、其他费用的合法零额或整单结算政策；历史策略仍见 HANDOFF/PROGRESS 待确认项。
- 相关文档：[新方案](docs/PLAN-空白封按单价管理.md)、[上一阶段方案](docs/archive/PLAN-纸张规格独立管理.md)、[交接](HANDOFF.md)、[进度](PROGRESS.md)。

## 2026-09-20：空白封历史停售核算与人工材料补核已确认

- 决策：业主授权执行按单价管理方案；新业务只认当前正价。原历史款式同身份在停售/缺价后需要重算，沿用可验证已确认材料单价；资料不足支持管理员填写、修改、确认独立材料价，不能从整款总额猜价。
- 理由：移除重复销售配置，同时保证已受理订单不会因停售按0结算或无处理入口。
- 影响：历史原款核算不受空白封旧产品或纸张当前启停/缺货阻断；当前正价仍按既有重算政策，新增/原样复制模板和身份变化仍执行新准入。历史真实0保留，新填材料价必须为正。其他费用、专版/彩印与结算权限不变。
- 相关文档：[方案](docs/PLAN-空白封按单价管理.md)、[现行操作](docs/空白封纸张规格管理-20260913.md)。此决定取代该方案先前“历史策略待确认”的状态；专版新增纸张默认准入仍保持现状。

## 2026-09-21：无计薪进度按工艺车道授权

- **决策**：业主在首次使用整改续修中明确选择“改成按工艺车道可见，补越权回归测试”，取代无计薪进度对所有在职 WORKER 开放的行为。
- **规则**：使用 Craft 的 defaultWorkerType、defaultMachineType / inHouseMachineTypes 与当前在职账号岗位、机型匹配；仅有效自产工艺。缺少岗位或机型配置时拒绝匹配。不使用个人认领、推荐熟练项作授权。
- **影响**：无计薪进度列表、直接详情和提交共用领域规则；写入在事务内复核。原计件车道与历史报工/工价快照不变。打印用途权限属于作业书 B3，未在本次改变。
- **相关文档**：API.md、docs/audits/2026-09-21-first-use-remediation-results.md。

## 2026-09-23：新建工单的包装改为整单区域

- **决策**：业主确认「包装是工单汇总的，不分规格」，不应放在设计款里。新建工单页把包装从「设计款 → 规格」面板移出，放到设计款卡片与收货之间的整单「包装」区域：顶部显示合计数量与袋/盒数，「包装类型」「包装方式」默认作用于全部规格；常规装下单个规格仍可单独改类型（如款 1 入袋、款 2 装盒）；每个规格一行填写每包/每盒数量。管理员包装组单价与「包装补充说明」一并收进该区域。设计款标签内的设计文件、工艺、材料、规格与数量、收费位置不变（业主要求本轮只移包装）。
- **理由**：多个设计款时包装数量、费用要在一处汇总核对；放在规格面板里一次只露出当前规格所在的包装组，看不出混装组成和整单袋数。
- **影响**：只改建单界面。数据仍是按规格组成的包装组（`OrderPackagingGroup` / `Line`），报价、袋数进位、生产打包工序、打印单、发货装盒口径不变，无迁移。取代 2026-09-18「两层建单标签与包装范围」中“主标签包含规格与数量包装”“常规包装类型修改仅影响当前规格”“管理员仅在当前规格显示其包装组人工价”三条的界面口径；“选择混装覆盖整单全部规格”“增加设计款／规格时新明细独立包装”保持。
- **相关文档**：`lib/order/create-packaging-selection.ts`、`components/business/order/order-form-b/OrderPackagingSection.tsx`。

## 2026-09-23：纸张改用现行叫法、按业主顺序胶囊展示

- **决策**：建单与销售工作台的纸张选择改为胶囊按钮（与克重、规格同一样式），不再显示纸张色卡；按业主顺序排列：艳红珠光纸、暗红珠光纸、触感纸、金葱纸、红卡纸，米金/紫色/黄色/粉色/金色/玫红/杂色/暗紫/紫色红珠光纸，冰白珠光纸、铜版纸；清单外的纸（莱尼纹、双铜纸、艳闪、杂色珠光）排在最后照常可选。现有纸张按业主确认的对应改显示名：珠光艳闪→艳红珠光纸、珠光闪红/珠光暗红→暗红珠光纸、金葱→金葱纸、红卡→红卡纸、冰白纸→冰白珠光纸。
- **理由**：业主给定的现行叫法与展示顺序；只改展示，不影响计价和历史。
- **影响**：显示名统一走 `paperDisplayLabel`（建单、工作台、详情、改单、已保存配置、打印单、导出、师傅端）；库里的纸张名称、计价键、价格与快照不变，计价引擎与报价令牌里的提示原文不变，只在建单费用栏展示时换名。工单列表按纸张搜索同时匹配新旧名称（`paperSearchValues`）。价格与物料配置页仍显示库里名称，因为那里编辑的就是纸张身份（如「冰白纸」才触发专版人工核价）。排序只在展示层，新款式默认纸张仍按目录顺序取，不因排序改变。米金等 8 种彩色珠光纸目前库里没有，只在排序中预留位置；「按杂色价格、可勾选、克重不变」如何建档（后台建物料并按杂色价发布，或新增计价规则）待业主另行确认。
- **相关文档**：`lib/rules/paper-label.ts`、`components/business/order/order-item-field-options.ts`、`docs/ui-规范.md` §2.1 / 附录 A-1。

## 2026-09-23：8 种彩色珠光纸按杂色珠光纸定价上架

- **决策**：业主选择「后台新建物料、按杂色价发布」。米金、紫色、黄色、粉色、金色、玫红、暗紫、紫色红珠光纸，均为 160g，经后台「空白封单价 → 新增纸张与规格价格」逐种新建（同时建物料、写审计），空白封只开大号封，单价取杂色珠光纸现行价（开发库 0.17 元/个），其余 5 个规格不开；专版烫金与「杂色珠光纸」一致，走人工核价，不加专版纸张加价行。新款式的默认纸张改为按 `PAPER_DISPLAY_ORDER` 取第一个在当前规格下可选的纸（现为艳红珠光纸），不再取按拼音排序的第一行（否则会变成暗紫珠光纸）。
- **理由**：杂色的权威价格见 `docs/加工费计费规则.md` §1.1；专版自动 +0.03 只对旧身份「杂色珠光 160g」生效，后台没有新增专版纸张加价的入口，业主选择与「杂色珠光纸」一致的人工核价，不改计价代码。
- **影响**：开发库已执行并发布为加工费 v11（v10 + 8 条规则，另新增 8 条物料，未改动其他数据）。生产未执行：需业主授权，且要**先部署**默认纸张与显示顺序的代码（`1b6c5219` 等，生产现为 `ef6fa012`），再录入数据，否则发布后生产局部烫金的默认纸会变成暗紫珠光纸。更正上一条：配置页并非一律显示库里名称。空白封价格表按显示名展示（行序仍是固定清单 + 拼音），新增纸张表单的纸张下拉与物料名称仍是库里名称。取代上一条中「8 种彩色珠光纸建档方式待确认」。
- **相关文档**：`docs/加工费计费规则.md` §1.1 / §2.2，`lib/order/order-item-configuration.ts`，HANDOFF「下一步」中的生产操作步骤。

## 2026-09-23：杂色珠光纸只保留一种

- **决策**：业主确认两种杂色只保留一种，保留旧身份「160g杂色珠光」：它带空白封大号封 0.17、全部专版阶梯和专版纸张加价 +0.03，在生产上原本就有完整价格。页面上它显示为「杂色珠光纸」（`paperDisplayLabel` 新增一条），排在清单第 12 位。重复的「160g杂色珠光纸」（迁移回填、开发库 09-21 后台补过空白封价）在后台纸张页停用，数据和历史保留。
- **理由**：两个同名按钮会让销售选错，而且专版计价路径不同：一个自动 +0.03，一个转人工。保留价格最完整的身份，风险最低。
- **影响**：「杂色珠光纸」的专版烫金改为自动报价（阶梯价 + 0.03）。8 种彩色珠光纸专版仍按人工核价，专版上暂不与杂色同价；业主选择时已知悉这个代价，这一点取代上一条「专版与杂色珠光纸一致」的表述。两者是不同的计价身份，不能在身份层合并（加了防护单测），也不要用 SQL 改名或改规则。开发库 B 的 0.17 空白封规则保留：停用后对新业务无效，但空白封价格表会留一行禁用的警告行（仅开发库，生产上 B 很可能没有价格）。停用不写审计日志，操作记录为 2026-09-23 20:52（+08），由管理员在后台完成。从迁移新建的库（测试、CI、新环境）里 B 仍是启用状态；要不要用迁移统一停用，属于生产数据变更，需业主另行决定。
- **相关文档**：`lib/rules/paper-label.ts`，`docs/加工费计费规则.md` §1.1 / §2.2，`UI-SYSTEM.md`「建单纸张胶囊、业主顺序与现行叫法」，HANDOFF 生产步骤。

## 2026-09-24：老板首页月账单卡片口径

- **决策**：业主选择「按本月确认 / 收款」口径。「本月已出账」取 `AgentMonthlyBill` 中 `confirmedAt` 落在当前上海自然月、状态为 CONFIRMED 或 PAID 的账单，合计 `totalAmount`；「已收」取收款时间落在本月的 `AgentMonthlyBillReceipt` 合计；「未收」取当前所有 CONFIRMED 且未付款的账单总额，不限账期。v2 没有部分收款，一律按整单口径。
- **理由**：v2 账单只能为已结束的月份生成，旧口径按「当前月 period」查询，结构上恒为 0（readiness P0-5 的修复 `8ecbd09f` 未解决这一点）。
- **影响**：只改 `lib/dashboard/owner-stats.ts` 的读口径和卡片说明文字，账单数据与生成流程不变。E2E `owner-dashboard` 的夹具仍向旧 `Bill` 表写入，需另行改为 v2 夹具。
- **相关文档**：`docs/audits/2026-09-23-evidence-review.md` M-8。

## 2026-09-24：部分发货后的改单与取消、已结算单的售后重做

- **决策**：工单只要有任一地址已 SHIPPED，就拒绝取消申请，也拒绝任何改动款式、数量或分货的修改申请，只允许改交期等不涉及分货的内容；提交和批准两处都校验。已结算（SETTLED）的工单可以像已发货、已完成的工单一样发起售后重做（SPEC-v1.2 §3.4.1）。（部分已被 2026-09-24「发货后无取消选项」取代）
- **理由**：逐地址发货期间，工单保持 PACKING 状态。原先的改单和取消会改写已发包裹的分货并重算物流费，与现有边界不一致（`add-shipment`、`edit-shipment-fields` 早已禁止改动已发货地址）。逐地址发货在同一事务里自动结算为 SETTLED，所以按原来的来源白名单，新工单永远走不到售后重做。
- **影响**：「部分发货后取消剩余」没有实现，其结算口径（已发地址快递费是否计入）待业主拍板。申请入口仍按工单状态显示，提交后才出现拒绝提示。重做单不改原单应收（DECISIONS.md 中 2026-09 的重做决策）。
- **相关文档**：`lib/order/change-request-shipment-guard.ts`、`lib/order/rework-eligibility.ts`、`docs/audits/2026-09-23-evidence-review.md` M-4 / M-11。

## 2026-09-24：删除客服角色与内部/工厂直单结算（管理员建单必须挂外部销售）

- **决策**：业主决定彻底删除客服（`CUSTOMER_SERVICE`）角色，`Role = ADMIN | SALES | WORKER`；客服提成、客服工资周期、客服业绩流水、客服工资发放及四张表（`SalaryPeriod` / `CsSalesEntry` / `CustomerServiceCommission` / `CsPayrollPayment`）、定时任务 `cs-settle` / `cs-period-ending`、通知事件 `CS_PERIOD_ENDING` / `CS_PERIOD_SETTLED` 一并删除。所有收费业务都以外部销售身份开展：`OrderSettlementType = EXTERNAL_SALES | NO_CHARGE`，删除 `INTERNAL_SALES`（内部销售）与 `FACTORY_DIRECT`（工厂直单）；管理员建单必须选择一个启用的外部销售，工单按 `EXTERNAL_SALES` 结算，提交人为该销售，管理员保留为创建人。
- **理由**：业主 2026-09-24 明确：客服角色不再存在，所有业务都以外部销售身份开展。按业主要求彻底删除而不是停用，代码里不再保留客服与工厂直单分支。
- **影响**：迁移 `20260924110000_remove_customer_service_role` 在业务数据仍引用客服或内部/工厂直单（账号、工单身份与结算快照、价格修订快照、价目簿、考勤快照、审计日志、四张客服表中的数据、运行中的客服任务）时整体中止，不静默改写历史；生产部署前必须先查询这些条件。管理员没有启用的外部销售账号时不能建单。生产 crontab 需按 `docs/部署指南.md` 重装以去掉两条客服 cron。审计 H-2 的冲销口径、M-6 的直营单取消规则、L-11、N-3 随之失效。
- **取代关系**：取代 2026-08-02「客服业绩、客户付款与工资发放是三本独立账」、2026-09-18「内部工单与外销共用同一本物流价目自动计费」，以及 2026-08-07「结算方向在工单创建时冻结」中客服与工厂直单的部分（结算方向在创建时冻结的原则继续有效）。
- **相关文档**：`SPEC-v1.2.md` §L、§J.1、§2、§3.1、§3.7、§5.3；`prisma/migrations/20260924110000_remove_customer_service_role/migration.sql`；`docs/audits/2026-09-23-evidence-review.md` §6。

## 2026-09-24：删除清废/厨师工种与清废工艺（时薪月结只保留打包历史存档，存档月考勤只读）

- **决策**：业主决定删除清废（`CLEANER`）、厨师（`COOK`）工种与清废工艺（`CLEANING`），`WorkerType = MACHINE | PACKER`。时薪月结生成链路（含定时任务 `hourly-payroll`、重算与标记发放）删除；已有的打包 `HourlyWorkerPayroll` 只作只读历史存档，存档月份的考勤不能再新增、修改或删除。规则 `OT_MULTIPLIER`、`COOK_SALARY`、`CLEANER_HOURLY`、`COOK_SPARE_HOURLY` 删除；CLAUDE.md §15.5 的 `cookSpareRate ?? 0` 例外随之消失，缺少生效规则一律拒绝继续。
- **理由**：打包已切换为工序计件，时薪月结此前只为清废与厨师生成；两类岗位不再存在后，整条生成链路没有使用者。
- **影响**：迁移 `20260924100000_remove_cleaner_cook_cleaning` 在账号岗位、考勤快照、空闲打包工时、清废/厨师月结、派工、工艺接单岗位、工单款式/派工/日工资明细/待审改单/进度步骤对 `CLEANING` 的引用或运行中的时薪任务存在时整体中止；生产部署前必须先查询。改岗与雇佣日期修改不再删除未发月结，只拒绝会改变存档月覆盖日期的雇佣日期修改。生产 crontab 需重装以去掉 `hourly-payroll`。审计 M-15、L-17、N-5 随之失效。
- **取代关系**：取代 2026-04-24「厨师请假 MVP 按不折扣月薪处理」、2026-08-19「厨师空闲打包时薪缺失时按 0 计」，以及 2026-08-30「考勤是时薪工资的源事实」中重算与未发快照失效的部分（考勤按月冻结的原则改为按存档冻结）。
- **相关文档**：`SPEC-v1.2.md` §L、§3.9、§5.4、§6.1；`prisma/migrations/20260924100000_remove_cleaner_cook_cleaning/migration.sql`；`lib/attendance.ts`、`lib/salary/hourly-aggregate.ts`；CLAUDE.md §15.5。

## 2026-09-24：发货后无取消选项（M-4）

- **决策**：业主决定：工单只要有任一收货地址已发货（SHIPPED），就正常收费，任何界面都不提供取消选项（销售申请取消、管理员直接取消、批准取消都不可用，已发货的取消申请只能拒绝）；修改申请只能改交期。改款式数量的预览与取消结算预览对已发货工单同样拒绝。
- **理由**：业主 2026-09-24 原话口径：“只要发货了就正常收费，没有取消的选项。”服务端早已拒绝发货后的取消与改款式数量，界面入口与预览端点随之保持一致，不再让用户提交后才看到拒绝。
- **影响**：`lib/order/change-request-options.ts` 是销售详情页修改/取消入口的唯一判断，界面与服务端闸口共用 `hasShippedShipment` / `shippedShipmentViolation`。「部分发货后取消剩余」不再作为待定需求（审计 N-2 关闭）。
- **取代关系**：取代同日较早条目「部分发货后的改单与取消、已结算单的售后重做」中“部分发货后取消剩余待业主拍板”与“申请入口仍按工单状态显示，提交后才出现拒绝提示”两处表述；该条关于已结算工单可发起售后重做的决策继续有效。
- **相关文档**：`SPEC-v1.2.md` §L、§3.6；`lib/order/change-request-options.ts`、`lib/order/change-request-shipment-guard.ts`；`docs/audits/2026-09-23-evidence-review.md` M-4。

## 2026-09-24：历史数据清理脚本的执行口径

- **决策**：业主决定清理已经卡住或写脏的历史数据（审计 M-7 旧代次卡住的工序与进度步骤、L-14 从未下发却提前写入的 `scheduledAt`），使用 `scripts/maintenance/cleanup-stuck-production-history.ts`。执行口径：先在目标库只读 dry-run（`--database=<库名>` 必须与实际连接库一致）；业主核对输出的数量与 id 后，才用 `--apply --actor=<管理员用户名>` 写入，`--actor` 由业主指定且必须是活跃管理员；`skipped` 中的工单不手工改库，按原因人工核对。
- **理由**：修复提交只对上线后发生的情况生效，已存在的脏数据需要一次性清理；生产数据修改必须经业主确认（CLAUDE.md §12），所以默认只读、写入需要显式参数和指定操作人。
- **影响**：写入在单事务内逐单持工单级联锁，锁内重新判定，已不适用的候选跳过；条件更新失败或其他异常时整体回滚；每单写 OrderLog 与 BusinessAuditLog；带分档烫金报工的旧代次工序只标记 `payrollReviewRequired` 转管理员人工核定，从不计算工资；重复执行无写入。生产尚未执行 dry-run。
- **相关文档**：`docs/部署指南.md`（历史数据清理发布步骤）、`scripts/maintenance/cleanup-stuck-production-history.ts`、`docs/audits/2026-09-23-evidence-review.md` M-7 / L-14。

## 2026-09-25：彩印叠加烫金带反面颜色一律转人工核价，不再判为非法输入

- **决策**：彩印款叠加烫金（局部或专版）只烫反面或正反面都烫时，纯报价引擎返回 `MANUAL_PRICING_REQUIRED`（原因 `PRINT_BACK_SIDE_FOIL`），沿用“人工整款价含制版费”，不另出制版费行；外部销售建单命令 schema 不再提前拒绝。真正矛盾的输入（叠加烫金却无颜色、未叠加烫金却带颜色）仍按非法输入拒绝；正面单色平烫套餐价不变。
- **理由**：GPT-6 对抗审查（A1-2）确认：`e4deaafc` 的人工分支只覆盖叠加局部烫金，`hasLocalFoil=false` 时适配器得到 `printFoilMode FULL`，旧校验“彩印叠加专版烫金只能使用正面”先返回 `INVALID_INPUT`，报价与提交都被阻断，违背 2026-08-27「外部报价目录与事实合法性不再由编码或旧能力清单决定」中“彩印反面烫金是合法但待人工定价的组合，schema 不得提前拒绝”。本条是落实该既有决策的修复，未经业主另行拍板。
- **影响**：`4800b043`。非彩印专版烫金带反面颜色仍被“专版烫金只能使用正面”拒绝，与 2026-08-27 条目的“专版双面”口径不一致，**待业主确认**（HANDOFF「卡住的问题」），本条不替业主决定。
- **取代关系**：无；落实 2026-08-27 条目中彩印部分。
- **相关文档**：`SPEC-v1.2.md` §J.3；`docs/加工费计费规则.md` §7；`docs/contracts/external-create-order.md`；`lib/price/create-order/item-quote.ts`；`docs/audits/2026-09-23-evidence-review.md` §7。

## 2026-09-25：未提交的外部销售草稿改数量 / 规格只重算加工费，物流收费行在提交时生成

- **决策**：外部销售草稿（本人建单或管理员代建）尚无快递 / 耗材收费行时，改单预览与批准只重算加工费（`requotesLogisticsChargesOnChange` 判定，`includeOrderCharges=false`），不刷新物流行、不做“每个地址两行”的身份校验；提交时由 `finalizeExternalOrderQuoteInTx` 按最新物流价目权威生成物流行并做完整性校验。已提交的外部销售工单、以及已带物流行的草稿，仍按原口径重算物流并在缺行时于首次写入前拒绝。
- **理由**：GPT-6 对抗审查（R4-1）确认：物流行只在提交时生成，草稿上本来就没有；改单路径却一律要求每个地址已有两行，导致管理员代建草稿与外部销售本人草稿改数量或规格都以“快递/耗材收费明细不完整”失败，而草稿不能使用完整收费编辑器补行。修复不改变提交时的权威报价，未经业主另行拍板。
- **影响**：`26c65eba`；`tests/e2e/order-create.spec.ts` 恢复管理员代建草稿改数量 / 包装与改规格的正向用例。
- **取代关系**：补充 2026-08-27「改单必须原子维护计价事实、包装金额与历史兼容」中“外部销售按审批时有效版本重新报价”的适用范围（草稿阶段不含物流行），该条其余内容继续有效。
- **相关文档**：`SPEC-v1.2.md` §3.6；`API.md`「工单修改与价格确认」；`docs/工单变更与版本规则.md`；`lib/order/change-request.ts`。

## 2026-09-25：分货后过期的管理员议定盒价，提交确认、报价凭证与落库计入同一金额

- **决策**：分货改变盒数后不再受信任的管理员议定盒价，在“确认最新报价并提交”的已知合计、报价凭证与落库三处都按已保存单价与小计计入；存在这类过期议定组时确认完整性为 `EXCLUDES_MANUAL_ITEMS`，与落库的 `PENDING_ADMIN_CONFIRMATION` 一致。确认后议定单价若再被改动，旧凭证不再放行。
- **理由**：GPT-6 对抗审查（A1-1）确认：提交终结器沿用已保存盒价落库，而确认页与凭证只纳入受信任的管理员价、其余按价目簿计算，用户确认的金额比随后落库的少（单测复现 896.30 对 1071.30），完整性还被报成 `COMPLETE`。本条保证“用户看到并确认的金额 = 落库金额”，未经业主另行拍板。
- **影响**：`55a81c73`；最终价格仍由管理员确认，本条不改变议定价是否需要重新确认的规则。
- **取代关系**：无。
- **相关文档**：`SPEC-v1.2.md` §J.3；`docs/工单变更与版本规则.md`；`docs/contracts/external-create-order.md`；`lib/order/submit-external-order.ts`。

## 2026-09-25：已删除功能的历史任务与通知保留为记录，不能重试或重发

- **决策**：升级前遗留的 `CRON_HOURLY_PAYROLL`、`CRON_CS_SETTLE`、`CRON_CS_PERIOD_ENDING` 死信任务，以及事件已不在 `NOTIFICATION_EVENTS` 的通知死信，运维页不给“重试”，`retryDeadBackgroundJob` 抛 `RetiredBackgroundJobTypeError` 拒绝；已删除事件（`CS_PERIOD_ENDING` / `CS_PERIOD_SETTLED`）的“送达未知”通知拒绝“确认未送达并重发”（`RETIRED_EVENT`，写入前拒绝），“确认已送达 / 忽略”照常可用。历史行原样保留。
- **理由**：GPT-6 对抗审查（R1-2、R4-3、R2）确认：两条删除迁移只取消 `PENDING` 任务，保留的 `DEAD` 行重试后必然因处理器 / 事件已删除再次失败；通知重发后日志已不是 `UNKNOWN`，连“忽略”都无法收尾。保留记录而拒绝无效重试，符合 2026-09-24「删除客服角色」「删除清废/厨师」两条决策“不静默改写历史”的口径，未经业主另行拍板。
- **影响**：`ea4449d1`、`3ebdfb2d`。已知边角未修：升级前已处于 `RETRYING` 的通知日志，在其最后一条 `UNKNOWN` 日志被确认已送达时仍可能重新入队（HANDOFF「卡住的问题」）（已由 `ec43cf66` 修复：已删除事件收尾时不再重新入队，同组 `RETRYING` 日志关闭为 `FAILED`，死信任务保留为历史）。以后删除任务类型或通知事件时沿用这一做法（CLAUDE.md §15.4）。
- **取代关系**：无；补充 2026-09-24 两条删除决策的历史数据处理。
- **相关文档**：`SPEC-v1.2.md` §L 第 5 条；`API.md`「已删除功能的历史任务与通知」；`lib/background-jobs/types.ts`、`lib/background-jobs/repository.ts`、`lib/notification/resolve.ts`、`lib/notification/unknown-retry-availability.ts`。

## 2026-09-26：已删除事件的待重发通知收尾口径与 PDF 运维重试并入在途复用

- **决策**：对已删除事件（如客服周期通知）的“送达未知”通知，管理员选“确认已送达”或“忽略”时不再重新入队；同一投递键下仍处于 `RETRYING` 的日志在同一事务内按 CAS 关闭为 `FAILED`——选“忽略”时沿用忽略理由，选“确认已送达”时记为“人工核对：未送达；事件已停用，不再重发”（这些行此前已被管理员确认未送达，不改写成已送达），死信任务保留为 `DEAD` 历史并逐条写入审计。运维页重试失败的 PDF 任务与下载、重新生成共用同一授权范围锁；同范围已有排队或生成中的任务时不复活旧任务，提示“已有同一工单 PDF 正在生成”。
- **理由**：GPT-6 对抗复审（2026-09-25，gpt-6-astra）确认两处遗漏：收尾分支会把已删除事件的任务重新入队，处理器必然拒绝并让日志永久停在 `RETRYING`；运维重试绕过了 `86b49c9b` 的在途复用，可能让同一工单两个 PDF 任务同时占用大文件队列。
- **影响**：`ec43cf66`、`9273e1b2`。2026-09-11 之前旧格式的 PDF 去重键不含范围摘要，无法重建范围，这类历史任务重试照旧处理。取代 2026-09-25「已删除任务 / 通知不可重试」条目中“已知边角未修”一句。
- **相关文档**：`lib/notification/resolve.ts`、`lib/background-jobs/pdf-scope.ts`、SPEC §E.1、§L、API.md、`docs/audits/2026-09-23-evidence-review.md` §8。

## 2026-09-26：建单页“设计款名称”由建单人填写，单款默认跟随工单名称，同一工单内不重名

- **决策**：管理员与外部销售建单时都填写“设计款名称”（代表这张设计图，如“福字款”），规则一致：只有一个设计款时默认跟随工单名称，输入过名称即不再跟随（本次编辑中按设计款记录，不按取值猜测；清空后在下次修改工单名称时恢复跟随，删到只剩一个未手动命名的设计款时也恢复跟随；恢复本地草稿或切换批量工单后记录不保留，改按取值推断——名称为空或等于当前工单名称视为跟随）；“＋ 增加设计款”新增的设计款名称留空、必须手动填写，不再自动带“副本”；“＋ 增加规格”新增的规格与所在设计款共用名称，改名同步到该设计款全部规格；同一张工单内设计款名称不能重复（去首尾空白、忽略大小写比较），前端对每个撞名的设计款即时提示，`createOrderSchema` 与 `createOrder` 两处拒绝；名称最多 64 个字符，跟随的工单名称超长时提示缩短而不截断。管理员保存草稿只因设计款名称被拦时，只提示外部销售与设计款名称，不打开提交阶段校验（沿用同日“草稿只拦外部销售”的做法）。切换类型、纸张、克重、规格不再改写名称；恢复旧本地草稿时同一设计款各规格统一为首行名称。打印单：一张工单混用多种纸张或克重时，在每行款名下标“纸张 克重”（只用一种时仍看顶部“纸张类型”栏，版面与页数不变；类型不另印，每行工艺已写明局部平烫 / 专版平烫 / 彩印；业主 2026-09-26 在“每行都加会让常见 4 款工单从 1 页变 3 页”的实测后选定），分页估算计入这一行，PDF 模板版本升到 6。XLSX 款式表新增“克重”“类型”两列（类型取计价路线业务名，待管理员终价留空）。寄样品 / 打样的命名规则不变（打样仍取系统生成名）；建单后改名（详情页、修改申请）不变；已有工单不回改。
- **理由**：SPEC §3.1 建单时“添加款式 → 款式名”由人填写；2026-08-27 起外部销售表单改为按“类型 · 纸张 克重 · 规格”自动生成款名，2026-09-24 管理员改走外部销售表单后，管理员可见的名称输入框被自动名覆盖、形同虚设（HANDOFF 挂起项“外部销售表单是否支持手填款名”）。业主 2026-09-26 拍板：款名应是设计图的名称，由人填写；纸张等信息改在打印与导出里单独呈现。
- **影响**：管理员不填工单名称也不填设计款名称时不能再存草稿（原先自动名兜底）；分货、人工核价、制版明细日志、历史空白封价按“序号 + 款名 + 规格”区分共用名称的规格行；修改申请与重做相关提示仍只写款名（后续待办）；款式名称搜索不再能用纸张或规格关键词命中新工单。打印截图基线不变（现有夹具只用一种纸张）。
- **取代关系**：取代 2026-08-27 外部销售表单“款名按计价事实自动生成、不提供人工命名入口”的做法；关闭 HANDOFF / PROGRESS 挂起项“外部销售表单是否支持手填款名”。
- **相关文档**：SPEC §3.1；`components/business/order/order-form-design-names.ts`、`lib/order/design-groups.ts`（`findDuplicateDesignNames`）、`lib/auth/schemas/order-create.ts`、`lib/order/print-layout.tsx`、`lib/order/export.ts`；TROUBLESHOOTING「新建工单选了专版烫金，款名仍显示局部烫金」。

## 2026-09-27：打印单抬头改为工单归属的外部销售，去掉“客户”与空工序占位

- **决策**：生产打印单页眉大字由“客户名称/简称”改为工单归属的外部销售——收费工单取提交外部销售（`submitter`），免费重做（`NO_CHARGE`，由管理员发起）取原单的外部销售；缺失时显示“外部销售未填”并列入“数据不完整”。原“客户未填”提示与“客户”续页取消，续页改为“外部销售”；PDF 文件名改为“工单号_外部销售”。尚未下发生产、没有工序时不再打印“暂无生产工序记录”占位，整块不显示。PDF 模板版本升到 7。
- **理由**：业主 2026-09-27 看打印单指出抬头应为外部销售；自 2026-09-13 管理员不再录入客户、2026-09-24 起收费工单一律归属外部销售，新工单的“客户”始终为空，每张单都印大红“客户未填”与缺失提示。工序在下发生产时才生成，未下发时的空占位没有信息。
- **影响**：打印像素基线全部随页眉更新（夹具改为测试销售提交，超长文本夹具用 64 字姓名的停用销售）。管理端列表 / 筛选、工单详情、编辑表单、师傅端工单页、账单等仍显示或可填“客户名称/简称”，是否一并收敛待业主决定。
- **相关文档**：`lib/order/print-view.ts`、`lib/order/print-layout.tsx`、`lib/order/print-html.tsx`、`lib/pdf/order-snapshot.ts`；UI-SYSTEM「工单单码报工与纸质分页」。

## 2026-09-27：停用工单“客户名称/简称”，按工单指认归属一律用工单归属的外部销售

- **决策**：工单不再显示、录入、筛选、搜索或导出“客户名称/简称”（`Order.customerRef` / `customerPartyId`）；凡要指认“这是谁的单”，统一用工单归属的外部销售——收费工单为提交外部销售，免费重做（`NO_CHARGE`）为原单外部销售，查不到时显示“未填”（`lib/order/external-sales-name.ts`）。逐处落实：师傅端工单列表与详情以一行“外部销售：…”取代“客户名称/简称”和“接单人”；管理端工单列表去掉“产品客户”筛选与“精确”标签，搜索框改为“搜工单号 / 名称 / 运单号”、不再按客户文本或关联客户命中，旧链接里的 `customerRef` / `customerPartyId` / `customerRefExact` 被忽略、不报错，“业务员”链接只按 `submitterId` 筛选；工单详情去掉“客户名称/简称”行，页头“业务员”改为工单归属的外部销售；管理员与销售编辑都不含客户，旧表单带来的客户键被丢弃、已存客户列不改；建单时 `createOrder` 对销售与管理员一律把两个客户列写空、不查客户主数据（schema 仍接受旧客户端带来的键、不校验），本地草稿不再保存客户、恢复旧草稿时丢弃，寄样品 / 打样不再携带客户，重做单不再复制原单客户；销售端列表、抽屉、详情与 `GET /api/orders/sales/[orderNo]` 不再返回客户，去掉“未填客户”，搜索框改为“搜工单名 / 单号”；代理商月账单（管理员、销售）与旧账单归档明细的“客户”列改为“工单名称”（未命名显示“未命名工单”），月账单生成仍照旧写 `customerRefSnapshot`（确认触发器要求）；CDR 打包候选表该列改为“工单名称 · 外部销售”；工作台关注列表主标签为工单名称、次行工单号，表头“工单”，待发货的“提交人”改为“外部销售”，临期工单表新增“外部销售”列；工单 XLSX 原“客户名称/简称”列位改为“外部销售”（其余列位不变），导出筛选仍接受三个旧客户键但先丢弃，停用前入队的导出照常生成、不再按客户筛选；代理商月账单 XLSX 的“客户快照”列改为“工单名称”（请求时冻结，未命名留空），停用前入队的快照仍能解析；完工、逾期、急单通知载荷新增 `{externalSalesName}`，交期逾期默认模板“客户：{customerRef}”改为“外部销售：{externalSalesName}”（迁移只改仍等于旧默认原文的行），规则编辑页不再把 `{customerRef}` 列为可用占位符，但载荷照旧发送，管理员自定义的旧模板不会漏出占位符。
- **理由**：自 2026-09-13 管理员不再录入客户、2026-09-24 起收费工单一律归属外部销售，新工单的客户恒为空，各页仍显示“未填客户 / —”、提供客户筛选，逾期通知也印“客户：未填”。业主 2026-09-27 看打印单后决定一并清理（同日前一条决定），并批准按 12 项方案全部执行。
- **影响**：数据库列（`Order.customerRef` / `customerPartyId`、`AgentMonthlyBillItem.customerRefSnapshot`）、相关触发器与“客户/供应商”主数据保留不动；历史 OrderLog 仍按原标签显示客户变更；`/api/owner/agent-bills/[id]` 仍原样返回 `customerRefSnapshot`（不改接口形状）。拼音搜索列由数据库按工单号、客户、收件与运单号生成，历史工单仍可能被旧客户名的拼音搜到（改生成列要重建列，本次不动库）。回滚到本次之前的版本时，本次之后请求、尚未生成的代理商月账单导出会因多出 `orderNameSnapshot` 键被旧代码拒绝，需重新发起（导出 24 小时即过期）。免费重做若原单缺失，外部销售显示“未填”（现行只有重做路径产生 `NO_CHARGE`，总带原单）。
- **相关文档**：SPEC §3.1、§3.1.1、§F.2；UI-SYSTEM「管理端工单列表」「工单资料与包装语义」「工单页面导航与标题去重」「工厂工单的业务员识别」；API.md 工单写入与「外部销售补正与账单」；ARCHITECTURE「外部销售读取边界」；`docs/管理后台使用手册.md`（工作台、§4.1、§4.2、§5.0）；迁移 `20260927100000_order_overdue_template_external_sales`。

## 2026-09-27：生产 crontab 只保留现行 4 个端点，示例里另 3 个暂不安装

- **决策**：部署 `b658328c` 时只删除已下线的 `cs-settle`、`cs-period-ending`、`hourly-payroll` 三行；生产从未安装过的 `pending-factory-backlog`（每日 08:30 待工厂确认积压推送）、`production-alerts`（每 10 分钟报工异常与生产停滞扫描）、`order-export-cleanup`（每日 02:15 导出产物过期与筛选隐私清理）继续不装。生产 crontab 为 `daily-salary`、`outsource-overdue`、`order-overdue`、`generate-bills` 4 行；cron 包装脚本换为仓库现行版本。
- **理由**：这 3 个端点自 2026-09-17 首次上线起就不在生产 crontab 里（未见记录说明原因）；其中两个会开始向企业微信发送新提醒，属于新增的生产行为。业主 2026-09-27 选择本次“只删三行”，不改变现有推送。
- **影响**：生产不自动发送积压与生产异常提醒；过期的工单 / 月账单导出产物不会被定时删除——下载在 24 小时后仍按 `expiresAt` 拒绝，但文件（含收件人姓名、电话）会留在应用机磁盘，有导出后应安装清理任务或人工清理。`deploy/crontab.example` 与部署指南 §10 仍是 7 个端点的完整配置，以后按 §10 安装即可启用。
- **相关文档**：[09-27 发布记录](docs/audits/2026-09-27-production-release-b658328c.md)；部署指南 §10；上线前置操作清单三节。

## 2026-09-27：建单设计款删除与规格移除分开

- **决策**：设计款标签前提供独立的增加/删除操作行；删除设计款一次移除所属全部规格，只剩一款时不提供整款删除。规格区“移除当前规格”只在同款有多个规格时出现，删除后优先留在同款。整款删除选择邻近设计款；焦点留在对应删除按钮，按钮消失时回到相应层级的选中标签。
- **理由**：业主指出设计款标签没有删除入口，审查发现多规格整款删除缺位、删除后跳到其他款、历史草稿手工名称串用，并授权直接修复。
- **影响**：整款删除移除该款全部规格，清除只属于它的包装组和额外收件地址；保留其他款的明细、文件和人工价，包装条件变化仍需重新确认人工包装价。删除使用现有 destructive 语义样式。
- **边界**：仅作用于建单表单，保留关联包装、分货及待上传文件处理和报价重新核对。历史无分组键草稿的手工命名记录随剩余明细重新映射，不因下标变化覆盖名称。不改既有工单、服务端授权、计费规则、历史快照或迁移。
- **相关文档**：[修复与验证记录](docs/audits/2026-09-27-design-removal.md)、[建单连续删除规范](docs/ui-规范.md#建单连续删除款式2026-09-12)。

## 2026-09-27：采购与 BOM 补资料保留录入

- **决策**：维持独立资料页，使用标签页内暂存与固定返回协议；普通重访明确选择续填，相同用户重新登录也需确认。数量/金额保留原始文本，BOM 物料行以稳定 UUID 关联回填。资料失效、目标行删除或返回上下文不匹配时保留其他输入并要求重新选择。
- **去重边界**：采购/BOM 创建、请求记录和审计保持同一事务，状态查询与创建使用同一请求锁。未知结果可以沿用原键重试，不能自动换键；明确另建才生成新 draftId / 请求键。记录不自动清理。完成标记保留请求身份，浏览器后退也须核对，旧提交重放明确显示原单据。
- **降级与权限**：存储不可用时停留原页，补资料使用 noopener 新标签页，并提供仅更新选项的动作。新建路由复用原授权但脱离流式加载占位，保证无 JavaScript 的原生创建和退出可执行；采集脚本就绪前的原生输入，防止默认值覆盖。供应商类型、物料分类与产品分类权限继续分别验证。
- **依据**：[已审查方案](docs/audits/2026-09-27-interaction-remediation-plan.md) B 批、[实施记录](docs/audits/2026-09-27-interaction-remediation-implementation.md)。不做跨设备草稿，不改变库存、价格或工资历史。

## 2026-09-27：仓库维护与库存写入协调

- 仓库、库位只改名和启停，不删除、不改编码或所属关系；默认对象不可停用，有任一非零库存则拒绝。历史零余额流水不阻止停用；历史收货取消必须先恢复库位。采购待收货没有预占库位，不虚构阻断关系。
- 配置写入与维护先取事务独占锁，所有实际库存写入先取共享锁，状态重新读取后才写库存。共享写入仍可并发；不在持有请求/物料等锁后升级配置锁。维护前后值与审计同事务提交；无变化重试不新增审计。
- 父仓停用只改变父状态，子库位保留各自状态；恢复父仓不强行恢复单独停用的库位；恢复库位前必须先恢复所属仓库。下拉选项失效保留原值要求重选，服务端继续拒绝旧页面的非法写入。依据已审查交互修复方案 C 批。
- 配置锁等待限定 3 秒并给可重试提示。创建失败保留名称、编码及所属仓库，成功明确清空；出入库和收货成功同步重置受控字段，保证下一次确认内容与提交一致。盘点只列启用父仓/库位，旧页面按具体对象提示修复。

## 2026-09-28：未来计件调价仅取消选中的单版

- **决策**：按业主授权的交互修复方案 D 批，统一与个人工价提供“取消调价计划”。只取消尚未生效且无报工引用的一版，不连带取消后继；前版结束改为该版原结束，尾版恢复为空。历史版、规则、金额、哈希及已结算工资保留。
- **纠错边界**：保留已有草稿；无草稿取最新未取消发布版作为模板，版本号不复用。保留其他未来计划时仍不支持插入立即调价，明确提示追加时间；取消最后未来版后才可立即纠正。首版个人取消回到统一价，首版统一取消产生未配置时段并拒绝报工，不自动生成零价。
- **执行保护**：活跃管理员、个人归属、真实数据库时钟、相邻版本复核、同事务审计和请求去重；师傅停用不阻碍取消其未来计划。不可变取消记录与延迟 DB 校验约束区间恢复，提交跨过生效时刻必须回滚。
- **发布边界**：默认关闭 `PIECEWORK_SCHEDULE_CANCEL_ENABLED`。全运行面兼容 CANCELLED 后才启用；一旦发生取消，只能关闭入口并使用兼容版本，不能回退到不认识取消历史的旧代码。
- **审查补修**：取消结果在工价区播报，保留展开与焦点，草稿提示与入口按实际存在及可编辑状态显示。新增政策引用索引而不改已应用迁移；CLI 缺少已发布统一价时引导到页面创建草稿，保留现有发布并发标记，不新增另一套自举协议。


## 2026-09-28：单负责人完工登记与独立提成账本

- **决策**：多选整单排给合格师傅，同一任务不拆量。下发后生产进度显示生产中、待打包发货、已发货；原审批、暂停和财务状态仍独立执行。打包无需扫码。修改默认生产量需审批，管理员补登使用既有归属。
- **理由**：用户确认师傅扫码表示已经做完；归属已由排单确定，再选师傅容易出错。真实生产过即应保留工资，改版不冲掉工资，补做人工定价。
- **实现取舍**：新增 ProductionJob 完成事实及 ProductionWage/Entry 工资投影/流水，旧 ProductionReport 不填虚构零价。改版完成先产生 NULL 待补价义务；人工协作用最终金额差额入账。新旧账本按 simpleProduction 隔离，统一结算与历史查询。
- **历史边界**：旧单不会自动猜负责人或转换历史。实际生产被改版淘汰仍保留提成；更正仅处理确实未生产的误登记，未结算、未发货、无后续版本才能反向记账。旧日已结算不通过换日期绕过。
- **相关**：[方案](docs/audits/2026-09-28-production-assignment-plan.md)、[API](API.md)、[数据库](DATABASE.md)、[执行证据](docs/audits/2026-09-28-production-assignment-implementation.md)。


## 2026-09-28：核定产量与需求满足分别保存

- **决策**：用户确认原计划 1,000、核定实际 990 后增至 1,300，默认新增 310。纯资料改版保留满足原需求的结论，不能自动补做 10。
- **事实优先**：改单/取消前处理数量申请和漏登记；无扫码不等于无生产。历史审批使用原师傅、原工作日和原规则快照。归属调整需先核实原师傅未生产。
- **状态与通知**：共同完成闸口阻止待审变更及未决历史事实；最后待审关闭或暂停恢复时重新投影。关联新模式重做从实际创建入口下发，零内部生产任务也主动检查外协等完成条件。
- **旧账保护**：已结算日可确认生产并立待补工资义务，不写原工资流水；错误义务可据证关闭但不撤销已结算日生产。补差支付机制仍待用户选择，本轮不默认启用。
- **恢复**：未知事实持久保留，依赖冲突不自动挪量或扣薪。恢复命令默认只读，确定的元数据修复支持原修订和幂等键；见 [恢复手册](docs/生产事实恢复手册.md) 和 [执行记录](docs/audits/2026-09-28-production-remediation-execution.md)。

- **复审补充**：只改交期等资料、实物与各款未登记量不变时延续未完工任务，不要求虚假未生产证明；历史冲突区分已包含于后续生产与独立额外生产，均需管理员证据，后续工资不改写。非新增生产的计价变化不重新发完工通知。

## 2026-09-30：单张 PDF 直接生成，打印使用准备完成的 HTML 页面

- **决策**：按本轮用户要求简化 PDF 使用链路，单张接口默认 `PDF_ORDER_MODE=direct`；限时在 Web 的 Chromium 子进程生成，按账号/角色/内容合并请求，使用有容量和时效上限的私有内存缓存。页面“打印”使用已有 HTML 打印页，在字体、图片、分页准备完成后调用打印；PDF 下载与原 `view=inline` API 保留。
- **取代范围**：取代 2026-07-17 的“全部 PDF 必须写 BackgroundJob、只能在 HEAVY 执行”中单张交互下载这一部分；批量 PDF、CDR、其他导出和通知的 durable 模式保持。`PDF_ORDER_MODE=queued` 保留单张回退；旧任务及其审计不删除，原队列的幂等和权限规则继续成立。
- **稳定性边界**：每 Web 进程最多四个不同请求在途、一个串行浏览器池、45 秒生成预算、32 MiB/16 份/五分钟完成缓存；每次响应重新核验账号、资源和完整打印内容。同一版本内内容变化也拒绝旧文件。不同 Web 进程、直接请求和历史队列任务之间不承诺全局去重；部署需要评估所有进程及 Chromium 子进程的资源总量。
- **验证与发布**：本机直接下载和队列回退分别验收；用户授权本次代码优化，不代表已执行生产发布或完成生产容量验收。相关契约见 API、ARCHITECTURE、DEVELOPMENT 和部署指南。

## 2026-09-30：PDF 显式生产模式与局部故障隔离

- **决策**：落实用户要求继续修复的对抗复审方案 T2/T3/T5。取代本日“单张 PDF 直接生成”中生产未配置也默认 direct 的规则：开发仍默认 direct，生产缺少 PDF_ORDER_MODE 则配置预检失败且接口返回 503；queued 与 inline 的组合不再静默直接渲染。
- **隔离**：新增可空 PDF 能力心跳；失能的 HEAVY 仍运行 CDR/表格，领取 SQL 在计入尝试前排除两类 PDF。旧 worker NULL 不视为能力已就绪；发布按同版本能力放行。schema 先前向迁移再启动新代码，生产发布维持停旧 worker 的原顺序。
- **体验**：保留图稿警告 PDF 的下载契约，仅不缓存不完整结果；错误使用固定分类与随机关联号。未更改打印模板、权限、金额或历史版本规则。
- **验收边界**：本地生产构建与故障注入不能代替生产低内存主机容量数据；未执行 PR CI、目标环境容量或生产部署时明确保留发布阻断。


## 2026-09-30：大表哥历史回放与销售账单浏览

- **决策**：历史源表仅在明确隔离的本地 E2E 库中回放，使用独立测试账号，保存来源文件、工作表、行号和原日期；不把原日期声明为真实发货或结算日期。缺金额或分项不平的行保留草稿，不推测应收；原数量合计相互冲突时保留原文、等待核对，不自动选一个数字。多款合并原行只做聚合测试项，不伪造分款。
- **理由**：真实历史能暴露大列表、跨年份账期和手机布局问题，但不能填造生产、收款与历史凭证。测试生成仍走原月结命令，只有已结束的月份生成草稿，没有模拟收款。此工具不是生产迁移入口。
- **决策**：销售“已发货”覆盖发货后已结算状态，并单列“已结算”子集；正常末地址发货会同时结算，原单一 `SHIPPED` 筛选会漏掉这些工单。工单保存时归属账号决定列表可见性，出月账单不决定工单是否出现。
- **决策**：销售月账单用卡片明确账期、状态、工单数、工单金额、抵扣及应付；趋势按本人最近 12 个有账单月份展示，默认折叠。大账单增加名称／工单号搜索和每页 30 条的明细分页，金额始终取整张账单的保存值。工单列表提供所属账单入口；手机状态筛选自动换行，避免已选视图藏在横向滚动区中。缺款式数量时明确显示未填写。
- **影响范围**：销售列表、预览 DTO、销售月账单列表和详情；不改变确认、收款、结算资格、历史不可变约束与账号授权。无迁移。
- **相关文档**：API.md“销售工单与月账单浏览”、DEVELOPMENT.md“历史数据本地回放”。

## 2026-10-01：师傅按总数登记完成；单人流程停滞告警维持现状

- **决策**：师傅端不逐款登记实际数量。师傅只按总数登记完成（与计划不同走既有数量审批），各款实际数量按工单确定，由管理员在核定 / 补登记时逐款处理。服务端拒绝师傅（`COMPLETE` 模式）提交的逐款数量，撤回 d79082f1 / 7d2da271 的"师傅逐款申请进审批、审批回填"路径。
- **决策**：单人流程（simpleProduction）停滞告警维持现状，不把已登记的 `ProductionJob` 视为"已开工"。师傅会扫码报工；已下发但超时未完工的工单由告警提醒管理员处理完成。
- **理由**：业主 2026-10-01 答复。逐款核对属于管理员职责，师傅手工提交逐款数量只会产生需要额外审批的伪数据。
- **影响范围**：`lib/production/completion-registration.ts`（拒收师傅逐款数量）、`ProductionJobPanel`（去掉申请回填）；告警逻辑不变（b6151430 仅排除已完工单人流程工单）。无迁移。
- **相关文档**：HANDOFF「卡住的问题」2026-10-01 节。

## 2026-10-01：工单页面审查后的五项界面决定（先下发后物流、去掉费用记录、详情收起低频表单、我的工单、待下发检查）

- **决策**：先下发生产，生产后才处理物流。仍可下发的工单，「当前待办」只给「下发生产」，物流费用核对不进当前待办（表单留在费用区并默认收起，维护区保留一个「核对物流费用」入口）；下发后、发货前才进入当前待办。服务端规则不变：确认单本就可下发，发货仍要求物流已核对。
- **决策**：管理员工单详情去掉「费用记录」三阶段卡（提交报价 / 确认金额 / 结算金额及其占位提示），合计统一叫「当前金额」（历史单「历史金额」），估价照旧标「估」；金额变化见工单动态。
- **决策**：详情页低频表单默认收起、保持挂载（未提交输入不丢，深链展开祖先折叠）：物流费用确认、添加整单费用、添加制版明细、添加成本明细、发起重做工单、尚不能发货且未保存过物流资料的地址登记。界面用词「订单级」统一为「整单」。
- **决策**：外部销售的工单列表在侧栏、面包屑、H1、`<title>` 统一叫「我的工单」；管理员仍为「工单列表」。
- **决策**：管理端工单状态 PENDING_FACTORY / SUBMITTED 由「待处理」改为「待下发检查」（与队列「待办」区分，与详情「下发前检查」同词）；工单列表主按钮为「新建工单」，「应用筛选」为次要按钮。
- **理由**：业主 2026-10-01 对审查 D-9、D-13～D-15、S-3、L-9/L-10 的答复。
- **影响范围**：仅界面与内联操作 DTO（`lib/order/admin-inline-operations.ts` 在可下发时不返回 fulfillment）；状态注册表标签变更影响管理端所有该状态徽章与日志文案，打印模板使用自己的状态标签、像素基线不受影响。无迁移。
- **相关文档**：[审查记录](docs/audits/2026-10-01-order-list-detail-ui-review.md)、`docs/ui-规范.md`「管理员工单详情布局」2026-10-01 补充、`UI-SYSTEM.md`「管理端工单详情」。

## 2026-10-01：师傅一键完成；批量完成与发货即完工按计划数量代登记

- **决策**：师傅端「完成生产」按计划数量一键登记（二次确认防误触），不再输入数量；数量不一致时展开上报，走原数量审批。管理员可在工单列表「批量完成生产」；单人流程工单填物流单号确认发货（多地址为第一个地址）即按计划数量代师傅登记完成并计提成。生产日期记当天；有数量待审批、未安排师傅、师傅当天不在雇佣期、修改待审批时拦下；逐单一个事务，失败整体回滚；只做单人流程。
- **理由**：业主 2026-10-01 答复（1–5 条全部采纳建议）：工单一旦生产就是工单数量；货已发出即证明已生产，不应因师傅漏点完成而卡住发货或漏计工资。
- **影响范围**：`lib/production/planned-completion.ts`（新）、`registerProductionCompletionInTx`（原登记函数拆出事务内版本，行为不变）、`registerShipment` 与 `shipOrder`（`transitionWithLog.prepare` 钩子）、工单列表批量命令 `COMPLETE_PRODUCTION`、发货可用性新增 `PRODUCTION_REQUESTED` / `PRODUCTION_UNASSIGNED`。`ProductionJob.recordSource` 新增 `ADMIN_BATCH` / `SHIPMENT_AUTO`。无迁移。
- **相关文档**：SPEC-v1.2.md「师傅一键完成、批量完成与发货即完工（2026-10-01）」。

## 2026-10-01：全站 UI 文案回归统一规范

- **决定**：按用户再次确认的 `docs/ui-规范.md` §7 清理销售账单、工单、价格规则、库存采购、通知、外协与师傅端的重复导语、机制解释和可选空占位。`UI-SYSTEM.md` 中要求额外业务说明的冲突条目以 §7 为准；旧测试不得继续要求已拒绝的说明。
- **保留边界**：金额范围与未定稿状态、历史档案隔离、权限和禁用原因、异步任务有效期、提交与失败恢复、离开和文件损失保护。确认内容只陈述本次实际后果；外部销售归属仅在账号实际变化时提醒。
- **一致性**：新生成的月账单 XLSX 使用“工单明细 / 跨月抵扣”和业务状态，计件 XLSX 使用“计件结算 / 报工明细”，校验码移至“核验记录”；保存的源数据及已生成文件不重写。销售工单预览错误按 HTTP 状态提供恢复，不显示远端原始错误。
- **边界**：不改权限、结算资格、计价与库存计算、历史记录、数据库结构或迁移；提成复核按现有命令展示原报工日实际抵消的人工差额，保留跨日冲正的各日原额，提交参数及计薪命令不变。扫描器增加结构化展示字段追踪与定向禁词，不扩大豁免。
- **验证**：命令、范围、实际结果及未覆盖项记录在 [本次验证记录](docs/audits/2026-10-01-ui-copy-cleanup.md)。此次为本地修改，未发布。

## 2026-09-30：寄样品快递费默认按首重，提交即自动确认

- **决策**：寄样品（`SAMPLE_SHIPMENT`）的快递费在报价和提交时按收件省份的中通首重计费，提交后费用自动确认、直接进入待下发，不再需要管理员人工核价；首重同时写为该地址的计费重量，发货按它定稿，不必另填重量。实际超重时，管理员在详情页「履约费用」改计费重量（快递费留空即按原物流价目重算）或直接填实际快递费；「编辑全部收费」入口不变。顺丰到付仍只收纸箱费。收件省份不在中通报价表内时快递费仍待核价，不估算、不按零元。
- **理由**：业主原话「样品不会超重，都是几个红包」「其他无必要的就忽略掉，简单一些」。原设计（`docs/寄样与打样开发任务.md` §2「不以虚假数量、零重量或硬编码金额触发默认」）让每张寄付样品停在待核价，管理员要先手输一次快递费、发货前再补一次重量。首重和首重价都取自已发布的物流价目，不是硬编码金额。
- **影响**：`lib/order/sample-order.ts` 的报价与提交共用首重默认；提交时不信任已存重量（驳回后改了省份会按新省份重算）；收费明细快照标 `weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT`。已提交的寄样地址带计费重量，按既有规则视为「已登记物流」，不能再从它分货——要多寄一处请另建寄样单。
- **相关文档**：`scripts/verify-sample-orders.ts`（独立库全链路验收）、`lib/order/__tests__/sample-order-quote.test.ts`、`lib/order/__tests__/sample-order-finalize.test.ts`。
