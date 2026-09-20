# 管理员与外部销售新建工单自动报价审查

2026-09-21。候选基线 `1b0123d4`，分支 `codex/maindev`，开始时工作区干净；本记录对应其上的表单修复、回归测试和交接文档增量。没有变更价目、计算公式、数据库结构或历史金额。

## 发现与修复

1. **管理员空白封新单有正确报价，仍不能直接提交。** `collectOrderFormGaps` 仍要求 `productId`，但空白封改造后合法新明细不再创建或绑定旧产品。实测提交被“未匹配规则配置，请填写配置外说明”拦截；服务端又明确禁止空白封通过配置外说明绕过准入。现在空白封使用纸张和规格检查表单资料，仍要求完整报价；其他路线保留产品检查。服务端的正价、纸张启用/唯一性/缺货、标准尺寸校验保持原样。
2. **两端自动报价请求异常会破坏当前表单。** 浏览器中断报价 Server Action 的 POST 后，未捕获的异常进入页面错误边界，已填写内容无法在当前页面继续操作。现在异常进入现有“核价失败 / 重新报价”流程，保留表单内容；仍经过请求序号、报价条件和款式标识检查，过期失败不能覆盖新报价。

代码与验证入口：

- [报价请求和重试](../../components/business/order/OrderForm.tsx)
- [提交前资料检查](../../components/business/order/order-form-gaps.ts)
- [资料检查边界单测](../../components/business/order/__tests__/order-form-gaps.test.ts)
- [两端真实自动报价 E2E](../../tests/e2e/order-auto-pricing.spec.ts)
- [既有管理员提交复核 E2E](../../tests/e2e/order-create-ui-parity.spec.ts)

## 核对范围

两端共用已发布价目与服务端报价服务，浏览器费用明细不是最终写入依据。核对了新单准入、客户端防过期响应、人工价格事实变化校验、服务端提交重算、报价凭证与价格版本锁，以及包装和物流金额。

新增 E2E 对管理员、外部销售各执行以下断言，期望金额来自已确认规则，不调用被测报价器生成期望：

| 场景 | 核验金额 |
|---|---|
| 红卡 180g 中号，999 个 | 材料 134.87，机烫 40.00 |
| 同规格 1,000 个 | 材料 135.00 |
| 连续改为 1,500 / 1,999 / 2,000 个 | 最终材料 270.00，机烫 80.00，入袋 20.00，纸箱 5.00 |
| 珠光艳闪 160g 大号专版，1,000 个 | 专版阶梯价 325.00，不再显示空白封材料行 |
| 铜版纸 200g 大号彩印、亚膜 | 1,000 个 310.00；2,000 个 450.00 |
| 切回红卡 180g 中号 2,000 个并提交，顺丰到付 | 预览合计和落库 `quotedFee` 均为 375.00；明细加工金额 350.00、`productId=null` |
| 中断报价连接再点击重新报价 | 数量保留为 2,000；正确恢复材料 260.00；两端均无页面异常 |

既有 E2E 另外覆盖：管理员代外销、人工改价后改量、草稿恢复、工单编辑与历史原价保留、393/1280 视口输入稳定性、入袋/不包装/两种装盒、多地址分别进位和最终提交。数据库与单元回归覆盖缺价、停用、重复规则、金额精度、报价变更、权限和历史快照等边界。

日常开发库仅做只读核对：当前加工费第 8 版、物流第 2 版；红卡 180g 中号现货 0.1350 元、大号 0.1500 元。3000 开发服务仍可访问。没有写入日常业务数据，也没有保存或发布现有价格草稿。

## 运行与证据

- 独立可丢弃库 `erp_e2e_quote_audit_1789923314377`：fresh 160 条迁移、seed、E2E 用户/目录/工价/包装资料准备成功。实际写入测试仅在此库。
- 浏览器通过 `playwright.release.config.ts` 执行 `next build` + `next start`，端口 3200，构建目录 `.next-release`；与 3000 开发服务分离。后续仅测试文件变化时复用同一候选构建。
- 初次既有 E2E：20 通过、1 失败，失败为上述管理员提交缺陷。新增资料检查单测修复前 5 失败/8 通过；定向修复后两文件 17 通过。故障注入修复前管理员、外销各 1 失败，页面均进入错误边界；修复后恢复通过。
- 新增测试编写期间曾因复选框可访问名称、彩印规格显示名及明细标签定位失败；按实际界面纠正选择器，金额及提交断言未放宽。中止的调试运行不计验收。
- 修复后定向 E2E：既有复核 3 项、两端金额/提交/网络恢复 4 项通过；浏览器组件 3 文件 41 项通过。
- 最终全量 Vitest：685 文件通过、1 文件跳过；7,475 项通过、44 项沿用既有跳过。覆盖率门禁通过：语句 85.92%、分支 79.97%、函数 91.71%、行 87.86%，未降低阈值。跳过项不计作验收。
- 类型检查、release 构建、架构门禁、完整 lint 通过；lint 有 3 条既有内部导航警告，文案和令牌新增违例均为 0。
- 最终八文件 release E2E：26 通过、0 失败、0 跳过（2.6 分钟），包括空白封停价、历史材料补核与取消并发检查。历史材料编辑器的六视口明暗、触控和 axe 检查也通过；新建页另有 393/1280 视口输入回归。
- 已确认测试进程退出、数据库无连接，再删除本次一次性库；含连接信息的临时状态文件及任务运行器已清理。保留本机验证日志，3000 服务继续运行。

命令均在显式隔离连接环境下执行，连接信息不入库：

```sh
pnpm exec prisma migrate deploy
pnpm db:seed
pnpm test:e2e:prepare
pnpm exec vitest run --coverage
pnpm exec playwright test --config=playwright.release.config.ts --workers=1 \
  tests/e2e/admin-create-pricing.spec.ts tests/e2e/admin-order-entry.spec.ts \
  tests/e2e/order-create.spec.ts tests/e2e/order-create-ui-parity.spec.ts \
  tests/e2e/order-entry-stability.spec.ts tests/e2e/order-packaging-types.spec.ts \
  tests/e2e/order-auto-pricing.spec.ts tests/e2e/blank-price-only.spec.ts
pnpm test:browser components/business/order/__tests__/OrderCreateReview.browser.spec.tsx \
  components/business/order/__tests__/OrderCreationWorkspace.browser.spec.tsx \
  components/business/order/__tests__/ExternalSalesOrderFormRail.browser.spec.tsx
pnpm typecheck
pnpm lint
pnpm check:architecture
```

本机日志 `/tmp/order-price-audit-*.log`；断网修复前截图、trace 留在 `/tmp/order-price-audit-red-evidence/`，最终浏览器报告在 `playwright-report/release/` 与 `.review/playwright-release.json`。这些是本机验证产物，不提交到 Git。

## 结论边界

本次修复针对已复现的两个缺陷；通过的场景可以正常报价和提交，不能据此保证所有可能输入永远无缺陷。空白封无有效正价仍禁止新建；其他属于人工核价的项目保持人工确认流程，不按零元自动成交。

销售提交测试为隔离库准备设计稿记录，模拟对象存储上传失败后继续提交；真实 OSS 上传、企业微信实收和 durable worker 不属于本次自动报价验收。通知使用 mock、任务使用 inline。未操作生产、未推送或部署，不将本机结果记为生产验收。
