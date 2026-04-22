# 开发进度

> 本文档记录"当前做到哪了、下一步做什么"。每次 session 结束前更新。

## 当前阶段

**P0 阶段 1/9：认证与用户管理完成，准备开 P0 #2 工艺 / 产品字典**

## 最后更新

2026-04-23

## 已完成

- [x] 项目初始化（Next.js 16.2.4 + Prisma 7 脚手架、init migration、种子数据雏形）
  - `d3ab602` 脚手架、`6c1865e` / `332ccb0` / `1c253fc` / `a9431bd` / `aa82d2c` seed 五轮加固
- [x] 项目记忆管理体系（PROGRESS / DECISIONS / HANDOFF + CLAUDE.md §13）
- [x] **P0 #1 认证与用户管理**
  - 认证基础（`881ed75`）：lib/db / auth config / session / permissions / middleware / 31 测试
  - 登录页（`4f9cce4` + 开放重定向修复 `d389222`）
  - 自服务改密 + 登出 + 认证首页（`f50a354` + bcrypt 硬化 `e0070f6` / `1b6011d` / `8d07058`）
  - 老板管账号：业务层 + actions（`ce0c425` + 原子守卫 `fc24700`）+ UI（`d663f49` + 表单 remount `6ef01fe`）
  - 测试：149 单测覆盖 schemas、permissions、账号业务逻辑（含不变量）、actions
  - 工作流：Codex review 改为 `codex exec` 自动跑

## 进行中

（无）

## 下一步

按 README "开发路径（P0 优先级）" 顺序推进：

2. **P0-2 工艺字典与产品字典**（预计 3 天）
   - 工艺管理页面（Craft 表 CRUD，仅 OWNER）
   - 产品基础管理（Product 表 CRUD，仅 OWNER）
   - 参考已有 `lib/account.ts` / `actions/owner-accounts.ts` / `app/owner/accounts/**` 的范式
3. **P0-3 工单核心**（预计 2 周）
   - 销售/客服创建工单（多款式、双面双色、工艺多选）
   - JPG 设计图 + CDR 源文件上传（OSS 直传）
   - 工单列表、详情、按状态限制修改、状态机严格落地

## 待澄清的业务问题

- **工艺清单最终确认** —— 参见 `prisma/seed.ts` 的 `seedCrafts()` 函数里预置的 12 个工艺。业主需确认完整列表（含是否外协、关联师傅类型）。来源：CHANGELOG "待 v1.2 确认事项 #1"。开工 P0 #2 前必须对一遍。

## 已知技术债

- `middleware.ts` 在 Next.js 16 有 deprecation warning（应迁移到 `proxy.ts`）。TODO 已写在 `middleware.ts` 注释里。不阻塞开发，单独一个 commit 迁移。
- 账号管理的"保存成功"banner 因表单 remount 出现时间很短。必要时考虑加 toast / URL flag 保留确认 UI。
