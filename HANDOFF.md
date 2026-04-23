# 会话交接

> **每次新对话开始前，先读这份文件。** 它记录了上次会话停在哪、下次该接着做什么。
>
> 本文件每次 session 结束前**整体重写**（除"历史"小节是追加式时间线）。

---

## 当前任务

P0 #1（认证与用户管理）+ P0 #2（工艺 + 产品字典）已完成。下一步：P0 #3（工单核心，预计 2 周）。

## 本次 session 主要产出

P0 #1 + P0 #2 全部完成（字典 / 用户管理 / 登录 / 改密 / 启停）。

- **认证 + 用户管理**（共 8 个 feature/fix commits + 15 轮 Codex review）：
  - bootstrap、登录、自服务改密、老板管账号 CRUD
  - PG advisory xact lock 做最后一位 OWNER 原子守卫
  - bcrypt 72 字节上限（superRefine 短路 + TextEncoder spy 锁住）
- **工艺字典 + 产品字典**（共 10 个 feature/fix commits + 9 轮 Codex review）：
  - 工艺：lib/craft + actions/owner-crafts + UI，支持排序 / 默认机器 / 外协标记
  - 产品：lib/product + actions/owner-products + UI，Decimal(10,4) 单价 + minOrderQty
  - 跨字典通病修复（round 24）：
    - 编辑页 `isActive` 双控件 → 只留 ToggleActiveButton
    - create action 成功后 `redirect('/owner/{resource}/<id>')` → 进编辑页

- **测试**：249 单测 across 10 文件（schemas 68 + permissions 31 + lib/account 19 + lib/craft 10 + lib/product 9 + actions/account 13 + actions/craft 16 + actions/product 14 + redirect 30）
- **工作流升级**：Codex review 全部由 Claude Code 自驱（`codex exec -m gpt-5.4`），用 stdin 管道传 prompt（不用 positional argument，避免 backtick 被 shell 吃掉）

## 下一步具体指令（给下次 AI）

P0 #3 工单核心 — **最大的 P0 切片,预计 2 周**。开工前**必读**:
1. SPEC-v1.2.md §3.1(销售/客服创建工单)、§3.6(工单修改)、§4.1(实体清单)、§4.2(关键字段)、§4.3(状态机)、附录 E(打印方案)、附录 H(OSS 直传)
2. `prisma/schema.prisma`:Order / OrderItem / OrderItemDesign / OrderLog 模型
3. `_reference/OrderPrintLayout.tsx`(业主提供的打印视图骨架)

分解建议(按 CLAUDE.md §4.2 垂直切片):

**Slice A — 工单创建基础**
- schemas:`createOrderSchema`(含 items 数组;每项 name/specification/paperType/quantity/crafts[]/isDoubleSided/isDoubleColor/unitPrice/suggestedPrice/remark)
- lib/order.ts:`createOrder`, `listOrders`, `getOrderDetail`(含 items 和 designs join)
- actions/order.ts:`createOrderAction`(权限 `order:create`)
- 状态机:lib/order/status-machine.ts(CLAUDE.md §4.5 铁律)
- 工单号生成:`YYYYMMDD-XXXX` 序号按天自增(注意并发)

**Slice B — 销售/客服端 UI**
- `/sales/orders/new`(多 item 动态添加、工艺多选、双面双色、JPG 上传)
- `/sales/orders`(列表带 getOrderScopeFilter,客服销售只看自己)
- `/sales/orders/[id]`(详情;按状态限制修改,SPEC §3.6)

**Slice C — OSS 直传**
- `lib/oss/`:STS token 签发(DECISIONS.md 2026-04-22 OSS 直传)
- 设计图上传:JPG 多张;CDR 可选多个
- 回调 API:接收 OSS 上传完成通知 → 写 OrderItemDesign 元数据

**Slice D — 打印 PDF**
- 参考 `_reference/OrderPrintLayout.tsx` 的网格布局
- `lib/pdf.ts`:Puppeteer 渲染
- 二维码:工单码 + 每个任务码(SPEC §4.2 ProductionTask)

**Slice E — 修改日志 + 急单 + 状态流转**
- OrderLog 自动记录每次变更(CLAUDE.md §4.5)
- 急单勾选 → 推送触发(留占位,notification 模块在 P0 #8)

建议先做 A + B(最小可用闭环),C/D/E 按业主优先级排。

## 卡住的问题

- **工艺清单 v.s. SPEC**:seed 里的 12 条与 SPEC §6.1 一致。如果业主真实业务里有增减,在 `/owner/crafts` UI 里自行调整即可,不影响开发。
- **ProductCategory 中文标签**:`lib/auth/role-labels.ts PRODUCT_CATEGORY_LABELS` 有 `TODO: 需业主确认`。现在是根据 enum 名猜的,看 `/owner/products` 列表和 SPEC 附录 C 对一遍。
- **`middleware.ts` → `proxy.ts`**:Next 16 deprecation 警告。留 TODO 在 middleware.ts 注释里,不阻塞。
- **Auth.js Adapter 表**:DECISIONS.md B 决策是只用 Credentials+JWT,不接 Prisma Adapter。以后加 OAuth 再补 Account / Session / VerificationToken 表 + migration。

## 相关文件清单（下次 AI 必读）

- `SPEC-v1.2.md` §3.1-3.6(工单/排产/报工流程)、§4.1-4.3(实体+状态机)、附录 E(打印)、附录 H(OSS)
- `prisma/schema.prisma` Order / OrderItem / OrderItemDesign / OrderLog / ProductionTask
- `_reference/OrderPrintLayout.tsx` 业主已给的打印视图
- 已建范式(照抄):
  - `lib/account.ts` / `lib/craft.ts` / `lib/product.ts` — CRUD + 不变量模式
  - `actions/owner-*.ts` + `.types.ts` — Server Action + redirect 模式
  - `components/business/*/` — 表格 + 表单 + ToggleActiveButton 模式
  - `app/owner/*/` — list / new / [id] 三页 + layout 守卫
- CLAUDE.md §4.5 状态机铁律(**禁止裸写 `status: 'XXX'`**)
- CLAUDE.md §4.6 权限统一入口
- CLAUDE.md §13 记忆管理

## 约束提醒（本次任务特有）

- **工单号并发**:`YYYYMMDD-XXXX` 自增的 XXXX 部分需要 advisory lock 或 `SELECT ... FOR UPDATE` + retry(参考 `lib/account.ts` OWNER 守卫的 advisory lock 模式)。
- **状态机 hard constraint**:所有状态流转必须走 `lib/order/status-machine.ts`,不允许 action/page 里写 `data: { status: 'SUBMITTED' }`。同步在 `OrderLog` 里写一条记录。
- **设计文件大**:CDR 可能几十 MB → OSS 直传 + signed URL(DECISIONS.md 2026-04-22)。**禁止**从 Next.js 后端中转文件。
- **金额字段**:`unitPrice` / `subtotal` / `totalAmount` 一律 `Decimal`,禁止 float。
- **可见范围**:`getOrderScopeFilter(user)` 已实现,list 和 detail 页必须应用。
- **Order 没有 price 业务**:DECISIONS.md 2026-04-22 决定 — 工单只记金额给客服业绩累加,不参与账单计算。

## 上次会话结束时间

2026-04-23

---

## 历史（追加式时间线）

- 2026-04-22：建立了项目记忆管理体系（PROGRESS / DECISIONS / HANDOFF + CLAUDE.md §13）。
- 2026-04-22 → 2026-04-23：完成 P0 #1 认证与用户管理全部切片（seed 硬化 + 认证基础 + 登录 + 自服务改密 + 老板管账号 CRUD）。16 个 feature/fix commits + 1 docs commit，149 单测，Codex 走了 15 轮 review。
- 2026-04-23：完成 P0 #2 工艺字典 + 产品字典。10 个 feature/fix commits，+100 单测（累计 249），Codex 9 轮 review。Round 24 统一修了三份字典的 "编辑页双 isActive 控件" 和 "create 后停留 /new" 两个通病。
