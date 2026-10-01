# 全站 UI 文案清理验收记录

本次从 `ffc69b04`、`codex/order-leave-recovery` 开始，执行用户确认的全站文案修复任务。工作区起始没有已跟踪文件改动，已有 `.playwright-cli/` 不纳入提交。执行依据为 `AGENTS.md`、`CONTRIBUTING.md` 和 `docs/ui-规范.md` §7。

## 修改范围

| 范围 | 处理 | 保留的必要信息 |
| --- | --- | --- |
| 销售账单、总览、月账单管理 | 删除重复导语、点击教学、重复收款空态；可选收款方式和流水号缺省时不显示 | 当前筛选数量、整单金额、金额未定稿、结算历史依据、管理员和销售的数据边界 |
| 工单创建、修改、结果、预览 | 删除流程说明、报价内部版本提示；归属变化后果只在实际换账号的复核中出现 | 草稿保存失败、未上传文件损失、退出保护、版本变化及生产限制 |
| 工单费用、包装资料 | 无数据的可选明细不占位；有历史制版记录仍显示 | 核价阻断、费用记录、删除历史、实际包装明细 |
| 价格规则和主数据 | 删除固定数量试算、默认零价说明、重复影响说明；用料清单替代内部 BOM 用词 | 参数值、阈值、单位、引用数量、实际禁用后果 |
| 采购、库存、外协 | 删除表单教程和重复说明；外协提交按钮明确为“创建并标记已发出” | 盘点归零确认、并发冲突恢复、付款金额、回货条件和不可逆后果 |
| 通知、账号、系统设置、后台任务 | 绑定步骤集中在实际绑定面板；字段帮助只显示真实限制 | 未绑定或账号变更的阻断、权限、有效期、失败恢复、操作控件 |
| 师傅端、计件工资 | 精简重复说明；提成复核展示实际金额差额 | 数量审批、已结算限制、原报工及跨日冲正金额 |
| 下载文件 | 新生成的月账单和计件 XLSX 使用业务列名及状态；工资规则校验码放在独立“核验记录”表 | 金额、记录关联编号、规则版本和完整校验码；不重写已生成文件 |

浏览器复核中一并处理了长面包屑、长工单名称的完整文本提示，以及账单在手机卡片模式下的表头隐藏方式。桌面表头保留；手机卡片保留业务字段标签和金额名称。

## 防止复发

原检查主要覆盖 JSX 与显示属性，结构化 `items` 的展示字段存在遗漏；部分旧测试及 `UI-SYSTEM.md` 仍要求已被 §7 拒绝的解释。此次统一规范和断言，并补充扫描本地及导入的 `items`、展示字段、嵌套 `children`、条件和函数返回值。内部键、查询值和元数据不作为 UI 文案处理。

扫描器没有新增豁免。针对已经移除的文案加入限定路径规则，避免把必要的阻断和风险提示一起禁止。静态扫描不等于完整语义审查；数据库文案、动态属性和不能静态追踪的回调消费链仍需渲染与人工复核。

## 业务边界与复审

- 未改服务端权限、账号归属规则、金额计算、结算条件、库存计算、状态机写入或历史记录；没有 schema、SQL、迁移及部署配置修改。
- 删除的 `FormulaNote`、固定试算辅助函数、`SALES_BILL_DESCRIPTION` 只有本次删除的展示消费方；已检查引用与调用链。未删除公开 API、动态注册项或已应用迁移。
- 提成复核共用现有 `voidedAdjustmentResiduals`，增加只读差额字段。跨日案例“原日 24 元减人工调整 5 元、次日冲正 24 元”预览为原日 `19 → 24`、次日 `-24 → -24`。提交仍传原金额作校验，实际核定命令不变；不把每行错误显示为归零。
- 销售预览根据 HTTP 状态显示可恢复的业务错误，异常响应不直接呈现原始远端错误。覆盖 401、403、404、500、无效 JSON 和工单号不匹配。
- 不重命名数据库字段、保存的导出快照或历史文件。新 XLSX 的工作表及列名变更已记入 `API.md`。

## 验证

使用隔离本地库 `erp_e2e_dabiaoge_final_0930`；历史回放账号用于只读页面验证，自动化写入使用各测试生成的独立记录。未接入生产库或实际企业微信推送。

| 检查 | 实际结果 |
| --- | --- |
| 全量 Vitest，显式 `--config vitest.config.ts` | 8,056 项通过，1 项既有数据库测试在并行负载下超过 5 秒；单独复跑所在文件 4 项全部通过。133 项条件测试跳过，不计为通过 |
| 本次新增边界 | 扫描器结构化字段、可选制版空态、跨日冲正差额、XLSX 列与校验码位置均覆盖 |
| 9 个浏览器组件文件 | 125 项通过，包括工单修改、销售预览恢复、提成复核、外协创建、价格设置、两类账单导出及通知配置；绑定面板的 3 项单测增量复跑通过 |
| `pnpm lint` | 通过；文案门禁 0 命中、UI 令牌门禁 0 新违例。保留两个既有 `location.assign` 警告 |
| `pnpm typecheck`、生产构建、架构门禁 | 通过；构建保留两处未修改的导出文件目录动态追踪警告，架构门禁无新增违例 |
| 管理端和销售端六视口、明暗主题、overflow/touch/axe | 42 项全部通过 |
| 师傅端六视口、明暗主题、overflow/touch/axe | 12 项通过 |
| 账单、账号隔离、提成、外协、库存、通知与入口 E2E | 22 项最终全部通过，包含 hydrated / native 两种账单提交流程、跨页与筛选导出、失败重试、跨账号拒绝及模拟通知 |
| 手动浏览器复核 | 大表哥 303 单账单筛选到 1 单后，整单金额仍为 128,006.60，显示“匹配 1 / 303 单”，导出入口随筛选变化；已删除的账单导语不再出现 |

初轮视觉测试发现长文本提示、手机隐藏表头和旧标题断言问题，已修正后复跑。对流式加载的销售列表，先等待唯一列表就绪，未使用 `first()` 隐藏重复节点，也未降低几何或无障碍门禁。

E2E 分批记录：首批 8 项中 5 项通过、3 项旧文案定位失败；扩大验证后的 18 项中 16 项通过，剩余 2 项分别为区域名称模糊匹配和旧的明细数量文案。更新为准确的区域与现行字段后，这 2 项复跑通过。按完整测试套件路径去重，共 22 项；金额、账号隔离、幂等与历史成员断言全部保留。

实际验证入口：

- `pnpm exec vitest run --config vitest.config.ts`；数据库超时所在的 `scripts/maintenance/__tests__/deploy-blank-price-migrations.postgres.test.ts` 使用同一配置独立复跑。
- `pnpm exec vitest run --config vitest.browser.config.ts`，限定本次 9 个文件：`AdminOrderEditor.browser.spec.tsx`、`SalesOrdersList.preview.browser.spec.tsx`、`OrderWageReviewForm.browser.spec.tsx`、`CreateOutsourceForm.browser.spec.tsx`、`CustomerPricingSectionViews.browser.spec.tsx`、`AgentMonthlyBillExportControls.browser.spec.tsx`、`SalesBillExportButton.browser.spec.tsx`、`BindingPresentation.browser.spec.tsx`、`NotificationConfiguration.browser.spec.tsx`。
- `pnpm lint`、`pnpm typecheck`、`pnpm check:architecture`、`pnpm build`、`git diff --check`；最后的测试定位修改另跑对应文件 ESLint。
- Playwright 使用 `--config=playwright.release.config.ts` 和已构建应用（`E2E_PREBUILT=1`），服务地址为 `http://127.0.0.1:3337`。业务用例采用 `--project=chromium --workers=1`，覆盖 `bill-account-identity`、`bill-workspace`、`bill-flow`、`sales-overview-export`、`foil-wage`、`inventory-flow`、`outsource-flow`、`owner-notifications`、`interaction-discoverability`、`smoke` 共 10 个 spec。
- 视觉用例采用六个 `admin-*` / `worker-*` 项目：管理端限定可发现入口、独立返回、工单创建/详情/编辑、关键页面及销售路由，师傅端遍历 `worker-responsive.spec.ts` 的明暗主题路由。未运行的其他专项视觉用例不纳入本次通过数量。

本地证据目录为 `/tmp/erp-ui-copy-fix-1001/`，包括 `tests-verified.log`、`database-retry.log`、`browser-verified.log`、`binding-browser.log`、`visual.log`、`visual-verified.log`、三次 E2E JSON/日志、`lint-verified.log`、`types-verified.log`、`build-final.log` 和 `architecture.log`。候选为起始 SHA 加本次提交全部增量，未包含既有 `.playwright-cli/`；复核人为本任务 Codex。临时日志不提交到仓库。

再次调用 Claude Code 只读对抗审查时，CLI 返回周额度已用尽，未产生审查报告。不能声明 Claude 审查通过；上述结论来自代码复核和实际测试。

记录覆盖整个 UI 源码范围的文案检查及选定功能链路，不声称逐个角色、每种数据组合都已手动点击。此次仅本地修改和验收，不包含 push、PR 或生产发布。
