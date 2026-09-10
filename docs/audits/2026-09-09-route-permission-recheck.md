# 下载接口权限复审与修复

基线：`c9d9c1c`。复审报告中的两项建议不构成已证实的越权下载；本次修复鉴权接入方式和错误响应，不扩展权限范围。

## 改动

- `proxy.ts`：保持 matcher 不变；已纳入拦截的 API 匿名请求返回 JSON 401 和 private/no-store，页面仍重定向登录。公开及自行认证入口保持原行为。
- `app/api/salary/piecework-settlements/export/route.ts`：通过 auth(handler) 接收请求会话，再使用 requireSessionPermission 校验数据库当前账号状态和 salary:view:all；无权限在读取结算数据前返回 401。权限仍仅 ADMIN。
- `app/api/orders/[id]/pdf/route.ts`：通过请求会话和 requireVerifiedSession 校验当前账号；继续使用 getOrderForPrint 的角色/工单范围，不额外改为仅管理员。下载任务仍绑定账号、工单、生产版本，交付前再次校验工单版本。
- PDF 内联渲染和后台任务失败不外显原始异常或内部 errorCode；统一 PDF_GENERATION_FAILED 与恢复动作。内联日志只保留固定事件，不记录原始异常正文、URL 或路径。
- API.md 更新会话 API 响应与错误信息契约。

## 验证

在 HEAD 加本任务补丁的独立候选中验证，不依赖工作区其他未提交改动。

- 50 项针对性测试通过：Proxy 匿名响应/页面跳转/公开入口 matcher、工资导出角色与停用/删除/降权账号、PDF 验证后身份、工单与任务归属、版本、错误信息收敛，以及已有会话和打印权限测试。
- 原有 PDF 测试仅迁移 auth 包装后的调用入口与会话 mock，保留既有状态码、任务绑定、版本及重试断言；另增异常收敛与身份来源断言。
- 完整 Vitest（maxWorkers=2）：基线 5738 通过、4 失败、98 跳过；候选 5756 通过、4 失败、98 跳过。相同四项断言失败为 button-components、interaction-css-contract、order-detail-commercial-visibility 的 WORKER 与 SALES 两项。未修改这些无关断言。
- 两边均有四个数据库测试文件因 DATABASE_URL 未配置无法加载：material-price-snapshot-lock、create-order-published-rule-adapter、current-create-order-golden-gate、external-processing-truth-repair-runtime。这些不计为通过。
- 首轮高并发运行因资源争用停止；文案检查测试的超时在低并发复验通过。
- 最终独立候选 `pnpm typecheck` 通过；`pnpm lint` 无错误，保留两条既存未使用变量警告；文案门禁 0 处未豁免命中。
- 实际匿名 HTTP：两条下载接口均从 307 登录重定向改为 401 application/json，带 private/no-store。
- 已登录浏览器导出实测未取得响应，已停止等待，未计为通过；管理员成功导出、过滤参数和文件头由测试验证。未对真实业务执行付款、审批、报工或结算操作。

本次不改数据库、计价公式、所有权规则或已应用迁移；不声称全仓测试全绿。
