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
