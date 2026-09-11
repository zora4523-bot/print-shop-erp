# PR #16：CI 后续修复记录

起点：`1f95fe52fbba05d41017e33471f4d6d11a440092`。本次只处理 CI 的纸张前置、考勤/设置窄屏溢出和师傅端动画等待；不包含工作区中另行修改的打印布局、访问逻辑或截图文件。

## 失败证据与修复范围

- Quality run `34565333179`：业务/六视口组 146 通过、7 失败、1 flaky、5 跳过。失败为冰白纸核价，以及 375/393/1024 宽度下考勤或设置页的明暗布局；师傅端 1024 深色在动画等待中超时，重试通过。不能将失败后的未执行路由记为通过。
- 全新隔离库 `erp_e2e_pr16_20260911` 完整迁移并 seed 后，160g 冰白纸有 2 条身份、红卡有 3 条身份；工作台冰白纸用例再次失败。日常库之前执行过维护脚本，CI 空库没有，不能靠放宽身份唯一性断言解决。
- `test:e2e:prepare` 先通过隔离检查，再复用既有维护服务检查库存、8 个外键消费方、33 个 JSON 快照列与标准身份，事务内清理三条未用旧导入并记录完整审计；随后沿用原测试工价发布。重复执行不重复删除。已使用/改变的导入或不安全数据库目标仍失败；不改历史迁移、不自动修复正式库。
- 考勤原生月份/员工控件及其 flex 子项限制在可用宽度内；设置 fieldset 允许收缩，通知目标长标识可换行，不用隐藏溢出掩盖控件。
- 师傅端与管理端一样轮询当前文档中的运行/待启动动画，保留连续绘制及零活动动画要求，避免持有被流式更新替换的动画完成 Promise；使用现有断言时限并输出未完成目标，不延长总超时、不吞掉动画未完成。

## 独立候选验证

候选是起点 HEAD 加仅本任务补丁的 `git archive` 副本，路径 `/tmp/erp-pr16-continue-20260911/snapshot`。所有数据库写入只在专用测试库中；未提交真实客户工单。本次生产构建仍使用通知/CDR mock 和 inline jobs，不代表部署或真实外部服务验收。

| 检查 | 结果与证据 |
|---|---|
| 新库原问题复现 + 布局专项 | 冰白纸同样失败；修复后的考勤/设置六视口、明暗、overflow/touch/axe 共 6 项通过。`fresh-before.log` |
| 目录准备与幂等 | 首次修复三条、再次零删除，引用与快照检查保留。`catalog-prepare.log`、`catalog-prepare-repeat.log` |
| 全量 Vitest + 覆盖率 | 587 文件，6240 通过、43 既有 legacy bill 跳过；语句 85.39%、分支 79.39%、函数 91.81%、行 87.21%，门禁通过。`unit.log` |
| lint / typecheck / architecture | 通过；lint 0 错误、2 条既有 Next 导航警告；架构 841 模块、3231 内部依赖、26 项既有长函数债务。对应日志在证据目录 |
| 当前生产构建的工作台、师傅端和布局回归 | 28/28 通过、零跳过：工作台 10、师傅端六视口明暗 12、考勤/设置六视口明暗 6。冰白纸待管理员核价及切换红卡恢复报价通过；所有目录选项遍历通过。`release-targets.log` |

所有本次日志位于 `/tmp/erp-pr16-continue-20260911/`。首次尝试复用早先独立 E2E 库时，正式测试工价前置失败，未将其记作测试通过；随后新建上述隔离库、完整迁移/seed、按正式测试服务准备后重跑。

主要命令：`pnpm exec vitest run --coverage --maxWorkers=2`、`pnpm lint`、`pnpm typecheck`、`pnpm check:architecture`、`pnpm test:e2e:prepare`（两次）及 `pnpm exec playwright test --config=playwright.release.config.ts tests/e2e/workbench.spec.ts tests/visual/admin-responsive.spec.ts tests/visual/worker-responsive.spec.ts --grep 'sales workbench|workbench|partial foil|paper price|ice-white|attendance filters and settings|worker routes pass'`。测试环境变量由仓库外私有文件提供，未写入代码或报告。

## 尚未完成

`1f95fe5` 自托管字体的既有验证记录见 [跨设备打印与可用性](../跨设备打印与可用性.md)。13 组新字体像素差异仍待视觉确认，未更新旧基线。本次新增修复不改变打印布局/字体或像素阈值；远端完整 Quality 须对最终推送 SHA 复验，未据局部通过合并或宣称生产可用。
