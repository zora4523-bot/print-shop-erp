# /orders 管理工作区切换验收（2026-09-21）

## 第 0 步：基线

- 候选：`226058a4`，`codex/maindev`，起始工作区干净；SPEC §3.1.1。
- 使用 `scripts/e2e-release-build.ts` 的 `next build` 和 release 配置的 `next start`，端口 3200；本地可丢弃库 `erp_e2e_orders_perf_20260921`，不修改日常/生产数据。夹具复用 `admin-workspace-filter.spec.ts` 的八种状态；空队列附带不匹配的搜索词，非空生产队列两条。
- 临时 Prisma query 事件 + AsyncLocalStorage 分别标记 loader / options / billing / exports；只记录参数化 SQL 和耗时，不记录参数。源文件已恢复，埋点不进入提交。日志在 `/tmp/orders-perf-20260921/`。
- 每组 3 次，首轮保留但不当作稳定收益；下表为后两次范围（ms）。浏览器真实点击待打印队列（该夹具 1 条）一次完整请求 154 ms；非空页面已完成展示，但 Playwright `response.finished()` 未结束，主动中止该采集。完整响应基线改用相同浏览器登录会话 `page.request.get` + `RSC: 1` 读完整响应体；它不等同于点击到绘制延迟，也不带客户端 Router State Tree，不能伪称真实导航 P95。

| 项目 | 空结果 | 非空（2 条） |
| --- | ---: | ---: |
| 工作区 loader | 95.98–131.44 | 91.06–139.76 |
| 工作区分支（包含设置读取） | 109.61–134.33 | 92.09–142.41 |
| filterOptions | 2.25–13.92 | 1.39–1.97 |
| billingStats | 8.57–14.03 | 1.29–2.38 |
| recentExports | 2.00–13.96 | 1.22–1.78 |
| 完整 RSC 请求/响应读取 | 133.23–161.48 | 111.16–165.31 |

首轮空结果 loader 453.56 / RSC 501.79 ms；首轮非空 loader 138.99 / RSC 166.74 ms。不用一次尖峰决定结构改造。

### 事务 query 事件明细

以下分别为两组最后一次采样，按事件顺序列出；事件 duration 含驱动等待，不能把嵌套/排队事件简单相加当作可节省的墙钟耗时。数量只描述本次埋点的 scope，不据此重解释上一轮页面级 34 条结论。

#### 空结果

| 序号 | 查询对象/动作 | ms |
| --- | --- | ---: |
| 1 | Order SELECT | 1.14 |
| 2 | Order COUNT/groupBy | 6.83 |
| 3 | Order COUNT/groupBy | 7.89 |
| 4 | Order COUNT/groupBy | 6.15 |
| 5 | Order COUNT/groupBy | 4.76 |
| 6 | Order COUNT/groupBy | 5.56 |
| 7 | Order COUNT/groupBy | 5.03 |
| 8 | Order SELECT | 4.38 |
| 9 | User SELECT | 1.40 |
| 10 | Party SELECT | 1.67 |
| 11 | UserOrderStar SELECT | 1.90 |
| 12 | OrderItem SELECT | 2.11 |
| 13 | OrderCustomerCharge SELECT | 2.29 |
| 14 | OrderChangeRequest SELECT | 2.46 |
| 15 | OrderPrintJob SELECT | 2.63 |
| 16 | AgentMonthlyBillItem SELECT | 2.76 |
| 17 | OrderShipment SELECT | 2.89 |
| 18 | OrderWorkflowDecision SELECT | 3.06 |
| 19 | ProductionOperation SELECT | 3.23 |
| 20 | ProductionProgressStep SELECT | 3.39 |
| 21 | OutsourceOrder SELECT | 3.61 |
| 22 | OrderLog SELECT | 3.83 |
| 23 | ProductionTask SELECT | 1.96 |
| 24 | OrderItemDesign SELECT | 2.21 |
| 25 | OrderPrintJob SELECT | 1.91 |
| 26 | AgentMonthlyBill SELECT | 1.93 |
| 27 | User SELECT | 0.95 |
| 28 | OrderItem SUM | 4.96 |
| 29 | Order COUNT/groupBy | 4.47 |
| 30 | Order COUNT/groupBy | 6.57 |
| 31 | Order COUNT/groupBy | 5.97 |
| 32 | Order SUM | 8.95 |
| 33 | Order SUM | 6.49 |
| 34 | Order SUM | 4.33 |
| 35 | COMMIT | 0.22 |

#### 非空结果

| 序号 | 查询对象/动作 | ms |
| --- | --- | ---: |
| 1 | Order SELECT | 0.56 |
| 2 | Order COUNT/groupBy | 5.85 |
| 3 | Order COUNT/groupBy | 3.93 |
| 4 | Order COUNT/groupBy | 4.82 |
| 5 | Order COUNT/groupBy | 4.23 |
| 6 | Order COUNT/groupBy | 5.04 |
| 7 | Order COUNT/groupBy | 5.06 |
| 8 | Order SELECT | 4.67 |
| 9 | User SELECT | 1.25 |
| 10 | Party SELECT | 1.44 |
| 11 | UserOrderStar SELECT | 1.43 |
| 12 | OrderItem SELECT | 1.84 |
| 13 | OrderCustomerCharge SELECT | 2.04 |
| 14 | OrderChangeRequest SELECT | 1.94 |
| 15 | OrderPrintJob SELECT | 2.10 |
| 16 | AgentMonthlyBillItem SELECT | 2.30 |
| 17 | OrderShipment SELECT | 2.48 |
| 18 | OrderWorkflowDecision SELECT | 2.77 |
| 19 | ProductionOperation SELECT | 2.99 |
| 20 | ProductionProgressStep SELECT | 3.15 |
| 21 | OutsourceOrder SELECT | 3.28 |
| 22 | OrderLog SELECT | 3.46 |
| 23 | ProductionTask SELECT | 2.15 |
| 24 | OrderItemDesign SELECT | 2.30 |
| 25 | OrderPrintJob SELECT | 1.86 |
| 26 | AgentMonthlyBill SELECT | 1.71 |
| 27 | User SELECT | 0.61 |
| 28 | OrderItem SUM | 6.37 |
| 29 | Order COUNT/groupBy | 4.18 |
| 30 | Order COUNT/groupBy | 5.73 |
| 31 | Order COUNT/groupBy | 5.73 |
| 32 | Order SUM | 4.95 |
| 33 | Order SUM | 6.93 |
| 34 | Order SUM | 6.74 |
| 35 | Order SELECT | 0.40 |
| 36 | ProductionOperation SELECT | 0.37 |
| 37 | OrderItem SUM | 0.32 |
| 38 | ProductionWorkOrderProgress SUM | 2.86 |
| 39 | ProductionScanClaim SELECT | 0.57 |
| 40 | COMMIT | 0.17 |

### 测量后的取舍

- 第 1 步保留：useLinkStatus 切换反馈独立于服务端耗时优化。
- 第 2 步不实施：三个附属分支热读均 <20 ms，且均早于 loader 返回；拆闸口没有本次测量支持的首屏收益。optionalAdminRead/现有 issues 不变。
- 第 3 步不实施：目标七条查询单条均 <20 ms，事件耗时总和不能直接作为收益；不增加判空分支、额外 count 或更改队列计数。loadCraftNames、getWorkOrderProgressByOrderIds 不变。
- 预取、缓存不变；第 4 步尚未实施。依用户要求，后续阶段需先给出前一步实测结果；收益不明显时停止扩展。

### 验证

第 0 步：生产构建与完整 RSC 采集通过。提交前 `pnpm check:architecture`、`pnpm test:backup`、`pnpm lint`（3 条既有警告）、`pnpm typecheck`、`pnpm test run` 全部通过；Vitest 687 文件 / 7,494 项通过，44 项既有跳过。

## 第 1 步：切换反馈

- 保留原有 Link、href、`prefetch={false}` 和表单 key；只在 Link 后代读取 Next 16.3.4 的 `useLinkStatus()`。没有 router.push、自建导航请求或乐观改写队列选中态。
- pending 链接有等待图标与读屏状态播报；列表上方保留固定提示空间，等待时说明仍是旧结果，并给旧结果区加弱底和虚线。结果不被替换，不因提示出现下跳。
- 初版测试发现隐藏图标仍执行无限动画，已改为仅 pending 时执行；Browser Mode 断言空闲/完成后没有无限动画。未放宽既有颜色测试等待条件。
- 三个现有完整工作区 Browser Mode 夹具补齐 next/link 的 useLinkStatus mock；新增真实事件循环与键盘焦点测试。真实 release E2E 阻塞两条队列请求，验证旧结果仍在、最新链接独占 pending、旧请求结束/取消后仍展示最后一次选择。
- 旧构建负控：新增 E2E 因找不到切换提示失败；首轮新构建 7/7（含 no-js 4 项）通过。自动化发起点击至提示断言约 110 ms，包含 Playwright 等待，非纯浏览器渲染延迟。
- 最终生产构建实测：点击事件到 pending DOM 标记 **1.3 ms**；自动化点击到提示断言 **37.7 ms**。这是一次事件反馈采样，不是绘制耗时、INP 或 P95；后端查询未改变，不声称查询提速。
- 最终门禁全部通过：architecture、backup、lint（3 条既有警告）、typecheck、生产构建；全量单测 **7,494 通过 / 44 既有跳过**，浏览器组件 **805/805**，release E2E **7/7**（含 no-js **4/4**），完整六视口 admin-ui **103 通过 / 5 既有条件跳过 / 0 失败**（375、393、768、1024、1280、1920）。
- 复测过程发现并修复测试 mock 缺导出、测试夹具原生按钮违反组件门禁、空闲无限动画；三个相关浏览器文件定向 43/43 通过。销售工作台长用例曾超时，最终全量通过，未修改工作台代码或放宽超时。一次单测受外层 E2E_PREBUILT 环境变量影响，清除测试环境串用后完整重跑通过。
- 改动文件：AdminOrderWorkspace.tsx / .module.css、OrderQueuePending.tsx、OrderQueueResults.tsx；三个既有工作区浏览器夹具、新增 OrderQueuePending.browser.spec.tsx、admin-workspace-filter.spec.ts；本验收文档及 HANDOFF.md。所有业务修改仅涉及反馈展示。
- 验证结束已删除本次隔离测试库及临时连接文件/数据库转储；日常开发服务器与数据未改动。

## 停止范围

按业主“任何一步实测收益不明显就停下来说明”的要求：第 1 步验证提交后停止，不进入第 2 步拆闸口；附属分支热读 <20 ms 且早于列表完成，无可证明的本次收益。第 3 步不增查询短路；第 4 步筛选导航与输入保留未实施，也未创建/修改 PR 描述。不能将本轮表述为四步全部完成；原生筛选提交和队列切换丢失未应用输入仍保留，等待后续明确推进。
