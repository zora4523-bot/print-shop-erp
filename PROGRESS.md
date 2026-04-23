# 开发进度

> 本文档记录"当前做到哪了、下一步做什么"。每次 session 结束前更新。

## 当前阶段

**P0 阶段 2/9：认证 + 字典完成，准备开 P0 #3 工单核心**

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

## 进行中

（无，准备开 P0 #3）

## 下一步

按 README "开发路径（P0 优先级）" 顺序推进：

3. **P0-3 工单核心**（预计 2 周）— **下一个**
   - 工单 CRUD + 状态机严格落地
   - 销售/客服创建工单（多款式、双面双色、工艺多选、手填金额 + 建议价按钮）
   - JPG 设计图 + CDR 源文件 OSS 直传（`lib/oss/` STS token）
   - 按状态限制修改（SPEC §3.6）
   - 急单标记 + 修改日志
4. **P0-4 生产流程**（预计 1 周）
5. **P0-5 薪资系统**（预计 2 周，核心难点）
6. **P0-6 应收账单**（3 天）
7. **P0-7 CDR 汇总**（2 天）
8. **P0-8 推送 + Dashboard**（1 周）
9. **P0-9 测试 + 上线**（3 天）

## 待澄清的业务问题

- **ProductCategory 中文标签** — `lib/auth/role-labels.ts` 里是根据 enum 名猜的。业主过一眼 `/owner/products` 列表 + SPEC 附录 C 对一遍，如需更名在 `PRODUCT_CATEGORY_LABELS` 改即可。

## 已知技术债

- `middleware.ts` 在 Next.js 16 有 deprecation warning。TODO 已写在注释里。独立一次迁移 commit 搞定。
- 账号/工艺/产品三份 UI 有大量结构近似的 "ToggleActiveButton" 组件。目前三份独立；可抽公共组件但等第 4 次出现再抽（避免过早抽象）。
