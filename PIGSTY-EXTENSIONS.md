# Pigsty 扩展适配与开发计划

> 范围限定：本文只讨论 Pigsty Extension Catalog 中的 PostgreSQL 扩展。
> 不把 Auth.js、Next.js 中间件、应用层 RBAC、Redis/MQ、低代码后台等内容混入扩展方案。

## PR 目标

建立一份与当前系统架构兼容的 Pigsty 扩展路线图，并把第一批扩展能力落到代码、migration、readiness view 和 Owner 后台运维入口中。生产是否真正启用需要 `shared_preload_libraries`、扩展包和数据库参数配合的能力，仍由 Pigsty 运维显式执行。

## 当前落地状态

- PR-1：扩展决策与运维白名单已落地。
- PR-2：搜索 V1 已落地，`/orders` 和 `/owner/products` 支持 `q` 查询。
- PR-2 运维预检：`app_ops.search_index_readiness` 已落地，后台 `/owner/pigsty` 可查看搜索必需扩展、必需索引、可选 `pg_bigm` 增强和上线前 EXPLAIN SQL。
- 搜索排序：工单、商品、物料搜索已接入相关度排序，精确命中优先，其次前缀、包含、拼音/简拼命中，原业务排序作为稳定兜底。
- PR-3：编码规范已开始落地，`User.username`、`Material.code` 改为 `citext`，`Product.code` 作为可选内部编码接入产品字典。
- PR-4：价格字典数据库约束已开始落地，`PriceTier` 防重叠有效期，`PriceAdjustment.triggerCondition` 在 `pg_jsonschema` 可用时校验为 JSON object。
- PR-5：商品多级分类底座已开始落地，新增 `ProductCategoryNode`；Prisma 写文本 `path`，PostgreSQL 用生成的 `ltree` 列做树索引。
- PR-6：拼音搜索底座已开始落地，`Order` / `Product` / `Material` 的 `searchPinyin` 和简拼列在 Pigsty `pg_pinyin` 可用时由数据库生成，并用 `pg_trgm` 索引；非 Pigsty 本地库保留可空列并由 readiness 标记未就绪。
- PR-7：库存看板聚合底座已开始落地，`pg_ivm` 可用且已 preload 时维护 `material_inventory_*_summary`，本地环境退化为普通 view。
- PR-7 页面入口：`/foreman/materials` 已落地，按 `material:manage` 鉴权展示库存、安全库存、当日出入库、累计出入库和库存金额，并支持物料 `q` 搜索。
- PR-8：分区维护预检已开始落地，`app_ops.partition_readiness` 给出 `pg_partman` 候选表、阻塞项和运维 SQL。
- PR-9：脱敏与审计预检已开始落地，`app_ops.sensitive_column_*` 和 `app_ops.security_*_readiness` 给出 `anon` / `pgaudit` 策略、阻塞项和运维 SQL。
- PR-10：调度与观测预检已开始落地，`app_ops.cron_http_job_*` 和 `app_ops.query_observability_*` 给出 `pg_cron` / `pg_net` / `pg_stat_statements` / `auto_explain` / `index_advisor` 的启用状态、阻塞项和运维 SQL。
- 后台入口：`/owner/pigsty` 已接入 ADMIN 菜单，集中展示扩展 readiness、推荐步骤、cron SQL、查询诊断 SQL、脱敏审计策略和分区维护 SQL。
- A08：生产启用 runbook 已落地到 `docs/pigsty-production-activation-runbook.md`，覆盖扩展安装、preload/restart、readiness SQL、cron 启用和回滚。

本轮实现的目标不是在生产库里自动启用所有扩展。当前代码侧已经固化：

- 哪些 Pigsty 扩展适合本项目。
- 每个扩展对应当前哪些业务表和页面。
- 哪些扩展可以放进普通 migration，哪些必须走 Pigsty 集群配置。
- 后续开发任务如何拆分，避免扩展能力和应用层认证/权限职责混淆。
- Owner 后台如何读取 readiness view，让运维知道“能否启用、还缺什么、应执行哪条 SQL”。

## 架构适配结论

适配当前系统架构。

当前系统核心架构是 Next.js 16 App Router + Server Actions + Prisma 7 + PostgreSQL + Auth.js + 自定义 RBAC。Pigsty 对应用层保持透明，应用仍然只通过 `DATABASE_URL` 连接标准 PostgreSQL。扩展应作为数据库能力增强，不改变以下边界：

- 不替换 Auth.js 登录流程。
- 不替换 `lib/auth/permissions-dict.ts` 权限字典。
- 不把业务权限下沉为数据库 JWT 扩展。
- 不引入 Redis、消息队列或新的后台框架。
- 不在普通 Prisma migration 中偷偷启用需要 Pigsty 集群层配置或 `shared_preload_libraries` 的扩展。

对当前项目最自然的落点：

- `Order` / `OrderItem`：工单搜索、客户名称/简称、收货信息、快递号。
- `Product` / `PriceTier` / `PriceAdjustment`：商品搜索、编码、动态属性、价格有效期约束。
- `Material` / `MaterialTransaction`：物料搜索、库存看板、流水分区。
- `OrderLog` / `NotificationLog` / future `AuditLog`：日志增长后的分区与审计。
- 运维层：cron、慢 SQL 观测、测试库脱敏。

## 扩展白名单

| 阶段 | Pigsty 扩展 | 主要用途 | 当前项目落点 | 启用方式 |
|---|---|---|---|---|
| S1 | `pg_trgm` | 模糊搜索、相似搜索 | 工单、商品、物料搜索 | migration 可建 extension + index |
| S1 | `pg_bigm` | 中文短词搜索 | 红包、烫金、佛山、张三等短中文关键词 | migration 可建 extension + index |
| S1 | `citext` | 大小写不敏感唯一 | `User.username`、`Material.code`、future `Product.code` | migration + 数据冲突预检 |
| S1 | `pg_stat_statements` | SQL 性能观测 | Dashboard、搜索、账单列表慢查询 | Pigsty 集群配置 |
| S1 | `pg_cron` | 定时任务 | 6 个 `/api/cron/*` endpoint 调度 | Pigsty 集群配置 |
| S1 | `pg_net` | PG 发 HTTP 请求 | 配合 `pg_cron` 调 Next cron endpoint | Pigsty 集群配置 |
| S2 | `pg_jsonschema` | JSONB 结构校验 | `PriceAdjustment.triggerCondition`、future product attributes | hand-written SQL migration |
| S2 | `btree_gist` | 区间排他约束 | `PriceTier` 有效期、数量档防重叠 | hand-written SQL migration |
| S2 | `ltree` | 多级分类树 | `ProductCategoryNode` 分类路径 | schema/migration 单独 PR |
| S2 | `pg_pinyin` | 拼音搜索 | 商品名、物料名、客户名称/简称、收货信息 | generated column + search index |
| S3 | `pg_ivm` | 增量物化视图 | 库存看板、分类库存金额、今日入库/出库 | Pigsty 配置 + hand-written SQL |
| S3 | `pg_partman` | 分区维护 | `MaterialTransaction`、`OrderLog`、`NotificationLog` | Pigsty 配置 + hand-written SQL |
| S3 | `anon` | 数据脱敏 | 测试库/演示库脱敏手机号、地址、薪资 | Pigsty/ops 脚本 |
| S3 | `pgaudit` | 数据库审计 | DBA 直连修改账号、薪资、账单、价格 | Pigsty 集群配置 |
| S3 | `auto_explain` | 慢 SQL 执行计划 | 搜索和 Dashboard 诊断 | Pigsty 集群配置 |
| S3 | `index_advisor` | 索引建议 | 搜索/列表查询调优 | 诊断环境优先 |

## 不作为应用登录鉴权方案的扩展

Pigsty 中存在数据库认证、安全或 JWT 相关扩展，但它们不适合替代当前后台登录鉴权：

- `pg_session_jwt` / `pgjwt`：适合数据库直出 API 或 PostgREST 类架构。本项目是 Next.js Server Actions，不应替换 Auth.js。
- `credcheck` / `pg_auth_mon` / `auth_delay`：面向数据库账号，不是 ERP 用户账号。可用于 DBA/运维账号治理，不能替代 `User` 表、bcrypt 或 RBAC。
- PostgreSQL RLS 是内置能力，不是 Pigsty 扩展。以后可作为数据库最后一道防线，但不进入本轮扩展路线。

当前登录鉴权继续保持：

- 登录：Auth.js Credentials + bcrypt。
- Session：Auth.js JWT session。
- 权限：`PERMISSIONS` 字典 + `requirePermission()`。
- 资源归属：`requireOwnership()` 和业务 lib 层 scope filter。

## 开发任务拆分

### PR-1：扩展决策与运维白名单

目标：完成本文档、DECISIONS 记录、README 链接。

范围：

- 只更新文档，不创建数据库 migration。
- 明确 S1/S2/S3 启用顺序。
- 明确 Auth.js/RBAC 不被数据库扩展替换。

验收：

- 文档解释清楚为什么适配当前架构。
- README 文档索引能找到该计划。
- DECISIONS 有追加式决策记录。

### PR-2：搜索 V1（工单 + 商品）

目标：用 `pg_trgm` + `pg_bigm` 支撑最实用的模糊搜索。

范围：

- migration：启用 `pg_trgm`、`pg_bigm`。
- indexes：为 `Order` 的 `orderNo`、`customerRef`、`receiverName`、`receiverPhone`、`trackingNo`、`expressCode` 建搜索索引。
- indexes：为 `Product` 的 `name`、`specification`、`paperType` 建搜索索引。
- ops readiness：新增 `app_ops.search_index_readiness`，列出工单/商品搜索所需扩展、索引、缺失项和 EXPLAIN SQL。
- UI：`/orders` 和 `/owner/products` 增加 `q` 查询参数。
- lib：新增统一搜索 helper，避免页面里散落 raw SQL。

验收：

- 中文短词能搜到商品/工单。
- 手机号、快递号、订单号可搜索。
- 空查询保留现有列表行为。
- 不改变现有权限 scope：销售仍只能搜自己的工单（客服角色 2026-09-24 已删除）。
- 搜索结果按精确命中、前缀命中、包含命中、拼音/简拼命中的顺序优先展示，避免精确订单号/编码被历史排序压到后面。
- `/owner/pigsty` 能看到工单/商品搜索 readiness；必需扩展或索引缺失时报告 blocker。
- 上线前可直接复制页面里的 EXPLAIN SQL 在生产库检查计划，避免搜索路径退化成全表扫描。

### PR-3：编码规范（citext）

目标：为商品/物料编码建立大小写不敏感唯一约束。

范围：

- `Product` 增加可选 `code` 字段。
- `Material.code` 和 future `Product.code` 改为 `citext` 或使用等效唯一索引。
- migration 前做冲突探测 SQL，发现大小写冲突时中止并给修复指引。

验收：

- `HB001` 和 `hb001` 不能同时存在。
- 老数据迁移失败时错误可读，不静默改码。

### PR-4：商品动态属性与价格有效期

目标：用 `pg_jsonschema` 和 `btree_gist` 降低商品/报价规则维护成本。

范围：

- 为 `PriceAdjustment.triggerCondition` 增加 JSON schema 校验。
- future `Product.attributes Json?` 加 schema 校验（需产品属性方案确认）。
- 为 `PriceTier` 建有效期/数量档排他约束，防止同一商品同一档重叠。

验收：

- 非法 JSON 条件在数据库层拒绝。
- 同商品、同数量档、重叠有效期无法写入。
- 现有 Prisma 写入路径有对应错误翻译。

### PR-5：多级商品分类（ltree）

目标：当 enum 分类不够时，用 `ltree` 承载可维护分类树。

范围：

- 新增 `ProductCategoryNode`，字段包含 `path`、`name`、`legacyCategory`、`sortOrder`、`isActive`。
- `Product` 新增 `categoryNodeId` 外键，产品创建/编辑改选分类节点。
- 暂时保留 `Product.category` 作为旧 enum 快照，继续服务现有报表、订单录入和历史统计。
- Prisma 侧写入普通文本 `path`；数据库侧用生成列 `pathLtree ltree` + GIST 索引支持树查询。
- 保留旧 enum 到默认分类节点的迁移映射。

验收：

- 老产品能无损迁移。
- 分类可按树展示、启停、排序；当前 PR 先落创建/编辑产品选择分类节点。
- 订单录入中的产品选择仍保持可用。

### PR-6：拼音搜索增强

目标：用 `pg_pinyin` 提升商品、客户、收货人的输入体验。

范围：

- 为商品名、物料名、客户名称/简称、收货信息生成拼音列。
- 与 `pg_trgm`/`pg_bigm` 搜索 helper 合并。
- UI 不增加复杂控件，仍用同一个 `q` 输入框。
- 暂不引入 `pg_search`；先用 Pigsty 文档推荐的 generated column + trigram 方案，降低部署和查询复杂度。

验收：

- 输入中文、全拼、首字母均能命中目标记录。
- 搜索结果按精确命中优先，再按前缀、包含、拼音/简拼相关度排序。
- 非 Pigsty 本地开发库不会阻断 migration，但 `/owner/pigsty` 必须把缺失 `pg_pinyin` 报告为 blocker；生产 Pigsty 需安装扩展后才算拼音搜索 ready。

### PR-7：库存看板（pg_ivm）

目标：当 `MaterialTransaction` 流水量增长后，用 `pg_ivm` 做库存聚合增量维护。

范围：

- 为 `Material.code`、`Material.name`、`Material.specification`、`Material.unit` 增加 `pg_trgm` 搜索索引，可选 `pg_bigm` 中文短词索引；物料名和规格同步接入 `pg_pinyin` 全拼/简拼列。
- 先保留 `Material.currentStock` 作为事务内事实字段。
- 新增 `material_inventory_movement_summary` 汇总累计入库、出库、净变动。
- 新增 `material_inventory_daily_summary` 按上海日期汇总当日入库、出库、净变动。
- `lib/material-inventory.ts` 组合 `Material.currentStock`、安全库存、平均成本和汇总视图，形成库存看板数据源。
- `/foreman/materials` 读取该服务函数，不在请求时重扫全量流水。
- `app_ops.search_index_readiness` 追加物料搜索面，输出缺失索引和 EXPLAIN SQL。

验收：

- 入库/出库后看板实时变化。
- 写入成本可接受；如果批量导入变慢，提供禁用/重建视图的运维指引。
- 未安装或未 preload `pg_ivm` 的本地开发库仍可用普通 view 运行读路径。
- 管理员从侧边栏“物料”进入 `/foreman/materials`，能按编码、名称、规格、单位、全拼和简拼搜索。
- `/owner/pigsty` 能看到物料搜索 readiness 和 EXPLAIN SQL。

### PR-8：流水与日志分区（pg_partman）

目标：让长期增长的流水/日志表可维护。

范围：

- 优先候选表：`MaterialTransaction`、`OrderLog`、`NotificationLog`、future `AuditLog`。
- 按月分区。
- 写归档和保留策略说明。
- 当前 PR 先落 `app_ops.partition_candidate` / `app_ops.partition_readiness`，不直接改现有表为分区表。
- readiness 明确检测：父表是否已分区、主键是否包含分区键、是否有入向外键、`pg_partman` 是否可用/已安装。

验收：

- 最近月份查询不退化。
- 历史分区可归档/清理。
- Prisma 访问路径不需要大改。
- 未完成表结构切换前，系统能明确报告阻塞项，而不是半自动改坏现有主键/外键。

### PR-9：脱敏与审计

目标：保护生产数据和敏感操作。

范围：

- 新增 `app_ops.sensitive_column_policy`，登记当前 ERP 的敏感列：账号密码 hash、员工手机号、工单客户/收货信息、薪资、账单金额、价格规则、企业微信 webhook 和通知正文。
- 新增 `app_ops.sensitive_column_readiness`，为可用 `anon` 动态脱敏的文本列生成 `SECURITY LABEL FOR anon ... MASKED WITH FUNCTION ...` 建议 SQL。
- 薪资和账单金额先走 `manual_export_redact`，不在 migration 中生成随机金额；这些金额是 finance/payroll-of-record，演示库导出时显式替换，生产库由应用权限和审计保护。
- 新增 `app_ops.security_audit_table_readiness`，按敏感列汇总出表级 `pgaudit.role` 授权 SQL，便于只审计高敏表，不开启全库 `ALL`。
- 新增 `app_ops.security_extension_readiness`，检查 `anon` / `pgaudit` 是否可用、是否已安装、是否已 preload，以及当前还有哪些 blocker。
- 新增 `lib/security-readiness.ts`，让后台或运维页可以读取 readiness，而不是散落手写 SQL。
- 不执行 `anon.anonymize_database()` / `anon.anonymize_table()`，避免普通业务 migration 破坏生产真实数据。
- 不在普通 migration 里强行开启 `pgaudit.log`，因为 `pgaudit` 需要 Pigsty 集群层 `shared_preload_libraries` 和日志策略。

验收：

- `anon` 未安装、未 preload 或标签未应用时，readiness 明确报告 blocker，不把环境误判为可脱敏。
- `pgaudit` 未安装或未 preload 时，readiness 明确报告 blocker，并输出建议步骤。
- 测试库/演示库导出前可按 `sensitive_column_readiness.apply_anon_label_sql` 和手工 redaction 策略处理手机号、地址、客户信息、薪资和账单金额。
- 审计只覆盖账号、订单、薪资、账单、价格、通知等高敏表，默认 `pgaudit.log_parameter = off`，避免日志记录过多业务正文。

### PR-10：调度与观测

目标：把已存在的 6 个 `/api/cron/*` endpoint 和关键慢查询诊断纳入 Pigsty 运维面。

范围：

- 新增 `app_ops.cron_http_job_candidate`，登记 6 个 HTTP cron job：日薪、时薪月结、客服周期结算、销售账单生成、超期外协提醒、客服周期到期提醒。
- 新增 `app_ops.cron_http_job_readiness`，按 job 输出 `cron.schedule(...)` + `net.http_post(...)` SQL、手工 `curl` 兜底命令、阻塞项和是否可调度。
- 调度 SQL 不写死真实域名和 secret；Pigsty/PostgreSQL 侧通过 `app.erp_base_url` 和 `app.cron_secret` 自定义 GUC 注入。
- 新增 `app_ops.ops_extension_readiness`，检查 `pg_cron`、`pg_net`、`pg_stat_statements`、`auto_explain`、`index_advisor` 的可用性、安装状态、preload 状态和配置项。
- 新增 `app_ops.query_observation_candidate` / `app_ops.query_observability_readiness`，登记工单搜索、商品搜索、管理员 Dashboard、账单列表、库存看板、薪资汇总的诊断入口。
- 新增 `lib/ops-readiness.ts`，后台 `/owner/pigsty` 直接读取调度/观测 readiness。
- 新增 ADMIN-only `/owner/pigsty` 运维页，展示扩展状态、推荐步骤、cron 调度 SQL、取消 SQL、手工 curl 和查询诊断 SQL。
- 不在 migration 里直接调用 `cron.schedule`，避免开发库或未配置 secret 的生产库自动开始执行任务。

验收：

- Pigsty 未配置 `pg_cron`、`pg_net`、`cron.database_name`、`app.erp_base_url` 或 `app.cron_secret` 时，readiness 明确报告 blocker。
- `pg_stat_statements` 未 preload、`compute_query_id` 未启用时，查询诊断 readiness 明确报告 blocker。
- `auto_explain` 只作为诊断窗口使用，建议关闭参数日志或设置 `auto_explain.log_parameter_max_length = 0`，避免薪资/客户信息进入 PG 日志。
- `index_advisor` 只用于诊断环境输出建议，不直接把建议索引自动写进生产 migration。
- `/owner/pigsty` 受 `ops:pigsty:view` 权限保护；未登录访问跳转登录，非 ADMIN 不出现在菜单里。
- readiness 相关 migration 未应用时，页面显示具体错误面板，不应 500。

## 迁移约束

- 能被 Prisma 正常表达的 schema 改动走 Prisma schema + migration。
- Prisma 不表达或不应表达的数据库能力走 hand-written SQL migration，并在 migration 注释中说明。
- 需要 Pigsty 集群层配置的扩展不放入普通 migration 作为唯一启用手段。
- 所有搜索索引上线前要跑 `EXPLAIN`，避免生产 seq scan。
- 所有涉及金额、薪资、账单的扩展增强不得改变既有快照化语义。

## 参考文档

- Pigsty Extension Catalog: https://doc.pigsty.io/ext/
- Pigsty PostgreSQL Extensions: https://doc.pigsty.io/docs/pgsql/ext/
- `pg_trgm`: https://pigsty.io/ext/e/pg_trgm/
- `pg_bigm`: https://pigsty.io/ext/e/pg_bigm/
- `citext`: https://pigsty.io/ext/e/citext/
- `pg_stat_statements`: https://pigsty.io/ext/e/pg_stat_statements/
- `pg_cron`: https://pigsty.io/ext/e/pg_cron/
- `pg_net`: https://pigsty.io/ext/e/pg_net/
- `btree_gist`: https://pigsty.io/ext/e/btree_gist/
- `pg_jsonschema`: https://pigsty.io/ext/e/pg_jsonschema/
- `ltree`: https://pigsty.io/ext/e/ltree/
- `pg_pinyin`: https://pigsty.io/ext/e/pg_pinyin/
- `pg_ivm`: https://pigsty.io/ext/e/pg_ivm/
- `pg_partman`: https://pigsty.io/ext/e/pg_partman/
- `anon`: https://pigsty.io/ext/e/anon/
- `pgaudit`: https://pigsty.io/ext/e/pgaudit/
- `auto_explain`: https://pigsty.io/ext/e/auto_explain/
- `index_advisor`: https://pigsty.io/ext/e/index_advisor/
