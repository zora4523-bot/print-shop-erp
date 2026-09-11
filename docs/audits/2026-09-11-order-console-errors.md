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
