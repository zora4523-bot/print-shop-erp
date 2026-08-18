# 会话交接

> **每次新对话开始前，先读这份文件。** 它记录了上次会话停在哪、下次该接着做什么。
>
> 本文件每次 session 结束前**整体重写**（除"历史"小节是追加式时间线）。

---

## 当前任务

**对客加工费自动报价、身份结算隔离、员工工资规则、供应商应付账本、改单审批重报价、外部销售快递/耗材费、收费项目管理工作台，以及产品价格阶梯合并编辑已在本地发布候选完成** ✅。完整候选**已由本次 Git 提交固化，但尚未部署**；生产仍运行 `aa42ba0`（2026-08-02）。

- 结算方向：工单创建时冻结外部销售应收、内部客服业绩、工厂直接业务或免费重做，不根据账号后续角色反推历史资金归属。
- 客户报价：产品数量阶梯/基础单价叠加按个、按张、每万个、每款一次收费项；支持产品、工艺、规格、纸张、颜色、单双面/单双色、数量和结算方向条件。创建工单时服务端在事务内重新报价并保存不可变分项快照。
- 外部销售价目簿：`长昆-线下报价表(3)(1).xlsx` 已按来源 SHA-256 导入独立版本，包含 8 个可扩展收费类目、22 个报价产品、111 条来源规则及 10 条防漏收围栏。外部销售只查询当前发布版本，不回退到内部/直客旧规则；管理员通过“复制草稿 → 校验 → 发布”调价，不能原地改历史规则。非锚点、多色、缺色、低数量彩印+烫金、产品/工艺不匹配及原表歧义均转人工确认。
- 收费管理：管理员左侧“外部销售收费”直达 `/owner/prices/external-sales/items`，以 `purpose=processing|logistics` 查找和编辑加工费、快递费或耗材费；版本校验与发布独立在 `/owner/prices/external-sales/versions`。销售查询仍为 `/sales/quote?section=processing|logistics`。规则代码、JSON、来源范围、SHA 和匹配器不进入客户端，只留在数据库与服务端审计；规则/草稿乐观锁阻止多人陈旧覆盖。
- 产品价格阶梯：同一纸张下按产品/工艺/规格显示一个收费项目；例如“157克双铜纸彩印 大号”的 7 个精确数量锚点在一个编辑器内统一查看和修改金额/启停。只合并服务端严格证明匹配条件、来源和计价语义完全相同的 BASE 精确锚点；157 克与 200 克、范围价、附加费和人工参考项不会混组。底层规则仍逐档独立，保存必须完整覆盖全组并在一个事务内通过逐行乐观锁、Decimal 写入、整组校验和审计，任一档失败则全部回滚。
- 本轮验收：183 个测试文件 / 2441 项单测、typecheck、全库 lint、Prisma validate、生产 build、`git diff --check` 全绿；375×667 与 1280×800 的明暗模式分别覆盖当前固定总价、草稿固定总价和草稿按个单价，共 12 个确定性响应式与 axe 场景。真实本地管理员页面确认 157 克 7 档金额完整、技术字段零泄露、控制台无报错；禁用 JavaScript 的登录、登出、改密码 Playwright **3 / 3** 通过。该结果只代表本次本地提交，不代表生产已更新。
- 外部销售物流价目簿：新增独立 `LOGISTICS` 用途，与加工费 `PROCESSING` 价目互不可见。中通规则来自 `长昆中通报价表(1).xlsx`（SHA-256 `a92088a9ba0093afcbb96c6b3b182ab29e4f7d675cacf929c6745987bf4d6060`），纸箱建议来自 `纸箱价格表1(1).xlsx`（SHA-256 `9f0c30333a737ab9d36398b8af2c84ece599317f9df21af5dacb8f365fa5401b`）。
- 收费口径：每条 shipment 是一票运单，独立起算首重；同地址多包裹也要拆成多条发货记录。系统只接受承运商已进位的计费重量，不猜裸重取整。纸箱表的 ¥1/¥3/¥5/¥7/¥8 只是按每票分配数量生成的非强制建议，5000 个以上、其他承运商或任何差异都要人工确认并留理由。
- 冻结与账本：创建时以 `ESTIMATED` 保存每票收费和价目版本，管理员发货时按同一冻结版本终审为 `FINAL`。对客快递/耗材记入 `OrderCustomerCharge`，工厂内部成本仍记 `OrderCostEntry`；顺丰到付只免对客快递费，耗材费仍需确认。旧外部销售工单只回填零元结构行，不追溯猜价、不改旧账单。
- 起订量：产品 MOQ 是服务端报价事实；数量不足或 MOQ 配置无效时自动报价失败关闭，特殊订单只能在写明人工定价原因后继续。
- 金额守卫：数量、单价、一次性费用、款式小计和整单总额均在数据库前按 Decimal 精度/上限拒绝异常；人工差价和规则不完整都必须写原因，绝不静默落为 0。
- 单据变更：数量、规格、烫金色和新增款式在批准时按合并后事实重报价；只改名称保留原价。管理员先看新旧金额、差额和逐款完整性预览，批准时仍在写事务内按最新规则重算；无法完整报价时，审核备注是显式沿用旧价的必要依据。
- 并发：报价读使用共享事务锁，产品基础价/阶梯/收费项写使用同一把独占事务锁；时薪批次先固定一份规则 bundle，避免混用两代规则。
- 内部工资：`/owner/salary/rules` 可版本化设置客服底薪/周期/销售额提成、打包/清废/厨师时薪、加班倍率、工时和厨师月薪；开机师傅个人机型计件规则保持独立覆盖并同事务审计。
- 历史工资：日薪批次从已完工任务的工种/机型/计件金额快照选人，时薪批次从考勤发生时的角色/工种快照选人；账号后续改岗或停用不再漏算已发生记录。迁移只接受能由同期工资快照或“账号身份早于考勤创建”证明的旧考勤，歧义行会列 ID 后中止。
- 供应商应付：外协合计数量由服务端从锁定款式派生；确认金额、变更和逐笔付款走独立账本并禁止超付。供应商合同公式尚未定义，当前金额必须人工确认，不能套用客户报价或员工工资。
- 权限：销售账单详情仅返回本人外部应收所需字段，不查询或展示工厂计件、外协、重做、伙食、电费等内部成本；师傅列表、详情和日志也由服务端最小投影裁掉客户金额、报价快照与审核备注；管理员仍有完整财务对账视图。
- 历史字段：`OrderItem.suggestedPrice` 继续表示历史建议单价，当前自动报价小计使用 `suggestedSubtotal`；迁移只改写可由合法快照严格证明的过渡数据，不能证明就中止。
- 数据库：本次提交共 **74 migrations**，尾部为 `20260808100000_external_sales_logistics_charges`；一次性 PostgreSQL 16 干净隔离库已从头通过 74 / 74。默认本地历史库仍因一张已结清账单触发财务护栏而拒绝自动改写，必须先确认归属后显式修复；两项事实都不是生产数据库状态，生产仍为 45 / 45。

同一发布候选还包含上一批工单列表/导出和详情修复：

- 工单列表：默认 `createdAt DESC, id DESC`，服务端稳定分页；37 类筛选可独立或组合使用，且不绕过现有角色数据范围。
- 筛选回归：chip /“清除全部”后原生表单会按规范化 URL 重建；烫金色筛选以反斜杠转义颜色名内逗号和反斜杠并兼容旧链接；WORKER 的列表、详情、打印/PDF 共享 scope 均排除 `SUBMITTED` 排产草稿。
- 管理员导出：可选全部工单或当前筛选的全部命中项；HEAVY worker 生成 11 工作表 XLSX，24 小时过期，仅发起人本人的有效 ADMIN 可下载。
- 导出可靠性：过期任务不能复活，事务响应丢失不会误删已发布文件，FAILED 下载是明确终态；终态筛选收据仅留 scope，不留原始参数或可枚举哈希。
- 运维：新增第 8 个认证 cron `order-export-cleanup`；READY 产物 24 小时过期，orphan 约 48 小时后回收，每次最多处理 500 条并可续跑。
- 数据库：本轮最终候选已在本地库及一次性 PostgreSQL 16 空库验证 **71 / 71 migrations**；空库还执行 seed 与管理员 Dashboard 真页面 E2E，临时库验证后已明确销毁。
- 工单详情：`OrderItem.crafts` 仍保存稳定 ID，但 `getOrderDetail` 会一次批量解析中文名；停用工艺保留历史名称，缺失字典项显示“已删除工艺”。款式卡改为“数量 / 单价 / 小计”、四位单价、语义化工艺和生产安排；无任务明确显示“尚未排产”。
- 验收：Prisma validate/status、typecheck、lint、生产 build、`git diff --check`、**156 测试文件 / 2070 单测**全绿；一次性空库的登录、Dashboard KPI/关注列表/延迟图表 E2E 通过。上一轮 6 视口 × ADMIN/SALES × 明暗的裁切/溢出/触控/axe 门禁 **24 / 24** 结果继续保留。真实草稿单 `GD-260807-001` 已在本地浏览器确认显示“局部烫金 / 尚未排产”，不再泄漏内部工艺 ID。

下方为已在生产运行的上一批业务基线：

- 多地址：`OrderShipment / OrderShipmentLine` 保存地址与款式分配，历史工单回填为单地址；主地址兼容快照保留并与编辑同步，发货要求完整、顺序一致的地址集合后原子确认。
- 售后重做：SHIPPED / FINISHED 原单可创建 `REWORK + NO_CHARGE` 子工单；复制所选款式和设计证据后进入待排产，原单状态/应收/工资不回退，重做生产仍正常计件。
- 管理端：列表/详情展示提交人、实际师傅、顺丰到付、多地址、原单/重做关联；顺丰到付可后期独立更正。
- 排产：单工单工艺行可多选；待排产列表先选师傅，再从最多 30 张工单批量分配其兼容工艺。混合机型可分步派给不同师傅并显示已排/待排；草稿任务在全部派完前不向师傅开放，最后一项完成后原子进入 SCHEDULING。
- 打印：A4 边距 10mm，3 款启用紧凑布局；长名称、长红色备注、多色烫金 fixture 的 Chromium 截图和 PDF 单页断言通过。
- 工单变更：销售/客服创建带版本的修改申请，管理员批准后原子更新所有端口；版本冲突和已开工数量变更硬阻断。
- 混合工艺：彩印+烫金同时生成外协与厂内任务，回厂阶段可排风车机/机仔师傅。
- 师傅端：急单优先后按工单创建日期排序；支持多选一键开工/完工，任务详情展示设计图与接单人。
- 薪资/考勤：风车机新阶梯与账号级规则覆盖落地；工资可按日期查超底薪原因；全体正式员工考勤支持 0.5 天。
- 财务：客服销售额、客户结款、客服工资发放、工单成本分别记不可覆盖流水。客服工单提交/批准金额变更/取消分别记正数/差额/负数业绩；客户 `BillPayment` 只改应收，不改业绩。账单展示每次结款、提成、成本和毛利，售后重做成本归回原账单。
- 客服周期：新建在职客服账号自动建周期；业绩发生日无可用周期时工单操作整体回滚。结束日是包含式上海自然日，次日结算并自动开下一周期；底薪可分次发，提成只能结算后发。
- 金额一致性：时薪工资先舍入各分项再求和；日薪重算不再把负实发静默截零；客服累计加期初校准有联合上限。旧客服工单流水未与当前金额对平时，修改/取消会整体阻断并提示历史财务校准。
- 外协成本：创建请求全链 UUID 幂等；报价未知可留空，回货后可补录/更正金额。金额变更追加保留旧值、新值、原因、操作人和时间，并与业务审计同事务写入。
- 账单对账：原单与重做单成本流水都可见；历史账号改岗不影响客服业绩区块；跨周期提成标为估算，迁移前累计收款显示“历史期初 · 时间未知”。
- 后台批次：日薪、时薪和账单遇未知数据库/程序异常会携部分进度重抛，durable job 正确重试，不会将漏算任务标成成功。
- 认证：JWT 只作会话提示，页面与 Server Action 使用前按用户主键实时校验账号存在、启用状态和当前角色；账号在排产页打开后失效会返回重新登录入口，事务不落任务、不进入整页错误边界。
- 多能力派工：开机师傅账号配置“主机型 + 多设备能力 + 熟练工艺”；排产与改派分为推荐、可分配但需说明、硬阻断。非推荐原因写 `OrderLog`，实际设备写 `ProductionTask.machineType`，个人计件规则可覆盖每一种登记设备。
- 一次性 PostgreSQL 16 空库已从头应用 **45 项 migrations** 至 `20260802113000_hourly_payroll_reconciliation`；另注入旧时薪差分数据，确认已发放异常会中止、人工确认后未发放记录自动对平。
- 上一轮（不含本次物流扩展）最终验证：**161 个测试文件 / 2118 个单测**、typecheck、lint、Prisma validate/generate、73 / 73 migrate status、生产 build 与 `git diff --check` 全绿。上轮客服金额 E2E、4 项批量排产 E2E、375px 明暗与 1280px 管理端溢出/axe 门禁结果继续保留，但不替代新页面/新迁移的验收。
- 生产发布：<https://bag.sshapi.cn> 运行 `aa42ba0`；生产库已从 33 项升级为 **45 / 45 migrations**。迁移前 full backup 为 `20260802-193420F`，连续 WAL 正常，但目前仅有 repo1、保留 2 份 full，尚未达到两 repo / 30 天基线。
- 发布源连续性：生产 SHA 来自本地分支 `codex/complex-client-data-layer-poc@aa42ba0`；本地 `main` 仍停在 `245be5c`，且仓库当前没有配置 Git remote。`aa42ba0` 尚不能通过默认 `git pull` 或从 `main` 重建，下一次发布前必须先明确合并与远端备份策略，禁止误发旧 `main`。
- 生产验收：Web、LIGHT、HEAVY 三进程在线且 PM2 已保存；ready 200、DB `ok`、库存差异 0、无 warning。系统 `/usr/bin/chromium` 成功生成 37,646 字节中文测试 PDF，公网 login / ready TTFB 分别约 0.15 / 0.41 秒。
- 生产资源：应用机 1.6 GiB RAM + 4 GiB swap，构建的 TypeScript 阶段用时约 10.9 分钟并出现明显 swap I/O；运行正常，但下一次大发布前宜升级至至少 4 GiB。

## 下一步具体指令（给下次 AI）

1. 当前发布候选已由本次提交固化但尚未部署；不要把提交内的 74 项 migration 误记为生产事实。发布前先核对生产仍运行 `aa42ba0`、45 / 45 migrations 和 ready 200，并单独获得发布授权。迁移开始后继续只允许前向修复。
2. 先解决发布源连续性：确认是否把 `codex/complex-client-data-layer-poc` 合并进 `main`，并配置受控远端保存 `aa42ba0` 及后续提交。完成前不得按旧部署指南直接 `git pull`，也不得从 `main@245be5c` 发版。
3. 优先补齐运维缺口：Pigsty 异地 repo2、30 天保留、恢复演练；生产 `SENTRY_DSN / APP_VERSION`；应用机至少 4 GiB RAM。
4. 修正发布 smoke 的运行时口径：生产固定使用 `/usr/bin/chromium`，smoke 必须带和 `lib/pdf/render.ts` 相同的 `--no-sandbox / --disable-setuid-sandbox`，并应在 `deploy/update.sh` 停机前执行浏览器 preflight。
5. 重点人工验收：先用外部销售从 `/sales/quote?section=processing` 核对加工费、从 `/sales/quote?section=logistics` 核对快递/耗材只读价目，再在 `/orders/new` 分别验证原表锚点、非锚点、多色和人工改价原因。物流部分要另测广东/普通/偏远地区、0.5kg 档、同地址多包裹拆票、超 5000 个人工耗材、顺丰到付“快递 ¥0 但耗材仍收”，并从创建 `ESTIMATED` 一直验到管理员发货 `FINAL`、外部销售/管理员账单分项对平。管理员从 `/owner/prices/external-sales/items?purpose=processing|logistics` 查找和修改草稿项目，再到 `/owner/prices/external-sales/versions` 校验并发布。随后再验内部客服/管理员不误套外部价、改价审批、真实 OSS 图片 PDF、企业微信、cron、批量报工、分次结款、多地址和售后重做。
6. 多机扩容前，PDF 产物必须迁到共享对象存储；当前单机 PM2 基线用 `/var/tmp/print-shop-erp/pdf`。原架构报告与 A07/A20 待办仍保留；A21 只剩需业主提供合同口径的供应商自动定价，不得猜公式。

## 卡住的问题

- 当前默认本地开发库 `print_shop_erp` 尚不能直接跑本发布候选：前向 migration `20260807180000_order_pricing_and_settlement` 的财务护栏识别到已全额结清账单 `cmsbmplo40008850rahu58pb4`（已付 ¥3000、2 笔付款）混入非外部销售项目，拒绝自动改写。失败 migration 已按 Prisma 标准流程标为 rolled back，未删除或修正业务行；本轮所有真页面验收改在临时干净库完成并已删除。后续必须先由业务负责人决定该历史账单归属，再显式修复数据，不能绕过护栏或猜测重分账。
- 生产 pgBackRest 当前只有 repo1 且仅保留 2 份 full；即时备份和 WAL 虽正常，但两 repo / 30 天 / 月度恢复演练目标仍未达成。
- 当前发布分支领先 `main`，且仓库无 Git remote；在合并/远端策略确认前，生产源码没有可依赖的远端恢复路径，`deploy/update.sh` 的默认 `git pull` 更新方式也不可直接使用。
- 生产尚未配置 `SENTRY_DSN`，`APP_VERSION` 也需核对；当前错误主要依赖 PM2/Next 日志。
- `deploy-smoke` 尚未自动继承 PM2 的系统 Chromium 路径与 root sandbox 参数，直接按旧文档运行会假失败；修复脚本前按部署指南的显式环境变量命令执行。
- 应用机仅 1.6 GiB RAM，构建严重依赖 swap；运行期可用，但发布和 Chromium 峰值余量不足。
- 新增三款 A4 视觉基线已生成；既有 7 张打印基线未重写。
- `pnpm-workspace.yaml` 的 `allowBuilds` 占位符待业主定夺。
- A07/A20 等业务输入，以及供应商合同自动定价的工艺、单位、阶梯、最低收费与有效期口径。
- 后台任务账本尚无自动保留清理策略；上线后按实际增长率决定 SUCCEEDED/CANCELLED/DEAD 的保留窗口，并单独设计清理任务。
- 已结算/已发客服提成遇跨周期撤单或降价时，尚缺业主确定“下期扣回 / 历史工资调整 / 不追溯”政策；客服停用或改岗时同样不能猜测。当前代码宁可整体阻断，也不会静默错账。
- 已发布报价条件仍有 `productCodes / craftCodes` 字符串引用；后续如允许修改产品/工艺编码，需改用稳定 ID 或在仍被 CURRENT/SCHEDULED 价目引用时阻止改码。当前失配会失败关闭转人工，不会静默套错价。
- 若未来新增收费类目停用入口，必须先明确 `category.isActive` 是“全局紧急停收”还是“随冻结版本不漂移”；当前没有类目停用 UI，不得自行扩展。

## 历史（追加式时间线）

- 2026-04-22：建立了项目记忆管理体系（PROGRESS / DECISIONS / HANDOFF + CLAUDE.md §13）。
- 2026-04-22 → 2026-04-23：完成 P0 #1 认证与用户管理全部切片。149 单测，Codex 15 轮 review。
- 2026-04-23：完成 P0 #2 工艺字典 + 产品字典。+100 单测（累计 249），Codex 9 轮。
- 2026-04-23：完成 P0 #3 工单核心（E-lean）。21 commits，+151 单测（累计 400），Codex rounds 25–36。E-full 延期 P1。
- 2026-04-23：完成 P0 #4 生产流程。+107 单测（累计 507），Codex rounds 37–42。
- 2026-04-24：完成 P0 #5 薪资系统 4/5 切片。+119 单测（累计 626），Codex rounds 43–47。
- 2026-04-24：完成 P0 #5 Slice C（时薪工 + 考勤）。+90 单测（累计 716），Codex rounds 48–51。
- 2026-04-25：完成 P0 #6 Slice A 应收账单后端。+56 单测（累计 772），Codex rounds 52–54。
- 2026-04-25：闭合 P0 #5 遗留 daily-salary race（commit `50956ee`）。+4 单测（累计 776）。
- 2026-04-25：完成 P0 #6 Slice B/C/D 账单 UI + cron。Codex rounds 55–63。P0 #1–#6 全 clean。
- 2026-04-25：上线前运维补齐 + Sentry 隐私收紧（rounds 64–69）。
- 2026-04-25 → 2026-04-26：本地真跑暴露 4 个 prod-only bug 全修（rounds 70–72）。
- 2026-04-26：Playwright E2E + 视觉回归落地（5 waves，13 测试，rounds 73–94）。
- 2026-04-26：SHIP / FINISH 状态机收尾，Order.status 写入路径统一 advisory lock（rounds 87–88）。
- 2026-04-26：Admin shell scaffolding（AppSidebar / AdminBreadcrumb，round 81 收敛）。
- 2026-04-26 → 2026-04-27：P1 #1 管理员 Dashboard 三切片（KPI / 关注列表 / recharts 图表）。+68 单测（累计 870），rounds 98–100。
- 2026-04-27 → 2026-05-05：P1 #2 企业微信推送四切片（引擎 / admin UI / 状态机 wire / cron）。+121 单测（累计 991），rounds 101–118。
- 2026-05-05：P0 #7 CDR 汇总下载落地。+20 单测（累计 1011）。
- 2026-05-06：CDR 收尾审计 8 轮（rounds 119–126，baseUrl 推导硬化）。+12 单测（累计 1035）。**P0 9/9 收官**。
- 2026-06-28：（Codex 批次，工作区交付）Pigsty 扩展 PR-1..10 + admin 框架 A11–A15 + ERP 主数据 A16–A19 + 审计 A22 + 客户端数据层 POC A23 + agent 自动化协议（backlog / routines / agent:next）。16 个新 migration。
- 2026-07-05：（本 session）UI Phase A–E 之后的工作区大批次全量验证绿（1214 单测 / 21 Playwright / build / lint / typecheck / migrate deploy）；A09 分区 cutover 计划交付 `docs/partition-cutover-plan.md`（Codex 2 findings 闭合）；PROGRESS.md 刷新到真实状态。队列无 `agent-ready` 任务，剩余项等业主输入。
- 2026-07-05：（业主授权）大批次按模块拆 12 commit 固化（`c84162f → accb713`）；STOCK_ALERT 出库跨越检测接线收官 SPEC §8.1 10/10 事件（`3184a26` + `4f76a85`，Codex 抓 payload 丢尾零 + 测试锁提交顺序，复核 clean）。1220 单测 / lint / typecheck 全绿。
- 2026-07-05：**A06 OSS STS 真实接入**（`968b131` feat + `d65804f` / `89b1302` fix，Codex rounds 抓 6 真 bug）。业主提供 bucket `hongbaowebdb` / region `oss-cn-guangzhou` / 角色 `erp-oss-upload` / 子账号 `webhongbao` AK（**曾误填 .env.example，已迁 .env 并恢复模板，密钥未进 git**；region 从完整域名归一化）。`ali-oss` + `archiver` 落地：signViaSts 真 AssumeRole（session policy 收缩单 objectKey，1h）+ CDR 流式打包（get→zip→putStream bundles/* + 24h 预签 GET，长期凭证——STS 1h 签不出 24h 链接）。Codex 6 修：endpoint 走 config、putStream settled 折叠防 unhandled rejection、CDR mock 非生产默认开、expiresAt 对齐签发时刻、malformed OSS_ENDPOINT 双路径降级（sign 折叠 error / isMockMode 降级 mock 防 /foreman/cdr 500）、PassThrough destroy 需先挂 error 监听器（否则崩进程）。真实冒烟：AssumeRole ✅ / 临时凭证 PUT design/* ✅ / 越权护栏 ✅ / 子账号直连 ❌（等业主挂策略）。测试对象遗留 bucket（无 DeleteObject 权限，预期）。1229 单测全绿。pnpm store v10/v11 冲突用 `CI=true pnpm install` 重链接解决。
- 2026-07-05：A06 全链路验证收官——业主挂好 `webhongbao` 对象策略后复跑冒烟 6/6 全通；真实 `uploadBundleZip` 端到端（archiver 流式打包 + 预签 URL 下载 + ZIP 魔数校验）通过。
- 2026-07-05：设计图上传 UI 接线（`3849cbd` + `ed9733e`）。工单详情页款式卡设计图面板（DRAFT 增删/其余只读）；预签 PUT URL 直传（前端零 SDK）；Codex 抓 5 真 bug 全修：sign 前置授权闸（防任意 id 铸凭证写孤儿对象）、HEAD Content-Length 权威 size + 上限兜底（防申报小传大）、order-cascade 锁内 fresh-read（防与提交并发 TOCTOU）、凭证 1h→15min（压缩重放覆写窗口，ETag 固定记 P1）、input 重置。预签 PUT 真实冒烟（含错误 Content-Type 403 护栏）通过。1242 单测。
- 2026-07-06：上线前检查 + 注释清理（`f0cebce`）。全库移除 90+ 处 "Codex round N" 溯源标注（保留约束说明；历史在 git log/HANDOFF/DECISIONS 可查），49 文件纯注释改动。教训：第一版全局正则把代码里的 `()` 也删了——回滚重做，改成只作用于注释行的脚本 + 跨行引用逐处手修。验证：tsc / eslint / 1249 单测 / next build / deploy:smoke（prisma validate + migrate status + mock-mode + Puppeteer + 路由探测）/ 21 Playwright E2E+视觉 全绿。生产部署剩纯运维动作（README §🚢）：服务器 .env 真值、NOTIFICATION_MOCK_MODE=false、OSS CORS 加生产域名、pg_cron 切换、pgbackrest、Pigsty 扩展安装。
- 2026-07-07：承诺交期 + 交期预警 + ORDER_OVERDUE 推送 + 二维码 URL 化（`d240061` / `1483867` / `5d6b04a` / `6c3fdc5`）。Order.promisedDate（2 个 migration：字段 + 规则行数据迁移）；预警口径集中 lib/order/promised-date（详情徽标 / dashboard 关注列表 / 每日 cron 三处共用）；第 11 个推送事件 ORDER_OVERDUE 只推逾期；QR 内容改 {base}/orders|worker/tasks URL（lib/public-base-url 与 CDR 共用推导，foreman-cdr 去重）；打印页眉加承诺交期行。Codex 抓 3 真问题：升级库缺规则行（数据 migration 修，高危）、视觉基线（按惯例截图待业主确认后提交）、cron E2E 缺口（补全链测试）。1264 单测 / 22 E2E 全绿。**待办：视觉基线 6 张 png 等业主看截图 OK 后以 [visual-regression] commit 提交。**
- 2026-07-08：上线前多维度审计（6 维度并行 audit → 逐条对抗性验证 workflow，54 agent；含手动核实）。发现并**即修 4 项**：(1) **blocker** `createOrderFromInput`/`scheduleOrderFromInput` 从 'use server' 导出成公开 Server Action、信任调用方 actor 无 requirePermission = 越权+审计伪造后门，零调用方直接删除（`5bdf5a3`）；(2) **high** `.env.example` 出厂 `NOTIFICATION_MOCK_MODE="true"` 会诱导运维带进生产静默 mock 推送→改留空按 NODE_ENV 判定（`3eaf050`）；(3) README env 表补 mock 开关行+OSS CORS 手动步骤+APP_PUBLIC_URL 扩到二维码、6→7 cron 漂移修正（`3eaf050`）；(4) **low** hourly-payroll cron 意外错误 scrub 对齐 COUNTS-ONLY（`c5ac707`）。1264 单测/tsc/eslint/build 全绿。**剩余为纯手动运维项**（见报告）：生产 .env 注入（APP_PUBLIC_URL/SENTRY_DSN/AUTH_SECRET 新值/DATABASE_URL 生产库）、OSS 控制台配 CORS、首次 seed、cron 调度器（crontab/pg_cron 7 端点）、Pigsty 扩展安装、pgbackrest、Puppeteer chrome、PM2/Nginx 自备。视觉基线 6 png 仍待业主确认后提交。
- 2026-07-09：全库架构体检（6 子系统深读 + 44 agent 提案验证 workflow）→ 7 个行为零变化重构切片落地（日期/cron 认证/OSS 工厂+锁 key/通知常量/collectFieldErrors/createOrder 批量/薪资规则查询，`06ecc62`→`f4b6ab7`），Codex 复核 PASS，1272 单测全绿；交付 `docs/架构体检报告-2026-07-09.md`（含行为缺口 A1-A7、结构债清单、已验证路线图、不做清单）；DECISIONS 记录去重边界决策。
- 2026-07-17：生产硬化：PostgreSQL 任务账本 + LIGHT/HEAVY worker + cron/通知持久化 + CDR/PDF 资源隔离 + live/ready + ADMIN 任务看板 + pgBackRest 验收脚本落地。本地 migration 和 PDF worker 真实演练通过；1296 单测 / lint / typecheck / build 全绿。
- 2026-07-17：生产硬化上线前纠偏：修复 worker 资源限制落在 tsx 包装进程、durable 通知可抛、终态 dedupe 永久占位、CDR 永久 PENDING、未知任务不进 fail、部署 env/重启配置和 PDF 排队体验；补齐生产分支测试，1353 单测 / lint / typecheck / Prisma validate / build 全绿。
- 2026-07-19：后台角色收敛：OWNER / FOREMAN 数据与权限统一迁移为 ADMIN，管理员菜单合并经营、生产、财务、字典和运维入口；保留 `/owner/*`、`/foreman/*` 旧 URL，旧 JWT 与早期默认姓名自动归一化。迁移已在本地库执行并确认 3 个管理账号全部为 ADMIN，后台不再展示“老板/车间主管”；1397 单测 / 3 项登录 E2E / lint / typecheck / Prisma validate / build / 页面实测全绿。
- 2026-07-19：新工单号改为 `GD-YYMMDD-XXX`（例 `GD-260719-001`），保留历史编号；上海业务日 advisory lock 与严格三位流水校验继续生效。配置迁移已执行，真实新建工单 E2E 与工单列表页面验证通过。
- 2026-07-31：管理端履约与售后增强：多地址发货/分地址运单、顺丰到付后期更正、免计费关联重做、批量派工与三款 A4 单页打印落地。本地迁移和真实 Chromium 打印验收通过；109 文件 / 1479 单测全绿。
- 2026-07-31：工单变更、生产、薪资与财务闭环：版本化修改申请、彩印+烫金混合排产、师傅批量开工/完工、风车机新阶梯与账号规则、日期底薪对比、全员半天考勤、客服销售额/结款/成本分账落地；111 文件 / 1496 单测、36 项跨设备 UI、8 项打印视觉/PDF、生产 build 全绿。
- 2026-07-31：待排产列表升级为按兼容工艺分步批量排产：先选师傅再跨工单勾选，混合机型可分两次派给不同师傅；PENDING 草稿由 Order 状态双重门控，全部派完才进入生产。真实同机型批量与混合机型两阶段 E2E 均通过。
- 2026-07-31：修复删除/停用账号的长效 JWT 仍可进入排产动作并在 OrderLog 外键处 500；统一数据库实时会话校验，排产动作提供重新登录恢复态，真实失效会话 E2E 验证零任务落库。
- 2026-07-31：多能力师傅与管理员最终派工落地：账号支持主机型/多设备/熟练工艺，单单/批量/改派统一推荐与硬资格，非推荐派工强制原因并审计；任务按实际设备计薪，个人规则覆盖全部登记机型。1527 单测、4 项真实排产 E2E、375px 明暗与 1280px 管理端 UI 门禁、生产 build 全绿。
- 2026-08-02：财务/薪资/外协对账审查以 `aa42ba0` 固化（121 文件 / 1688 单测、45 项 fresh migration 全绿），随后发布到 <https://bag.sshapi.cn>。Pigsty 上线前 full backup `20260802-193420F` 成功，生产 12 条待迁移全部应用，三 PM2 进程、ready、HTTPS 路由和系统 Chromium PDF 内存生成验收通过；同时确认 repo2/Sentry/内存升级与 smoke 口径为后续运维缺口。
- 2026-08-03：同步近期功能与生产事实到三份记忆文档、README、部署/冒烟/SLO 和同事使用手册；清除 A06、任务排序、工单修改申请与生产 Chromium 等陈旧口径，并记录发布分支领先 `main`、无 Git remote 的恢复风险。
- 2026-08-07：工单列表新单优先、37 类独立筛选、稳定服务端分页和 ADMIN 全量/筛选异步 XLSX 导出在本地收官。导出包含 11 工作表、精确 Decimal、发起人+当前 ADMIN 双重授权、24h 保留和第 8 cron；事务模糊提交、过期竞态、终态 PII 收缩与删除重试经对抗性复核闭合。筛选表单导航同步、烫金色可逆转义和 WORKER 排产草稿边界已补回归；Fresh 64 migration、1840 单测、build 和 24 项全视口/axe 门禁全绿；未 commit、未部署。
- 2026-08-07：修复管理端工单详情把工艺 ID 直接显示给用户的问题；详情查询批量映射中文名并保留历史/缺失回退，款式卡补数量、四位单价、小计和准确排产语义。139 文件 / 1845 单测、生产 build、24 项全视口明暗/axe 门禁及真实草稿单浏览器回归全绿；未 commit、未部署。
- 2026-08-07：完成对客加工费自动报价与资金方向隔离：订单冻结结算类型，产品阶梯/基础价叠加工艺收费项并保存快照，MOQ 失败关闭，改单提供只读差额预览且批准时重新报价；客户应收、内部工资/提成、师傅计件和供应商应付互不复用。历史建议单价、考勤身份快照和数据库兼容围栏由第 67–71 项前向 migration 严格收口；本地库及 PostgreSQL 16 空库 71 / 71、156 文件 / 2070 单测、空库 Dashboard E2E、typecheck、lint、Prisma、生产 build 全绿；未 commit、未部署。
- 2026-08-08：外部销售快递/打包耗材对客收费完成：中通与纸箱两份来源的 SHA-256/单元格证据、每票创建估算、最终重量发货终审、顺丰到付管理员后期更正、改单耗材跨档重算、账单分项与工厂内部成本分账均已收口。74 / 74 migrations、170 个测试文件 / 2265 项单测、typecheck、lint、Prisma validate、生产 build、375px + 1280px 管理/销售明暗响应式 + axe 门禁全绿；未 commit、未部署。
- 2026-08-09：外部销售报价统一为管理/销售单入口，已接入 PROCESSING/LOGISTICS 草稿复制、单项目编辑、严格校验、上海时间发布与放弃；已发布版只读，技术证据不进入业务页面，并发陈旧覆盖失败关闭。178 个测试文件 / 2325 项单测、typecheck、lint、Prisma validate、生产 build、375×667 管理/销售 viewport+axe+touch 门禁全绿；真实草稿页技术字段零可见且无横向溢出。未 commit、未部署。
- 2026-08-11：管理端外部销售收费拆为 `/items` 日常工作台与 `/versions` 发布中心，左侧菜单可直达；121 条加工规则与物流规则支持服务端搜索、类目/产品/省份/数量/计价/状态组合筛选和当前价→草稿价对比。客户端编辑 DTO 已裁掉 code/JSON/SHA/Excel/互斥组/优先级，服务端写锁内保留技术条件并同步产品匹配。计划生效与无当前版不再显示必失败动作；桌面长编辑器改为视口内滚动。180 文件 / 2362 单测、typecheck、lint、Prisma、build 及干净 74 migration 隔离库的 375×667、1280×800 管理/销售明暗 viewport+touch+axe 门禁全绿；未 commit、未部署。
- 2026-08-12：外部销售收费按纸张、产品/工艺/规格聚合精确数量锚点；157 克与 200 克严格分组，底层规则仍逐档独立。草稿可在一个编辑器中原子保存全部数量档金额/启停，固定总价与按个/按张/每万/每款单位分别诚实展示；181 文件 / 2427 单测、生产 build 和 12 个确定性响应式/axe 场景全绿；未 commit、未部署。
- 2026-08-17：将零 JS 硬约束收敛到登录、登出、改密码三条关键会话路径，新增禁用 JavaScript 的 Playwright project；师傅端开工/报工恢复原生 form 形状，其余后台 CRUD 不再被未拍板的全仓约束阻断。
- 2026-08-18：将工单筛选/导出、计价结算、工资与外协账本、外部销售加工/物流价目、收费工作台、价格阶梯编辑、74 项 migration、测试和记录文档统一固化为提交 `feat: complete pricing, settlement, and order operations`。183 文件 / 2441 单测、typecheck、lint、Prisma、build、diff-check 与零 JS 会话门禁 3 / 3 全绿；本条只表示 Git 归档完成，生产仍为 `aa42ba0 / 45 migrations`。
