# 会话交接

> **每次新对话开始前，先读这份文件。** 它记录了上次会话停在哪、下次该接着做什么。
>
> 本文件每次 session 结束前**整体重写**（除"历史"小节是追加式时间线）。

---

## 当前任务

P0 #1（认证与用户管理）已完成。下一步：P0 #2（工艺字典与产品字典）。

## 已完成步骤（本次 session）

项目从脚手架走到了 P0 #1 全功能闭环：

- **Bootstrap**（d3ab602）：Next 16.2.4 + Prisma 7 + Auth.js v5 beta 搭建，seed 跑通。
- **Seed 硬化**（6c1865e → aa82d2c，5 轮 Codex review）：
  - 薪资规则 idempotent + 历史遗留 dedupe
  - 管理员种子改为环境变量驱动、收紧活跃/非活跃 OWNER 的各种 gate
- **认证基础**（881ed75）：lib/db、auth.config.edge/ts、session、permissions、middleware、vitest，31 个 permissions 单测。
- **登录页 + 开放重定向修复**（4f9cce4、d389222）：Zod schema、Server Action、`safeInternalPath` 拦 `//evil`。
- **自服务改密 + 登出 + 认证首页**（f50a354 + e0070f6 / 1b6011d / 8d07058，三轮密码策略收紧）：
  - bcrypt 72-byte 真实限制
  - Logout 降级为 Server Component 支持 JS-off
  - superRefine 合并两道 gate 避免 UTF-8 再分配
- **老板管账号**（ce0c425 + fc24700 + d663f49 + 6ef01fe，4 轮 review）：
  - lib/account.ts 完整 CRUD + 不变量（最后一位 OWNER、禁自改、禁自停）
  - PG advisory xact lock 把 last-OWNER guard 做成真原子
  - HTML checkbox 默认 `on` 语义通过 `z.preprocess` 统一
  - UI：列表 / 新建 / 编辑 / 改密 / 启停，带级联 role→workerType→machineType
  - Edit form 用 `updatedAt` 作 key 自动 remount
- **测试覆盖**：149 单测(schemas 32 + permissions 31 + lib/account 20 + actions/account 8 + actions/owner-accounts 16 + redirect 30 + schemas login+change 12)。
- **工作流升级**：发现 Codex review 可以 `codex exec -m gpt-5.4 -s read-only` 非交互驱动,不必人机往返(见 memory `workflow_codex_review`)。

## 下一步具体指令（给下次 AI）

1. 读 SPEC-v1.2.md §6（工艺-机器路由）、§4.2（关键字段 OrderItem）、附录 B（工艺清单初始化数据）。
2. 复核 `prisma/seed.ts` 的 `seedCrafts()`：12 条预置工艺是否与业主最终确认版一致（CHANGELOG 待确认事项 #1）。
3. 按垂直切片（CLAUDE.md §4.2）开 P0 #2 工艺字典 + 产品字典：
   - **Slice A**：工艺字典 CRUD（`Craft` 表；业主可增删改字段 `name / code / isOutsource / defaultMachineType / sortOrder / isActive`）。
   - **Slice B**：产品字典 CRUD（`Product` 表；分类、规格、纸张、`baseUnitPrice`、`minOrderQty`）。
   - **Slice C**（可选）：`PriceTier` 价格阶梯编辑（P1 可能延后）。
4. 权限统一走 `requirePermission('dict:craft:manage')` 或 `'dict:product:manage'`，仅 OWNER。
5. 每切片一个 commit，用 `codex exec -m gpt-5.4` 自审一轮，修完再提。
6. 结束前按 §13.2 更新本文件 + PROGRESS + DECISIONS（若有新决策）。

## 卡住的问题

- **工艺清单最终版**：`prisma/seed.ts` 现有 12 条工艺,等业主确认含义、是否外协、默认机器类型。在 P0 #2 开工前需要对一遍。
- **Next.js 16 `middleware.ts` → `proxy.ts` 迁移**：dev server 有 deprecation warning。TODO 放在 middleware.ts 注释里，未来单独一个迁移 commit。

## 相关文件清单（下次 AI 必读）

- `SPEC-v1.2.md` §6（工艺-机器路由）、§4.2（OrderItem crafts[]）、附录 B。
- `prisma/schema.prisma` `Craft` / `Product` / `PriceTier` / `PriceAdjustment`。
- `prisma/seed.ts` `seedCrafts()` 初始 12 条。
- `lib/account.ts` / `actions/owner-accounts.ts`：CRUD + 不变量 + Zod 的成熟范式可以照抄。
- `app/owner/accounts/**`：`owner/*` 路由组的 layout 守卫 + 级联表单范式。
- CLAUDE.md §4.6（权限统一入口）、§13（记忆管理）。

## 约束提醒（本次任务特有）

- 工艺字典的 `isOutsource=true` 意味着该工艺会触发外协单生成（SPEC §3.2）。字段改动要考虑对已有工单/生产任务的影响。
- 产品字典的 `baseUnitPrice` 是"建议价"参考,不参与账单计算（业主决定 DECISIONS.md 2026-04-22 "工单不含价格字段"）。
- `Craft.code` 在 seed 里是 `UPPER_SNAKE_CASE`,`Product` 没 code 约定,按 `category` + `name` 唯一即可。
- 删除动作按"软删除 `isActive=false`" 处理，不物理删除（保留历史工单引用）。

## 上次会话结束时间

2026-04-23

---

## 历史（追加式时间线）

- 2026-04-22：本次建立了项目记忆管理体系（PROGRESS / DECISIONS / HANDOFF + CLAUDE.md §13）。
- 2026-04-22 → 2026-04-23：完成 P0 #1 认证与用户管理全部切片（seed 硬化 + 认证基础 + 登录 + 自服务改密 + 老板管账号 CRUD）。共 15 个 feature/fix commit，149 单测，Codex 走了 15 轮 review。
