---
status: historical
owner: project-maintainers
last_verified: 2026-08-24
applies_to: SPEC v1.0 through v1.2.1; not product releases
---

# SPEC 变更日志

> 本文件只记录业务规格与技术基线在 v1.0–v1.2.1 期间的历史变化，**不是当前产品发布日志**。
> 仓库目前没有可据实补写的正式产品 release 清单，因此不从未提交工作区、计划或测试结果伪造版本。
> 产品发布记录的建立与字段要求见
> [`CONTRIBUTING.md` 的“产品发布记录策略”](./CONTRIBUTING.md#产品发布记录策略)。

## v1.2.1 技术栈校准（2026-04-22，脚手架初始化时发现）

初始化时发现 CLAUDE.md §2 写 "Next.js 15"、示例锁 `15.2.4`，但 README 使用 `pnpm create next-app@latest`，今日装出的稳定版为 **Next.js 16.2.4（React 19.2.4）**。业主确认以"当前稳定版 + 锁精确版本"为准，不回退到 15。

变更：
- CLAUDE.md §2：`Next.js 15` → `Next.js 16`；版本锁定示例 `15.2.4` → `16.2.4`
- package.json：`next@16.2.4`、`eslint-config-next@16.2.4`（脚手架已是精确版本）
- 其它被 CLAUDE.md 要求精确锁的 Node / Prisma / Auth.js 在后续安装时仍按规则锁精确版本

无业务或架构改动，不影响 SPEC-v1.2.md。

---

## v1.2 技术栈升级（2026-04-22 最终定版）

基于"2026 年新项目基线"的论证，对技术栈做了以下关键升级：

### 运行时与核心库

| 项 | 原定 | 升级后 | 原因 |
|---|---|---|---|
| Node.js | 20 LTS | **24 LTS** | Node 20 EOL 2026-04-30，Node 24 支持到 2028-04-30 |
| Prisma | 5 | **7**（rust-free client）| Prisma 7 是当前主线，新项目避免未来升级债 |
| Auth.js | NextAuth v5 (^) | **v5 锁精确版本** | 仍在 beta，避免次版本突袭 breaking |
| 测试 | Vitest + Playwright | **Vitest + Browser Mode + Playwright + 截图回归** | 覆盖组件级和视觉级场景 |
| 可观测性 | — | **OpenTelemetry + Sentry** | Next.js 官方推荐的 instrumentation.ts |
| 文件上传 | 未明确 | **OSS 直传（STS token）** | CDR文件可达几十MB，代传吃服务器带宽 |
| 部署 | PM2 | **PM2（MVP）+ Docker 预埋** | 团队成熟度分阶段落地 |

### 架构调整

新增**三层架构约束**（简化版，非严格四层）：
- `app/` 页面层：不直接调用 Prisma
- `actions/` 编排层：Server Actions + 权限检查
- `lib/` 业务层：Prisma 调用集中在此

**权限统一入口**：`lib/auth/permissions.ts` 集中定义所有权限常量和检查函数，禁止散落写法。

### 文件新增

- `components-reference/permissions.ts` —— 权限统一入口骨架
- `components-reference/instrumentation.ts` —— OTel+Sentry 埋点骨架
- `Dockerfile`、`docker-compose.yml`（预埋，MVP 不启用）

### 兼容性

此次升级是**文档级变更**，代码尚未开发，无迁移成本。Claude Code 会按新规格直接搭建项目骨架。

---

## v1.1 (2026-04-22)

本版是一次重大升级，核心是把"薪资体系"从简化版扩展为完整的三套薪资模式，并引入了客服角色、推送模块、CDR设计稿管理。

### 角色体系

**v1.0**：老板、车间主管、销售、师傅（4种）

**v1.1**：老板、车间主管、外部销售、客服、开机师傅、打包师傅、厨师（7种）

**关键区别**：
- 新增"客服"角色，定位为"内部销售"，和外部销售平级录单，但结算方式不同
- 师傅细分为"开机（三类机器）/打包清废/厨师"，对应三种计薪方式
- 权限矩阵同步扩展

### 薪资体系（核心改动）

**v1.0**：只有师傅按件提成一种简化模式

**v1.1**：三套并存

1. **客服**：底薪2000 + 4个月累计业绩分段提成（9档，0.01~0.085）
2. **开机师傅**：每日保底vs每日计件取大，细分三种机器（开机仔/风车机/黏封机）
3. **时薪工**：打包/清废11元/小时、厨师3000月薪+空闲打包另算

**新增实体**：
- `SalaryRule`：所有薪资参数配置（可改）
- `DailyWorkerSalary`：开机师傅日薪记录
- `SalaryPeriod`：客服4月周期
- `CustomerServiceCommission`：客服提成记录
- `HourlyWorkerPayroll`：时薪工月度工资

**关键机制**：
- 薪资规则改动**只影响新建记录**，历史记录通过snapshot锁定
- 客服周期可导入历史业绩（系统上线时）
- 小单保护（1000个以下订单）的计算规则已内置
- 双面红包自动算2个板/2下

### 新增推送模块

**v1.0**：只在非功能需求里一笔带过

**v1.1**：独立章节，详细规划

- 所有推送走企业微信机器人Webhook
- 多Webhook配置（老板群/排产群/车间群/发货群分开）
- 10个预置事件类型（工单提交、急单、完工、外协超期、库存告警、客服周期等）
- 新增`NotificationChannel`、`NotificationRule`、`NotificationLog`实体
- 失败自动重试3次

### 新增CDR设计稿管理

**v1.0**：只支持设计图（JPG）

**v1.1**：
- `OrderItemDesign`增加`fileType`字段，区分IMAGE/CDR
- 销售/客服录单时可同时上传JPG和CDR
- 车间主管独立页面："CDR汇总下载"——按日期勾选工单、打包ZIP、生成24小时下载链接
- 新增`DesignBundle`实体记录汇总下载

### 业绩归属规则

**v1.0**：模糊，没明确

**v1.1**：**谁提交谁拿**，不做客户绑定、不做归属人设置

### 工单/款式字段

- `Order.submitterId`替代原`salesUserId`（因为提交人可能是销售也可能是客服）
- `Order.submitterRole`冗余字段（便于统计）
- `OrderItem.isDoubleSided`（决定板数/下数）
- `OrderItem.suggestedPrice`（系统建议价，仅展示，不强制）
- `ProductionTask.boardCount`、`pressCount`、`pieceworkAmount`、`salaryRuleSnapshot`

### 价格策略调整

**v1.0**：P0阶段价格人工填，P1阶段自动算

**v1.1**：P0阶段仍**人工填金额**，但系统提供"建议价"按钮（基于报价表算出参考价）。**客服业绩按手填金额算**——尊重实际成交价。

### 部署配置升级

**v1.0**：2核4G服务器

**v1.1**：4核8G（因CDR文件处理和ZIP打包对内存有要求）

### MVP范围调整

**v1.0**：P0不含价格自动计算、不含完整财务

**v1.1（方案B）**：P0就做全套薪资体系（开发周期从4周延长到6周）
- P0保持：工单核心、生产流程、薪资、推送、CDR、销售账单
- P1推迟：物料管理、价格完整自动化、完整财务报表、数据导出
- P2不变：BOM、打卡机、小程序

---

## 待v1.2确认的事项

1. **工艺清单补全**：业主需提供完整工艺列表（含是否外协、关联师傅类型）
2. **推送事件文案**：每个事件的企业微信消息具体格式
3. **历史数据量预估**：上线时需要导入多少客服的历史业绩
4. **客服周期起算**：统一起算点还是各自开户日起算

v1.2冻结后将生成`CLAUDE.md`（开发规范）和Prisma schema草案，正式进入开发。
