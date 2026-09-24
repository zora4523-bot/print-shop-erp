# docs/archive — 过程文件归档

> 这里放**已经完成使命、只剩留档价值**的文件：某一次任务的计划（PLAN-*）、执行报告（REPORT-*）、
> 给 Codex 的执行稿（codex-*）、带日期的一次性审查 / 体检 / 验收记录。它们记录的是当时的现状，
> **不再随代码更新**，读的时候按文内日期理解，不要当成当前事实。

## 归档规则（2026-09-14 起）

| 放哪 | 放什么 | 例子 |
|---|---|---|
| 仓库根目录 | 长期有效的规范与状态文档 | `CLAUDE.md`、`AGENTS.md`、`SPEC-v1.2.md`、`ARCHITECTURE.md`、`DATABASE.md`、`API.md`、`DEPLOYMENT.md`、`DEVELOPMENT.md`、`TROUBLESHOOTING.md`、`UI-SYSTEM.md`、`HANDOFF.md`、`PROGRESS.md`、`DECISIONS.md` |
| `docs/` 根 | 仍在维护的规范、手册、runbook、backlog | `ui-规范.md`、`加工费计费规则.md`、`管理后台使用手册.md`、`上线前置操作清单.md`、`AGENT-BACKLOG.md` |
| `docs/audits/` | 按 `YYYY-MM-DD-<主题>.md` 命名的审查记录与证据（既有约定，继续沿用） | `2026-09-10-release-readiness.md`、`evidence/` |
| `docs/archive/` | 任务过程文件：计划、执行稿、任务报告、带日期的一次性体检 / 验收 / 迁移说明 | 本目录 |
| `docs/ux-redesign/` | 交互稿 `.dc.html` 与说明 | 不动 |

判断口诀：**这份文件半年后还会被改吗？** 会 → 留在根或 `docs/`；不会，只是留证 → `docs/archive/`。

- 新建任务过程文件时**直接建在本目录**，不要再放仓库根目录。
- 移动已有文件用 `git mv` 保留历史，并用 `git grep -F <文件名>` 把 `HANDOFF.md` / `PROGRESS.md` /
  `DECISIONS.md` 与相关文档里的路径一并改掉；`docs/audits/evidence/*.json` 是证据，**不改**，
  被证据引用的文件（如 `docs/release-remediation-2026-09-10.md`）留在原地。
- 归档文件之间的相对链接按新位置修正；文内对代码路径、commit 的引用保持原样。

## 2026-09-14 首批归档清单

原仓库根目录：`AUDIT-报告.md`、`AUDIT-修复计划.md`、`PLAN-创建工单.md`、`PLAN-引擎切换.md`、
`PLAN-管理端列表与账单.md`、`REPORT-呈现修复.md`、`REPORT-引擎切换.md`、`REPORT-管理端列表与账单.md`。

原 `docs/`：`codex-prompt-代码质量审查修复-2026-08-23.md`、`codex-prompt-定价表单优化-2026-08-24.md`、
`codex-管理端列表与月度账单任务.md`、`定价表单优化-2026-08-24.md`、`代码质量审查-2026-08-23.md`、
`架构体检报告-2026-07-09.md`、`规范合规审查-2026-08-19.md`、`工作台待下发生产口径-2026-09-07.md`、
`工作台整理验收-2026-09-07.md`、`工作台经营概览迁移-2026-09-07.md`、`architecture-gate-remediation-2026-09-07.md`、
`notification-config-retirement-2026-09-07.md`、`notification-live-test-2026-09-05.md`、
`order-flow-simplification-2026-09-08.md`、`order-pages-audit-2026-09-07.md`、`order-scenario-review-2026-09-08.md`、
`项目结构体检-2026-09-14.md`。

刻意**没有**归档的带日期文件及原因：`docs/release-remediation-2026-09-10.md`（被 `docs/audits/evidence/*.json` 引用）、
`docs/LOAD-TEST-RESULTS-2026-08-25.md`（`LOAD-TEST-PLAN.md` 的配套实测）、`docs/UI-UX-ADVERSARIAL-REVIEW-2026-08-24.md`
与 `docs/codex-ui-brief.md`（被 `ux-redesign/*.dc.html` 交互稿和在用的 UI 覆盖文档引用）、`docs/*-20260913.md`
（前一日的实施说明，仍被 `API.md` / `DATABASE.md` / `DEVELOPMENT.md` / `加工费计费规则.md` 作为现行说明引用）。

## 2026-09-25 第二批归档清单

原 `docs/`（任务已完成、不再随代码更新，且未被 `docs/audits/evidence/*.json` 或现行文档作为现行说明引用）：
`piecework-rate-admin-plan-2026-09-16.md`、`worker-personal-piecework-plan-2026-09-16.md`、
`worker-ux-remediation-2026-09-18.md`、`师傅报工与未结算明细修复-20260917.md`、`生产发布回归修复-20260917.md`、
`管理员收费编辑验收.md`、`ADMIN-FRAMEWORK-PLAN.md`、`SOYBEANADMIN-ADOPTION.md`、`open-source-erp-review.md`。
`DECISIONS.md` 与 `docs/AGENT-BACKLOG.md` 中的路径已同步改为 `docs/archive/…`；`piecework-rate-admin-plan-2026-09-16.md`
的相对链接已按新位置修正。

刻意**没有**归档、改为在文首加“历史记录”提示的文件及原因：

- `docs/PLAN-空白封按单价管理.md`：被 `docs/audits/2026-09-20-blank-price-implementation.md` 以相对链接引用（审查记录不改），
  且 `DECISIONS.md` / `HANDOFF.md` / `PROGRESS.md` 以其 §6 作为空白封历史停售规则的现行说明。
- `docs/寄样与打样开发任务.md`：`API.md` 以它作为寄样 / 打样实现、测试与本地操作的现行说明。
- `docs/UI迁移清单.md`、`docs/UI现状盘点.md`：`docs/ui-规范.md` 的 front matter 与附录把它们作为现行迁移项与违例清单，
  `docs/audits/2026-09-08-UI对照裁决表.md` 也以相对链接引用。
- 上一批已说明的 `docs/release-remediation-2026-09-10.md`、`docs/LOAD-TEST-RESULTS-2026-08-25.md`、
  `docs/UI-UX-ADVERSARIAL-REVIEW-2026-08-24.md`、`docs/*-20260913.md`（5 份）继续留在原地，同样加了提示行。
