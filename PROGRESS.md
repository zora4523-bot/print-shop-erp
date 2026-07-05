# 开发进度

> 本文档记录"当前做到哪了、下一步做什么"。每次 session 结束前更新。

## 当前阶段

**P0 全部收官（9/9）+ P1 Dashboard / 企业微信推送完成 + Pigsty 扩展与 ERP 主数据大批次已交付（待提交）**。自动化任务队列（`docs/AGENT-BACKLOG.md`）中已无 `agent-ready` 任务，剩余项全部需要业主拍板。

## 最后更新

2026-07-05

## 已完成

### P0（MVP 核心，2026-05-06 收官，详细过程见 HANDOFF.md 历史）

- [x] **#1 认证与用户管理**（149 单测，Codex 15 轮）
- [x] **#2 工艺 + 产品字典**（累计 249 单测）
- [x] **#3 工单核心 E-lean**：创建/提交/编辑/取消、急单、打印 + Puppeteer PDF、OSS 直传脚手架（STS 仍是桩）（累计 400 单测）
- [x] **#4 生产流程**：排产、师傅报工（薪资快照铁律）、外协单、SHIP/FINISH 状态机收尾，所有 Order.status 写入共享一把 advisory lock（累计 507 单测）
- [x] **#5 薪资系统**：师傅日薪、客服周期提成、时薪工月结 + 考勤，全量规则快照 + 已发放行拒绝重算（累计 716 单测）
- [x] **#6 应收账单**：生成/发单/收款，收款与客服业绩累加同事务（累计 776 单测）
- [x] **#7 CDR 汇总下载**：24h 短链 + baseUrl 推导硬化（Codex rounds 119–126）
- [x] **#8 推送 + Dashboard**：作为 P1 #1/#2 交付（见下）
- [x] **#9 测试 + 运维**：E2E + 视觉回归、Sentry 隐私收紧、cron 端点、上线 checklist、4 个 prod-only bug 修复

### P1（2026-04-26 → 2026-05-05）

- [x] **P1 #1 老板 Dashboard** 三层：KPI 卡 + 关注列表 + recharts 图表（累计 870 单测）
- [x] **P1 #2 企业微信推送** 四切片：notify 引擎（mock-mode）→ admin UI → 5 状态机事件 wire → cron 事件 + 2 新端点；SPEC §8.1 9/10 事件接通（STOCK_ALERT 依赖物料模型，现已具备 wire 条件）（累计 1011 单测）

### Pigsty 扩展 + 内部 Admin 框架 + ERP 主数据（2026-06-28 批次，工作区已验证、待提交）

- [x] **Pigsty PR-1..10**：`citext` 产品编码、价格窗口防重叠（`btree_gist`）、`ltree` 分类树、`pg_pinyin` 拼音搜索、`pg_ivm` 库存看板、partman/anon/pgaudit/cron/observability readiness（`app_ops.*`）、`/owner/pigsty` readiness 页
- [x] **A11–A15 内部 admin 框架**：action-helpers 契约、AdminDataTable 表格原语、模块元数据 registry、Soybean 风格 shell
- [x] **A16 往来单位**（Party/Contact/Address + 工单选客户回填快照）
- [x] **A17 采购单 + 收货**（部分收货、取消回冲，库存与流水同事务）
- [x] **A18 仓库/库位 + 库存台账**（默认仓回填、负库存拒绝）
- [x] **A19 BOM + 用料估算**（工单详情只读估算，不自动发料）
- [x] **A22 业务审计日志**（BusinessAuditLog + 敏感字段掩码）
- [x] **A23 复杂页客户端数据层 POC**（库存盘点页 + `/api/admin/*` 路由复用权限）
- [x] **UI Phase A–E**（已提交 `fde48b8 → 245be5c`）：design tokens、业务原子组件、admin shell 统一
- [x] **2026-07-05 全量验证**：prisma validate / tsc / eslint / **1214 单测** / next build / migrate deploy（16 个新 migration）/ **21 Playwright E2E + 视觉** 全绿
- [x] **A09 分区 cutover 计划**（plan-only）：`docs/partition-cutover-plan.md`

## 进行中

- **工作区大批次待提交**：~127 个文件（A12–A23 + orders 迁入 `(admin)` 路由组 + schema 832 行变更 + 16 migrations）已全量验证绿，等业主决定提交切分方式（建议按 backlog 任务号分批 commit）。

## 下一步

队列里已无 `agent-ready` 任务，以下全部**需业主拍板**后才能推进：

1. **A05 工单款式级编辑**（P1）— 需确认允许编辑的状态、设计图增删规则、金额是否自动重算
2. **A06 OSS STS 真实接入 + CDR 真打包**（P1）— 需 OSS region/bucket/RAM role 凭证
3. **A07 推送按人路由**（P2）— 需确认客服/师傅是否有私有 webhook
4. **A20 生产单拆分**（P1）— 需确认生产单粒度与发料时机
5. **A21 应收应付扩展**（P1）— 需确认是否保持轻量记账
6. **纯运维动作**：填生产 `.env`、cron 切 pg_cron、pgbackrest 启用、Pigsty 扩展生产安装（见 runbook）

## 待澄清的业务问题

- A05/A06/A07/A20/A21 的 Needs 清单（见 `docs/AGENT-BACKLOG.md`）
- **STOCK_ALERT 推送 wire**：物料模型已落地，安全库存告警何时触发（cron 扫描 or 出库时检查）需业主确认
- **ProductCategory 中文标签**：业主过一眼 `/owner/product-categories` 与 SPEC 附录 C 对一遍
- **CDR 预览方案**：等真实上传流跑起来再定

## 已知技术债

- `middleware.ts` Next.js 16 deprecation warning（注释里有 TODO，独立一次迁移）
- OSS `signViaSts` / CDR `generateRealZip` 仍是显式桩（A06 一并替换）
- Puppeteer 部署需 `npx puppeteer browsers install chrome`（README 已写）
- `pg_pinyin` / `pg_ivm` / `pg_partman` 等在非 Pigsty 本地库降级为普通列/视图/缺席，生产安装按 `docs/pigsty-production-activation-runbook.md`
