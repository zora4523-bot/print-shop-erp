# CLAUDE.md

> 本文档是 Claude Code / Codex 开发此项目时的**强制规范**。每次开始新任务前必读。

---

## 1. 项目身份

**项目名**：print-shop-erp
**类型**：红包印刷厂内部ERP系统

**业务规格**：见 `SPEC-v1.2.md`（权威文档，有冲突以它为准）。

---

## 2. 技术栈（固定，不改）

```
运行时：Node.js 24 LTS（Krypton，支持至2028-04-30）
全栈框架：Next.js 16（App Router + Server Actions）
语言：TypeScript 5.x（strict mode）
ORM：Prisma 7（rust-free client，generator = "prisma-client"）
数据库：PostgreSQL 16（通过 Pigsty 部署管理）
认证:  Auth.js v5（NextAuth v5，锁精确版本，不用 ^ 或 ~ 前缀）
UI：Tailwind CSS + shadcn/ui
表单：React Hook Form + Zod
状态：Server Components 优先，必要时用 useState
测试：
  - 单元测试：Vitest（node 环境，`vitest.config.ts`；184 个测试文件 / 2440 项）
  - 渲染/交互断言：Playwright（`tests/e2e`）+ 截图与响应式门禁（`tests/visual`）
后台任务：PostgreSQL 任务账本（`BackgroundJob`）+ PM2 light/heavy worker
可观测性：OpenTelemetry（instrumentation.ts） + Sentry（错误监控）
PDF生成：Puppeteer（headless Chrome 渲染打印视图；生产用系统 Chromium）
二维码：qrcode（**仅服务端**，预渲染 SVG 字符串注入；见 lib/order/qr.ts）
部署：阿里云 ECS + PM2（web + light worker + heavy worker）+ Nginx
文件存储：阿里云 OSS（直传方案，签发 STS token 由前端直接上传）
包管理：pnpm
```

**版本锁定策略**：
- Node、Next、Prisma、Auth.js 全部锁精确版本（如 `"next": "16.2.4"` 而非 `"next": "^16.2.4"`）
- 其他依赖用 caret（`^`）允许 patch 和 minor 更新
- 升级通过 PR 走，不让 Renovate 或 Dependabot 自动合并主要版本

**关于 Pigsty**：
- Pigsty 是 PostgreSQL 的部署管理工具，对应用层完全透明
- Prisma 连接字符串指向 Pigsty 管理的 PG 实例即可，schema.prisma 无任何差异
- 推荐启用扩展：`pg_cron`（定时任务）、`pg_stat_statements`（慢查询监控）
- 备份用 Pigsty 自带的 `pgbackrest`，不要自己写备份脚本
- **本项目使用独立的 Pigsty 实例，独立部署、独立运维**

**关于 Docker**：
- 现状：仓库**没有** `Dockerfile` / `docker-compose.yml`，部署全部走 PM2（`deploy/ecosystem.config.cjs`）
- 想切 Docker 需先获业主拍板，不要顺手补一个 Dockerfile

**明确不用**：
- ❌ Redux / Zustand / Jotai（Server Components替代）
- ❌ tRPC（Server Actions替代）
- ❌ GraphQL
- ❌ Docker（单机部署用pm2足够）
- ❌ Redis / Memcached（MVP阶段不需要）
- ❌ 外部消息队列（已用 PostgreSQL 任务账本 `BackgroundJob` + PM2 worker + cron 替代，见 §15.4）
- ❌ 任何微服务架构

---

## 3. 目录结构（严格遵守）

```
print-shop-erp/
├── app/                          # Next.js App Router（页面层）
│   ├── (auth)/login/             # 登录
│   ├── (admin)/                  # 后台工作台外壳（侧边栏/面包屑/header）
│   │   ├── owner/                # ADMIN only（字典、价格、薪资、账单、运维…）
│   │   ├── foreman/              # ADMIN only（排产、外协、考勤、CDR、领料）
│   │   ├── orders/               # ADMIN + SALES + CUSTOMER_SERVICE
│   │   └── sales/                # 外部 SALES only（应收、报价）
│   ├── (worker)/worker/          # 师傅端 H5（WORKER only，独立外壳）
│   ├── api/                      # cron / health / cdr / 客户端数据层路由
│   ├── print/orders/[id]/        # 打印视图（Puppeteer 渲染源）
│   └── dev/showcase/             # 设计系统演示页（非业务）
├── actions/                      # Server Actions（业务编排层）
│   ├── order.ts                  # 'use server'，只能导出 async 函数
│   └── order.types.ts            # 配套返回类型（'use server' 不能导出类型）
├── components/
│   ├── ui/                       # shadcn 原子件（唯一允许 Tailwind 调色板字面量的目录）
│   ├── ui-business/              # 跨领域业务原子件（PageHeader/StatCard/StatusBadge…）
│   └── business/<领域>/          # 业务组件（order、salary、price、admin…）
├── lib/                          # 核心业务逻辑层（Prisma 调用集中于此）
│   ├── db.ts                     # Prisma client 单例（唯一的 Prisma 入口）
│   ├── auth/                     # config / session / permissions / permissions-dict / schemas
│   ├── admin/                    # action-helpers（MutationResult 契约）、table（分页排序）
│   ├── salary/  order/  price/  bill/  production/  outsource/
│   ├── background-jobs/          # 持久化任务账本 + worker + handler registry
│   ├── cron/  notification/  oss/  pdf/  cdr/  export/  dashboard/  navigation/
│   └── __tests__/                # 领域根模块（lib/order.ts 等）的测试
├── generated/prisma/             # Prisma 7 生成产物（gitignore 外的生成目录，勿手改）
├── instrumentation.ts            # OTel + Sentry 初始化入口
├── prisma/{schema.prisma,migrations/,seed.ts}
├── scripts/                      # background-worker、check-env、deploy-smoke、agent-next-task
├── deploy/                       # PM2 ecosystem、nginx、crontab 样例、update.sh
├── tests/{e2e,visual,integration}/
├── docs/                         # 运维 runbook、admin 框架计划、agent backlog
├── _reference/                   # 只读样板，已被 eslint/vitest/tsc 排除
├── SPEC-v1.2.md  CLAUDE.md  AGENTS.md  HANDOFF.md  PROGRESS.md  DECISIONS.md
└── package.json
```

> `AGENTS.md` 是硬约束：本仓库的 Next.js 16 与训练数据差异较大，**动 App Router 相关代码前先读
> `node_modules/next/dist/docs/` 里的对应文档**，不要凭记忆写。

**三层架构约束**（简化版，独立开发者友好）：

- **页面层（app/）**：只关心UI渲染和路由，**禁止直接调用 Prisma**
- **编排层（actions/）**：Server Actions，处理用户操作，调用 lib/ 完成业务，**第一行必须调用权限检查**（通过 `lib/auth/permissions.ts` 的统一入口）
- **业务层（lib/）**：纯业务逻辑，Prisma 的所有直接调用**集中在这一层**

**Repository 单独分层不强制**，但严格要求调用方向：`app → actions → lib → Prisma`，不得倒置，不得跨层。具体来说：

- Prisma import 不得出现在 `app/` 和 `actions/` 以外的页面/组件文件中
- `actions/` 中可以 import Prisma，但应委托给 `lib/` 的函数处理复杂业务
- `components/` 中不得有任何数据库调用
- 现状：`db` 的直接使用集中在 `lib/`（约 60 个文件）；`actions/` 与 `app/api/health/*` 只有极少数遗留直连，新代码不要扩大这个口子

**Prisma 生成物的 import 约定**（易踩坑）：

```typescript
// ✅ 只要枚举 —— 零副作用，测试/导航/纯函数模块都能安全 import
import { OrderStatus, Role } from '../../generated/prisma/enums';

// ✅ 需要 PrismaClient / Prisma 命名空间类型时才用 client
import type { Prisma } from '../../generated/prisma/client';
```

`generated/prisma/client` 会拉入运行时；纯逻辑模块只 import `/enums`，否则 vitest（node 环境）
和客户端组件会被动加载整个 client。仓库里两种相对路径与 `@/generated/...` 并存，**跟随所在目录
的既有写法**即可。

---

## 4. 开发铁律（违反即重做）

### 4.1 每次开始任务前必读

1. `SPEC-v1.2.md` 的相关章节
2. 本文件（CLAUDE.md）
3. 如涉及数据库：`prisma/schema.prisma`
4. 如涉及已有代码：相关`lib/`模块的`__tests__/`
5. `HANDOFF.md`（如存在）—— 上次会话留下的接力棒，本次任务的起点
6. `PROGRESS.md` —— 当前阶段与下一步
7. `DECISIONS.md` 最近 3-5 条 —— 最新已拍板的决策（避免和已有决策冲突）

### 4.2 垂直切片开发

**禁止**：先建所有数据表 → 再建所有API → 再建所有前端。
**必须**：一次只做一个完整功能的端到端（schema → server action → UI → 测试）。

### 4.3 业务逻辑必须有测试

**100% 覆盖是有门禁的硬指标**，范围限定在「算错就是发错钱 / 绕过状态流转」的纯函数
（业主 2026-08-19 拍板；阈值配在 `vitest.config.ts` 的 `coverage.thresholds`，
`pnpm vitest run --coverage` 不达标即 exit 1）：

- `lib/salary/machine-piecework.ts`：机台计件
- `lib/salary/cs-commission.ts`：客服提成
- `lib/salary/hourly-payroll.ts`：时薪月结
- `lib/**/status-machine.ts`：全部状态机（order / production / bill / outsource / cs）

`lib/**` 的其余部分（多为读路径与管理 CRUD）设**当前水位**阈值，只防倒退、不强求 100%。
水位随实测调整，抬高可以、调低要说明理由。

**测试必须覆盖边界case**：
- 小单（<1000）、超大单
- 单面单色、双面单色、单面双色、双面双色
- 客服业绩在档位边界（刚好10万、9.99万、10.01万）
- 客服业绩超过最高档（100万以上）
- 师傅当日无任务、请假全休

### 4.4 薪资规则快照化（铁律）

**凡是生成薪资记录时，必须把当时的规则快照写入记录**。

```typescript
// ✅ 正确
async function completeTask(taskId: string, ...) {
  const task = await db.productionTask.findUnique({ where: { id: taskId }, include: { worker: true } });
  const rule = await db.salaryRule.findActive(task.worker.machineType);
  const piecework = calcPiecework(task, rule);
  
  await db.productionTask.update({
    where: { id: taskId },
    data: {
      pieceworkAmount: piecework,
      salaryRuleSnapshot: JSON.stringify(rule),  // ← 必须！
      status: 'COMPLETED',
      completedAt: new Date(),
    }
  });
}

// ❌ 错误：没有快照
await db.productionTask.update({
  where: { id: taskId },
  data: { pieceworkAmount: piecework, status: 'COMPLETED' }
});
```

### 4.5 状态机硬约束

工单/任务/周期的状态流转必须通过**状态机函数**，禁止裸写`status: 'XXX'`。

**批量路径是显式例外**（业主 2026-08-19 拍板）：`lib/production.ts` 的 `beginTasks` /
`reportTasks` 用 `where: { status: <前置状态> }` 在 SQL 层表达同一个守卫，换取单条语句的
原子批量更新——逐行调用状态机会迫使先查后写、丢掉原子性。代价是没有编译期保障，改这两处时
必须自己维持 `where` 子句与转换表一致。单条路径（`beginTask` / `reportTask`）不适用本例外。

```typescript
// lib/order/status-machine.ts
export function transitionOrder(order: Order, targetStatus: OrderStatus) {
  const allowedTransitions = ORDER_TRANSITIONS[order.status];
  if (!allowedTransitions.includes(targetStatus)) {
    throw new InvalidStateTransitionError(order.status, targetStatus);
  }
  return targetStatus;
}
```

### 4.6 权限检查（必须走统一入口）

所有 Server Action 第一行必须调用 `lib/auth/permissions.ts` 中的权限函数，**禁止**在 Server Action 内部自己写 `if (session.role !== ...)` 这类散落检查。

```typescript
// ❌ 错误：散落在 Server Action 内部
'use server';
export async function createOrder(data: OrderInput) {
  const session = await getSession();
  if (!session || !['SALES', 'CUSTOMER_SERVICE'].includes(session.user.role)) {
    throw new UnauthorizedError();
  }
  // ...
}

// ✅ 正确：走统一入口
'use server';
import { requirePermission } from '@/lib/auth/permissions';

export async function createOrder(data: OrderInput) {
  const user = await requirePermission('order:create');
  // ...
}
```

**权限定义集中在 `lib/auth/permissions.ts`**，所有权限常量、角色-权限映射、资源所有权判断都在这个文件里。修改权限规则只改一处。

**新增权限时的流程**：
1. 在 `permissions.ts` 的权限字典里新增 key（如 `'order:shipment:update'`）
2. 在角色-权限映射表里声明哪些角色有此权限
3. 在 Server Action 里用 `requirePermission('order:shipment:update')`
4. 如涉及资源所有权（如"只能改自己的工单"），调用 `requireOwnership(resource, user)`

**禁止**：在 `components/` 或 `app/` 的 JSX 中做权限判断来显示/隐藏按钮。正确做法是在 Server Component 里预先判断权限、传给 Client Component 一个 boolean 属性。

**三类例外**（实测 99 个 Server Action 中恰好 3 个，全部合理，不要"修复"它们）：

1. **鉴权入口本身**：`actions/auth.ts` 的 `signInWithCredentials` —— 登录前定义上没有 session。
2. **自助操作**：`actions/account.ts` 的 `changeMyPassword` / `signOutAction` —— 只作用于调用者
   自己，用 `lib/auth/session.ts` 的 `requireSession()` 而不是权限字典。权限字典里没有也不该有
   `account:self` 这类 key（这三条正是 §15.8 单列的零 JS 硬约束路径）。
3. **纯签名适配层**：如 `actions/production.ts` 的 `beginTaskFormAction`，函数体只是
   `return beginTaskAction(taskId)`，真闸口在被调方。这类必须在注释里写明闸口在哪。

### 4.7 金额处理

**所有金额使用 Prisma Decimal 或 integer (分为单位)**，禁止用 float/number。

```typescript
// ✅ 正确
amount: Decimal   // Prisma
amount: number    // 以分为单位的整数

// ❌ 错误
amount: 12.34     // JS float 精度问题
```

---

## 5. 命名约定

### 5.1 数据库

- 表名：PascalCase 单数（`Order`、`ProductionTask`）
- 字段名：camelCase（`orderNo`、`isDoubleSided`）
- 枚举：SCREAMING_SNAKE_CASE（`DRAFT`、`IN_PROGRESS`）
- 外键：`xxxId`（`orderId`、`workerId`）

### 5.2 代码

- 文件名：kebab-case（`machine-piecework.ts`）
- 组件文件：PascalCase（`OrderList.tsx`）
- React组件：PascalCase
- 函数：camelCase。**执行动作的**用动词开头（`calcPiecework`、`transitionOrder`、`settleCsPeriod`）；
  **纯 getter / 派生值**可以用名词短语，仓库已有三个成建制的族，跟随即可：
  `<x>Label`（`roleLabel`、`billStatusLabel`…）、`<x>LockKey`（`salaryRuleLockKey`…）、
  上海时钟（`todayShanghai`、`currentShanghaiMonth`…）
- 常量：SCREAMING_SNAKE_CASE
- 类型：PascalCase，接口不加`I`前缀

### 5.3 业务概念中英对照

| 中文 | 英文 | 备注 |
|---|---|---|
| 工单 | Order | — |
| 款式 | OrderItem | — |
| 生产任务 | ProductionTask | — |
| 外协单 | OutsourceOrder | — |
| 工艺 | Craft | 不用Process（混淆） |
| 双面 | isDoubleSided | — |
| 双色 | isDoubleColor | — |
| 板数 | boardCount | — |
| 下数 | pressCount | — |
| 急单 | isUrgent | — |
| 合格数 | completedQty | — |
| 不良数 | defectQty | — |
| 返工数 | reworkQty | — |
| 计件 | piecework | — |
| 保底 | dailyBase | — |
| 业绩周期 | SalaryPeriod | 客服专用 |

---

## 6. Git 工作流

### 6.1 分支

- `main`：受保护，只接受PR合入
- `dev`：日常开发主干
- `feature/xxx`：功能分支

### 6.2 Commit Message

格式：`type(scope): subject`

types: `feat`、`fix`、`refactor`、`test`、`docs`、`chore`

示例：
- `feat(order): add urgent flag`
- `fix(salary): correct double-color multiplier for windmill`
- `test(salary): add edge cases for small order protection`

### 6.3 提交规则

- 每完成一个小任务就commit，禁止大块commit
- 每次commit前运行 `pnpm lint`、`pnpm typecheck`、`pnpm test run`（**注意 `run`**，见 §14）
- 不允许commit `console.log`（除日志工具内）

---

## 7. 推送模块约定

### 7.1 不要在业务代码里直接调用Webhook

```typescript
// ❌ 错误
fetch(webhookUrl, { method: 'POST', body: JSON.stringify(...) });

// ✅ 正确
import { notify } from '@/lib/notification';
await notify('ORDER_SUBMITTED', { orderId: order.id });
```

`notify()`内部处理：查推送规则 → 渲染模板 → 发Webhook → 写日志 → 失败重试。

### 7.2 推送事件枚举

事件类型的**权威定义**在 `lib/notification/events.ts` 的 `NOTIFICATION_EVENTS`。

**调用时直接写字符串字面量是推荐写法**，不要改成 `NOTIFICATION_EVENTS.ORDER_SUBMITTED`：

```typescript
// ✅ 推荐
await dispatchNotification('ORDER_SUBMITTED', { orderId, orderNo, submitterName });
```

两个理由，都不是风格问题：

1. **字面量已经受类型约束**。`dispatchNotification<E extends NotificationEvent>(event: E,
   payload: NotificationPayloadFor<E>)` —— 事件名既被字典收窄，又是驱动 payload 逐事件推断
   的泛型实参。写错事件名或漏写 payload 字段，`tsc` 当场报错（实测：传
   `'NOT_A_REAL_EVENT'` → `TS2345: not assignable to parameter of type 'NotificationEvent'`）。
2. **字面量在改事件名时更安全**。这些 value 是 `NotificationRule` / `NotificationLog.eventType`
   的数据库行值。改 `NOTIFICATION_EVENTS.X` 的 **value** 时，字面量写法会让全部调用点 tsc 报错、
   逼你写 migration；用常量引用反而全绿，线上事件名静默漂移、旧规则失配。

`NOTIFICATION_EVENTS` 常量用在**遍历/白名单**场景（admin 配置页、background-jobs 的类型校验），
不用在调用点。

---

## 8. 测试要求

本项目采用**四层测试体系**：单元测试 → 组件测试 → E2E测试 → 截图回归。

### 8.1 单元测试（Vitest）

**必须测试**：
- 所有 `lib/salary/*` 模块的算法（100%覆盖）
- 所有 `lib/order/status-machine.ts` 状态机
- 所有 `lib/auth/permissions.ts` 权限函数
- 关键计算函数（板数/下数、业绩档位查询）

**可以不测**：
- UI组件的样式
- 简单的CRUD Server Action（但要有集成测试）

### 8.2 组件/渲染测试

**现状（与早期计划不同，以此为准）**：`vitest.config.ts` 只有 node 环境，**没有启用 Browser
Mode**。组件层的验证分两处落地：

- **纯逻辑部分用 Vitest**：Zod schema 校验、报工数量约束、打印布局的网格计算、导航菜单与权限
  相关的可见性推导 —— 抽成纯函数放 `lib/`，在 node 环境测。
- **SSR markup 断言也用 Vitest**（第三种形态，20 个测试文件在用）：`renderToStaticMarkup` +
  `vi.mock('react')` 注入 `useActionState` 状态，断言渲染出的 HTML。用于**Playwright 结构上够
  不到**的场景 —— 典型是逐字段错误的 aria 连线：错误 DOM 只在提交失败后存在，而 `tests/visual`
  的 axe 门禁断言的是页面加载态，那条路径它一次都走不到。
  见 `components/business/order/__tests__/EditOrderForm.aria.test.tsx`。
- **真实渲染用 Playwright**：`tests/visual/` 在真实 Chromium 下跑截图、响应式裁切/溢出/触控目标
  与 axe 无障碍门禁（6 视口 × 明暗模式）。

新增 UI 时**不要**自己去开 Vitest Browser Mode；要么把逻辑抽纯函数，要么加 Playwright 断言。

### 8.3 E2E测试（Playwright）

**必须覆盖的关键路径**：
1. 销售创建工单 → 车间主管排产 → 师傅报工 → 工单完工 → 发货
2. 客服4月周期结算（需要 mock 时间推进）
3. CDR打包下载流程
4. 工单修改的权限控制（不同角色、不同状态下的允许/拒绝）
5. 企业微信推送触发（mock Webhook）

### 8.4 截图回归（Playwright Visual Regression）

**必须覆盖**：
- 工单打印视图（1/2/3/5/10张设计图的各版本）
- 急单打印视图
- 老板Dashboard
- 师傅报工界面

Playwright 命令：`toHaveScreenshot()`。首次运行生成基线，后续对比；发现像素差异自动 fail。

截图基线存在 `tests/visual/<spec 名>.spec.ts-snapshots/`（如 `order-print.spec.ts-snapshots/`），
是 Git 版本控制的一部分。`admin-responsive` / `worker-responsive` 走的是断言式门禁（裁切、溢出、
触控目标、axe），不落基线图。布局变更时，**主动更新截图基线必须在 commit message 里说明**：
```
feat(print): adjust design grid spacing for 5-6 designs

[visual-regression] updated screenshots for order-print-5-designs.png
```

### 8.5 算法测试示例

```typescript
// lib/salary/__tests__/machine-piecework.test.ts
describe('calcMachinePiecework', () => {
  describe('HAND_PRESS', () => {
    const rule = { pieceRate: 0.007, boardRate: 5, smallOrderThreshold: 1000, 
                   smallOrderFlatPrice: 12, multiplierFactors: ['DOUBLE_SIDED', 'DOUBLE_COLOR'] };
    
    it('small order returns flat price', () => {
      const task = { quantity: 500, itemCount: 1, isDoubleSided: false, isDoubleColor: false };
      expect(calcMachinePiecework(task, rule)).toBe(12);
    });
    
    it('single side single color', () => {
      const task = { quantity: 5000, itemCount: 1, isDoubleSided: false, isDoubleColor: false };
      // 1×5 + 5000×0.007 = 5 + 35 = 40
      expect(calcMachinePiecework(task, rule)).toBe(40);
    });
    
    it('double side double color', () => {
      const task = { quantity: 5000, itemCount: 1, isDoubleSided: true, isDoubleColor: true };
      // 4×5 + 20000×0.007 = 20 + 140 = 160
      expect(calcMachinePiecework(task, rule)).toBe(160);
    });
  });
  
  describe('WINDMILL', () => {
    const rule = { pieceRate: 0.01, boardRate: 0, smallOrderThreshold: 1000,
                   smallOrderFlatPrice: 20, multiplierFactors: ['DOUBLE_COLOR'] };
    
    it('does not multiply by double sided', () => {
      const task = { quantity: 5000, itemCount: 1, isDoubleSided: true, isDoubleColor: false };
      // 风车机不看双面，5000×0.01 = 50
      expect(calcMachinePiecework(task, rule)).toBe(50);
    });
    
    it('multiplies by double color only', () => {
      const task = { quantity: 5000, itemCount: 1, isDoubleSided: true, isDoubleColor: true };
      // 10000×0.01 = 100
      expect(calcMachinePiecework(task, rule)).toBe(100);
    });
  });
});
```

---

## 9. 遇到问题怎么办

### 9.1 业务规则不清楚

**绝对禁止**：自己猜测业务逻辑继续开发。

**正确做法**：
1. 查 `SPEC-v1.2.md` 相关章节
2. 查本项目其他已实现模块的参考
3. 如仍不确定，**停下来，在commit message或PR描述里写TODO，标注"需业主确认"**，不要继续写

### 9.2 技术方案有多种选择

按本文档"技术栈"章节已固定的方案执行。如确实需要引入新依赖：
1. 说明理由（现有方案为什么不够）
2. 评估替代方案
3. 等业主拍板，不自行引入

### 9.3 SPEC和现有代码冲突

**SPEC为准**，更新代码。同时在`CHANGELOG.md`中记录冲突点和解决方式。

---

## 10. 每次任务完成自检清单

提交前，逐项检查：

- [ ] 代码通过 `pnpm lint`
- [ ] 代码通过 `pnpm typecheck`
- [ ] 代码通过 `pnpm test run`
- [ ] 涉及薪资/状态机的改动有对应测试
- [ ] 没有`console.log`泄漏
- [ ] 没有硬编码的业务常量（应从SalaryRule/Setting读取）
- [ ] Server Action有权限检查
- [ ] 金额字段用Decimal或integer
- [ ] 数据库改动有对应migration
- [ ] 涉及快照的地方已写入snapshot字段
- [ ] commit message符合规范

---

## 11. Claude Code 与 Codex 分工建议

**Claude Code**：
- 功能开发（写新代码、写新测试）
- 数据库schema变更
- 状态机和业务逻辑

**Codex**：
- Code Review（读Claude Code的产出，找问题）
- 补充测试用例
- 重构和优化

两者配合时，Codex的review意见优先于Claude Code的初始决定，除非Claude Code能明确解释为何不采纳。

---

## 12. 紧急情况

**禁止在未经业主确认的情况下**：
- 删除数据库
- 重置migration
- 修改生产数据
- 连接或调用任何未在本项目SPEC中声明的外部系统
- 发送真实的企业微信推送（开发期用mock webhook）
- 发送真实邮件/短信

任何涉及"生产环境"的操作，必须先获得业主明确授权。

---

## 13. 记忆管理与交接

为解决 Claude Code / Codex 跨对话无记忆的问题，项目根目录维护三份**状态文档**，由人 + AI 共同维护：

| 文档 | 节奏 | 写入策略 |
|---|---|---|
| `HANDOFF.md` | 每次会话**结束前**整体重写 | 把"下次接着做什么"写清楚 |
| `PROGRESS.md` | 完成模块/阶段切换时更新 | 勾选已完成、移动进行中、刷新下一步 |
| `DECISIONS.md` | 出现**新的关键决策**时追加 | 不删旧条目，只追加新条目 |

### 13.1 每次对话开始前（必做）

1. 读 `HANDOFF.md` —— 拿到本次任务起点和约束
2. 读 `PROGRESS.md` —— 确认整体进度和待澄清问题
3. 扫 `DECISIONS.md` 最近 3-5 条 —— 避免和已拍板的决策冲突

### 13.2 每次对话结束前（必做）

1. **更新 `HANDOFF.md`**：当前任务、已完成步骤、下一步具体指令、卡住的问题；在 `## 历史` 追加一行 `- YYYY-MM-DD：<本次主要产出>`
2. 如有阶段性进展，**更新 `PROGRESS.md`** 的"已完成"和"下一步"
3. 如本次产生了**新的关键决策**，追加到 `DECISIONS.md`（按二级标题 `## YYYY-MM-DD：<标题>` 格式，包含决策/理由/影响/相关文档四行）

### 13.3 提交纪律

- 每完成一个小任务即 commit；commit message 引用 SPEC 章节，例：
  - `feat(order): add urgent flag (SPEC §4.2)`
  - `fix(salary): correct windmill double-color multiplier (SPEC §6.3)`
- 三份记忆文档的更新可单独 commit，type 用 `docs`，scope 用 `memory`，例：
  - `docs(memory): handoff after P0-1 auth scaffolding`
  - `docs(memory): record decision on Pigsty extension whitelist`

### 13.4 不确定业务规则时

**禁止猜测**（重申 §9.1）。改为：

1. 在涉及代码处写 `// TODO: 需业主确认 —— <具体问题>`
2. 把同一问题追加到 `HANDOFF.md` 的"卡住的问题"
3. 同一问题也追加到 `PROGRESS.md` 的"待澄清的业务问题"
4. 暂停该子任务，转下一项或结束会话

---

## 14. 命令速查

```bash
pnpm dev                     # 开发服务器（:3000）
pnpm build                   # 生产构建
pnpm typecheck               # tsc --noEmit
pnpm lint                    # eslint（flat config，全仓库）

pnpm test run                # 单测跑一遍就退出 ← agent 必须用这个
pnpm test                    # 交互式 watch，会挂住不返回，agent 不要用
pnpm test run lib/salary     # 只跑某个目录
pnpm test run lib/salary/__tests__/machine-piecework.test.ts   # 只跑单个文件
pnpm test run -t "double color"                                # 按用例名过滤
pnpm vitest run --coverage   # 覆盖率（只统计 lib/**，见 vitest.config.ts）

pnpm test:e2e                        # Playwright（tests/e2e + tests/visual）
pnpm test:e2e -- tests/e2e/order-create.spec.ts   # 单个 spec
pnpm test:e2e:install                # 首次装 chromium
pnpm test:admin-ui / pnpm test:worker-ui          # 只跑响应式门禁
pnpm test:visual:update              # 更新截图基线（改动须写进 commit message，见 §8.4）

# ⚠️ 不要给 tests/visual 或 tests/e2e 加 --workers！
#    playwright.config.ts 里的 `workers: 1` + `fullyParallel: false` 是为
#    「所有 spec 共用同一个开发库」刻意设的（配置里就有这行注释）。加并发
#    后 tests/e2e/_helpers.ts 的 login() 会随机 `waitForURL` 超时——实测
#    --workers=4 下 56 个用例里 16 个失败，其中 15 个是这种登录竞争，看起来
#    像业务代码坏了，实际只是跑法不对。串行同一份代码是 55/56。
#    唯一已知安全的例外是 package.json 里 test:admin-ui / test:worker-ui
#    自带的 --workers=4：它们只跑单个 spec，不和别的 spec 抢库。

pnpm db:migrate              # prisma migrate dev
pnpm db:seed                 # prisma db seed（tsx prisma/seed.ts）
pnpm db:studio               # Prisma Studio
pnpm exec prisma generate    # 重新生成 generated/prisma
pnpm exec prisma validate    # schema 语法/关系校验（提交前建议跑）

pnpm check:env               # 部署前环境变量门禁
pnpm check:backup            # pgBackRest 只读就绪检查
pnpm deploy:smoke            # 部署后 smoke
pnpm agent:next              # 从 docs/AGENT-BACKLOG.md 取下一个任务并打印 prompt

pnpm worker:light            # 本地手动跑 LIGHT 队列 worker
pnpm worker:heavy            # 本地手动跑 HEAVY 队列 worker（CDR/PDF/XLSX）
```

**E2E 前置**：Playwright 复用已在 `:3000` 跑的 dev server（没有就自己拉起），并共用开发库；
`tests/e2e/global-setup.ts` 会幂等 upsert 各角色测试账号（密码见该文件的 `E2E_PASSWORD`）。

---

## 15. 架构现状速查（读代码前先看这里）

### 15.1 角色只有 4 个

`Role = ADMIN | SALES | CUSTOMER_SERVICE | WORKER`（`prisma/schema.prisma`）。
原「老板 OWNER」与「车间主管 FOREMAN」已合并为唯一的 **ADMIN**（DECISIONS 2026-07-19）。
`/owner/*` 与 `/foreman/*` 只是保留的 URL 分区，两者都是 ADMIN only；`/sales/*` 是外部 SALES
only（把内部客服挡在外部应收之外）。SPEC 里的「老板 / 主管」是业务称谓，不是角色枚举。

### 15.2 会话与权限是三道防线

1. **JWT 只是乐观提示**：`lib/auth/session.ts` 的 `getVerifiedSession()` 每次都回库查当前账号，
   停用/改岗立即生效（DECISIONS 2026-07-31）。`getSession()` 用 React `cache` 把解码 + 主键查询
   收敛到一次渲染/一次 action 内。
2. **Layout 只挡 UI 外壳**：`app/(admin)/layout.tsx` 及各角色子 layout 做 redirect，属于纵深防御，
   **不是授权**。
3. **授权在 action/route 层**：Server Action 第一行 `requirePermission('xxx')`（§4.6）；
   Route Handler 用 `auth(handler)` 包装后走 `requireSessionPermission(perm, request.auth)`
   —— 在裸 route handler 里调零参 `auth()` 会丢 Next 的 request 上下文。

权限字典拆成两个文件：`lib/auth/permissions-dict.ts`（**纯数据、零副作用**，测试/导航可安全 import）
与 `lib/auth/permissions.ts`（检查函数 + re-export）。新增权限改前者。

### 15.3 Server Action 的固定形状

```typescript
'use server';
export async function createProductAction(
  _prev: ProductMutationResult | null,
  formData: FormData,
): Promise<ProductMutationResult> {
  await requirePermission('dict:product:manage');          // 1. 权限（§4.6）
  const parsed = createProductSchema.safeParse(normalize(formData));  // 2. Zod
  if (!parsed.success)
    return { status: 'invalid', fieldErrors: collectFieldErrors(parsed.error.issues) };
  try {
    await createProduct(parsed.data);                      // 3. 委托 lib/
  } catch (err) {
    const unique = mapPrismaUniqueViolation(err, PRODUCT_UNIQUE_VIOLATIONS);
    if (unique) return unique;                             // 4. 已知错误 → 字段错误
    if (err instanceof ProductInvariantError) return { status: 'error', message: err.message };
    throw err;                                             // 未知错误必须继续抛
  }
  revalidatePath(...); redirect(...);                      // 5. 失效 + 跳转
}
```

- 返回类型统一是 `MutationResult`（`success | invalid | error`），**类型定义放
  `actions/<x>.types.ts`** —— `'use server'` 模块只能导出 async 函数，类型不能同文件导出。
- 复用 `lib/admin/action-helpers.ts`：`collectFieldErrors`（扁平表单）/ `collectFieldErrorsDeep`
  （含数组、嵌套，路径展平成 `items.0.quantity`）、`mapPrismaUniqueViolation`、`revalidatePaths`。
  两个 collect 家族**不可互换**：给嵌套表单用 shallow 会丢掉行级定位。
- Zod schema 集中在 `lib/auth/schemas.ts`。
- 列表页分页/排序/筛选用 `lib/admin/table.ts` 的解析器，不要各页自己 parse searchParams。

### 15.4 后台任务与 cron

- `BACKGROUND_JOBS_MODE`：生产默认 `durable`，dev/test 默认 `inline`（`lib/background-jobs/mode.ts`）。
  durable 模式下通知、cron、CDR 打包、PDF、XLSX 导出先落 `BackgroundJob` 账本，由 PM2 的
  light/heavy worker 领取执行；heavy 队列（CDR/PDF/导出）并发固定 1。
- 入队必须带 `dedupeKey`；任务类型用 `BACKGROUND_JOB_TYPES` 常量，不写字符串字面量。
- 8 个 `/api/cron/*` 端点用 `requireCronAuth(req)` 校验 `Authorization: Bearer $CRON_SECRET`；
  未配置 secret → 503（部署漏配时快速失败）。响应形状对外部调度器是契约，不要改。
- handler 抛未知异常时必须**携带部分进度重抛**，让 durable job 重试，绝不把漏算的批次标成成功。

### 15.5 金额与规则快照的实现细节

- §4.4 的快照铁律在 schema 里落地为 `salaryRuleSnapshot` / `pricingSnapshot` /
  `roleSnapshot` / `workerTypeSnapshot` / `submitterRole` 等字段 —— 派工、报工、结算、报价
  都要写。
- 规则由多行独立版本组成（`SalaryRule` 按 `(ruleType, ruleKey, effectiveFrom)` 版本化，
  价格由 `Product.baseUnitPrice + PriceTier + PriceAdjustment` 共同构成）。为避免快照跨越管理员
  改规则的瞬间，读用共享 advisory lock、写用独占 advisory lock：
  `lib/salary/rules.ts` 与 `lib/price/rule-snapshot-lock.ts`。**新增读取规则的结算路径必须把
  事务 client（`tx`）传进去，用同一把锁**，不要用全局 `db` 读。
- 没有生效规则时**拒绝继续**，绝不 fallback 到 0 —— 静默按 0 发工资/报价是本项目的头号事故。
  **唯一显式例外**：厨师的空闲打包时薪（`lib/salary/hourly-aggregate.ts` 的
  `cookSpareRate ?? 0`）。空闲打包对厨师是可选职责，没配 `COOK_SPARE_HOURLY` 更可能表示
  「这个厨师不打包」而非配置遗漏，所以按 0 计空闲工资而不是让整个月结失败。同一 if/else 里
  PACKER / CLEANER / COOK_MONTHLY 三个分支**仍然全部 throw**。业主 2026-08-19 拍板，行为由
  `lib/salary/__tests__/hourly-payroll.test.ts:186` 锁定 —— 别当 bug 修掉。

### 15.6 设计系统门禁（eslint 会 fail）

`app/**`、`components/business/**`、`components/ui-business/**` **禁止 Tailwind 调色板字面量**
（`bg-amber-50`、`text-emerald-600` …），必须用 `app/globals.css` 里的语义 token：
`bg-primary` / `bg-warning/10` / `text-success` / `border-info/40`。
只有 `components/ui/`（shadcn 原子件）豁免。规则见 `eslint.config.mjs`。

### 15.7 其他易踩坑

- 中文标识：用户名是 `citext`，编码/分类树用 `ltree`、拼音搜索用 `pg_pinyin`（Pigsty 扩展，
  见 `PIGSTY-EXTENSIONS.md`）。
- 打印/PDF：生产固定用系统 Chromium（`PUPPETEER_EXECUTABLE_PATH`），发布检查要复用真实运行时。
- OSS / 通知 / Sentry 都是「配置齐全才启用」：缺变量时返回 `not-configured` 或自动 mock，
  不要为了让本地跑通去改这些降级分支。
- `_reference/` 是只读样板，已被 eslint / vitest / tsconfig 排除，不要在那里改代码。

### 15.8 零 JS 降级：三条路径是硬约束，其余只是写法偏好

**别再把「渐进增强」当全仓铁律援引**（DECISIONS 2026-08-17 已就此拍板）。

- **硬约束只有三条**：登录、登出、改密码。它们由 `tests/e2e/no-js.spec.ts` 在
  `javaScriptEnabled: false` 的 `no-js` project 下断言。动这三个表单的形状会红。
- **其余表单**：新写时默认 `<form action={serverAction}>` + 非受控控件 + `name` —— 这是
  React 19 / Next 16 白送的，别主动扔。但它**不构成任何技术选型的否决理由**，也不进门禁。
- **机制**：React 只在传给 `useActionState` 的函数**本身是 Server Action 引用**
  （带 `$$FORM_ACTION`，`.bind` 会保留）、且 `<form action={formAction}>` 直接接收它时，
  才会在 SSR 输出里渲染原生 action + 隐藏 `$ACTION_ID`。以下两种写法当场把它归零：

```typescript
// ❌ 箭头函数包裹 —— 没有 $$FORM_ACTION，零 JS 提交归零
<form action={(fd) => startTransition(() => formAction(fd))}>
// ❌ 客户端闭包传给 useActionState —— 同理
useActionState(async () => boundAction(), null)

// ✅ pending 用 useActionState 的第三个返回值，不要再套 useTransition
const [state, formAction, pending] = useActionState(action.bind(null, id), null);
<form action={formAction}>
```

- **现状**：92 个 `<form>` 里仍有约 15 处后台表单是被箭头函数包裹的，**这是已知且被接受的**，
  不要顺手"修复"——真要动先看 DECISIONS 2026-08-17 的影响一节。
- **SPEC 有三处强制要求 JS**（§H.1 OSS 直传、§E.1 打印弹窗、浏览器端算建议价），所以
  建单路径在架构上不可能零 JS。

---

**本文档版本**：1.2
**最后更新**：2026-08-19
**维护者**：业主 + Claude Code / Codex
