# 建单页控制台报错修复记录

日期：2026-09-11。起点：`45ef5c98159bafc1f922e9621988315ab559c0f9`。复核人：Codex。修复提交见本文件所在 commit。本次仅修复建单页重复提示与上传失败引导，并核查外部配置和材料目录；不是整套系统发布验收。

## 已完成

1. 同一整体报价失败被写入包装、物流状态，提示列表把文字用作 React key，造成重复 key。现在显示前按完整文字去重；每款的编号和不同原因继续保留，重新核价成功后移除旧错误。
2. 文件 PUT 请求被浏览器拒绝时，明确提示检查网络、持续失败时联系管理员核对上传设置。浏览器无法从 fetch TypeError 区分 CORS 和网络中断，因此不把所有失败断言为跨域错误。失败时不调用文件登记；重试重新签发上传凭证。
3. 用户完成 OSS 配置后，实际 OPTIONS 验证 `http://127.0.0.1:3000` 与 `http://localhost:3000` 均返回 200，并返回各自允许来源、PUT/GET/HEAD 和 content-type。原先前者为 403、后者为 200。跨域阻断已解除。
4. 用户明确要求忽略沉浸式翻译报错。本次不修改扩展，也不通过拦截键盘事件或吞掉全局异常来隐藏扩展问题。

## 纸张资料核查

只读检查 28 条纸张材料记录，发现以下身份冲突。正式引擎要求未绑定特定材料的专版产品能唯一匹配纸张，不能为消除错误而选择第一条、忽略停用历史或猜测材料归属。

| 纸张身份 | 匹配资料 |
|---|---|
| 冰白纸 160g | `PAPER-4D8D4EE3BB37`（160克冰白纸，启用）、`PAPER-ICE-WHITE-160`（160g冰白纸，启用） |
| 艳闪 160g | `PAPER-B77FEE3E77EB`（艳闪/红卡，启用）、`PAPER-E194860F33BC`（艳闪/闪红/红卡，停用） |
| 红卡 160g | 上述两条含红卡别名的材料，以及 `PAPER-RED-CARD-160`（启用） |

本次日志对应草稿 `cmtwgmdlv0000f70rrp8a1l8v` 当前选择珠光艳闪 160g、数量 1,001；真实页面已显示报价，当前阻塞为两个文件未上传。日志无法定位此前触发目录冲突时究竟选择了哪条纸张。

材料归并需要核对库存、采购及历史引用和业务认可的标准身份。本次未改名、合并、删除材料或放松计价匹配约束；这三组冲突保留为资料治理待办。

## 验证

在 `/tmp/erp-console-fix-20260911/snapshot` 使用 Git archive 起点加仅本任务补丁验证，依赖及生成物独立复制。没有引入工作区其他打印任务的修改。临时包装器 `run.cjs` 在副本执行命令，测试数据库指向已有独立 E2E 库，凭证不写入报告。

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run components/business/order/__tests__/ExternalSalesOrderFormRail.test.tsx components/business/order/__tests__/design-upload-client.test.ts components/business/order/__tests__/OrderFormB-unified-quote.test.tsx` | 3 文件、19 项通过，零跳过。 |
| `pnpm test:browser components/business/order/__tests__/OrderConsoleErrors.browser.spec.tsx components/business/order/__tests__/DesignUploadPanel.browser.spec.tsx` | 2 文件、16 项通过，零跳过。包括重复错误、按款区分、恢复、真实上传面板的失败重试，以及六视口/明暗主题/overflow/44px按钮/axe。 |
| `pnpm lint` | 通过，无错误，UI 文案与令牌零新增违规；起点的 global-error 与 OrderForm 各有一个 location.assign 警告。 |
| `pnpm typecheck` | 通过。 |

新增两条行为断言在修复前均失败（`browser-red.log`），修复后通过（`browser-green.log`）。其他日志：`unit-green.log`、`lint.log`、`typecheck.log`。浏览器组件测试 mock 签发/登记 action，仅对测试 URL 模拟网络拒绝，未向真实 OSS 上传用户文件。

## 外部传输验证限制

无凭证 OPTIONS 证据：`oss-preflight-after.json`。应用凭证读取跨域配置返回 AccessDenied，实际跨域配置由用户完成，未使用替换 bucket 全部规则的方式绕过限制。

额外独立文件传输探测未完成：清理对象返回 403，使首次探测无法证明先前 PUT 是否成功，且列举诊断路径也被拒绝。当时可能有一张自有微小测试图片留在 `design/diagnostic-…/upload-probe/` 下，用户随后回复“已检查并处理”；这一清理结果来自用户确认，工具没有独立列举确认。

再次探测改为先验证对全新随机测试路径的删除权限，并在每阶段记录结果；该预检仍返回 AccessDenied/403，因此在任何新 PUT 前停止，没有新增测试文件。证据 `oss-transfer-probe.json` 的 phase 为 `cleanup-permission`，status 为 0。尚需核对应用账号的对象权限后才能验收完整上传链路，不能据此断言真实上传 PUT 或 HEAD 一定失败。用户现有草稿未提交，其设计文件未上传或更改；不能把跨域预检通过写成完整上传、读取和登记验收通过。

控制台错误原文含临时签名与 token，本报告不收录这些参数；临时探测脚本和证据在仓库外。没有数据库迁移、价格修改、历史订单变更或部署。

## 后续复核与资料修复（2026-09-11）

本节追加此前待办的后续状态，保留上文当时的失败证据。代码起点 `2cd0423dddb3211d57c01e7ae2303e82ddf7e0d6`；候选为该 HEAD 加本节对应的维护脚本、14 项测试及文档，未包含工作区其他打印改动。

### OSS：已恢复，纠正验收前置

用户确认已处理测试文件后，重新核查真实工单 `cmtwgmdlv0000f70rrp8a1l8v`：图片与 CDR 均已登记，工单为 CONFIRMED。使用应用账号对这两个已存在对象进行 HEAD 和 GET，全部返回 200，实际大小分别为 28,076 和 72,887 字节，与数据库登记一致。此轮只读，不再创建测试对象，也未代替用户提交或修改工单。

此前把 DeleteObject 权限作为传输验收前置不正确：`recordOrderItemDesign` 使用 HEAD 检查文件后登记；`removeOrderItemDesign` 只删除关联记录并写工单日志，没有调用 OSS 物理删除。因此缺少 DeleteObject 不能证明上传或业务删除不可用，也不需要为测试增加对象删除权限。已纠正部署指南。跨域预检、真实文件登记和读取证据已闭环；旧诊断对象清理仍以用户确认作为依据，不宣称工具列举成功。

### 纸张：三条未使用旧导入记录已清理

溯源到 `20260826184000_external_sales_processing_rule_v2` 已建立标准纸张，但旧名称的语义重复未被数据库的精确名称约束消除。核对三条旧记录均为零库存、空成本/安全库存、无产品/采购/库存/BOM 等引用。事务内动态核查 8 个外键消费字段、33 个 JSON 快照字段，均无相关引用。

维护脚本先演练回滚，再在当前开发服务器所连数据库执行。三条旧导入记录已删除，完整 before 留在 BusinessAuditLog；标准材料不改名、不改价，计价引擎的唯一匹配约束保持不变。执行前后 Order、OrderItem、Product、CustomerPriceBook、CustomerPriceRule、OrderPricingRevision 全表内容哈希一致。再次演练返回空变更，确认幂等。

真实浏览器复核：修复前选择 160g冰白纸出现通用无法核价错误；修复后进入正式计价判断，明确显示“所选纸张暂无专版烫金价格，请选择其他纸张或联系管理员核价”。这属于当前已发布价格未覆盖，不能写成冰白纸已可自动出价。160g红卡在专版大号封、单面单色、1,000 个、加价35%条件下自动显示加工费325.00、参考报价438.75。数量改为2,000后自动更新为加工费570.00、参考报价769.50，未点击计算按钮。刷新后旧冰白纸名称及混合导入的艳闪选项已移除。

### 本轮验证

独立候选目录 `/tmp/erp-outstanding-20260911/snapshot`，由 Git archive 加本任务文件构成。依赖与生成物单独复制；只移除了副本中指回原工作区的 `node_modules/node_modules` 链接并清除副本失败缓存，没有改动用户原目录。E2E 使用显式确认的独立可丢弃数据库及端口3115，框架现有隔离门禁保持启用。初次 E2E 因临时包装器错误地把普通连接设为测试连接而被门禁拒绝；随后因复制的外链导致编译失败。纠正测试环境后重跑，均非应用回归。

数据库集成演练在独立测试库新建本次专用 schema，完成后仅清理该 schema：验证默认回滚、SET NULL 外键拒绝、历史快照拒绝、中途删除失败时审计和删除一起回滚、成功写入完整 before 及重复执行幂等，5 组实测通过。证据为仓库外 `integration.log`；现场演练与执行证据为 `dry-run.json`、`applied.json`；文件读取为 `oss-head.json`、`oss-get.json`，均不收录签名或凭证。

| 最终验证命令 | 结果 |
|---|---|
| `pnpm exec vitest run scripts/maintenance/__tests__/retire-unused-paper-imports.test.ts` | 14项通过，零跳过。 |
| `pnpm exec vitest run` | 582文件通过，6,198项通过；43项为起点已跳过的legacy bill测试，不计入通过。 |
| `pnpm exec playwright test tests/e2e/workbench.spec.ts tests/e2e/workbench-paper-boundaries.spec.ts --project=chromium` | development模式10项通过，零跳过，1.8分钟；包括目录逐项选择、自动计算、缺价恢复、权限及资料查询。 |
| `pnpm lint`，最后增补后重跑维护脚本eslint | 零错误，最终任务文件零警告；全库仍为global-error和OrderForm两处既有警告。 |
| `pnpm typecheck` | 最终候选通过。 |
| `git diff --check` | 通过。 |

日志位于同一仓库外证据目录：`target.log`、`unit-final.log`、`e2e.log`、`lint.log`、`lint-final.log`、`typecheck-final.log`。本次没有schema迁移、发布、push或价格规则修改；验证范围是上述问题修复，不能据此宣称整个生产环境已完成发布验收。冰白纸专版价格需要业务管理员按现行流程配置和发布，仍不代填价格。

## 冰白纸核价方式定案（2026-09-11）

业主随后明确指定冰白纸专版烫金采用管理员手动核价，取代上节“补充并发布自动价格”的待办。此后该路线由共用计价引擎主动转人工核价，工作台显示明确原因，金额保持待核价；即使后续价格表出现匹配价格也不会自动报价。彩印、其他纸张和既有历史报价不变。决策见 [DECISIONS](../../DECISIONS.md#2026-09-11冰白纸专版烫金由管理员手动核价)。

实施起点 `385adbc1cba044040cc862a16e79858d8e82f291`，独立候选 `/tmp/erp-ice-manual-20260911/snapshot` 为 Git archive 加仅本次8个文件改动。新增4项断言在原实现下全部失败（`red.log`），修改后全量 `pnpm exec vitest run` 为582文件、6,202项通过，43项仍为既有legacy bill跳过（`unit.log`）。`pnpm lint` 零错误、2个既有location.assign警告；`pnpm typecheck` 通过（`lint.log`、`typecheck.log`）。

调用链复核：`submit-external-order` 按 MANUAL_PRICING_REQUIRED 保存款式待核价状态和空报价，并将整单转 PENDING_ADMIN_CONFIRMATION；`pricing-review` 保留 ADMIN 权限校验。此轮未提交、改价或流转用户实际工单。真实开发页面选择冰白纸后已显示本次管理员核价文案，加工费及加价金额均为待核价。

E2E 使用独立可丢弃数据库、端口3115。为使测试目录与已修复的开发目录一致，先在该测试库执行上一提交的受保护纸张清理脚本；8类外键、33个快照字段检查通过，演练证据与正式操作分属独立测试库。本次没有改已发布价格表或迁移。

`pnpm exec playwright test tests/e2e/workbench.spec.ts tests/e2e/workbench-paper-boundaries.spec.ts --project=chromium` 最终11项通过、零跳过（development模式，1.9分钟，`e2e.log`），包含新增的冰白纸人工核价、改数量仍待核价以及切回红卡恢复自动报价。`git diff --check`通过。仅本地提交，不包含发布或生产环境全面验收。
