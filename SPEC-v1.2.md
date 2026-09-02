# 红包印刷 ERP 系统需求文档

> **文档版本**：v1.2（**冻结版**）
> **冻结日期**：2026-04-22
> **状态**：进入开发阶段
> **项目代号**：print-shop-erp

---

## J. 2026-08-07 现行计价与结算补充（取代本文早期“金额手填 / 建议价仅参考”口径）

本节描述当前代码的权威实现；与正文或附录 C 冲突时，以本节为准。

### J.1 工单结算方向不是账号当前角色

工单创建时把资金方向冻结到 `Order.settlementType`：

| 创建身份 | 结算方向 | 财务含义 |
|---|---|---|
| 外部销售 `SALES` | `EXTERNAL_SALES` | 外部销售应付工厂加工费，进入销售应收 Bill |
| 内部客服 `CUSTOMER_SERVICE` | `INTERNAL_SALES` | 工厂内部销售业绩，进入客服销售额/工资流水，不生成外部应收 |
| 管理员 `ADMIN` | `FACTORY_DIRECT` | 工厂直接业务，不借用外部销售或员工工资账本 |
| 免费重做 | `NO_CHARGE` | 不向客户重复收费，生产计件和成本仍按真实事实记录 |

账号角色只回答权限；历史工单的资金方向不得因改岗、停用或重命名重新推导。

### J.2 对客加工费公式

每个款式独立报价，最终恒满足：

```text
款式小计 = round(数量 × 成交单价, 2) + 一次性费用
工单总额 = Σ 款式小计
```

系统先校验产品最小起订量；数量低于起订量时报价不完整，特殊单只能由有权录单人员手工填价并保存原因。通过校验后，选择同一产品中“`minQty <= 数量` 的最大起订量”价格阶梯；没有适用阶梯时回退到产品基础单价。随后叠加所有命中的启用收费项：

- `PER_PIECE`：按个，`金额 = 费率 × 数量`；
- `PER_SHEET`：按张，`张数 = ceil(数量 / unitsPerSheet)`；
- `PER_10K`：每万个，`金额 = 费率 × 数量 / 10000`；
- `PER_ORDER`：历史枚举名保留，现行业务含义是“每款一次”，不是整张工单只收一次。

收费项可按产品、工艺（任一/全部）、规格、纸张、烫金色、单双面、单双色、数量区间和结算方向命中；`perFoilColor=true` 时按实际所选烫金颜色数倍增，“无颜色（纯彩印）”不计为烫金色。

各组件先按分币舍入，再合计款式建议小计。服务端会把可归入按个的部分保存为四位小数成交单价，把舍入余数和按张/每万个/每款费用保存为两位小数一次性费用，保证页面、数据库和导出对平。

### J.3 服务端权威报价与快照

- 浏览器的“计算并应用建议价”只用于预览；创建工单时服务端必须在写入事务内按当前规则重新报价。
- 未人工填写价格且规则完整时，自动应用建议价；人工成交价与建议价不同，或规则不完整时，必须填写人工改价说明。
- `OrderItem.pricingSnapshot` 保存输入事实、基础价来源、命中收费项、各组件和实际成交金额；后续修改字典不得回写历史快照。
- 修改申请若改变数量、规格、烫金颜色或新增款式，管理员批准时按合并后的完整事实重新报价；只改名称不得因字典后来变化而改价。无法完整报价而沿用旧成交价时必须由审核人明确说明原因。
- `Decimal(10,4)` 单价和 `Decimal(12,2)` 款式/工单金额在报价引擎与领域写入边界双重校验；任何派生溢出都在写数据库前明确拒绝。

### J.4 五类金额事实必须分账

1. 外部销售加工费应收：`Bill / BillItem / BillPayment`；
2. 内部客服销售额与提成：`CsSalesEntry / SalaryPeriod / CsPayrollPayment`；
3. 开机师傅计件及保底：任务规则快照、日工资和调整流水；
4. 打包、清废、厨师工资：考勤 + 版本化工资规则 + 月结快照；
5. 外协供应商应付：`OutsourceOrder.amount / OutsourceAmountChange / OutsourcePayment`。

客户售价规则不得用于计算员工工资或供应商应付。当前外协供应商尚无结构化合同价规则；应付金额必须由管理员按供应商对账结果人工确认/更正后再付款，系统只负责数量归属校验、不可覆盖变更历史和防超付。不得为了“自动”而套用对客价格字典。

---

## 0. 文档说明

本文档是系统开发的**权威业务规格**。所有开发决策、代码实现、测试用例都以本文档为准。v1.2 较 v1.1 的主要变更：

- 计件算法最终定版：双面/双色多维度乘倍、机器特异性
- 工艺-机器映射表完整，激凸归风车机、UV和啤为外协
- 报价表细节曾降级为 P1/P2、MVP 阶段金额手填（历史口径，现已由 §J 取代）
- 增加《不做清单》保护开发聚焦

本文档的附录B（工艺清单）和第7章（算法示例）是与代码实现一一对应的，**修改时需同步更新代码**。

---

## 1. 项目概述

### 1.1 业务背景

工厂位于佛山，主营红包加工，工序覆盖烫金、粘封、打包、入袋，印刷工序外协。订单来源为两类人员：

- **外部销售**：独立签约B端渠道商，按工厂报价表结算
- **内部客服**：工厂员工，按底薪+4月累计提成拿工资

两类人员在系统内功能几乎一致（都能创建工单），仅结算方式不同。

### 1.2 核心价值

将工单全流程从Excel+微信+纸质搬到系统内：

- 销售/客服在线录单 → 系统生成打印工单 → 车间师傅扫码报工
- 师傅薪资按机器规则日结 / 客服4月周期自动算提成
- 销售账单月度自动生成
- CDR文件统一管理，管理员一键打包发外协
- 关键事件通过企业微信机器人实时推送

### 1.3 范围边界

**包含**：工单管理、设计文件管理（JPG+CDR）、生产任务分派与扫码报工、外协管理、产品与报价字典（参考）、双库存（P1）、三套薪资体系、销售月度账单、企业微信推送、多角色权限、PC+手机H5。

**不包含**：终端客户CRM、在线支付、电子发票、硬件打卡、国际化、多工厂、高并发架构、复杂财务分录、与任何未声明的外部系统集成。

---

## 2. 角色与权限

### 2.1 角色定义

| 角色枚举 | 中文名 | 主用终端 | 结算方式 |
|---|---|---|---|
| ADMIN | 管理员 | PC + 手机 | — |
| SALES | 外部销售 | 手机 + PC | 按报价表应付工厂 |
| CUSTOMER_SERVICE | 客服 | 手机 + PC | 2000底薪 + 4月累计提成 |
| WORKER | 师傅 | 手机 | 按身份不同 |

师傅（WORKER）通过 `workerType` 细分岗位；开机师傅另外登记主机型与
全部可操作机型：

```
workerType ∈ {MACHINE, PACKER, CLEANER, COOK}
  当 workerType=MACHINE 时：
    machineType ∈ {HAND_PRESS, WINDMILL, GLUE}          # 主机型
    machineCapabilities ⊆ {HAND_PRESS, WINDMILL, GLUE}  # 全部可操作机型，必须包含主机型
```

**师傅仍是一人一岗位类型，不跨 MACHINE/PACKER/CLEANER/COOK；开机师傅可
操作多种机器。** 管理员另为师傅登记熟练工艺，作为排产推荐依据而非唯一
派工权限。

### 2.2 权限矩阵

| 能力 | 管理员 | 销售 | 客服 | 开机师傅 | 打包/清废 |
|---|:---:|:---:|:---:|:---:|:---:|
| 查看所有工单 | ✓ | 仅自己 | 仅自己 | 分配任务 | 分配任务 |
| 创建工单 | ✓ | ✓ | ✓ | — | — |
| 修改工单（未排产前） | ✓ | 仅自己 | 仅自己 | — | — |
| 修改工单（排产后） | 仅地址/备注 | — | — | — | — |
| 标记急单 | ✓ | ✓ | ✓ | — | — |
| 排产、派师傅 | ✓ | — | — | — | — |
| 外协管理 | ✓ | — | — | — | — |
| 物料出入库（P1） | ✓ | — | — | ✓（领料） | — |
| 报工 | — | — | — | ✓（自己任务） | ✓（自己任务） |
| CDR汇总下载 | ✓ | — | — | — | — |
| 查看所有应收账单 | ✓ | — | — | — | — |
| 查看自己账单 | — | ✓ | — | — | — |
| 查看自己工资/业绩 | — | — | ✓ | ✓ | ✓ |
| 查看所有薪资 | ✓ | — | — | — | — |
| 管理产品/报价字典 | ✓ | — | — | — | — |
| 管理薪资规则 | ✓ | — | — | — | — |
| 管理工艺字典 | ✓ | — | — | — | — |
| 管理推送规则 | ✓ | — | — | — | — |
| 管理账号 | ✓ | — | — | — | — |

---

## 3. 核心业务流程

### 3.1 销售/客服创建工单

```
登录 → 新建工单 → 填工单头（自定义名称、客户名称/简称、收货信息、包装要求、备注、是否急单、是否顺丰到付）
  → 添加款式（可多款式）
      ├─ 款式名
      ├─ 规格（中/大/方形/西封...）
      ├─ 纸张
      ├─ 工艺（多选，从工艺字典）
      ├─ 烫金颜色
      ├─ 数量
      ├─ 是否双面
      ├─ 是否双色
      ├─ 加工费（服务端自动报价；规则不完整或人工议价时填写价格与原因）
      ├─ 上传设计图（JPG/PNG，多张）
      └─ 上传CDR源文件（多个，可选）
  → 如需多地址：添加最多9个额外地址，为每个款式分配正整数数量
      ├─ 各额外地址至少分配一个款式
      ├─ 各款式分配总数不得超过款式数量
      └─ 主地址至少保留一个款式数量
  → 系统累加款式金额为工单总额（不计物流费用）
  → 提交
  → 工单状态：DRAFT → SUBMITTED
  → 企业微信机器人推送到"排产群"
```

#### 3.1.1 工单列表查询与导出

- 工单列表默认严格按 `createdAt DESC, id DESC` 排列；急单只作标识和筛选，不打乱新单优先顺序。
- 页数、总数、排序和所有筛选在服务端 PostgreSQL 执行；筛选条件始终与当前账号的工单数据范围做 `AND`，不得因搜索、地址、款式、任务或外协条件绕过权限。
- 管理员可按工单、客户、收货/发货、提交人/师傅、金额/日期、款式/工艺、任务/机器和外协信息逐项独立筛选；已停用账号和退役工艺仍作为历史筛选项可见。
- 只有 ADMIN 可导出全部或当前筛选结果。生产环境由 HEAVY worker 流式生成私有多工作表 XLSX；精确十进制金额不经 `Number`，不导出 OSS 地址/对象键、内部 ID、工资快照、任务载荷或 raw JSON。
- 导出文件只允许发起人本人且下载时仍为启用 ADMIN 时获取，响应使用 `private, no-store`，生成后 24 小时过期；请求、完成和下载均写审计记录。
- 导出筛选参数只在 PENDING 生成期保留并用哈希校验完整性；READY / FAILED / EXPIRED 终态只保留 `scope`，不保留原值或可枚举的确定性哈希。

### 3.2 生产下发与外协（管理员）

```
管理员查看 PENDING_FACTORY 工单
→ 完成价格、变更申请等前置校验后确认：PENDING_FACTORY → CONFIRMED
→ 管理员下发生产：
    ├─ 按当前 workOrderVersion 物化 ProductionOperation 与 ProductionProgressStep
    ├─ 创建首次打印任务
    ├─ 工单状态：CONFIRMED → RELEASED
    └─ durable 模式在同一事务写入 ORDER_SCHEDULED 通知任务；inline 模式在提交后派发
→ ORDER_SCHEDULED 的 taskCount = 计件工序数 + 非计件进度步骤数
→ 有外协工艺时另行创建、发出并收货外协单，完成闸口还会校验覆盖
→ 当前 runtime 不做师傅派工；ORDER_SCHEDULED 只能发往事件规则绑定的共享群，尚无对应师傅个人/专属群路由
```

### 3.3 师傅报工

```
师傅手机 H5 → 扫当前版本工单/工序二维码
→ 认领并对 ProductionOperation 或 ProductionProgressStep 报工
→ 计件工序填合格数、不良数、返工数，工资使用持久化规则快照
→ 计件 FOILING / PACKING 工序的首次有效阶段报工使 canonical 状态从 RELEASED 按阶段推进
→ 当前 workOrderVersion 的所有有效计件工序、非计件步骤及必需外协通过完成闸口
    ├─ 写入 completedAt 和生产完成审计记录
    ├─ 按 workOrderVersion 幂等产生 ORDER_COMPLETED
    └─ canonical 工单原子收口到 PACKING，直到管理员显式发货
```

### 3.4 发货

```
工单通过生产完成闸口（completedAt 已写入）→ 管理员打包 → 按收货地址分别填写快递单号
  ├─ 单地址：记录一条发货记录
  ├─ 多地址：每个地址独立记录款式数量、运单号与发货状态
  └─ 顺丰到付：全部由内部自行预约，物流费用不计入工单金额
→ 所有地址在同一事务中确认发货，canonical 状态进入 SHIPPED
→ 产生 ORDER_SHIPPED，发往事件规则绑定的共享群
```

### 3.4.1 售后重做

```
已发货 / 已完成工单发生质量问题或物流损毁
→ 管理员在原工单选择重做款式、数量、工艺并填写原因
→ 系统创建关联的 REWORK 子工单
    ├─ 状态直接进入 SUBMITTED，按普通工单重新排产和报工
    ├─ 复制所选款式的规格、纸张、设计稿和主收货地址快照
    ├─ billingMode=NO_CHARGE、金额=0，不进入客户应收账单
    └─ 师傅生产任务与计件工资仍按正常规则记录
→ 原工单状态、历史应收、历史工资保持不变
→ 原单与重做单互相展示关联编号和状态
→ 重做单不能继续派生嵌套重做；再次售后必须回到原单新建，保证所有重做成本都可由原单一层汇总
```

### 3.5 CDR汇总下载

```
管理员 → CDR汇总页面
→ 筛选日期范围 → 勾选工单/文件
→ 点"生成下载包"
    ├─ 系统打包ZIP（内部按工单号分文件夹）
    ├─ 生成24小时有效下载链接
    └─ 写入DesignBundle记录
→ 管理员复制链接发外协模具厂
```

### 3.6 工单修改

```
销售/客服在工单完工前提交修改申请
  ├─ 可申请改款式名称、数量、规格、烫金颜色
  └─ 可基于现有款式新增一款（继承纸张、工艺和单价）
→ 管理员后台“工单修改申请”批准/拒绝
  ├─ 申请记录 baseRevision；审核时版本不一致自动标记 STALE
  ├─ 数量变更遇已开工/完工任务时拒绝，防生产数据回退
  ├─ 批准后同步更新款式、主地址数量、待生产任务与工单总额
  └─ 工单 revision + 1，写 OrderLog；所有端口下次读取看到同一版本

收货/履约字段仍按状态直接修改：
  ├─ DRAFT / SUBMITTED：可直接编辑
  ├─ SCHEDULING / IN_PRODUCTION：主收货信息/备注/顺丰到付
  ├─ COMPLETED / SHIPPED：仅单独更正顺丰到付
  └─ FINISHED / CANCELLED：不可改
```

### 3.7 客服周期结算

```
客服开户 → 系统按当前规则自动创建 SalaryPeriod（start=本月，end=周期最后一天）
→ 每次该客服提交收费工单 → 追加 CsSalesEntry 正数流水并累加 period.totalSales
→ 管理员批准工单修改 → 按新旧金额差额追加调整流水
→ 工单取消 → 追加负数冲销流水
→ 账单收款只写付款流水，不重复增加客服销售额
→ 如业务日期没有可用的 IN_PROGRESS 周期，工单操作与业绩写入整体回滚
→ 周期结束日的次日（上海自然日，定时任务）:
    ├─ 查 SalaryRule 找档位
    ├─ 计算提成 = (totalSales + initialSales) × tierRate
    ├─ 生成 CustomerServiceCommission 记录
    ├─ 周期 status: IN_PROGRESS → SETTLED
    └─ 自动开启下一个周期
→ 底薪可在周期内按月/分次发放；提成只能在 SETTLED 后发放
→ 每次工资发放追加 CsPayrollPayment，不覆盖历史流水
→ 企业微信推送管理员和客服
```

### 3.8 师傅日薪结算

```
每日 24:00 定时任务 → 对每位开机师傅:
    ├─ 汇总当日所有 ProductionTask.pieceworkAmount
    ├─ 查 SalaryRule 取当日保底
    ├─ 生成 DailyWorkerSalary:
    │    actualSalary = max(汇总计件, 保底)
    └─ 企业微信推送车间群（可选）
→ 师傅端可按日期范围查询；每天明确显示“计件高于保底”、
  “计件等于保底”或“按保底补足”，低于保底时同时显示原因
```

### 3.9 时薪工月结

```
管理员为全体在职正式员工记录实际上班/请假（支持 0.5 天）
→ PACKER / CLEANER / COOK 同时录入正常、加班和代班工时
月底定时任务 → 对每位时薪工:
    ├─ 汇总本月总工时
    ├─ 计算：正常工时 × 时薪 + 加班工时 × 时薪 × 加班倍率
    └─ 生成 HourlyWorkerPayroll
```

### 3.10 应收、收款与成本明细

```
账单发出后 → 每次结款追加 BillPayment（金额、时间、方式、流水号、备注、记录人）
→ Bill.paidAmount 只做累计快照，结款明细永久可追溯

管理员在工单详情追加成本流水：
  材料 / 物流 / 伙食费 / 电费 / 外协 / 上板装板 / 其他 / 调整
→ 已入账记录不覆盖；更正用正负调整项
→ 账单详情自动汇总计件、外协、人工补录及关联售后重做成本
→ 展示销售额、总成本、毛利；客服账单另展示提成比例与归属提成
```

---

## 4. 数据模型

### 4.1 实体清单

| 分类 | 实体 | 说明 |
|---|---|---|
| **用户** | User | 所有角色统一表 |
| **工单** | Order, OrderItem, OrderItemDesign, OrderLog | 工单核心 |
| **生产** | ProductionTask, OutsourceOrder, DesignBundle | 生产流程 |
| **字典** | Craft, Product, PriceTier, PriceAdjustment | 工艺/产品/报价 |
| **物料（P1）** | Material, MaterialTransaction | 库存 |
| **薪资** | SalaryRule, DailyWorkerSalary, SalaryPeriod, CustomerServiceCommission, HourlyWorkerPayroll | 三套薪资 |
| **财务** | Bill, BillItem | 销售应收账单 |
| **推送** | NotificationChannel, NotificationRule, NotificationLog | 企业微信 |
| **系统** | Setting | 全局配置 |

### 4.2 关键字段定义

详见 `prisma/schema.prisma` 文件。本节仅列出与算法直接相关的字段。

#### OrderItem（款式）

```
orderId                关联工单
sequence               序号
name                   款式名
productId              产品字典ID（可空）
specification          规格
paperType              纸张
quantity               数量 ★
crafts                 工艺ID数组 ★
foilColors             烫金颜色数组（最多 5 色；无颜色与其他颜色互斥）
isDoubleSided          是否双面 ★（影响开机仔计件）
isDoubleColor          是否双色 ★（影响开机仔和风车机计件）
unitPrice              成交单价（服务端自动报价或受控人工改价）
fixedFee               一次性费用（按张/每万个/每款等分项对平）
subtotal               成交小计 = round(数量 × 成交单价, 2) + 一次性费用
suggestedPrice         历史建议单价（旧字段，新报价不再写入）
suggestedSubtotal      当次规则建议小计
pricingSnapshot        报价输入、命中规则、分项与实际成交价快照
priceOverrideReason    规则不完整或人工改价原因
remark
```

#### ProductionTask（生产任务）

```
orderItemId            关联款式
craftId                工艺
workerId               师傅
machineType            本任务实际使用机器类型（派工快照）★
status                 PENDING/IN_PROGRESS/COMPLETED/CANCELLED
plannedQty             计划数量
boardCount             板数（计算值）
pressCount             下数（计算值）
completedQty           合格数量
defectQty              不良数量
reworkQty              返工数量
pieceworkAmount        本任务计件金额 ★
salaryRuleSnapshot     完工时薪资规则快照（JSON）★
startedAt
completedAt
```

### 4.3 状态机

**工单（canonical）**：DRAFT → PENDING_FACTORY → CONFIRMED → RELEASED → FOILING → PACKING → SHIPPED → SETTLED。`SUBMITTED / SCHEDULING / IN_PRODUCTION / COMPLETED / FINISHED` 仅作扩展迁移兼容状态保留。

**生产任务**：PENDING → IN_PROGRESS → COMPLETED

**客服周期**：IN_PROGRESS → SETTLED

**外协单**：SENT → IN_PROGRESS → RECEIVED

任意非终态均可转 CANCELLED（需对应权限）。

---

## 5. 薪资体系（核心算法）

### 5.1 算法原则

**三条铁律**：

1. **所有薪资参数存数据库**：管理员随时可改，不改代码
2. **历史记录快照化**：每条薪资记录完工时锁定当时的规则，事后改参数不影响历史
3. **三套薪资完全独立**：客服/开机师傅/时薪工互不干扰

### 5.2 开机师傅日薪算法

```python
# 伪代码
def calc_machine_piecework(task, machine_rule):
    """计算单个任务的计件金额"""
    quantity = task.quantity
    
    # 小单保护
    if (machine_rule.smallOrderThreshold
        and (quantity < machine_rule.smallOrderThreshold
             or (machine_rule.smallOrderInclusive
                 and quantity == machine_rule.smallOrderThreshold))):
        return machine_rule.smallOrderFlatPrice
    
    # 计算倍率（多维度独立生效）
    multiplier = 1
    if "DOUBLE_SIDED" in machine_rule.multiplierFactors and task.isDoubleSided:
        multiplier *= 2
    if "DOUBLE_COLOR" in machine_rule.multiplierFactors and task.isDoubleColor:
        multiplier *= 2
    
    # 计算板数和下数
    board_count = task.itemCount * multiplier
    press_count = quantity * multiplier
    
    # 计件金额
    return (board_count * machine_rule.boardRate 
            + press_count * machine_rule.pieceRate
            + task.itemCount * machine_rule.largeOrderSetupFee)


def calc_daily_salary(worker, date):
    """计算单日师傅日薪"""
    tasks = get_completed_tasks(worker, date)
    total_piecework = sum(t.pieceworkAmount for t in tasks)
    worked_machines = unique(t.machineType for t in tasks)
    if worked_machines:
        # 同日跨机型支援时取实际生产机型中最高的日保底
        base = max(active_rule(m).dailyBase for m in worked_machines)
    else:
        # 当日无任务时才回退账号主机型
        base = active_rule(worker.primaryMachineType).dailyBase
    return max(total_piecework, base)
```

**关键参数**（初始值，可修改）：

| 机器 | dailyBase | pieceRate | boardRate | smallThreshold | smallFlatPrice | inclusive | setupFee | multiplierFactors |
|---|---|---|---|---|---|---|---|---|
| HAND_PRESS（开机仔） | 100 | 0.007 | 5 | 1000 | 12 | false | 0 | [DOUBLE_SIDED, DOUBLE_COLOR] |
| WINDMILL（风车机） | 120 | 0.01 | 0 | 1000 | 20 | true | 10 | [DOUBLE_COLOR] |
| GLUE（黏封机） | 120 | 0.002 | 0 | — | — | false | 0 | [] |

风车机规则：**1000 个及以下 20 元/单；1000 个以上按 0.01 元/个 +
10 元装板费**。装板费每款只加一次，不随双面/双色倍率翻倍。管理员可为
单个师傅可针对其登记的每一种机器能力建立版本化个性规则。报工按
`ProductionTask.machineType` 查实际任务机型的个人规则，未配置时使用该机型
统一规则，并把命中规则快照到任务。

### 5.3 客服提成算法

```python
def calc_cs_commission(period, tiers, mode="FLAT"):
    """计算客服周期提成"""
    # totalSales 由 CsSalesEntry 对账；initialSales 是历史导入的期初额
    total = period.totalSales + period.initialSales
    
    # 查档位（从高到低）
    applicable_tier = None
    for tier in sorted(tiers, key=lambda t: t.minSales, reverse=True):
        if total >= tier.minSales:
            applicable_tier = tier
            break
    
    if not applicable_tier:
        return 0
    
    if mode == "FLAT":
        # 整段用最高达到档的费率
        return total * applicable_tier.rate
    else:
        # 阶梯累进（MVP不用）
        ...
```

**关键参数**（初始值，可修改）：

| 档位 | minSales | rate |
|---|---|---|
| 1 | 100,000 | 0.010 |
| 2 | 200,000 | 0.020 |
| 3 | 300,000 | 0.030 |
| 4 | 400,000 | 0.045 |
| 5 | 500,000 | 0.060 |
| 6 | 600,000 | 0.065 |
| 7 | 700,000 | 0.070 |
| 8 | 800,000 | 0.075 |
| 9 | 900,000 | 0.080 |
| 10 | 1,000,000 | 0.085 |

月底薪 2000，周期长度 4 个月，模式 FLAT。

### 5.4 时薪工月工资算法

```python
def calc_hourly_payroll(worker, month):
    """计算时薪工月工资"""
    attendance = get_attendance(worker, month)
    rule = get_salary_rule(worker.workerType)
    
    normal_hours = attendance.totalNormalHours
    ot_hours = attendance.totalOtHours
    
    normal_pay = normal_hours * rule.hourlyRate
    ot_pay = ot_hours * rule.hourlyRate * rule.otMultiplier
    
    # 厨师特殊处理
    if worker.workerType == "COOK":
        base = rule.monthlyBase  # 3000
        # 空闲时间打包另算
        packer_rule = get_salary_rule("PACKER")
        spare_pay = attendance.spareHours * packer_rule.hourlyRate
        return base + spare_pay
    
    return normal_pay + ot_pay
```

**关键参数**：

| workerType | 参数 | 初始值 |
|---|---|---|
| PACKER（打包） | hourlyRate | 11 |
| CLEANER（清废） | hourlyRate | 11 |
| COOK（厨师） | monthlyBase | 3000 |
| — | otMultiplier | 1.0 |
| — | 正常工时 | 早8-12 + 下午13:30-17:30 |
| — | 加班起始 | 18:00 |

### 5.5 历史业绩导入

系统上线时，管理员可为每个客服初始化：

```
{
  "csUserId": "xxx",
  "periodStart": "2026-02",
  "initialSales": 230000,
  "baseMonthsAlreadyPaid": 3
}
```

系统创建周期并以此作为初始累计值继续运行。

---

## 6. 工艺-机器路由

### 6.1 工艺字典（初始化数据）

| 工艺名 | code | isOutsource | defaultMachineType | 说明 |
|---|---|---|---|---|
| 现货加烫（局部烫金） | STOCK_FOIL | false | HAND_PRESS | 在现货上加烫 |
| 专版单色平烫 | FLAT_FOIL_SINGLE | false | WINDMILL | — |
| 专版双色平烫 | FLAT_FOIL_DOUBLE | false | WINDMILL | 双色×2 |
| 浮雕 | EMBOSS | false | WINDMILL | — |
| 激凸 | BUMP | false | WINDMILL | — |
| UV | UV | **true** | — | 外协 |
| 啤（模切） | DIE_CUT | **true** | — | 外协 |
| 冰白彩印-纯印刷 | COLOR_PRINT | **true** | — | 外协 |
| 冰白彩印-印刷+烫金 | COLOR_PRINT_FOIL | **true** | WINDMILL | 外协印刷后风车机烫 |
| 粘封 | GLUING | false | GLUE | — |
| 打包/入袋 | PACKING | false | — | 打包师傅 |
| 清废 | CLEANING | false | — | 清废工 |

说明：
- `isOutsource=true` 且 `inHouseMachineTypes=[]` 的纯外协工艺不创建生产任务
- `isOutsource=true` 且配置 `inHouseMachineTypes` 的混合工艺既加入外协清单，
  也创建回厂加工任务；彩印+烫金允许 HAND_PRESS / WINDMILL
- `defaultMachineType / inHouseMachineTypes` 决定任务允许使用的设备集合
- 师傅账号的 `machineCapabilities` 与允许设备集合取交集；优先用主机型，
  否则确定一个匹配设备并快照到任务
- `WorkerCraftCapability` 只决定推荐顺序；管理员可越过推荐派工，但原因必须
  写入 `OrderLog`
- 特殊工艺"冰白彩印-印刷+烫金"既要外协（印刷部分）也要内部生产（烫金部分），需在排产时拆成两步

### 6.2 组合工艺处理

报价表中的"啤烫粘"、"啤烫粘+金料"等套餐价，MVP处理方式：

**用户录单时仍选择独立工艺**（啤+烫+粘），系统后台不自动拆套餐。报价系统识别到组合时给出套餐建议价，销售/客服可参考后手填金额。

**组合自动识别放到P2阶段**（降低MVP复杂度）。

---

## 7. 算法示例（与代码一一对应）

### 7.1 开机仔日薪示例

师傅张三某日任务：

| 任务 | 款式数 | 数量 | 双面 | 双色 | 板数 | 下数 | 计件 |
|---|---|---|---|---|---|---|---|
| T1 | 1 | 500（小单） | 否 | 否 | — | — | 12元 |
| T2 | 1 | 8000 | 否 | 否 | 1 | 8000 | 5+56=61元 |
| T3 | 1 | 3000 | 是 | 否 | 2 | 6000 | 10+42=52元 |
| T4 | 1 | 2000 | 是 | 是 | 4 | 8000 | 20+56=76元 |

当日计件合计：12+61+52+76 = **201元**
当日保底：100元
**实发：max(201, 100) = 201元**

### 7.2 风车机日薪示例

师傅李四某日任务：

| 任务 | 数量 | 双色 | 下数 | 计件 |
|---|---|---|---|---|
| T1 | 500 | 否 | — | 20元（小单） |
| T2 | 5000 | 否 | 5000 | 50+10=60元 |
| T3 | 8000 | 是 | 16000 | 160+10=170元 |

当日计件合计：20+60+170 = **250元**
当日保底：120元
**实发：max(250, 120) = 250元**

### 7.3 客服周期结算示例

客服小王 2026-01 ~ 2026-04 周期：

- 累计业绩：55万
- 查档位：50万 ≤ 55万 < 60万 → 命中 tier 5（rate=0.06）
- 提成：550000 × 0.06 = **33000元**
- 4月底薪合计：2000 × 4 = 8000元
- 周期总收入：**41000元**
- 前3月已发：3 条底薪发放流水，合计 6000元
- 第4月结算后发：2000（底薪）+ 33000（提成）= **35000元**，追加第4条工资发放流水
- 上述工资发放与客户账单回款无关；客户回款不改变 55 万的业绩合计

### 7.4 打包工月工资示例

打包阿姨 2026-05：

- 正常工时：22天 × 8小时 = 176小时
- 加班：12小时
- 时薪：11元，加班倍率：1.0

月工资：176×11 + 12×11×1.0 = 1936 + 132 = **2068元**

---

## 8. 通知推送

### 8.1 事件-渠道映射

| eventType | 触发时机 | 收件配置（当前实现） |
|---|---|---|
| ORDER_SUBMITTED | 新工单提交待工厂确认 | 系统设置：工厂确认人共享群 |
| ORDER_CHANGE_REQUESTED | 变更/取消申请提交 | 系统设置：工厂确认人共享群 |
| PRODUCTION_PROGRESS_ANOMALY | 报工进度出现异常 | 系统设置：老板共享群 |
| PRODUCTION_STAGNANT | 下发超配置天数仍无有效扫码认领 | 系统设置：老板共享群 |
| PENDING_FACTORY_BACKLOG | 待工厂确认工单达到阈值 | 系统设置：老板共享群 |
| URGENT_ORDER | 急单提交 | 事件规则绑定群（可手工绑定排产/管理员群） |
| ORDER_SCHEDULED | 管理员下发：`CONFIRMED → RELEASED` | 事件规则绑定共享群；尚无对应师傅路由 |
| ORDER_COMPLETED | 当前 work-order generation 通过内部工作 + 必需外协完成闸口 | 事件规则绑定的发货共享群 |
| ORDER_SHIPPED | 工单发货 | 事件规则绑定群 |
| OUTSOURCE_OVERDUE | 外协超预计回货日 | 事件规则绑定群 |
| ORDER_OVERDUE | 承诺交期已过仍未发货 | 事件规则绑定群 |
| STOCK_ALERT | 库存从安全线上方跌破安全线 | 事件规则绑定群 |
| CS_PERIOD_ENDING | 客服周期前 7 天预警 | 事件规则最多 1 个授权共享群；尚无 per-CS 路由 |
| CS_PERIOD_SETTLED | 客服周期结算 | 事件规则最多 1 个授权共享群；尚无 per-CS 路由 |
| DAILY_WORKER_SALARY | 师傅日薪结算 | 事件规则绑定的车间共享群 |

上表 15 个事件会预置 `NotificationRule`，但 seed 默认不启用、不猜测真实收件群。生产必须由管理员显式创建 channel，按业务启用规则并配置路由。对应客服/师傅的个人或专属群 Webhook 映射尚未实现，不得宣称已达成原始&ldquo;管理员群 + 对应客服&rdquo;或&ldquo;对应师傅群&rdquo;的路由目标。

### 8.2 消息模板

所有消息使用 Markdown 格式，推送到企业微信群机器人 Webhook。消息模板存在 `NotificationRule.messageTemplate` 字段，可用占位符取自每个事件的允许字段。

[企业微信「消息推送」官方文档](https://developer.work.weixin.qq.com/document/path/99110)规定：

- `markdown.content` 最大 4096 UTF-8 字节；模板保存与真实/mock 发送前均按此上限校验。
- 每个机器人 Webhook 最多 20 条/分钟。除单次 cron 批量扇出按 `index × 3500ms` 摊开外，真实 `sendWebhook` 还会通过 PostgreSQL 全局 permit 表，以「固定端点 + 解码后 key」的 SHA-256 摘要为键，按 3500ms 安全间隔对共享 Webhook 跨事件、跨进程原子串行；不持久化明文 webhook/key，mock 或测试注入 sender 不触发该表。生产真发前须先应用 `20260902121100_notification_webhook_global_throttle` migration。

生产使用 durable `BackgroundJob`（当前 `maxAttempts=4`，即首次投递 + 3 次退避重试，不做进程内紧密连续重发）：可恢复的明确限流失败写 `RETRYING` 并由任务退避；永久性内容/配置错误写 `FAILED`；无法判定是否已送达时写 `UNKNOWN` 且禁止自动重发。重试耗尽的 job 进入 `DEAD`，通知后台的告警与待人工处理队列负责暴露这些状态。

---

## 9. MVP 分级

### 9.1 P0（第一版，6周）

**用户与权限**
- 七类角色、登录、账号管理、历史业绩导入功能

**工单**
- 工单CRUD、状态机、多款式、多工艺、双面双色、设计图和CDR上传、工单PDF含二维码、修改留痕

**生产**
- 外协单管理、生产任务自动拆分、按工艺推荐师傅、扫码报工、不良/返工记录

**薪资（核心）**
- 三套薪资规则可配置、开机师傅日薪自动结算、客服周期自动累计结算、时薪工月结、快照机制

**财务**
- 销售应收账单月度自动生成

**CDR**
- 管理员汇总下载、24小时链接

**推送**
- 企业微信 Webhook 配置、15 个预置事件、推送日志

**统计**
- 管理员Dashboard、基础生产和销售报表

### 9.2 P1（上线1-2月后）

- 物料管理+出入库、备货报表、价格阶梯与加价规则完整配置、销售/客服端建议价提示增强、完整财务报表、数据导出、工单历史数据导入

### 9.3 P2（长期）

- BOM物料清单、完工自动扣料、组合工艺自动识别、硬件打卡、微信小程序、外协系统API、移动端深度优化

---

## 10. 不做清单（范围保护）

开发期间，以下诉求**一律拒绝纳入MVP**，避免范围蔓延：

- 与任何外部业务系统的集成
- 终端客户档案与CRM
- 在线支付、微信支付、支付宝
- 电子发票、增值税计算、会计凭证
- 物流API对接（只记录快递单号）
- 硬件打卡机集成
- 多工厂/多主体/多租户
- 国际化、多语言、多币种
- SSO、LDAP、企业微信OAuth登录
- 工单审批流
- VIP折扣、优惠券、客户分级
- 打样单独流程（打样按普通工单处理，备注标记）
- 春节等放假排期自动处理

以上若业主提出，回应："已列入不做清单，如需支持请进入v2规划"。

---

## 附录

### A. 变更记录

- v1.0 初版
- v1.1 引入客服、三套薪资、推送、CDR
- **v1.2（本版，冻结）**：修正计件维度（双面双色）、工艺-机器映射确定、降低报价表复杂度

### B. 工艺清单（初始化数据）

见第6.1节表格。

### C. 报价表消化策略

**历史 MVP 口径（已由 §J 取代）**：报价表曾只作参考字典、金额手填；现行实现由服务端重新报价并保存快照，不能把浏览器提示当权威结果。

**P1阶段**：补充完整价格阶梯、纸张加价、工艺加价、一次性费用，建议价精确度提升。

**P2阶段**：可选开启全自动计价模式。

### D. 相关文档

- `CLAUDE.md`：开发规范、技术栈、目录结构
- `prisma/schema.prisma`：完整数据库Schema
- `seed-data.ts`：初始化种子数据
- `CHANGELOG.md`：版本变更历史

---

### E. 工单打印方案（v1.2 追加规范）

#### E.1 双通道打印

工单提供两种输出方式：

**主通道：网页直接打印**
- 工单详情页点"打印" → 新窗口打开打印视图 → 自动弹出浏览器打印对话框
- 不产生文件，打印完毕窗口自动关闭
- 适用：车间日常打印、销售快速补单

**辅通道：生成PDF**
- 工单详情页点"下载PDF" → 服务端Puppeteer渲染 → 返回PDF文件
- 适用：发微信给外协、存档、事后对账

两通道**共用同一个React组件** `<OrderPrintLayout />`，布局代码不重复。

#### E.2 打印视图布局（固定模板）

- 规格：A4纵向（210×297mm），边距10mm
- 不含任何价格、金额、成本信息
- 急单顶部红条+大号红字提示
- 每款式独立一块（左设计图、右信息表）
- 每任务独立二维码，尺寸15mm
- 工单二维码25mm置于页眉
- 款式不跨页（`page-break-inside: avoid`）
- 恰好3个款式时启用紧凑排版，长工单名、长关键备注、多色烫金基线必须保持单页
- 页脚含打印时间与页码

#### E.2.1 多设计图布局规则（预设）

一个款式可能有多张设计图（正面、反面、细节等）。打印时按固定规则排列，**只打印JPG/PNG**，CDR源文件不打印（车间看不到用）。

| 设计图数量 | 布局 | 单图尺寸 |
|---|---|---|
| 1张 | 居中 | 60mm × 60mm |
| 2张 | 横向并排 | 45mm × 45mm |
| 3-4张 | 2×2 网格 | 35mm × 35mm |
| 5-6张 | 3×2 网格 | 28mm × 28mm |
| 7-9张 | 3×3 网格 | 25mm × 25mm |
| 10张及以上 | 3列×N行 | 22mm × 22mm |

**布局要求**：
- 图片比例保持原始（`object-fit: contain`），不拉伸变形
- 图片间距4mm
- 有边框1px浅灰色，方便识别图片边界
- 图片按上传时间顺序排列（先上传的在前）
- 超过10张时，打印视图自动显示警告："设计图较多，建议分款式打印"

#### E.3 技术实现

**路由**：`/orders/[id]/print-view`（独立页面，无导航栏）

**关键CSS**：
```css
@page { size: A4 portrait; margin: 10mm; }
@media print {
  .no-print { display: none; }
  .order-item { page-break-inside: avoid; }
}
```

**自动打印**：
```tsx
useEffect(() => {
  window.print();
  window.addEventListener('afterprint', () => window.close());
}, []);
```

**PDF生成（服务端）**：
```ts
const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto(`${origin}/orders/${id}/print-view`, { waitUntil: 'networkidle0' });
const pdf = await page.pdf({ format: 'A4', printBackground: true });
```

---

### F. 数据存储与留存策略（v1.2 追加）

#### F.1 所有工单永久存数据库

- 工单从创建起立即写入`Order`表
- 款式、设计文件引用、生产任务分别入独立表
- 修改通过`OrderLog`表留痕：谁改、何时、改了什么（前后值）
- **不做软删除以外的删除操作**

#### F.2 查询与核对场景

系统原生支持：

- 按日期：管理员Dashboard按天/周/月展示
- 按销售/客服：列表过滤+累计汇总
- 按客户名称/简称：历史复购查询
- 按状态：待排产、生产中、待发货的工单列表
- 按工单号/快递单号：模糊搜索
- 历史追溯：查看3年前任意工单的完整信息和修改历史

#### F.3 设计文件存储

- JPG/CDR存阿里云OSS，数据库只存引用路径
- OSS配置生命周期：原图永久保留，可选压缩版本用于缩略图
- 定期清理删除工单的孤立文件（P1功能）

#### F.4 数据量估算

按每月1000单、每单平均5个款式估算：

- 核心表（Order/OrderItem/ProductionTask）：约3万行/年 → 一年不到100MB
- OrderLog：约10万行/年 → 一年约50MB
- 设计文件（OSS）：假设每单5MB → 约60GB/年

**结论**：5年内单机PG + 单个OSS bucket完全够用，不需要分库分表。

#### F.5 归档策略（P2）

当数据量超过单表1000万行时，建立`ArchivedOrder`表，把2年前的工单搬过去。主表保持热数据。MVP阶段**不做**此优化。

---

### G. 数据库部署（v1.2 追加）

#### G.1 使用Pigsty托管PostgreSQL

本项目使用 **Pigsty** 部署和管理 PostgreSQL。Pigsty对应用层透明（标准PG协议），`schema.prisma`无需任何改动。

#### G.2 建议启用的PG扩展

- `pg_cron`：替代部分Node定时任务（客服周期结算、师傅日薪汇总）可直接在数据库层跑
- `pg_stat_statements`：慢查询监控
- 可选：`pgaudit`（审计）、`pg_partman`（分区，P2阶段如需要）

**不需要**：`pgvector`（本项目无向量检索需求）

#### G.3 备份策略

利用Pigsty自带的`pgbackrest`：

- 每日全备（本地 + 异地）
- WAL连续归档（可按时间点恢复）
- 保留30天备份链

#### G.4 高可用

Pigsty支持主备+自动切换。**MVP阶段单机部署即可**，无需HA。P1/P2阶段如果业务依赖度提升，再考虑上主备。

#### G.5 部署形态

本项目使用**独立的 Pigsty 实例**，独立部署、独立运维、独立备份。不与任何其他系统共用数据库资源。

---

### H. OSS 文件上传方案（v1.2 追加）

#### H.1 直传模式（强制）

所有用户上传文件（设计图 JPG/PNG、CDR 源文件）**必须使用直传方式**：

```
浏览器 → 请求后端签发 STS token → 浏览器直接上传 OSS → 回调后端登记元数据
```

**禁止后端代传**（`浏览器 → 服务端 → OSS`），原因：
- CDR 文件可能 50MB+，代传会吃掉服务器带宽
- 代传会占用 Node.js 事件循环，影响其他请求响应

#### H.2 签发流程

1. 前端点上传 → 调 Server Action `requestUploadToken({ fileType, fileName })`
2. Server Action 检查权限、调用 STS 接口签发**一次性临时 token**（有效期 15 分钟，只允许 PUT 到指定路径）
3. 前端拿到 token 直传到 OSS
4. 上传完成后，前端调 Server Action `confirmUpload({ orderItemId, ossKey, fileType, fileSize })`
5. 后端校验文件确实存在 + 写入 `OrderItemDesign` 记录

#### H.3 存储路径规范

```
oss://print-shop-erp/
├── designs/
│   ├── {orderItemId}/
│   │   ├── {uuid}.jpg      ← 设计图
│   │   └── {uuid}.cdr      ← CDR源文件
├── cdr-bundles/
│   └── {bundleId}.zip      ← CDR汇总打包
└── thumbnails/
    └── {designId}_thumb.jpg ← 缩略图（由OSS图片处理生成）
```

#### H.4 限制

- 单文件最大 200 MB
- 允许的 MIME：`image/jpeg`、`image/png`、`application/x-coreldraw`、`application/octet-stream`（CDR 有时走这个类型）
- CDR 文件不生成缩略图
- 图片文件 OSS 自动生成 200x200 缩略图用于列表展示

---

### I. 可观测性（v1.2 追加）

#### I.1 目标

- **错误监控**：任何未捕获异常、Server Action 失败、推送失败能被第一时间发现
- **基础追踪**：能回答"这张工单从提交到发货每一步花了多久"
- **慢查询发现**：Prisma 慢查询（>500ms）被自动记录

#### I.2 技术选型

- **基础设施**：OpenTelemetry（Next.js 官方推荐）
- **错误监控**：Sentry
- **追踪可视化**：MVP 阶段用 Sentry 自带的 Performance；P1 阶段如需要可切换到 Grafana/Jaeger
- **PG 慢查询**：依赖 Pigsty 启用的 `pg_stat_statements`

#### I.3 接入方式

Next.js 项目根目录放 `instrumentation.ts`，Next.js 启动时自动加载。

MVP 阶段先接入：
- Sentry（SDK 方式，自动捕获 Server Action 和 API 异常）
- OTel SDK 的基础 HTTP + DB tracing

不做：
- 自建 Prometheus/Grafana
- 自建 ELK
- 完整的 RUM（前端性能监控）

#### I.4 关键业务指标

即使不搭复杂的监控，以下指标必须有方式查看：

- 今日工单数、完工数、发货数（在管理员 Dashboard 显示）
- 企业微信推送失败率（`NotificationLog.status='FAILED'` 计数）
- 师傅日薪结算成功/失败（定时任务结束写日志）
- 客服周期结算成功/失败（同上）

---
