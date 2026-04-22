# 红包印刷 ERP 系统需求文档

> **文档版本**：v1.2（**冻结版**）
> **冻结日期**：2026-04-22
> **状态**：进入开发阶段
> **项目代号**：print-shop-erp

---

## 0. 文档说明

本文档是系统开发的**权威业务规格**。所有开发决策、代码实现、测试用例都以本文档为准。v1.2 较 v1.1 的主要变更：

- 计件算法最终定版：双面/双色多维度乘倍、机器特异性
- 工艺-机器映射表完整，激凸归风车机、UV和啤为外协
- 报价表细节降级为P1/P2事项，MVP阶段金额手填
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
- CDR文件统一管理，车间主管一键打包发外协
- 关键事件通过企业微信机器人实时推送

### 1.3 范围边界

**包含**：工单管理、设计文件管理（JPG+CDR）、生产任务分派与扫码报工、外协管理、产品与报价字典（参考）、双库存（P1）、三套薪资体系、销售月度账单、企业微信推送、多角色权限、PC+手机H5。

**不包含**：终端客户CRM、在线支付、电子发票、硬件打卡、国际化、多工厂、高并发架构、复杂财务分录、与任何未声明的外部系统集成。

---

## 2. 角色与权限

### 2.1 角色定义

| 角色枚举 | 中文名 | 主用终端 | 结算方式 |
|---|---|---|---|
| OWNER | 老板 | PC | — |
| FOREMAN | 车间主管 | PC + 手机 | 系统不管 |
| SALES | 外部销售 | 手机 + PC | 按报价表应付工厂 |
| CUSTOMER_SERVICE | 客服 | 手机 + PC | 2000底薪 + 4月累计提成 |
| WORKER | 师傅 | 手机 | 按身份不同 |

师傅（WORKER）通过`workerType`+`machineType`细分：

```
workerType ∈ {MACHINE, PACKER, CLEANER, COOK}
  当 workerType=MACHINE 时：
    machineType ∈ {HAND_PRESS, WINDMILL, GLUE}
```

**师傅一人一岗，不支持一人多岗**。

### 2.2 权限矩阵

| 能力 | 老板 | 主管 | 销售 | 客服 | 开机师傅 | 打包/清废 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 查看所有工单 | ✓ | ✓ | 仅自己 | 仅自己 | 分配任务 | 分配任务 |
| 创建工单 | ✓ | ✓ | ✓ | ✓ | — | — |
| 修改工单（未排产前） | ✓ | ✓ | 仅自己 | 仅自己 | — | — |
| 修改工单（排产后） | 仅地址/备注 | 仅地址/备注 | — | — | — | — |
| 标记急单 | ✓ | ✓ | ✓ | ✓ | — | — |
| 排产、派师傅 | ✓ | ✓ | — | — | — | — |
| 外协管理 | ✓ | ✓ | — | — | — | — |
| 物料出入库（P1） | ✓ | ✓ | — | — | ✓（领料） | — |
| 报工 | — | — | — | — | ✓（自己任务） | ✓（自己任务） |
| CDR汇总下载 | ✓ | ✓ | — | — | — | — |
| 查看所有应收账单 | ✓ | — | — | — | — | — |
| 查看自己账单 | — | — | ✓ | — | — | — |
| 查看自己工资/业绩 | — | — | — | ✓ | ✓ | ✓ |
| 查看所有薪资 | ✓ | — | — | — | — | — |
| 管理产品/报价字典 | ✓ | — | — | — | — | — |
| 管理薪资规则 | ✓ | — | — | — | — | — |
| 管理工艺字典 | ✓ | — | — | — | — | — |
| 管理推送规则 | ✓ | — | — | — | — | — |
| 管理账号 | ✓ | — | — | — | — | — |

---

## 3. 核心业务流程

### 3.1 销售/客服创建工单

```
登录 → 新建工单 → 填工单头（客户代号、收货信息、包装要求、备注、是否急单）
  → 添加款式（可多款式）
      ├─ 款式名
      ├─ 规格（中/大/方形/西封...）
      ├─ 纸张
      ├─ 工艺（多选，从工艺字典）
      ├─ 烫金颜色
      ├─ 数量
      ├─ 是否双面
      ├─ 是否双色
      ├─ 金额（手填，可点"建议价"参考报价表）
      ├─ 上传设计图（JPG/PNG，多张）
      └─ 上传CDR源文件（多个，可选）
  → 系统累加款式金额为工单总额
  → 提交
  → 工单状态：DRAFT → SUBMITTED
  → 企业微信机器人推送到"排产群"
```

### 3.2 排产与外协（车间主管）

```
车间主管查看"已提交"工单
→ 对每个款式的每个工艺：
    ├─ 若 Craft.isOutsource=true → 加入外协清单
    └─ 否 → 创建生产任务，按 Craft.defaultMachineType 推荐师傅
→ 若有外协工艺 → 创建外协单 → 发印刷厂 → 等回货
→ 外协回货后 → 工单可排产
→ 确认所有任务派师傅完毕 → 工单状态：SUBMITTED → SCHEDULING
→ 企业微信机器人推送对应师傅群
```

### 3.3 师傅报工

```
师傅手机H5 → 扫工单/任务二维码
→ 查看任务详情 → "开始生产"
    └─ status: PENDING → IN_PROGRESS，记录开始时间
→ 生产完成 → "完工"
    ├─ 填：合格数、不良数、返工数
    ├─ 系统自动：
    │    ├─ 抓取师傅当前机器类型的薪资规则
    │    ├─ 计算本任务计件金额
    │    ├─ 将规则快照写入任务记录
    │    └─ 更新当日日薪记录（所在日期的DailyWorkerSalary）
    └─ status: IN_PROGRESS → COMPLETED
→ 当工单所有任务完工 → 工单状态：SCHEDULING/IN_PRODUCTION → COMPLETED
```

### 3.4 发货

```
工单COMPLETED → 车间主管打包 → 填快递单号、发货日期、件数
→ 状态：COMPLETED → SHIPPED
→ 企业微信推送给提交人（可选）
```

### 3.5 CDR汇总下载

```
车间主管 → CDR汇总页面
→ 筛选日期范围 → 勾选工单/文件
→ 点"生成下载包"
    ├─ 系统打包ZIP（内部按工单号分文件夹）
    ├─ 生成24小时有效下载链接
    └─ 写入DesignBundle记录
→ 车间主管复制链接发外协模具厂
```

### 3.6 工单修改

```
打开工单 → 按状态判断可修改性
  ├─ DRAFT / SUBMITTED：全部可改
  ├─ SCHEDULING / IN_PRODUCTION：仅改收货信息/备注
  └─ COMPLETED 及之后：不可改
→ 每次修改写 OrderLog
```

### 3.7 客服周期结算

```
客服开户 → 系统创建 SalaryPeriod（start=本月，end=4月后）
→ 每次该客服提交工单 → period.totalSales += 工单金额
→ 周期结束当日（定时任务）:
    ├─ 查 SalaryRule 找档位
    ├─ 计算提成 = totalSales × tierRate
    ├─ 生成 CustomerServiceCommission 记录
    ├─ 周期 status: IN_PROGRESS → SETTLED
    └─ 自动开启下一个周期
→ 企业微信推送老板和客服
```

### 3.8 师傅日薪结算

```
每日 24:00 定时任务 → 对每位开机师傅:
    ├─ 汇总当日所有 ProductionTask.pieceworkAmount
    ├─ 查 SalaryRule 取当日保底
    ├─ 生成 DailyWorkerSalary:
    │    actualSalary = max(汇总计件, 保底)
    └─ 企业微信推送车间群（可选）
```

### 3.9 时薪工月结

```
车间主管每日录入时薪工上下班时间 → 系统算当日工时
月底定时任务 → 对每位时薪工:
    ├─ 汇总本月总工时
    ├─ 计算：正常工时 × 时薪 + 加班工时 × 时薪 × 加班倍率
    └─ 生成 HourlyWorkerPayroll
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
foilColor              烫金颜色
isDoubleSided          是否双面 ★（影响开机仔计件）
isDoubleColor          是否双色 ★（影响开机仔和风车机计件）
unitPrice              单价（手填）
subtotal               小计（手填）
suggestedPrice         建议价（报价表算出）
remark
```

#### ProductionTask（生产任务）

```
orderItemId            关联款式
craftId                工艺
workerId               师傅
machineType            师傅当时机器类型（快照）★
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

**工单**：DRAFT → SUBMITTED → SCHEDULING → IN_PRODUCTION → COMPLETED → SHIPPED → FINISHED

**生产任务**：PENDING → IN_PROGRESS → COMPLETED

**客服周期**：IN_PROGRESS → SETTLED

**外协单**：SENT → IN_PROGRESS → RECEIVED

任意非终态均可转 CANCELLED（需对应权限）。

---

## 5. 薪资体系（核心算法）

### 5.1 算法原则

**三条铁律**：

1. **所有薪资参数存数据库**：老板随时可改，不改代码
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
        and quantity < machine_rule.smallOrderThreshold):
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
            + press_count * machine_rule.pieceRate)


def calc_daily_salary(worker, date):
    """计算单日师傅日薪"""
    tasks = get_completed_tasks(worker, date)
    total_piecework = sum(t.pieceworkAmount for t in tasks)
    base = worker.machine_rule.dailyBase
    return max(total_piecework, base)
```

**关键参数**（初始值，可修改）：

| 机器 | dailyBase | pieceRate | boardRate | smallThreshold | smallFlatPrice | multiplierFactors |
|---|---|---|---|---|---|---|
| HAND_PRESS（开机仔） | 100 | 0.007 | 5 | 1000 | 12 | [DOUBLE_SIDED, DOUBLE_COLOR] |
| WINDMILL（风车机） | 120 | 0.01 | 0 | 1000 | 20 | [DOUBLE_COLOR] |
| GLUE（黏封机） | 120 | 0.002 | 0 | — | — | [] |

### 5.3 客服提成算法

```python
def calc_cs_commission(period, tiers, mode="FLAT"):
    """计算客服周期提成"""
    total = period.totalSales
    
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

系统上线时，老板可为每个客服初始化：

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
- `isOutsource=true` 的工艺**不创建生产任务**，只加入外协清单
- `defaultMachineType` 决定派师傅时的默认建议
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
| T2 | 5000 | 否 | 5000 | 50元 |
| T3 | 8000 | 是 | 16000 | 160元 |

当日计件合计：20+50+160 = **230元**
当日保底：120元
**实发：max(230, 120) = 230元**

### 7.3 客服周期结算示例

客服小王 2026-01 ~ 2026-04 周期：

- 累计业绩：55万
- 查档位：50万 ≤ 55万 < 60万 → 命中 tier 5（rate=0.06）
- 提成：550000 × 0.06 = **33000元**
- 4月底薪合计：2000 × 4 = 8000元
- 周期总收入：**41000元**
- 前3月已发：6000元
- 第4月发：2000（底薪）+ 33000（提成）= **35000元**

### 7.4 打包工月工资示例

打包阿姨 2026-05：

- 正常工时：22天 × 8小时 = 176小时
- 加班：12小时
- 时薪：11元，加班倍率：1.0

月工资：176×11 + 12×11×1.0 = 1936 + 132 = **2068元**

---

## 8. 通知推送

### 8.1 事件-渠道映射

| eventType | 触发时机 | 默认渠道 |
|---|---|---|
| ORDER_SUBMITTED | 新工单提交 | 排产群 |
| URGENT_ORDER | 急单提交 | 排产群+老板群 |
| ORDER_SCHEDULED | 工单排产完成 | 对应师傅群 |
| ORDER_COMPLETED | 工单所有任务完工 | 发货群 |
| ORDER_SHIPPED | 工单发货 | 老板群 |
| OUTSOURCE_OVERDUE | 外协超预计回货日 | 管理群 |
| STOCK_ALERT | 物料低于安全库存（P1） | 管理群 |
| CS_PERIOD_ENDING | 客服周期前7天预警 | 老板群+对应客服 |
| CS_PERIOD_SETTLED | 客服周期结算 | 老板群+对应客服 |
| DAILY_WORKER_SALARY | 师傅日薪结算 | 车间群 |

### 8.2 消息模板

所有消息使用Markdown格式，推送到企业微信机器人Webhook。消息模板存在`NotificationRule.messageTemplate`字段，支持占位符`{orderNo}`、`{submitterName}`、`{amount}`等。

失败重试3次，3次后写入`NotificationLog.status=FAILED`，老板Dashboard显示告警。

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
- 车间主管汇总下载、24小时链接

**推送**
- 企业微信Webhook配置、10个预置事件、推送日志

**统计**
- 老板Dashboard、基础生产和销售报表

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

**MVP阶段**：报价表存为参考字典，销售/客服录单时金额手填，系统提供"建议价"按钮仅作提示。

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

- 规格：A4纵向（210×297mm），边距15mm
- 不含任何价格、金额、成本信息
- 急单顶部红条+大号红字提示
- 每款式独立一块（左设计图、右信息表）
- 每任务独立二维码，尺寸15mm
- 工单二维码25mm置于页眉
- 款式不跨页（`page-break-inside: avoid`）
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
@page { size: A4 portrait; margin: 15mm; }
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

- 按日期：老板Dashboard按天/周/月展示
- 按销售/客服：列表过滤+累计汇总
- 按客户代号：历史复购查询
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

- 今日工单数、完工数、发货数（在老板 Dashboard 显示）
- 企业微信推送失败率（`NotificationLog.status='FAILED'` 计数）
- 师傅日薪结算成功/失败（定时任务结束写日志）
- 客服周期结算成功/失败（同上）

---
