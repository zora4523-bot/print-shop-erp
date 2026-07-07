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

## 2026-04-22：工单不含价格字段，价格只在账单/报价系统体现

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
  - **C**：JWT session 有效期 **7 天**。
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
- **影响**：`components/business/order/OrderPrintLayout.tsx` 是纯函数组件，接收 `PrintOrder` 视图模型（craft IDs 在 page 层被解析成名字、role enum 解成中文 label）。`lib/pdf/render.ts` 是通用 wrapper，未来薪资单、账单都走同一个 `renderHtmlToPdf`。`lib/order/print-html.tsx` 的 `<title>` 注入用 `escapeHtml` 硬化（早期 review 确认 orderNo 目前是 ASCII，但加防御）。PDF route 回传 RFC 5987 双份 `Content-Disposition`（round 34）。`qrcode.react` SVG 变体用在 server-render 完全 OK。
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

## 2026-04-24：客服业绩流的并发序列化 — 锁 CS user 不锁 period

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

- **决策**：COOK workerType 的月薪 `monthlyBase`（默认 3000）与 `normalHours` / `otHours` 完全解耦——请假整月照发 3000，请假 + 代班打包则额外 + `spareHours × PACKER 时薪`。`calcHourlyPayroll` 的 COOK 分支对 normal/ot 一律忽略。
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

## 2026-04-25：应收账单 mark-paid 与 CS 累计共享同一个事务（tx threading）

- **决策**：`lib/salary/cs.ts accumulateCsSales(csUserId, amount, at, tx?)` 接受可选第 4 参数 tx。当账单 `recordPayment` 在自己的 `db.$transaction` 里调用时，传入 tx 让 CS 业绩累计的 `SalaryPeriod.totalSales += delta` 与 bill.paidAmount 的写入 **共享原子性**——一起 commit 一起 rollback。standalone 调用（未来可能的其他入口）不传 tx，自己开事务。
- **理由**：Codex round 52 / P1 指出 Prisma 的 `$transaction` 不是真的嵌套——`recordPayment` 外层 tx 里再 `await accumulateCsSales(...)`，内部会再开一个独立事务。内部先 commit，如果外层后续 rollback（比如 Decimal.js 精度断言失败 / 写 OrderLog 失败），`SalaryPeriod.totalSales` 已经涨了 delta，但 `bill.paidAmount` 回到旧值——payroll ledger 跑到 billing ledger 前面，提成多算。
- **影响**：`accumulateCsSales` 拆成 `accumulateCsSalesIn(tx, ...)`（真实逻辑）+ `accumulateCsSales(csUserId, amount, at, tx?)`（公开 API 包壳）。所有跨模块调 CS 累计的路径都应该传 tx。未来同款模式：如果 bill module 再长出 `cancelPayment` / `issueRefund`，也应该走 tx-threading 而非独立事务。同模式未来再出现跨模块累计（比如客服退单扣回业绩），API 已经就位。
- **相关文档**：`lib/salary/cs.ts accumulateCsSalesIn` / `accumulateCsSales`、`lib/bill.ts recordPayment`、Codex round 52。

---

## 2026-04-25：应收账单 paid-ledger 语义 — FULLY_PAID 终态，退款开新负数账单

- **决策**：`Bill.status` 状态机里 `FULLY_PAID` 是终态，不允许回退到 `PARTIAL_PAID` / `ISSUED`。如果业务发生退款 / 冲账，正确做法是 owner 新建一条负数金额的 Bill 做冲账记录（不改已结清的原单）。自反迁移（自我 → 自我）也一律拒绝；例外是 `PARTIAL_PAID → PARTIAL_PAID`（续收部分款），lib 层主动在状态未变时**跳过**状态机调用。
- **理由**：finance-of-record bedrock（DECISIONS 2026-04-24 薪资铁律）同样适用于账单。一旦打标 FULLY_PAID，关联的 CS 业绩已累计进 `SalaryPeriod.totalSales`、甚至可能已在月底 settle 成 `CustomerServiceCommission`——回退账单状态会让历史金额不可信。续收的场景下金额在变但状态不变，是合理的 no-transition；状态机保留&ldquo;自反即 bug&rdquo;的严格性用来抓 re-issue / re-pay 误用。
- **影响**：`lib/bill/status-machine.ts BILL_TRANSITIONS` 不含任何 self-loop；`lib/bill.ts recordPayment` 显式 `if (targetStatus !== bill.status) transitionBill(...)` 跳过续收的 self-transition。UI 在 detail 页要隐藏 `FULLY_PAID` 单的&ldquo;录入付款&rdquo;按钮（Slice B 落地）。未来 P1 加退款功能时，新加 `ADJUSTED` 或 `CREDITED` 状态、或者保持双账单模式。
- **相关文档**：`lib/bill/status-machine.ts`、`lib/bill.ts recordPayment`、Codex round 52。

---

## 2026-04-26：老板 Dashboard 业绩 / 排行 / 分布按 `Order.submittedAt` 计入

- **决策**：老板 Dashboard 上一切&ldquo;销售/客服业绩&rdquo;视角的统计——本月销售排行（Slice C）、产品线分布（Slice C）、即将结算客服周期的预测金额（Slice B）——业绩归属时间统一按 `Order.submittedAt`（工单提交时刻）。**不**按 `Order.finishedAt`（资金最终落账）。&ldquo;待发货&rdquo;关注列表则继续按 `Order.completedAt`（生产完工时刻）排序，因为它问的是&ldquo;什么时候能发&rdquo;不是&ldquo;什么时候算业绩&rdquo;。
- **理由**：业主明确倾向。`submittedAt` 是销售/客服真正出力气的时刻，给业绩反馈最即时；`finishedAt` 在长账期客户上要等 2-3 个月才出数，dashboard 看不到&ldquo;这个月谁拼了&rdquo;。代价是退单/取消会让历史业绩&ldquo;掉&rdquo;（CANCELLED 工单不计），但当前 SPEC 退单极少且 dashboard 只看&ldquo;趋势&rdquo;，不是结算证据。结算证据走 Bill / `accumulateCsSales`（独立链路，对应 DECISIONS 2026-04-25 应收账单 paid-ledger 语义）。
- **影响**：`lib/dashboard/owner-watchlist.ts` 的 `getEndingPeriods` 用 `submittedAt` 计算 totalSales 预测；Slice C 的 `getSalesRanking` / `getCategoryDistribution` 都按 `submittedAt` 月聚合，不与 `finishedAt`-based 客服真实提成（`SalaryPeriod.totalSales`）混用。Dashboard 数字可能会和 `/owner/salary/cs` 同期数字不一致——文案要点出&ldquo;本月销售排行（按提交时间）&rdquo;让 owner 不混淆两条链路。
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
- **理由**：Pigsty 的 `pg_pinyin` 文档给出了 generated column + trigram search 和 word tokenization + `pg_search` 两条路线。本项目当前搜索目标是工单号、客户代号、收货人、商品名、物料名这类短文本；先用生成列能覆盖中文/拼音输入，同时不引入 BM25、tokenizer、排序权重和额外扩展依赖。
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
