# 红包印刷 ERP 系统

内部工具，服务于佛山某红包印刷厂的生产、销售、薪资、库存全流程数字化。

---

## 📂 文档结构

| 文件 | 作用 | 读者 |
|---|---|---|
| **SPEC-v1.2.md** | 业务规格（冻结版，权威） | 所有人 |
| **CLAUDE.md** | 开发规范与工作准则 | Claude Code / Codex |
| **prisma/schema.prisma** | 数据库Schema | 开发 |
| **prisma/seed.ts** | 初始化种子数据 | 开发 |
| **CHANGELOG.md** | 版本变更历史 | 所有人 |
| **SPEC-v1.0.md / v1.1.md** | 历史版本（仅归档） | 参考 |

---

## 🚀 启动开发（给Claude Code的指引）

### 环境要求

- **Node.js 24 LTS**（Krypton，支持至2028-04-30）
- **pnpm** 最新版
- **PostgreSQL 16**（开发期用本地 PG 或 Pigsty dev 实例，生产用独立 Pigsty）

### 第一次启动

```bash
# 0. 确认 Node 版本
node -v  # 必须是 v24.x

# 1. 初始化项目
pnpm create next-app@latest print-shop-erp --ts --tailwind --app --no-src-dir
cd print-shop-erp

# 2. 安装核心依赖（版本锁精确，不用 ^ 前缀 —— 安装后手动去 package.json 改）
pnpm add prisma@7 @prisma/adapter-pg
pnpm add next-auth@5 @auth/prisma-adapter
pnpm add react-hook-form zod @hookform/resolvers
pnpm add bcryptjs decimal.js
pnpm add qrcode.react qrcode
pnpm add puppeteer   # PDF生成
pnpm add @sentry/nextjs   # 错误监控
pnpm add @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/instrumentation-http

# 3. 安装开发依赖
pnpm add -D @types/bcryptjs @types/qrcode
pnpm add -D vitest @vitest/browser playwright-core  # 单元+组件测试
pnpm add -D @playwright/test                         # E2E+截图回归

# 4. 初始化 shadcn/ui
pnpm dlx shadcn@latest init

# 5. 装 Playwright 浏览器
pnpm exec playwright install chromium

# 6. 复制本目录下的配置文件
cp ../SPEC-v1.2.md ./
cp ../CLAUDE.md ./
cp ../prisma/schema.prisma ./prisma/
cp ../prisma/seed.ts ./prisma/
cp -r ../components-reference ./

# 7. 数据库准备
#    MVP阶段可以用本地 PostgreSQL（brew install postgresql@16 或 apt install postgresql-16）
#    生产部署请用 Pigsty 独立实例
createdb print_shop_erp
export DATABASE_URL="postgresql://localhost:5432/print_shop_erp"

# 8. 生成 Prisma Client（Prisma 7 生成到 ./generated/prisma）
pnpm prisma generate

# 9. 首次 migration
pnpm prisma migrate dev --name init

# 10. 跑种子数据（初始化管理员、工艺字典、薪资规则等）
pnpm prisma db seed

# 11. 启动开发
pnpm dev
```

### 首次启动后

1. 打开 `http://localhost:3000`
2. 用种子数据创建的账号登录：`admin` / `admin@2026`
3. **立刻改默认密码**
4. 开始按 P0 清单开发第一个功能（认证与用户管理）

### 开发路径（P0优先级）

按以下顺序开发，**每个模块必须端到端完成后再进入下一个**：

1. **认证与用户管理**（1周）
   - 登录、密码管理
   - 老板管账号（增删改）、角色选择

2. **工艺字典与产品字典**（3天）
   - 工艺管理页面
   - 产品基础管理

3. **工单核心**（2周）
   - 销售/客服：创建工单、多款式、双面双色、工艺多选
   - 上传JPG设计图 + CDR源文件（OSS）
   - 工单列表、详情、修改（按状态限制）
   - 状态机严格落地

4. **生产流程**（1周）
   - 车间主管：排产、派师傅（按工艺推荐）
   - 外协单管理
   - 工单PDF生成（含任务二维码）
   - 师傅扫码开工/完工
   - 不良/返工记录

5. **薪资系统（核心难点）**（2周）
   - 三套薪资规则配置界面
   - 开机师傅日薪计算（每日24:00定时任务）
   - 客服业绩周期累计 + 结算
   - 时薪工工时录入 + 月结

6. **应收账单**（3天）
   - 月度自动生成销售账单
   - 销售查看、老板登记收款

7. **CDR汇总**（2天）
   - 车间主管勾选打包
   - 24小时临时链接

8. **推送与Dashboard**（1周）
   - 企业微信Webhook配置
   - 10个预置事件
   - 老板Dashboard

9. **测试与上线准备**（3天）
   - 关键流程E2E
   - 性能压测（小规模）
   - 生产部署

**目标总时长：约6周**

---

## 🛡️ 开发边界（必读）

### 不要做的事

见 `SPEC-v1.2.md` 第10章「不做清单」。其中最容易踩坑的：

- ❌ 不要引入Redis/消息队列/Docker等重型基础设施
- ❌ 不要修改技术栈（Next.js + Prisma + PostgreSQL 是固定的）
- ❌ 不要自己猜测业务规则，不清楚就标TODO
- ❌ 不要集成任何未在SPEC中声明的外部系统

### 核心算法的正确性

**薪资算法错1元，老板的信任会崩塌**。所以：

- 所有薪资算法必须100%单元测试覆盖
- 所有薪资记录必须快照化（改规则不影响历史）
- 所有边界case都要测（小单、超大单、档位边界）

---

## 🎯 验收标准

### 功能验收

- [ ] 销售能在手机上10秒内录完一张简单工单
- [ ] 师傅能在30秒内完成扫码报工
- [ ] 车间主管能30秒内汇总当日CDR并拿到分享链接
- [ ] 客服能实时看到自己当前周期的业绩和距离下一档的差额
- [ ] 老板能在Dashboard上一眼看到今日工单、产量、待发货
- [ ] 急单提交后企业微信群3秒内收到推送

### 技术验收

- [ ] 核心算法测试覆盖率 100%
- [ ] E2E测试覆盖关键路径
- [ ] 所有Server Action有权限检查
- [ ] 所有金额字段用Decimal或integer
- [ ] 所有薪资记录有快照
- [ ] 数据库有每日备份脚本

---

## 📞 遇到问题

按优先级：

1. 查 `SPEC-v1.2.md`
2. 查 `CLAUDE.md`
3. 查既有代码的模式
4. 标记 `TODO: 需业主确认` 并暂停该任务

**禁止**：自行假设业务规则继续开发。
