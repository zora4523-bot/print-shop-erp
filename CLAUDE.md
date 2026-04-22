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
  - 单元测试：Vitest
  - 组件测试：Vitest Browser Mode（真实浏览器中跑组件）
  - E2E：Playwright + 截图回归（visual regression）
可观测性：OpenTelemetry（instrumentation.ts） + Sentry（错误监控）
PDF生成：Puppeteer（headless Chrome 渲染打印视图）
二维码：qrcode.react（前端）/ qrcode（服务端）
部署（MVP）：阿里云 ECS + PM2 + Nginx
部署（P1+）：Docker 化（Dockerfile 预埋但不强启）
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
- MVP 阶段用 PM2 直接部署，调试阻力最小
- 仓库根目录**预埋** `Dockerfile` 和 `docker-compose.yml`，但 CI/CD 不启用
- 等 MVP 稳定后（约上线2-3月），再切换到 Docker 部署

**明确不用**：
- ❌ Redux / Zustand / Jotai（Server Components替代）
- ❌ tRPC（Server Actions替代）
- ❌ GraphQL
- ❌ Docker（单机部署用pm2足够）
- ❌ Redis / Memcached（MVP阶段不需要）
- ❌ 消息队列（用数据库+cron替代）
- ❌ 任何微服务架构

---

## 3. 目录结构（严格遵守）

```
print-shop-erp/
├── app/                          # Next.js App Router（页面层）
│   ├── (auth)/                   # 登录相关路由组
│   ├── (owner)/                  # 老板端
│   ├── (foreman)/                # 车间主管端
│   ├── (sales)/                  # 销售端（客服共用）
│   ├── (worker)/                 # 师傅端（手机H5）
│   ├── api/                      # API Routes（仅Webhook等必要场景）
│   └── layout.tsx
├── actions/                      # Server Actions（业务编排层）
│   ├── order.ts
│   ├── production.ts
│   ├── salary.ts
│   └── ...
├── components/
│   ├── ui/                       # shadcn组件
│   └── business/                 # 业务组件（按领域组织）
│       ├── order/
│       ├── production/
│       ├── salary/
│       └── ...
├── lib/                          # 核心业务逻辑层（纯函数优先）
│   ├── db.ts                     # Prisma client 单例（唯一的 Prisma 入口）
│   ├── auth/
│   │   ├── config.ts             # Auth.js 配置
│   │   ├── permissions.ts        # 【权限统一入口，所有检查必须走这里】
│   │   └── session.ts            # getSession / requireRole 等辅助
│   ├── salary/                   # 薪资计算模块（100%测试覆盖）
│   │   ├── machine-piecework.ts
│   │   ├── cs-commission.ts
│   │   ├── hourly-payroll.ts
│   │   └── __tests__/
│   ├── order/
│   │   ├── status-machine.ts
│   │   └── __tests__/
│   ├── notification/             # 企业微信推送
│   ├── oss/                      # OSS 工具（签发STS token等）
│   ├── telemetry/                # OpenTelemetry 辅助工具
│   └── utils/
├── instrumentation.ts            # 【Next.js OTel 埋点入口】
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── tests/
│   ├── e2e/                      # Playwright
│   ├── visual/                   # Playwright 截图回归
│   └── integration/
├── Dockerfile                    # 预埋，MVP 不启用
├── docker-compose.yml            # 预埋，MVP 不启用
├── SPEC-v1.2.md                  # 业务规格（权威）
├── CLAUDE.md                     # 本文件
├── CHANGELOG.md
└── package.json
```

**三层架构约束**（简化版，独立开发者友好）：

- **页面层（app/）**：只关心UI渲染和路由，**禁止直接调用 Prisma**
- **编排层（actions/）**：Server Actions，处理用户操作，调用 lib/ 完成业务，**第一行必须调用权限检查**（通过 `lib/auth/permissions.ts` 的统一入口）
- **业务层（lib/）**：纯业务逻辑，Prisma 的所有直接调用**集中在这一层**

**Repository 单独分层不强制**，但严格要求调用方向：`app → actions → lib → Prisma`，不得倒置，不得跨层。具体来说：

- Prisma import 不得出现在 `app/` 和 `actions/` 以外的页面/组件文件中
- `actions/` 中可以 import Prisma，但应委托给 `lib/` 的函数处理复杂业务
- `components/` 中不得有任何数据库调用

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

特别是以下模块，**单元测试覆盖率必须100%**：

- `lib/salary/*`：所有薪资算法
- `lib/order/status-machine.ts`：工单状态流转
- `lib/notification/*`：推送逻辑

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
- 函数：camelCase，动词开头（`calcPiecework`、`transitionOrder`）
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
- 每次commit前运行`pnpm lint`和`pnpm test`
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

所有事件类型定义在 `lib/notification/events.ts`，禁止用字符串字面量。

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

### 8.2 组件测试（Vitest Browser Mode）

Vitest Browser Mode 在真实浏览器中渲染组件并测试，比 jsdom 更接近真实环境。

**必须测试**：
- 工单打印布局 `OrderPrintLayout`（多设计图数量下的网格布局）
- 工单表单的校验逻辑（Zod schema）
- 师傅报工表单（合格/不良/返工数的约束）
- 权限相关的条件渲染

**配置要点**：
```ts
// vitest.config.ts
export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
    },
  },
});
```

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

截图文件存在 `tests/visual/__screenshots__/`，作为 Git 版本控制的一部分。布局变更时，**主动更新截图基线必须在 commit message 里说明**：
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
- [ ] 代码通过 `pnpm test`
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

**本文档版本**：1.1
**最后更新**：2026-04-22
**维护者**：业主 + Claude Code / Codex
