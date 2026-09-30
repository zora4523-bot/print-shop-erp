# 分支整合与 PR 验证

用户授权将 `codex/order-leave-recovery` 提交到仓库、创建 PR、运行 CI，并继续修复失败。开始于 `d025c72b`；远端 `main` 为 `038655d1`。分支有 38 个未合入提交，主分支有 7 个独有提交。起始无已跟踪文件改动，既有 `.playwright-cli/` 不纳入。

## 主分支整合

- 使用 merge 保留双方提交历史。费用编辑组件保留主分支的容器响应式布局、嵌入模式及响应丢失后的禁止重复提交；同时保留本分支的可选制版空态隐藏、历史记录和具体动作名称。
- 费用布局测试继续覆盖六视口、双主题、独立与嵌入模式。长名称夹具使用可编辑款式，避免空态隐藏后失去长文本覆盖。
- 费用请求恢复测试按实际“移除对客费用 / 移除制版明细”按钮定位，保留确认前零请求、输入保留、失败锁定和成功提示替换断言。
- 清除 PR 差异中的三处行尾空格和一处文件尾空行，不改变业务逻辑。

## 本地整合检查

- `pnpm exec vitest run --config vitest.config.ts`，限定 `OrderCommercialDetailsManager.empty`、`OrderChangeRequestForm.business-language`、`AdminRouteStates` 和 `change-request`：4 文件、248 项通过。
- 浏览器组件限定 `PlateDetailEditor`、`CommercialFeeRecovery`、`AdminOrderEditor`、`OrderChangeForms`、`AdminRouteRecovery`：137 项通过，3 项旧确认按钮断言失败；修正后 `CommercialFeeRecovery` 20 项全部通过，5 文件共 140 项最终通过。
- `pnpm typecheck` 和 `pnpm lint` 通过；保留两处既有 `location.assign` 警告，文案/令牌门禁无新增违例。
- `pnpm check:dead-code --check` 发现候选清单与实际消费方存在差异，作为后续独立 CI 修复处理；不刷新整个清单或删除未知消费方。

证据保存在本机 `/tmp/erp-pr-ci-1001/`，不纳入仓库。PR 包含之前完成的 UI、离开保护、PDF 和销售月账单任务，以及两个仅新增可空列的前向迁移；未执行生产迁移或部署。远端 CI 的候选 SHA、运行链接与最终结果记录在 PR 的检查和验证表中；此文不将待运行的检查写为通过。

## 死代码候选检查修复

核对本次新增候选的源码引用、barrel 和实际页面调用链后，将只在模块内部使用的面包屑集合、筛选键函数、离开计划函数、排单 DTO、价格字段类型及 PDF 内部错误/退出常量改为私有；实现保留。`FormPage` 的宽度常量重复出口和建单结果 barrel 的组件出口移除，实际消费者分别仍通过共享 UI barrel 和组件文件使用它们。未删除动态消费的 PDF render 导出。

PDF 协议超时改为两个渲染预算的最大值，当前仍为 60 秒，既有预算关系测试保留。`pgrep` 是 POSIX 系统命令，由独立 PDF 进程生命周期检查使用，在 Knip 的外部二进制声明中明确登记，未屏蔽源码导出检查。

清单只移除 8 个准确条目：已被页面使用的 `PageHeaderProps`（两个扫描器）、被 worker 动态导入路径覆盖的 render 四个 ts-prune 条目，以及本次改为私有的两个价格字段类型。没有批量刷新清单，也没有加入未经核对的新候选豁免。扫描结果与这份清单比较为零新增、零待移除；160 项定向测试、完整类型和 lint 通过。CI 中继续按原门禁运行完整扫描。

## 首轮 CI：依赖安全补丁

PR #32 首轮 `Quality` 运行 `36766861290` 的生产依赖审计报告 5 条公告。按上游已修复版本最小升级：

- `next`、`@next/env`、`eslint-config-next` 同步为 `16.3.6`，对应 [Next.js 公告](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j)。当前项目未使用 Node `next/og` 的 `ImageResponse`；依然安装补丁，不以未发现入口替代安全门禁。
- 对实际依赖树中的 `fast-uri` 3.x 和 `brace-expansion` 5.x 使用有上限范围的 override，分别锁到 `3.1.8`、`5.0.12`。依据 [fast-uri 公告](https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj) 及 brace-expansion 的 [解析递归](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-6j4f-fj2g-mc7p)、[嵌套递归](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-qhr7-859c-m2p7)、[二次复杂度](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr) 公告；未全量升级无关依赖。

已先阅读安装版 Next 16 升级文档，保留现有路由和构建配置。用 Git 归档及候选清单/锁文件创建无 `node_modules` 的干净目录，`pnpm install --frozen-lockfile` 通过；`pnpm audit --prod --json` 为 0 条公告，完整 typecheck、lint 和 `pnpm check:dead-code --check` 通过。Next 补丁后的全量浏览器组件测试 75 文件、1,047 项通过；后续离开确认缺陷的新增测试及生产构建、远端同 SHA 检查单独记录。

## 首轮 CI：交互与测试契约修复

- 四项浏览器组件失败来自已批准文案精简后残留的旧断言：物流确认、批量结果两项和共享报工不计薪标识。断言改为当前动作及作用域内的“不计薪”，仍校验金额快照、幂等、全部结果分类和可报工链接。完整浏览器组件集 1,047 项通过。
- 报价草稿恢复的真实框架测试暴露出离开确认竞态：弹框后自动保存完成，原有后果列表变空，通用确认组件因此禁用操作。新增组件回归先确认失败，再由协调器展示“当前没有未保存的内容”及“离开页面”；通用空确认保护不修改。新增测试同时检查自动保存后启动请求仍锁定。两个离开保护文件共 26 项通过。
- 报价恢复 E2E 显式处理当前离开确认；原单未重新打开前仍要求存储字节不变。重新打开并保存后对比全部草稿字段、范围和版本，仅允许保存时间前进，保留报价草稿恢复及原单不被覆盖的验证。
- 管理员代销售建单用例用可见语义行定位桌面列表，并核对精确工单 ID；另一账号的桌面行和移动卡片都必须为零。停用会话测试按现行“外部销售月账单”标题进入，权限拒绝断言全部保留。
- durable PDF 用例启用真实触控，并在点击重试后等待路由实际返回 202，再验证排队页。原实现的路由会等待约 10 秒，不能用默认 5 秒 DOM 断言替代响应等待。下载事件在释放测试任务前注册；继续检查原页轮询、焦点、多页 PDF、重复下载、匿名拒绝、六视口双主题和 axe。

隔离库 `erp_e2e_pr_ci_1001` 完整 181 条迁移、seed 和测试价簿准备通过。build/start 模式下三项真实 worker 文件用例通过，PDF 恢复独立复跑 1/1 通过；direct PDF 在 queued 套件中按设计跳过，仍由独立 direct 配置覆盖。业务 E2E 使用同一隔离库顺序执行，临时干净副本在 3337 启动，不覆盖用户 3336 的预览构建。最新业务回归和远端完整结果记录到 PR 验证表。

修复后业务验证：建单人工定价及账号隔离 2 项、会话拒绝 2 项通过；报价工作台首轮因保存时间更新的旧字节断言失败，保留全部字段等值并验证时间前进后，整个工作台 10/10 通过。最新完整类型检查与 lint 通过；临时干净副本完成 Next 16.3.6 production build/start。远端 CI 仍须验证最新提交。
