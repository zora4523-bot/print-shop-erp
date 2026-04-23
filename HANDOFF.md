# 会话交接

> **每次新对话开始前，先读这份文件。** 它记录了上次会话停在哪、下次该接着做什么。
>
> 本文件每次 session 结束前**整体重写**（除"历史"小节是追加式时间线）。

---

## 当前任务

P0 #1（认证 + 用户管理）/ P0 #2（字典）/ P0 #3（工单核心 E-lean）均已完成。**下一步：P0 #4 生产流程**（预计 1 周）。

## 本次 session 主要产出

P0 #3 工单核心（E-lean 版）——21 个 commit，+151 单测（累计 400），Codex 走了 9 轮 review（rounds 25–36）。

- **Slice A1 / A1b — 工单号 + 状态机 + create / submit / cancel 业务**（rounds 25–28）
  - `YYYYMMDD-XXXX` 工单号：`Asia/Shanghai` tz（`Intl.DateTimeFormat.formatToParts` 非 strip）、每日 advisory xact lock、max 序列（不重用被取消的洞）
  - 状态机 `transitionOrder` / `isTerminalOrderStatus`（SPEC §4.3，8 个状态）
  - submit 的 ownership 守卫 at action boundary + lib 重校（round 27 belt-and-suspenders）
  - 所有 read 走 `getOrderScopeFilter`（SALES/CS own / OWNER+FOREMAN all / WORKER 仅有任务的）
- **Slice B — 销售端 UI**
  - `/orders`, `/orders/new`, `/orders/[id]` 三页
  - `OrderForm` 用 RHF + `useFieldArray` 做多款式动态增删，Controller 包工艺 checkbox list
  - `OrderMutationResult` discriminated union + `useActionState` + 手动 `useTransition` 包
- **Slice C — OSS 直传脚手架**（rounds 29–33）
  - `lib/oss/config.ts readOssConfig` 返回 `{ configured: true, cfg }` / `{ configured: false, missing }`；`deriveBucketUrl` 从 `OSS_ENDPOINT` 派生（尊重 VPC / 自定义端口 / 拒 IPv6 / 拒已虚拟主机）
  - `lib/oss/sign.ts signDesignUpload` 做完校验 + 路径注入守卫后调用故意抛 `OssNotWiredError` 的 `signViaSts` 桩
  - `uploadUrl` 永远用 `bucketUrl`（虚拟主机），`publicUrl` 可以用 `publicBaseUrl`（CDN / 自定义域名）；CDN 绝不接受 PUT
- **Slice D — 打印 + PDF 双通道**（rounds 34–35）
  - `OrderPrintLayout` 纯组件 + `design-grid.ts` 纯分档函数（覆盖 SPEC 附录 E.2.1 的 6 档）
  - `/print/orders/[id]` 独立 top-level 段，`AutoPrint` client 组件按 `?autoprint=1` 分叉
  - `GET /api/orders/[id]/pdf` 进程内 `renderToStaticMarkup` + Puppeteer `setContent`（不本机 HTTP hop）
  - `lib/pdf/render.ts` 通用 HTML → PDF 包装（未来薪资单 / 账单共用）
- **Slice E (E-lean) — 编辑 / 急单 / OrderLog diff**（round 36 no findings）
  - `editable-fields.ts` 纯函数把状态分三档（FULL / SHIPPING_ONLY / NONE）
  - `updateEditableOrderSchema` 完全 partial；`optionalFormBoolean` 区分 undefined vs false
  - `pickEditableFields` 在 lib 层做 allowlist 二次过滤（防 action 层绕过）
  - 急单 toggle 是单独的 form + setOrderUrgentAction（不复用编辑表单，避免"保存"语义歧义）
  - OrderLog 按字段 diff 渲染（中文 label、状态枚举翻译、line-through before → after）

## 下一步具体指令（给下次 AI）

P0 #4 生产流程（预计 1 周）。开工前**必读**：

1. SPEC-v1.2.md §3.2（排产）、§3.3（师傅报工）、§3.4（生产计算）、§4.1（实体清单，尤其 `ProductionTask`）、§6.1（计件规则）、§6.2（日薪结算）
2. `prisma/schema.prisma` `ProductionTask` / `OutsourceOrder` 模型
3. 已建范式照抄：`lib/order.ts`（tx 模式、ownership 守卫、OrderLog 写入）、`lib/order/editable-fields.ts`（状态决定能力）

分解建议（按 CLAUDE.md §4.2 垂直切片）：

**Slice A — 排产**
- schemas: `schedulingCreateSchema`（一批 ProductionTask 一起生成）
- `lib/production.ts`: `createTasksForOrder(orderId, plan, actor)` —— 在 tx 内把 Order 从 SUBMITTED → SCHEDULING（状态机），对每个 `OrderItem` 按工艺生成 `ProductionTask` 行，快照 `machineType`
- actions: `scheduleOrderAction`（权限 `production:schedule`，只有 FOREMAN + OWNER）
- UI: `/foreman/scheduling` 列表 + 每个 SUBMITTED 工单的"排产"按钮 → 弹出派单抽屉（选师傅 / 机器）

**Slice B — 师傅手机 H5 报工**
- `/worker/tasks`（按 `getOrderScopeFilter` 的 WORKER 分支筛选）
- 扫 task 二维码（已在 print layout 生成）→ 跳 `/worker/tasks/[id]/report`
- `reportProduction(taskId, { completedQty, defectQty, reworkQty }, actor)` 在 tx 内算 `pieceworkAmount`、快照 `salaryRuleSnapshot`（CLAUDE.md §4.4 铁律）、切状态 PENDING→IN_PROGRESS 或 COMPLETED
- 报工时 Order 从 SCHEDULING → IN_PRODUCTION（第一个任务动起来时），所有任务 COMPLETED → Order COMPLETED

**Slice C — 外协单基础**
- `OutsourceOrder` 模型已在 schema；至少做 list + 创建（把一批 ProductionTask 指派给外协厂）
- 外协完工后人工回写报工

**Slice D — 薪资计算桩 + 单元测试**
- `lib/salary/machine-piecework.ts` 的纯函数可以先做（不接 DB），CLAUDE.md §8.5 已给了测试骨架（包括 `HAND_PRESS` / `WINDMILL` / 各种单双面双色组合）
- 这块是 P0 #5 的主体，但在 P0 #4 报工流程里要调用；提前起头能防 P0 #5 超工期

建议顺序 A → B → D → C；A 做完就能验证端到端（没有师傅报工也能看到 ProductionTask 生成），B 做完就能看到 `pieceworkAmount` 落地。

## 卡住的问题

- **工艺清单 v.s. SPEC**：seed 里 12 条与 SPEC §6.1 一致，业主实际业务里需要增减时自行在 `/owner/crafts` 调整。
- **ProductCategory 中文标签**：`lib/auth/role-labels.ts PRODUCT_CATEGORY_LABELS` 有 `TODO: 需业主确认`。业主过一眼 `/owner/products` 列表确认。
- **middleware.ts → proxy.ts**：Next 16 deprecation 警告。独立一次迁移 commit 解决，不阻塞。
- **CDR 预览 UX**：详情页看到 CDR 源文件时怎么处理？等真实上传流上线后再听业主反馈。

## 相关文件清单（下次 AI 必读）

- SPEC-v1.2.md §3.2-3.4（排产 / 报工 / 生产计算）、§4.1（`ProductionTask` 字段）、§6.1-6.2（计件规则 + 日薪）
- 已建范式（照抄）：
  - `lib/order.ts updateOrderFields` — tx + ownership + 状态门禁 + OrderLog 写入的组合拳
  - `lib/order/editable-fields.ts` — 纯函数按状态分档 + 白名单
  - `actions/order.ts setOrderUrgentAction` — 短小 Server Action + formData.get 校验
  - `components/business/order/EditOrderForm.tsx` — FormData + useActionState（无 RHF 的轻量路径）
- `components/business/order/OrderPrintLayout.tsx` — P0 #4 报工后可能需要刷新打印视图（任务表 + 师傅分配会实际有值）
- CLAUDE.md §4.4（快照化铁律，`salaryRuleSnapshot` 必写）、§4.5（状态机铁律）

## 约束提醒（本次任务特有 / 从 P0 #3 沿用）

- **薪资快照化（CLAUDE.md §4.4）**：P0 #4 报工时生成 `pieceworkAmount` **必须同步**把当时的 `SalaryRule` 完整序列化进 `salaryRuleSnapshot`。P0 #5 真正算工资时读快照，不回查 `SalaryRule.id`。
- **状态机 hard constraint（CLAUDE.md §4.5）**：`ProductionTask.status` 的任何流转必须走一个类似 `transitionProductionTask` 的函数（参考 `lib/order/status-machine.ts`）。禁止 action / page 里写 `data: { status: 'XXX' }`。
- **Order.status 联动**：第一个 ProductionTask 从 PENDING → IN_PROGRESS 时 Order 应当从 SCHEDULING → IN_PRODUCTION；所有 ProductionTask 进 COMPLETED 时 Order 应 → COMPLETED。别在每个报工 action 里重复写这个逻辑，抽到 lib。
- **WORKER 权限作用域**：`getOrderScopeFilter({ role: WORKER })` 已实现（通过 `items.some.tasks.some.workerId`）；师傅端的任何查询都走这个。不得让 WORKER 看到没分配给他的任务。
- **金额字段**：`pieceworkAmount` 是 `Decimal(10,2)`，用 `decimal.js` 算，不要用 `number` 乘法。
- **设计图数量大**：CDR 可能几十 MB → OSS 直传（P0 #3 Slice C 已脚手架，STS SDK 落地后生效）。P0 #4 不用碰文件流。

## 上次会话结束时间

2026-04-23

---

## 历史（追加式时间线）

- 2026-04-22：建立了项目记忆管理体系（PROGRESS / DECISIONS / HANDOFF + CLAUDE.md §13）。
- 2026-04-22 → 2026-04-23：完成 P0 #1 认证与用户管理全部切片（seed 硬化 + 认证基础 + 登录 + 自服务改密 + 老板管账号 CRUD）。16 个 feature/fix commits + 1 docs commit，149 单测，Codex 走了 15 轮 review。
- 2026-04-23：完成 P0 #2 工艺字典 + 产品字典。10 个 feature/fix commits，+100 单测（累计 249），Codex 9 轮 review。Round 24 统一修了三份字典的 "编辑页双 isActive 控件" 和 "create 后停留 /new" 两个通病。
- 2026-04-23：完成 P0 #3 工单核心（E-lean）。21 commits，+151 单测（累计 400），Codex rounds 25–36 共 9 轮（含 Slice A/B clean / C 3 轮修 / D 2 轮修 / E 一次过）。E-full（款式级编辑）延期到 P1。OSS 直传脚手架、打印 + PDF 双通道、工单编辑 + 急单 + OrderLog diff 全部落地。
