# 暗红珠光纸专版自动报价修复

## 范围与依据

- 开始版本：`ffb96982`；任务分支：`codex/dark-red-foil-pricing`。验证对象为该版本加本任务完整差异。
- 用户确认问题发生于专版烫金，并在了解历史加价依据后要求执行修复。
- 起点已有未跟踪的 `.playwright-cli/`、`2026-09-21-first-use-readiness.md` 和 `2026-09-21-first-use-remediation-brief.md`，本任务保留。
- 物料 `PAPER-PEARL-RED-160` 的名称为 `160g珠光闪红`，页面显示为暗红珠光纸。局部烫金五种规格均有价格；专版五种规格返回 `FULL_PAPER_SURCHARGE_NOT_FOUND`。
- [早期价格迁移](../../prisma/migrations/20260807185000_external_sales_price_book/migration.sql)把暗红珠光纸纳入每个加 0.03 元的映射；[结构化价格迁移](../../prisma/migrations/20260826184000_external_sales_processing_rule_v2/migration.sql)同时遗漏其专版阶梯适用范围和独立纸张加价。现行文档 §2.2 原先也未列暗红，已同步修正。

## 实施

1. [发布清单](../../config/customer-price-books/dark-red-paper-20261020.json)明确限定 `160g珠光闪红`，加价 `0.0300` 元/个。
2. [规则准备器](../../lib/price/dark-red-paper-release.ts)为原有专版阶梯增加该准确身份，并生成独立加价行。原有纸张、数量档位、工艺及局部烫金价格保留。
3. [草稿服务](../../lib/price/customer-price-book-admin.ts)使用价目写锁、管理员权限、草稿时间及当前基准版本校验。仅接受原规则副本或本发布清单已准备的草稿；其他价格或计价常量修改会被拒绝。
4. [发布命令](../../scripts/publish-dark-red-paper.ts)默认只读；显式 `--apply` 后通过既有草稿发布服务生成新版本，保留发布审计与历史版本。相同价格重复执行返回 `ALREADY_PUBLISHED`，其他暗红加价拒绝覆盖。
5. 部署参数、环境前置及重试方式写入[部署指南](../部署指南.md#暗红珠光纸专版价格发布)。没有 schema、已应用迁移、页面组件或接口协议变更。

## 本地数据验收

日常开发库 `print_shop_erp` 已从加工费 v11 发布为 **v12**，新版本 ID 为 `cmvgp2e320000m50rzn1856z1`。执行前导出原价目及规则，记录历史表摘要；执行后：

- v11 的全部 `CustomerPriceRule` 逐行相同。
- `Order`、`OrderItem`、`OrderPricingRevision`、`OrderPriceVersionLock`、`OrderCustomerCharge` 的全表摘要相同。
- 局部烫金和专版原有数量档位投影相同。
- 再次执行返回 v12 的 `ALREADY_PUBLISHED`，未增加版本。
- 真实建单目录、准入检查、参数转换及报价器串联读取 10 个组合，全部返回 `QUOTED`；5 个局部烫金组合与发布前相同。

暗红珠光纸 160g、单色、1,000 个的加工小计：

| 专版规格 | 加工小计 |
|---|---:|
| 中号封 | 340.00 元 |
| 方形封 | 340.00 元 |
| 大号封 | 355.00 元 |
| 西封中号 | 400.00 元 |
| 西封大号 | 415.00 元 |

大号封由基础价 325 元和纸张加价 30 元组成，包装及物流另计。

## 验证记录

环境为 Node 24.15.0、锁文件对应的 Next 16.3.8 / Vitest 4.1.11。首次发现本机依赖版本与锁文件不同后，已执行 `pnpm install --frozen-lockfile`；下面全量测试与最终浏览器结果均使用锁定版本。

单测使用隔离库 `erp_e2e_dark_red_20261020`；最终浏览器复跑使用另一个全新隔离库 `erp_e2e_dark_red_fresh_20261020`。两库均明确确认名称，写入测试不连接日常库。最终新库仅执行迁移、seed 和标准 `test:e2e:prepare`，测试自己通过正式发布命令准备数量档位。

| 检查 | 实际结果 |
|---|---|
| `pnpm test:migrations:fresh` | 188 项完整迁移链及后置检查通过 |
| `pnpm exec vitest run --exclude=**/.claude/** --exclude=**/.review/** --coverage --maxWorkers=2` | 789 个文件、8,839 项通过；46 项既有跳过 |
| 覆盖率 | statements 86.98%、branches 81.18%、functions 91.98%、lines 89.34%，门禁通过 |
| `pnpm exec playwright test tests/e2e/dark-red-paper-pricing.spec.ts tests/e2e/order-auto-pricing.spec.ts --project=chromium` | 全新库 7 项通过，0 失败、0 跳过 |
| `pnpm typecheck` | 通过 |
| `pnpm exec eslint --ignore-pattern '.claude/**' --ignore-pattern '.review/**'` | 当前工作区 0 错误，2 条既有提示 |
| `pnpm lint:ui` / `pnpm check:architecture` | 通过；文案、令牌均无新增问题，超长函数债务 0 |
| `pnpm check:docs` / `git diff --check` | 通过 |

新增回归覆盖：

- 精确纸张身份、源规则不变、重复身份及异常阶梯拒绝。
- 非管理员、失效基准、过期草稿、夹带其他价格或常量修改拒绝。
- 全新库发布、同草稿重复准备、发布后重复执行、历史规则逐行比较。
- 五种规格及 1 / 499 / 500 / 999 / 1,000 / 1,999 / 2,000 / 50,000 数量边界；双色、浮雕按原规则加价，三色、180g 暗红及未配置米金仍转人工核价。
- 管理员与外部销售真实登录、页面报价、费用复核、正式提交后的单价 `0.3550` / 加工小计 `355.00`，以及锁定当前加工费版本。
- 原有局部烫金、专版、彩印报价与提交，以及报价请求中断后的重试。

## 首次失败与验收限制

- 首次 Vitest 和默认 ESLint 搜索包含 `.claude/worktrees` 下其他旧工作树及生成文件。保留失败输出后，排除该目录和 `.review`，重新检查当前完整工作区；没有改低检查规则或覆盖率。
- 首次新增浏览器用例错误地把草稿当作正式锁价记录，并在销售端查找不存在的“保存草稿”按钮。已按真实创建、费用复核和提交流程修正测试，补验正式金额及版本锁定，最终全新库 7 项通过。业务草稿规则保持原有设计。
- 46 项跳过由旧账单实现的 41 项和三份独立数据库专项的 5 项组成，未计入通过；本任务新增回归无跳过。
- ESLint 的 2 条提示位于 `app/global-error.tsx` 和 `OrderCreatedSuccessView.tsx` 的原有 `window.location.assign` 调用。
- 浏览器使用 `next dev`、隔离数据库、模拟通知及 inline jobs。设计图沿用现有报价回归的数据库夹具，不证明真实 OSS 上传或生产通知正常。没有布局修改，未执行九视口视觉门禁。
- 本次未推送、创建 PR 或部署生产。生产生效需在获授权的部署中执行价格发布命令。

证据存放在 Git 忽略目录 `.review/dark-red-pricing-20261020/`：`unit.log` / `unit.json`、`fresh.log`、`e2e.log`、`e2e-first.log`、`e2e-existing-db.log`、`local-before-release.json`、`local-release-receipt.json`、`local-result.json` / `local-after-result.json` 和各静态检查日志。发布前后资料仅保存在本机，不随代码提交。
