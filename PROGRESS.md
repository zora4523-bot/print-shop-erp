# 开发进度

> 本文档记录"当前做到哪了、下一步做什么"。每次 session 结束前更新。

## 当前阶段

**P0 阶段 5/9：薪资系统（A/B/D + Slice C 纯函数）完成，剩余 Slice C 的考勤表 + 聚合 UI**

## 最后更新

2026-04-23

## 已完成

- [x] 项目初始化（Next 16.2 + Prisma 7 + 记忆管理体系）
- [x] **P0 #1 认证与用户管理**（commits `881ed75 → 6ef01fe`, 149 单测）
  - 认证基础 / 登录页 / 自服务改密 / 登出 / 老板管账号 CRUD
  - PG advisory xact lock 原子不变量、bcrypt 72-byte 短路
  - 15 轮 Codex review 全部闭合
- [x] **P0 #2 工艺 + 产品字典**（commits `25b2623 → 25bfebf`, +100 单测 = 249）
  - 工艺字典：列表 / 新建 / 编辑 / 启停，排序 + 默认机器 + 外协标记
  - 产品字典：分类 + 规格 + 纸张 + 建议单价 + 起订量
  - Decimal(10,4) 精度守卫、minOrderQty 严格 int 解析
  - 9 轮 Codex review；round 24 跨三份字典统一修"双 isActive 控件" + "post-create 不跳"
- [x] **P0 #3 工单核心（E-lean）**（commits `791f731 → e22b643`, 21 commits, +151 单测 = 400）
  - **Slice A1/A1b/B — 创建 / 提交 / 取消 + 销售端 UI**（rounds 25–28 clean）
    - `YYYYMMDD-XXXX` 工单号（Asia/Shanghai tz + 每日 advisory lock + max serial 跳洞）
    - 状态机 `transitionOrder` 铁律（§4.3，8 个状态）
    - RHF + useFieldArray 动态款式，工艺多选 checkbox list
    - submit-ownership 守卫 at action boundary + lib 重校（round 27 belt-and-suspenders）
    - 权限作用域 `getOrderScopeFilter`（SALES/CS own, OWNER/FOREMAN all, WORKER 仅自己有任务的）
  - **Slice C — OSS 直传脚手架**（rounds 29–33 clean）
    - env 四态 discriminated union `SignUploadResult`（ok / not-configured / invalid / error）
    - `OssNotWiredError` 显式桩，STS SDK 落地时替换 6 行实现
    - 路径注入守卫（`SAFE_ID_RE`）、扩展名 / fileType 匹配、`application/octet-stream` 通道防滥用
    - `deriveBucketUrl` 从 `OSS_ENDPOINT` 派生上传主机（VPC / 自定义端口 / IPv6 拒绝 / 已虚拟主机格式拒绝）
  - **Slice D — 打印 + PDF 双通道**（rounds 34–35 clean）
    - `/print/orders/[id]` 独立 top-level 段（避免继承 `/orders` nav）
    - `AutoPrint` client 组件按 `?autoprint=1` 分叉浏览器打印 vs Puppeteer PDF
    - `GET /api/orders/[id]/pdf` 进程内 `renderToStaticMarkup` + `page.setContent` → `page.pdf()`
    - `design-grid` 纯函数按数量分档（1/2/3-4/5-6/7-9/many）覆盖 SPEC 附录 E.2.1
  - **Slice E (E-lean) — 编辑 / 急单 / OrderLog diff**（round 36 clean，无 findings）
    - `editable-fields.ts` 按状态分三档（FULL / SHIPPING_ONLY / NONE），`pickEditableFields` 防御性 allowlist
    - `updateEditableOrderSchema` 完全 partial（缺 key 不改 / 空串清空 / 显式值写入）
    - 独立 `optionalFormBoolean` 区分 undefined vs false，防表单缺 checkbox 时误翻 isUrgent
    - 急单 toggle 仅在 FULL 状态可见；lib 层同样用 allowlist 守，即使绕过 UI 也不会污染 SCHEDULING+ 状态
    - OrderLog 按字段 diff 渲染（中文 label、状态枚举翻译、before → after 行）
  - **E-full（款式级增删改）延期到 P1**（业主 2026-04-23 拍板，临时解法：取消旧工单重建）
- [x] **P0 #4 生产流程**（commits `937d231 → 8eea35d`, 9 commits, +107 单测 = 507）
  - **Slice A — 排产**（rounds 37 / 38 clean）
    - `lib/production.ts scheduleOrder`：一次 tx 把 Order SUBMITTED → SCHEDULING + 批量 createMany ProductionTask，machineType 从 `Craft.defaultMachineType` 快照、`plannedQty` 从 OrderItem.quantity 取；白名单防御（外协、重复派工、不在工单里的 item×craft 组合全拒）
    - `pg_advisory_xact_lock('print-shop-erp:schedule:order:<id>')` 防双击调度
    - 拒绝对已停用工艺排产（round 37 P1）
    - `TaskStatus` 状态机 `PENDING → IN_PROGRESS → COMPLETED`，任何非终态可 CANCELLED
    - `/foreman/scheduling` 列表 + `/foreman/scheduling/[id]` 派工表单（按机型推荐师傅）
  - **Slice D — 薪资算法纯函数**（一次过）
    - `lib/salary/machine-piecework.ts`：`calcMachinePieceworkBreakdown` 返回 smallOrder 标记 + 倍率 + boardCount + pressCount + amount；`calcMachineDailySalary = max(sum, base)`
    - SPEC §7.1 / §7.2 的张三 / 李四两张示例表行对行断言复现
  - **Slice B — 师傅报工**（rounds 39 / 40 clean）
    - `beginTask` PENDING → IN_PROGRESS + 级联 Order SCHEDULING → IN_PRODUCTION
    - `reportTask` IN_PROGRESS → COMPLETED：读 active `WORKER_MACHINE` 规则、算 pieceworkAmount、**快照 salaryRuleSnapshot**（CLAUDE.md §4.4 铁律）、级联 Order IN_PRODUCTION → COMPLETED（当所有非 CANCELLED 任务都 COMPLETED 时）
    - 计件口径 `totalPressed = completedQty + defectQty + reworkQty`（DECISIONS 2026-04-23）
    - Cascade 锁后 **fresh-read Order.status**（round 39 / P1：防并发完工最后两个任务时写重复日志）
    - `/worker/tasks` H5 + `/worker/tasks/[id]` 开始 / 报工表单
  - **Slice C — 外协单**（rounds 41 / 42 clean）
    - `lib/outsource.ts` 单表 CRUD + `SENT → IN_PROGRESS → RECEIVED` 状态机（SENT → RECEIVED 短路合法）
    - 独立记录不阻塞 Order 级联（DECISIONS 2026-04-23）
    - `optionalDateField` 改严格 `YYYY-MM-DD` 解析（round 41 / P1，拒绝 `2024-02-31` 滚动）
    - `/foreman/outsource` 列表 / new?orderId / detail；工单详情页 foreman 可见"外协"入口
- [ ] **P0 #5 薪资系统（4/5 切片完成）**（commits `da80e1f → 2b7ba69`, +119 单测 = 626）
  - [x] **Slice A — 师傅日薪**（rounds 43/44 clean）
    - `lib/salary/daily.ts computeDailyWorkerSalary`：每日 24:00 汇总 `ProductionTask.pieceworkAmount`，max(汇总, dailyBase)，upsert 按 `@@unique([workerId, date])`；Shanghai 日界严格 `parseStrictYmd`
    - **已发放行拒绝重算**（round 43 / P0）：`isPaid=true` 抛错
    - `/owner/salary/daily` 列表 + FilterBar（date / paid / workerId）+ 3 张统计卡 + per-row 发放 toggle
    - `POST /api/cron/daily-salary` shared-secret Bearer
  - [x] **Slice B — 客服周期 + 提成**（rounds 45/46/47 clean，P3 hashtext 残留)
    - `calcCsCommission` FLAT 模式 + `computePeriodEnd`（Jan 31+1 月 → Feb 28 钳制）
    - `startCsPeriod` 支持 initialSales / durationMonths / monthlyBase override（SPEC §5.5 历史导入）+ 区间 overlap 守卫
    - `settleCsPeriod`：tx + **per-CS-user advisory lock**（防 accumulate-vs-settle race，round 46 / P0）+ 完整 `salaryRuleSnapshot`（round 45 / P1）+ 自动开启下一周期
    - `settleReadyCsPeriods` per-period try/catch（round 45 / P1）
    - `/owner/salary/cs` 列表 + new + detail + MarkCsPaidForm；`POST /api/cron/cs-settle`
    - **Migration**：`20260424015000_cs_commission_snapshot` 加 `salaryRuleSnapshot Json?`
  - [x] **Slice D — 老板薪资总览**
    - `/owner/salary` 索引：今日日薪 / 累计未发 / 客服活跃 / 待结算 / 未发提成合计
  - [x] **Slice C 纯函数 — `calcHourlyPayroll`**（一次过）
    - PACKER / CLEANER / COOK 三态；COOK 月薪 + spareHours × PACKER 时薪
    - SPEC §7.4 176+12×1.0×11=2068；COOK 3000+20×11=3220
  - [ ] **Slice C 剩余：`Attendance` schema + 外层 lib + 车间主管录入 UI + 老板月结列表**（本次 session 未做）

## 进行中

P0 #5 Slice C 剩余（考勤 + 月结汇总 UI）或 P0 #6。

## 下一步

按 README "开发路径（P0 优先级）" 顺序推进：

5. **P0-5 Slice C 剩余**（当前优先级，预计 1-2 天）
   - Schema 迁移：新增 `Attendance` 模型（workerId / date / normalHours / otHours / spareHours / createdById）
   - `lib/attendance.ts` CRUD + 车间主管录入 UI `/foreman/attendance`
   - `lib/salary/hourly-aggregate.ts` 月汇总 + Prisma 层（读月考勤 + 活跃规则 + 写 `HourlyWorkerPayroll` + `salaryRuleSnapshot`）
   - 老板 UI `/owner/salary/hourly` 月结列表 + mark-paid
6. **P0-6 应收账单**（3 天）
7. **P0-7 CDR 汇总**（2 天）
8. **P0-8 推送 + Dashboard**（1 周）
9. **P0-9 测试 + 上线**（3 天）

## P1 待办（已记录不拖 P0）

- **工单款式级编辑（E-full）** — item 增删改、OrderItem / OrderItemDesign 同步、OrderLog 内嵌款式 diff。当前 workaround：DRAFT/SUBMITTED 取消重建。
- **OSS 真实 STS SDK 接入** — `lib/oss/sign.ts signViaSts` 目前是抛 `OssNotWiredError` 的桩；业主 OSS 账号 / STS role 到齐后替换 6 行实现即可，`SignUploadResult` 契约不变。
- **设计文件孤儿清理** — SPEC §F.3 提到"定期清理删除工单的孤立文件"；待 P0 #3 真实上传流上线后评估。
- **外协状态 UI：IN_PROGRESS 中间态** — 当前 UI 只做 SENT → RECEIVED 直跳。如果业主希望区分"已发出"和"确认开始加工"，加一个"标记进行中"按钮即可（lib 已支持）。
- **外协阻塞 Order 排产** — 当前决策让外协记录和 Order 级联脱钩。若业务出现"必须外协回货才能排产"的强需求，加 gate 即可。
- **Slice E 派单 / 报工 OrderLog 增强** — 现在 `STATUS_CHANGE` 日志只记 before/after 状态，看不到谁派给谁 / 哪个师傅报了多少。未来细化 changedFields 结构即可。

## 待澄清的业务问题

- **ProductCategory 中文标签** — `lib/auth/role-labels.ts` 里是根据 enum 名猜的。业主过一眼 `/owner/products` 列表 + SPEC 附录 C 对一遍，如需更名在 `PRODUCT_CATEGORY_LABELS` 改即可。
- **设计图 "无法预览 CDR" 方案** — CDR 源文件目前只存不显；车间打印视图 SPEC §E.2.1 明确"CDR 不打印"。客服想在详情页预览 CDR 时怎么处理（占位缩略图 / "请下载"按钮 / 打开专用预览器）——等真实上传流跑起来再听业主反馈。

## 已知技术债

- `middleware.ts` 在 Next.js 16 有 deprecation warning。TODO 已写在注释里。独立一次迁移 commit 搞定。
- 账号/工艺/产品三份 UI 有大量结构近似的 "ToggleActiveButton" 组件。目前三份独立；可抽公共组件但等第 4 次出现再抽（避免过早抽象）。
- `app/orders/[id]/page.tsx` `formatDateTime` 用本地 `new Date(...).getX()`，和打印视图的 `Asia/Shanghai Intl.DateTimeFormat` 不一致。详情页当前只运行在国内服务器上不会出错，但和 `print-view.ts` 统一到 Asia/Shanghai 会更稳。
- Puppeteer 首次运行需要 `npx puppeteer browsers install chrome` 下载 Chromium（~170MB），部署 checklist 里要补一步。
