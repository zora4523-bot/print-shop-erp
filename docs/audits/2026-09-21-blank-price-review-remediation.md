# 空白封按单价管理：审查整改

开始基线 `b8a93cf1`，分支 `codex/maindev`，工作区干净。业主已授权规划并执行修复。

## 范围与不变量

1. 管理员新增/修改空白封规格采用 `targetBlankIdentity`，确认、预览和落库一致；新业务仍走当前正价准入，非空白重复产品仍须显式选择。
2. 工单用料估算的资料冲突返回明确诊断，不导致整页失败、不选择任意纸张、不回退成零用量成功。历史 Product BOM 读取保持。
3. 未执行迁移前检查所有相关价格身份重复、旧零价和产品/价格文本漂移；迁移过程有有界锁等待。已应用迁移不可修改，正式库不在本次执行范围。
4. CI 实际执行两项迁移安全测试，保留隔离库保护；补齐工作台浏览器和非空白缺价提交测试。
5. 审批差异显示空白封目标规格；规格页面取数归领域层；同步开发库迁移状态。
6. 人工材料价继续遵循已确认的管理员填写、修改、确认及审计策略，不新增未经确认的限制；历史原价与已结算金额不因本轮修改重写。

## 验证计划

先保留失败回归，再修复运行同一断言。目标单测与浏览器、全量 Vitest/覆盖率、完整浏览器组件、lint/typecheck/架构/死代码门禁；一次性数据库执行完整迁移、迁移前置拒绝及锁竞争测试，生产构建真实表单验证规格、金额与持久化一致。日常库仅可只读，写入测试只用本次专用库。

## 结果

### 已落实的审查项

- 管理员空白封 ADD / UPDATE 共用目标身份转换，传 `targetBlankIdentity`；覆盖新款无 Product ID、历史款带旧 ID 两种情况。保留服务端新准入，未放宽 Product 参数校验。
- 两个审批差异投影和工作台摘要识别目标规格，不修改原审计 JSON。
- 用料估算对重复纸张、资料缺失和失效默认分类返回逐款诊断；历史产品 BOM 继续读取，正常款式继续估算，部分汇总有明确标识。
- 预检遍历全部 STOCK_BASE 行，检查唯一性，并与创建草稿共用产品/文本身份判断。给出现行/预约/草稿中的绑定产品零价清单并拒绝；新政策无绑定零价是正常停售，不误拦。
- 迁移保护脚本核对目标及 pending 清单，持有价目锁重做预检，先拒绝表锁冲突，再以有界等待执行原迁移。原 schema、两条已应用迁移均未修改。日常 `deploy/update.sh` 在旧进程停机前只读检查两条切换迁移是否完成，未完成即拒绝普通发布，避免从另一入口直接执行未预检迁移。
- CI unit 数据库改名 `erp_e2e_unit`，增加报告检查，价格与 BOM 迁移套件缺失或跳过不再算绿。工作台旧空白封 Product 断言更新；专版重复产品的显式选择保护保留。
- 补回非空白款式、包装和物流缺价转人工的提交编排测试，继续断言 `EXCLUDES_MANUAL_ITEMS`、`quotedAmount=null`、`PENDING_AMOUNT` 和待管理员确认修订。
- 规格页读取收敛到 `lib/product.ts`，页面权限与查询范围保持。

### 不直接采纳的建议与反证

1. 不给已经应用的 `migration.sql` 加前置 SQL：本机日常库只读确认 160 条迁移已应用；AGENTS / CONTRIBUTING 禁止修改已应用迁移。保护在执行 Prisma 前完成，冲突不会先产生 Prisma 失败记录；仍需保持操作窗口停写，不能声称排除了不遵循锁协议的外部连接。
2. 报告称“两项迁移测试原先均在 CI 跳过”不完全成立：价格测试只接受 `erp_e2e_` / `test_`，确会跳过；BOM 使用通用可丢弃库判断，原 `_ci` 后缀本已满足。统一命名并增加实际报告门禁，避免再靠总通过数推断覆盖。
3. 不限制人工材料价只能补缺：业主执行指令要求支持人工修改，现有已确认价更正有专门 E2E、权限、依据和版本审计；本轮保留该能力，并澄清方案 §6。更正确认本身不重写整单金额。
4. “不改 schema”属于此前纸张规格分离阶段；后续业主授权的现行按单价方案 §7.1 明确要求无 Product 的 BOM 目标。本轮不撤销其已应用结构，不以回滚历史代替缺陷修复。

### 环境与已完成证据

- 候选：`b8a93cf1` 加本任务工作区增量；运行模式和证据限本机，不代表远端 CI 或生产验收。
- 日常开发库 `localhost:5432/print_shop_erp` 本轮只读：160 条迁移，预检 `readyForAutomaticCutover=true`，229 条规则，旧零价/文本漂移/重复价格身份清单均空。仍有保留的 120g 退役规则提示，未自动清理任何业务数据。
- 写入测试只用自建 `erp_e2e_blank_review_1789928171436` 与 `erp_e2e_blank_cutover_1789928515254`。后者先在外部临时目录按原 SQL 应用前 158 条，再调用真实受控 Prisma 部署完成两条，查询确认 160 条；不是 mock 迁移。
- 原问题红灯：管理员四种 ADD/UPDATE 身份案例 4 失败；用料/审批差异 4 失败；预检新增案例失败，修复后同断言通过。日志 `/tmp/blank-review-admin-red.log`、`/tmp/blank-review-domain-red.log`、`/tmp/blank-review-preflight-red.log`。
- 完整浏览器组件 49 文件 / 802 项通过，`pnpm test:browser`，日志 `/tmp/blank-review-full-browser.log`。
- lint 0 错误，3 条既存警告（订单页未用局部变量与两处导航用法）；架构、类型、备份 23 项、死代码增量门禁通过。未更新死代码基线或降低覆盖率。
- 第一次全量单测的新锁释放测试受其他并行用例持有同一全库 advisory lock 影响：把“此刻任何人都能拿锁”改为检查“本次持锁 backend 已无锁”，保留迁移期间阻断共享锁的断言；不是放宽生产代码。新增非空白测试首轮缺少专版 craft fixture，补齐真实 craft code 后通过。
- 全量单测第一轮修正后 687 文件 / 7,489 项通过，44 项既有跳过（旧账单实现 43 项、需独立 opt-in 的包装修复集成 1 项），覆盖率 statements 85.96%、branches 80.07%、functions 91.74%、lines 87.90%。两项价格/BOM 迁移及新增迁移保护套件实际通过。增加普通部署入口保护后全量复验 7,490 项通过 / 44 项既有跳过，覆盖率不变，报告门禁通过。
- 真实编辑首轮 UPDATE 已通过：1,200 个珠光艳闪 160g 大号费用 204.00，改中号 192.00，差额 12.00 与现行材料价差一致。ADD 用例首轮错误沿用“已有分袋的草稿”，该状态本就无新增入口；保留既有包装限制，改用尚未分袋的草稿 fixture，未为测试放宽生产代码。
- 新增款式真实入口还有原有包装边界：已有分袋的草稿不开放 ADD，未分袋草稿的整单预检会拒绝 `BAGGING_INPUT_PENDING`。本轮不自动猜分袋、不把包装当免费、不放宽报价完整性。ADD 真实框架测试验证目标身份传输与不完整报价零写入；四种组件用例覆盖 ADD/UPDATE 与新旧 Product ID，不能把它宣传为“无包装资料也能成功新增”。完整可保存 ADD 的分袋交互需单独明确，未在此次协议修复中扩展。
- E2E fixture 修正记录：停用重复纸张才能复现历史冲突且遵守在用纸张名称唯一索引；Material id/text 与 code/citext 需显式参数类型；草稿新增预检必须有主收货记录。所有失败保留原安全约束，未放宽数据库或包装校验。
- release `next build` + `next start` 后运行八文件 E2E：26 项既有用例通过；新增 2 项在修正 fixture/定位器后分别定向通过，累计 28 项不同用例已验证，不能将中途 26 通过/2 失败那轮说成全绿。最终业务代码未再改变，后续仅复用同一 `.next-release` 构建调试测试。覆盖两端三路线真实金额/提交、断网恢复、人工报价、历史核价与取消、UPDATE 规格落库、ADD 正确目标传输及缺分袋零写入。
- 用料异常真实查询返回 HTTP 200，无 pageerror；停用的重复纸张也保留身份冲突诊断。六视口 375/393/768/1024/1280/1920、明暗、无横向页面溢出、44px 触控目标、实际 tap/键盘展开收起和 scoped axe 均通过。详情区默认展开，测试须先验证 open 再收起/展开，不可把首次点击当展开。查看了 375 浅色与 1920 深色截图，诊断可读、不显示零用量成功。
- 日常 3000 服务未操作。两个一次性库在确认无连接后已删除，连接状态与执行器临时文件已删除；日志及无凭据测试报告留在本机。未 push、部署或修改生产。

### 主要命令与证据

以下 DATABASE_URL 仅指上述专用可丢弃库，连接参数通过临时受保护环境注入，文档不记录凭据。

```bash
pnpm exec vitest run --coverage --reporter=default --reporter=json --outputFile=.review/unit-tests.json
node scripts/check-blank-migration-tests.mjs
pnpm test:browser
pnpm lint
pnpm typecheck
pnpm check:architecture
pnpm test:backup
pnpm check:dead-code --check
pnpm exec playwright test --config=playwright.release.config.ts --project=chromium \
  tests/e2e/admin-create-pricing.spec.ts tests/e2e/admin-order-entry.spec.ts \
  tests/e2e/order-create.spec.ts tests/e2e/order-create-ui-parity.spec.ts \
  tests/e2e/order-entry-stability.spec.ts tests/e2e/order-packaging-types.spec.ts \
  tests/e2e/order-auto-pricing.spec.ts tests/e2e/blank-price-only.spec.ts
# 新增 fixture 和定位器修正后，仅重跑受影响用例；E2E_PREBUILT=1 复用同候选构建。
pnpm exec playwright test --config=playwright.release.config.ts --project=chromium \
  tests/e2e/order-create.spec.ts --grep '纸张身份冲突|管理员新增空白封'
```

最终全量单测 `/tmp/blank-review-full-unit-final2.log`；完整组件 `/tmp/blank-review-full-browser.log`；真实迁移 `/tmp/blank-review-real-cutover.log`；八文件 E2E `/tmp/blank-review-e2e-final.log`；新增保护 `/tmp/blank-review-e2e-target4.log` 与用料最终 `/tmp/blank-review-e2e-bom-final.log`。复核后的 typecheck、lint、架构、备份及死代码日志均在 `/tmp/blank-review-*.log`。JSON 单测报告 `.review/unit-tests.json` 包含迁移实际执行结果；截图位于 `test-results/release/`，均不入 Git。

边界：无远端 CI / 生产存量验收；通知/CDR mock、后台任务 inline，未验证真实消息、OSS 上传或 durable worker。浏览器回归有页面离开导致的服务器 `destination stream closed early` 日志，未改这些无关流式导航路径，当前交互断言通过；新增用料用例另外要求 pageerror 为空。正式发布仍按部署指南独立放行。
