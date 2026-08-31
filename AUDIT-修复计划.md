# print-shop-erp 审查问题修复计划

- 计划日期：2026-08-28
- 对应报告：AUDIT-报告.md
- 原审查提交：0463468
- 真值正源：[`docs/工单变更与版本规则.md`](docs/工单变更与版本规则.md)
- 接收来源：`/Users/zhixing/Downloads/工单变更与版本规则 (1).md`（按字节不变入库；145 行、6,657 字节；提交 `282a283`）
- 真值 SHA-256：`10711faaaab5936720e312184a3f3065474958d2d50cac8de792f4addfa92dd9`
- 代码证据快照：2026-08-28 10:22 CST（dirty worktree）

## 结论

修复必须沿“真值裁决 → 前向数据迁移 → 领域不变量 → 版本与财务闭环 → API 投影 → UI → 清理重构”的依赖顺序执行。不能从销售列表文案或状态药丸开始倒推数据库状态，也不能把生产中取消当作普通状态切换。

现有实现有四项可复用基础：单工单事务锁、一单一个 PENDING 申请的数据库唯一索引、Order.revision 自增、不可变价格修订。它们只能作为实现基础，不能代表 §§1–7 已闭合。

本计划本身不实施状态机、计费、schema、迁移或 API 改动。审查期间另一路工作流正在修改建单 schema；到 10:22 快照，`PENDING_FACTORY`、三段金额字段、migration、generated Prisma、状态机和部分消费者已发生变动，但状态仍是保留旧值、缺 7 个真值态且查询集合未统一的 9 态兼容草案。因此这些改动记为“进行中的部分草案”，不计入已修。

B0 的原文入库已由 `282a283` 完成，B0a 的锁文件一致性已由 `236969e` 完成；B0 仍受 D-02～D-04 真值冲突局部阻断，B0a 仍受 TOOL-002 的隔离 E2E 数据库前置条件阻断。

## 一、编码前的人工决策门

以下决策必须逐条确认；对应项未确认前，不开始该项实现。

| 决策门 | 必须确认的问题 | 阻断范围 |
|---|---|---|
| D-01（已完成，`282a283`） | 将收到的 145 行原文按字节不变地纳入 docs/工单变更与版本规则.md | 无；文内冲突由 D-02～D-04 独立阻断 |
| D-02 | §6 标题称“8 个词”，表格实际产生 9 个唯一销售词；确认“8”是笔误还是还需合并一组 | 销售状态 API、状态药丸、筛选 |
| D-03 | §1 把 ADDRESS 定义为贴唛前直改，§2 又把 ADDRESS 列为 modifyKind；确认何时直改、何时走申请 | 编辑权限、ChangeRequest |
| D-04 | §2 使用 settleFee，§4 最终写 settledFee；确认唯一持久字段名 | schema、结算、对账 |
| D-05 | “工厂裁决”对应现有 Role.ADMIN，还是需要新的工厂主管身份/权限 | 审批、取消、审计 |
| D-06 | 旧 SUBMITTED / SCHEDULING / IN_PRODUCTION / COMPLETED / FINISHED 到 11 态的逐行映射 | 数据迁移、回滚 |
| D-07 | ON_HOLD 的进入、恢复、修改和取消边；REJECTED 的重新提交边；无烫金时是否跳过 FOILING | 11 态转换矩阵 |
| D-08 | 旧改单 STALE 如何处理；是否保留为只读技术终态，或另存失效原因而只用 DENIED / WITHDRAWN | ChangeRequest 历史迁移 |
| D-09 | reasonNote 是否必填、fig[] 是否至少一款，以及 fig 使用稳定款号还是数据库 id | 驳回/暂停记录 |
| D-10 | “贴唛前”由哪个持久事实证明；当前仓库没有贴唛时间或步骤字段 | 收货信息直改闸口 |
| D-11 | “申请被拒”在需处理列表中的具体动作；PRICE_PENDING 无动作时按钮如何呈现 | 销售默认动作 |
| D-12 | 重新打印任务的领取人、完成条件、通知渠道和幂等键 | 版本作废闭环 |
| D-13 | craft 正源、专版双面冲突、旧 fallback 的适用范围 | CRAFT、COLOR、CUSTOM-SIDE、FALLBACK |
| D-14 | 当前 Order.revision 同时被核价、发货物流终审和顺丰到付修改递增；确认是否新增独立 workOrderVersion | 纸质工单版本、PDF、二维码 |
| D-15 | 多款取消的 producedQty 是逐款结构还是单个总量；若是总量，确认可证明的分摊规则 | 取消计费、schema |
| D-16 | 旧纸上的任务二维码是否也必须带版本并阻止报工 | 纸质工单作废闭环 |
| D-17 | 旧 `totalAmount / pricingStatus / priceRevision` 如何可证明地回填为 confirmed、quoted 或 pending；无证据行如何隔离 | 金额迁移、对账 |
| D-18 | “再来一单”除 IMAGE 清空、CDR 保留外，客户/收货/包装/交期/报价事实哪些复制、哪些重置 | 复制服务、权限、幂等 |
| D-19 | 取消结算进入哪个账期：按申请时、裁决时还是独立 cancelledAt | 取消对账、月结重跑 |

## 二、关键新增审查结论

这些条目补充原报告，均属留人工或仅建议。

| 编号 | 风险 | 结论 |
|---|---:|---|
| TRUTH-ERRATA-001 | P0 | §6 的“8 个词”与表格 9 个唯一词自相矛盾，不得自行修文档或冻结 API |
| TRUTH-AMB-001 | P0 | ADDRESS 同时出现在直改规则与改单类型中，缺边界 |
| TRUTH-AMB-002 | P1 | settleFee / settledFee 命名不一致 |
| STATE-005 | P0 | 9 态兼容状态机仍允许 SHIPPED → CANCELLED，真值明确禁止 |
| STATE-006 | P0 | 10:22 草案已在多层接入 PENDING_FACTORY，但仍是保留旧值的 9 态兼容集，且销售查询集合漏新态 |
| CHANGE-001 | P0 | 当前改单在 DRAFT、SUBMITTED 也可提交；真值要求 CONFIRMED 后才把修改建模为申请 |
| CHANGE-002 | P0 | ChangeRequest 缺 type、modifyKind、denyReason、producedQty、结算金额、woVersionAfter 等契约，状态名也不同 |
| CHANGE-003 | P0 | 当前 DENY 使用 REJECTED 且备注可空；没有销售 WITHDRAWN 撤回入口 |
| CHANGE-004 | P1 | 影响生产的申请没有专用工厂通知事件，也没有批准后的重新打印任务 |
| CHANGE-005 | P1 | 当前 PENDING_FACTORY 与兼容 SUBMITTED 可原地编辑，没有“撤回 → 改 → 重新提交”的显式闭环 |
| CHANGE-006 | P1 | 轻变更会记 OrderLog，但未通知工厂，也没有贴唛前服务端闸口 |
| CHANGE-007 | P1 | SHIPPED 仍有顺丰到付特殊修改入口，与 §1 的不可修改矩阵不一致 |
| CHANGE-008 | P1 | DRAFT 编辑页只开放顶层字段，不能直接增删改款式，未达到“全部字段” |
| CHANGE-009 | P1 | 当前服务会直接阻止部分已开工修改，真值要求允许提交并由工厂裁决 |
| VERSION-001 | P0 | 二维码仍是 /wo/{woNo}，扫码页忽略 v，旧纸不会出现整页作废警告 |
| VERSION-002 | P0 | PrintOrder 不含 revision，PDF/打印页眉和文件名均无 vN |
| VERSION-003 | P0 | 后台 PDF job 不锁定或复核工单版本，排队期间改版可能返回旧产物 |
| VERSION-004 | P1 | 价格快照包含 orderRevision，但物理唯一键仍是独立 priceRevision；需确认一版工单对应哪一份确认金额快照 |
| VERSION-005 | P0 | 当前 Order.revision 不是纯纸质版本：核价、发货物流终审和顺丰到付也会递增 |
| VERSION-006 | P0 | 任务二维码仍是 /worker/tasks/{id}；只修工单二维码仍可从旧纸进入报工 |
| CANCEL-001 | P0 | 当前确认后/生产中取消仍是管理员直接切状态，没有 CANCEL 申请和工厂裁决 |
| CANCEL-002 | P0 | 没有 producedQty、参考结算、调整理由和 settledFee 原子写入 |
| BILL-001 | P0 | 月账单只扫描 FINISHED；有 settledFee 的 CANCELLED 工单不会自动进入对账 |
| REJECT-001（续审细化） | P0 | 工单 REJECTED / ON_HOLD 的 PAPER_OUT、DESIGN_ERROR、PRICE_PENDING 记录模型完全缺失 |
| SALES-001 | P0 | 销售 API 直接暴露内部 OrderStatus，销售词由客户端解释，无法把 §6 固化成 API 契约 |
| SALES-002 | P1 | “需处理”只覆盖待管理员确认与最新改单被拒，还漏已接入的 PENDING_FACTORY 及真值 REJECTED、ON_HOLD |
| SALES-003 | P1 | 默认动作不是“再来一单”，也没有“清 IMAGE、保留 CDR”的复制领域服务 |
| SALES-004 | P1 | 原因对应动作、按 fig 跳纸张/文件区和撤回申请均缺失 |
| SALES-005 | P2 | 首图会取第一个有图的款而非严格首款；超期样式也不是白字红底 |
| TOOL-001（已修 `236969e`） | P2 | manifest 与 lockfile importer 已统一为 `^4.1.5`，解析版本仍为 4.1.5；冻结安装已通过 |
| TOOL-002 | P1 | 现有基线依赖 dirty worktree、既有服务器和共享开发库，无法由标注 commit 重放 |

已确认的正例：

- 禁词“分辨率不足”未出现。
- 一单一个 PENDING 有数据库部分唯一索引。
- 当前销售 Sheet 右侧打开、#wo= 可寻址且正文只读。
- 销售查询使用白名单，不向抽屉下发任务、师傅、audit、成本和外协细节。
- 运单号复制、改单中角标、需处理行泛红的基础交互已存在。

## 三、依赖与批次

| 批次 | 依赖 | 目标 | 覆盖报告项 |
|---|---|---|---|
| B0 | 无 | 原文入库已完成；勘误决策待完成 | STATE-001、DOC-TRUTH-001、TRUTH-* |
| B0a | 无 | TOOL-001 已完成；TOOL-002 待完成 | TOOL-001、TOOL-002 |
| B1 | B0、B0a | 数据盘点与 expand 迁移骨架 | STATE-002、STATE-006、AMOUNT-001 |
| B2 | B1 | 11 态领域状态机和兼容投影 | STATE-002～005 |
| B3 | B1、B2 | 工单驳回/暂停原因 | REJECT-001 |
| B4 | B1、B2 | MODIFY 申请与版本作废闭环 | CHANGE-*、VERSION-* |
| B5 | B1～B4 | CANCEL 与已产结算、对账 | CANCEL-*、BILL-001 |
| B6 | B1 | 金额三态和计费输入迁移 | AMOUNT-*、COLOR-*、CRAFT-*、PACK-* |
| B7 | B2～B6 | 销售 API、列表、抽屉和动作 | SALES-*、UI-COMP、UI-A11Y、FMT |
| B8 | B7 | 行为敏感的重复/嵌套/死代码 | DUP-*、NEST-002、DEAD-* |
| B9 | 稳定后 | 架构与 Prisma 性能评估 | UI-ARCH-*、PRISMA-* |

## 四、分批执行方案

### B0：真值治理

1. **已完成（`282a283`）：**把下载文件原样纳入 docs/工单变更与版本规则.md。
2. **已完成（`282a283`）：**入库提交只改文件位置、真值索引和 SHA 记录，未静默修正文内冲突。
3. 决策另写 DECISIONS 追加记录：8/9 词、完整转换矩阵、旧状态映射、ADDRESS、结算字段名、贴唛事实、角色和重打印任务。
4. 决策文件不得留 TBD；有 TBD 的领域继续冻结。

建议提交边界：

- docs(truth): intake work-order change rules [STATE-001][DOC-TRUTH-001]
- docs(decision): approve work-order migration matrix [TRUTH-ERRATA-001]

### B0a：依赖安装与测试基线可复现性

1. **已完成（`236969e`）：**沿用 manifest 与同组 Vitest 已声明的 `^4.1.5` 范围。
2. **已完成（`236969e`）：**只同步 lockfile importer 的一行 specifier，解析版本仍为 4.1.5，未夹带依赖升级。
3. **已完成：**frozen lockfile-only 离线校验及全新 checkout 的 `pnpm install --frozen-lockfile --ignore-scripts` 均通过。
4. **待人工提供：**专用、可销毁的 `E2E_DATABASE_URL`，以及期望 host/database/user、可审计数据库身份标记和 migrate/reset/seed 权限；禁止回退普通 `DATABASE_URL` 或共享开发库。
5. **待人工裁决：**数据库每次新建还是快照还原、失败后是否保留、完整 seed 还是最小 seed，以及使用 `next dev` 还是 `build/start`。
6. 前置条件齐备后实现 fail-closed preflight、固定独立端口、`reuseExistingServer: false`，并归档 commit、tracked diff、未跟踪测试清单、Node/pnpm/browser 版本、数据库指纹和 `playwright test --list`；再运行 lint、typecheck、全量 Vitest 和 Playwright，生成新的可重放基线。

`236969e` 的干净检出已通过 frozen install、Prisma/Next 类型生成、lint 与 typecheck。全量 Vitest 的标准门限受主机约 90 的 load average 影响，留下两个纯超时；其中全仓按钮扫描在修复前提交的同环境对照也同样超时，诊断性延长单次命令门限后断言通过。该证据只排除 TOOL-001 回归，不替代 TOOL-002 的可复现全量基线。

建议提交边界：

- chore(deps): synchronize frozen lockfile metadata [TOOL-001]
- test(audit): establish reproducible full-suite baseline [TOOL-002]

### B1：盘点与前向数据迁移

先对生产数据做只读盘点：

- 各旧 OrderStatus 行数、时间戳、任务工艺和任务状态组合。
- SCHEDULING / IN_PRODUCTION / COMPLETED 的工序证据。
- FINISHED 的账单、付款和结算证据；不得把 FINISHED 直接猜成 SETTLED。
- SHIPPED 后又取消的历史行和日志。
- 每单 PENDING 申请数、STALE 历史、取消记录。
- Order.revision、priceRevision、价格快照中的 orderRevision 对账。
- CANCELLED 工单中已有金额、账单或生产记录的数量。

推荐 expand/contract，不原地强改 PostgreSQL enum：

1. 先加入新字段、约束和兼容读取；首次发布保留旧值。
2. 无法唯一映射的行写入人工隔离清单并停止该行回填，禁止默认到“最接近”的状态。
3. schema、migration、prisma generate、状态机和所有查询/写入集合必须作为同一受控批次验证；不能只让部分消费者看见新态。
4. 新列回填完成且双读对账为零差异后，才切换写路径。
5. 旧列/旧 enum 的删除另开清理批次；首次发布不做破坏性收缩。

### B2：11 态状态机

1. 用已批准的完整转换矩阵建立唯一纯状态机。
2. 更新排产、任务开始、工序完成、发货、结算、驳回、暂停、恢复、取消的所有写入口。
3. 更新权限、通知、时间戳、日志、逾期判断、worker scope、账单和导出。
4. 内部 registry 与销售 registry 分离；销售 API 输出批准后的对外状态，不让客户端各自映射。
5. 明确 SHIPPED 没有取消边，SETTLED / CANCELLED 为终态。

验收：

- 11 态精确集合与所有合法/非法边表驱动测试。
- 全仓枚举、状态写入、过滤、导出和测试引用逐一消除旧状态假设；动态与字符串引用也要复核。
- 旧状态行数 = 已确定映射 + 明确隔离；不得丢行。
- API 映射唯一词数与 D-02 裁决一致。

### B3：驳回与暂停

这是工单状态原因，不得与 ChangeRequest.denyReason 合并。

1. 新增工单级原因记录：reasonCode、reasonNote、受影响 fig、operator、createdAt。
2. 只允许 PAPER_OUT、DESIGN_ERROR、PRICE_PENDING。
3. 校验 fig 属于该工单；按 D-09 决定 note 和 fig 的必填性。
4. REJECTED / ON_HOLD 转换、原因记录和通知在同一事务。
5. 销售 DTO 输出原因与允许动作；PAPER_OUT 定位纸张区，DESIGN_ERROR 定位文件区，PRICE_PENDING 不伪造编辑动作。

### B4：MODIFY 与版本闭环

1. 对 ChangeRequest 做 additive 扩展：type、modifyKind、detail、denyReason、woVersionAfter、decidedBy/At；旧字段先兼容读。
2. 只在确认后的允许状态提交 MODIFY；DRAFT 直改，PENDING_FACTORY / REJECTED 走撤回、编辑、重提。
3. 一单一个 PENDING 继续由数据库唯一索引兜底。
4. 实现销售 WITHDRAWN；DENIED 必须有 denyReason；STALE 按 D-08 处理。
5. 已开工变更应能提交并留给工厂裁决；不能在申请入口用旧安全规则一律挡掉。
6. 批准事务原子完成：事实更新、workOrderVersion + 1、确认金额重算/快照、woVersionAfter、日志、通知、重新打印任务。
7. 影响生产的申请只置顶通知，不自动停线或改状态。
8. 轻变更必须通知工厂；生产期地址修改必须由服务端验证“贴唛前”事实。

纸质工单闭环：

- 先按 D-14 引入独立 workOrderVersion，或证明并收口当前 revision 的所有递增语义；不能直接把混合 revision 印到纸上。
- 建立完整且不可变的工单版本快照，唯一键为 orderId + workOrderVersion，并关联改单、价格快照和重印任务。
- PrintOrder 加 workOrderVersion，页眉和 PDF 文件名显示 vN。
- 工单二维码固定为 /wo/{woNo}?v={workOrderVersion}。
- 任务二维码也携带版本；扫码页面和最终报工写服务都在服务端拒绝旧版。
- v 不一致时返回整页红色作废页，不渲染旧版或当前版工单细节。
- PDF 下载请求和后台 job 都携带 `expectedWorkOrderVersion`；取数后和交付前各复核一次。
- 旧 job、旧链接和旧 artifact 不得返回；应提示重新生成当前版。

### B5：CANCEL 与已产结算

1. DRAFT / PENDING_FACTORY / REJECTED 的直接取消与确认后申请取消分开。
2. CONFIRMED、RELEASED、FOILING、PACKING 只能创建 CANCEL 申请。
3. 工厂按 D-15 录入逐款已产数量；单个总量不能在多款之间靠代码猜分。
4. 按当前已批准版本的计费快照计算参考结算。
5. 款级费用按已产数量，纸箱耗材按已产总量，快递费为 0。
6. 工厂调整参考值必须保存原参考值、最终值、理由、操作者和时间。
7. 审批原子写入 D-04 批准的最终金额字段、D-19 批准的账期时间、CANCELLED、申请结论、财务修订、日志和通知。
8. 账单生成显式纳入有最终结算金额的 CANCELLED；金额和账期均使用 D-04 / D-19 批准契约，不再只扫 FINISHED。
9. 保留已完成任务、工资和成本，只关闭剩余任务。
10. 已形成结算只能用补偿记录更正，不得覆盖历史或恢复旧状态掩盖结算。

### B6：金额、颜色、craft、包装与 fallback

1. 先完成 craft 清单、专版双面和 fallback 的人工裁决。
2. 三段金额以服务端判别联合输出：confirmed、quoted、pending；UI 不从 totalAmount、零值、pricingStatus 或 feeLine 猜状态。
3. confirmedFee 优先，quotedFee 显示“估”，两者均无显示朱红“待工厂核价”。
4. 旧 totalAmount 的回填必须依据不可变修订和 D-17 批准矩阵；不能按状态名或是否为零推断。
5. frontColors[] / backColors[] 只回填可证明的数据；不能从色数、面数或聚合数组猜分面。
6. 停止新写历史聚合字段后，经过观察期再删除。
7. 包装组成清空必须使袋数与报价立即失效，报价 key 包含每包组成。
8. 外部销售缺档严格 fail closed；不改计费结果来迎合 UI。

### B7：销售 API 与 UI

先写服务端销售 DTO，再改组件：

- 对外状态、金额态、当前原因、涉及 fig、允许动作由服务端输出。
- “需处理”统一为 REJECTED + ON_HOLD + 待工厂核价 + 最新申请 DENIED，并在筛选、summary、排序和分页前复用同一谓词。
- 列表严格取首款缩略图；工单号文本可点击复制；超期为白字红底。
- 状态药丸迁移到共享 StatusBadge；金额迁移到共享 presenter。
- 默认动作实现“再来一单”：新建 DRAFT 和新工单号，IMAGE 清空、CDR 保留；其他业务事实、确认金额和内部记录按 D-18 白名单复制或重置，不从现有对象浅拷贝。
- 草稿为“继续填写”；原因动作跳独立编辑页并用稳定 fig 定位。
- 抽屉继续保持只读和 #wo= 可寻址，不在 Sheet 内保存。
- 复制交互只保留一个 aria-live。

### B8：重复、嵌套与多余代码

等 B2～B7 稳定后再处理：

1. 为 datetime-local、地址、cron JSON、纸张格式和账单行先补输入输出契约，再各自独立合并。
2. OrderForm 按功能区补 fixture 后逐段早返回，不与报价或状态修复混合。
3. 公共导出须再次全仓检索动态消费者；拿不准仍留人工。
4. 依赖删除须核对 Next 配置、instrumentation、构建和启动钩子。
5. UI-ARCH 与 PRISMA 查询拆分继续只作为独立架构/性能项目。

### B9：架构与 Prisma 性能（仅建议）

1. 只在 B2–B8 的状态、金额、变更和取消契约稳定后启动。
2. 巨型工单详情页按只读区块拆分；不在拆分中改权限、状态或金额行为。
3. 评估稳定的 `ListSurface` 组合 API，再迁移跨域列表 shell。
4. Prisma 查询先记录 SQL、返回行数、执行计划、权限投影和事务一致性基线；没有可量化证据不拆 include/select。
5. 性能修改不与业务修复、schema 迁移或 UI 改版混合。

## 五、建议 commit 序列

下表是推荐顺序；实际执行时仍可把单行再拆小，但不可把两行合并成一个多目的提交。

| 顺序 | 批次 | 建议 message | 边界 |
|---:|---|---|---|
| 1（已完成 `282a283`） | B0 | `docs(truth): intake work-order change rules [STATE-001][DOC-TRUTH-001]` | 原文、索引、SHA；不勘误 |
| 2 | B0 | `docs(decision): resolve work-order truth conflicts [TRUTH-ERRATA-001][TRUTH-AMB-001][TRUTH-AMB-002]` | 只记录已批准决策 |
| 2a（已完成 `236969e`） | B0a | `chore(deps): synchronize frozen lockfile metadata [TOOL-001]` | 只同步 importer specifier，不升级版本 |
| 2b | B0a | `test(audit): establish reproducible full-suite baseline [TOOL-002]` | 专用数据库、受控服务器、清单指纹和基线归档 |
| 3 | B1 | `chore(audit): inventory legacy order facts [STATE-002][AMOUNT-001]` | 只读盘点脚本与结果 |
| 4 | B1 | `feat(schema): expand canonical order states [STATE-002][STATE-006]` | 状态 schema/migration/generated 与兼容读；不改 UI |
| 5 | B2 | `feat(order): enforce approved work-order transitions [STATE-003][STATE-005]` | 纯状态机与写入守卫 |
| 6 | B2 | `feat(order): migrate state consumers [STATE-002][STATE-004]` | 查询、通知、导出、权限；不改文案外观 |
| 7 | B3 | `feat(order): record reject and hold reasons [REJECT-001]` | 原因模型、状态原子写与权限 |
| 8 | B4 | `feat(schema): expand change-request contract [CHANGE-002][CHANGE-003]` | additive schema、历史兼容与唯一约束 |
| 9 | B4 | `feat(order): enforce modify-request capabilities [CHANGE-001][CHANGE-005][CHANGE-009]` | 提交、撤回、拒绝与批准能力；暂不接入纸质版本基础设施 |
| 10 | B4 | `feat(order): version printed work orders [VERSION-001][VERSION-002][VERSION-004][VERSION-005]` | 快照、独立版本、页眉和工单 QR |
| 11 | B4 | `feat(order): invalidate stale print workflows [CHANGE-004][VERSION-003][VERSION-006]` | PDF job、任务 QR、报工校验与重打任务 |
| 12a | B4 | `feat(order): guard lightweight production changes [CHANGE-006][CHANGE-007]` | 通知、贴唛事实与已发货禁改 |
| 12b | B4 | `feat(order): support complete draft item editing [CHANGE-008]` | 草稿款式增删改，不混生产态守卫 |
| 13 | B5 | `feat(schema): expand cancellation decisions [CANCEL-001][CANCEL-002]` | CANCEL 申请、逐款已产与裁决审计 |
| 14 | B5 | `feat(order): settle produced cancellation quantities [CANCEL-002]` | 计费适配、调整留痕与原子取消 |
| 15 | B5 | `feat(billing): include settled cancellations [BILL-001]` | 账期、冻结金额、幂等重跑 |
| 16 | B6 | `feat(pricing): migrate canonical amount states [AMOUNT-001]` | 加字段/回填/双读；不改计费结果 |
| 17 | B6 | `feat(pricing): expose canonical amount projection [AMOUNT-003][AMOUNT-004]` | 服务端 tagged union 与各出口 |
| 18 | B6 | `feat(pricing): migrate canonical craft facts [CRAFT-001][CRAFT-002]` | 仅在 D-13 批准后；明确 enum 与生产 Craft ID 边界 |
| 19 | B6 | `feat(pricing): migrate face color facts [COLOR-001][COLOR-002][COLOR-003]` | 新字段、可证明回填和停止旧字段新写 |
| 20 | B6 | `feat(pricing): enforce approved manual-pricing scope [CUSTOM-SIDE-001][FALLBACK-001]` | 只实施 D-13 已批准的作用域；附黄金 fixture |
| 21 | B6 | `fix(pricing): invalidate incomplete packaging quotes [PACK-001]` | 行为缺陷独立于包装术语修改 |
| 22 | B7 | `feat(api): publish sales work-order projection [SALES-001][SALES-002]` | 状态、金额、原因、动作 DTO |
| 23 | B7 | `feat(order): create repeat sales orders [SALES-003]` | 独立复制领域服务 |
| 24a | B7 | `feat(ui): route sales resolution actions [SALES-004]` | 保持只读抽屉，定位到独立编辑页 |
| 24b | B7 | `fix(ui): align sales list details [SALES-005]` | 首款缩略图和超期视觉 |
| 25 | B7 | `fix(ui): align canonical amount presentation [AMOUNT-002][AMOUNT-005][FMT-001]` | 金额文案、两位小数与共享 presenter |
| 26a | B7 | `fix(ui): align millimeter dimensions [FMT-003]` | 只改尺寸 formatter |
| 26b | B7 | `fix(ui): align packaging terminology [PACK-002]` | 只改术语，不改报价行为 |
| 27a | B7 | `refactor(ui): share work-order status badges [UI-COMP-001]` | 在销售状态 API 稳定后做行为无关收口 |
| 27b | B7 | `refactor(ui): share copy feedback [UI-A11Y-001][UI-INT-004]` | 单一 clipboard 状态与 `aria-live` 出口 |
| 28+ | B7/B8 | 其余 `UI-* / DUP-* / NEST-* / DEAD-*` 每项独立 message | 一个交互契约、一类 helper、一段嵌套或一组确定死代码一提交 |

任何行为无关重构不得与状态、计费、取消或迁移提交混合。

## 六、测试与发布门禁

每个行为批次必须：

1. 不删除断言、不加任意 sleep、不盲目更新截图。
2. lint、typecheck、全部 Vitest、全部 Playwright。
3. 与 TOOL-002 重新建立的可复现基线比较；不得出现其已归档失败集合之外的新失败。现有 37 项 dirty-worktree 基线只保留为历史证据，不再作为行为批次门禁。
4. 新增合同 fixture，不通过修改测试来掩盖行为破坏。
5. 若旧测试明确编码已被人工裁决取代的旧真值，先在决策记录中列出，再在独立合同提交中替换；不能顺手放宽。
6. 依赖或锁文件批次必须从干净 checkout 先通过 `pnpm install --frozen-lockfile`，不能复用已有 `node_modules` 掩盖漂移。

schema 批次额外执行：

- Prisma validate / generate 后检查 schema 与 generated 精确一致。
- 空库迁移、生产副本 dry-run、回填行数和金额对账。
- 一单一个 PENDING、版本唯一性、金额非负和关联完整性约束。
- expand/contract 应用回滚演练；不依赖危险 down migration。

金额、取消与版本批次额外执行：

- confirmed / quoted / pending 表驱动 fixture。
- 计费黄金 fixture、幂等、并发和账本守恒。
- 旧二维码、旧 PDF job、改版竞态和当前版下载测试。
- 旧任务二维码无法开始或提交报工。
- 有 settledFee 的 CANCELLED 对账测试。

销售端额外执行：

- 11 态对外映射穷举。
- 四类需处理分别命中、叠加、排序和跨分页边界。
- PAPER_OUT / DESIGN_ERROR 精确跳 fig；PRICE_PENDING 无伪造动作。
- “再来一单”验证 CDR 保留、IMAGE 清空及内部记录不复制。
- 375×667 到 1920×1080 六视口、axe、键盘和焦点返回。

## 七、回滚原则

- 数据库先扩展、后切换、最后另批收缩。
- 首次发布不删除旧列、旧 enum 值、旧快照或旧审计记录。
- 应用回滚走兼容读取路径，不执行破坏性逆迁移。
- 已发生的工单版本、价格修订和结算只能追加补偿，不能覆盖或删除。
- 临时兼容开关必须登记负责人、移除条件和最晚删除批次。
- 任一迁移行无法确定映射时停止该批次并回到人工清单，不猜值。
