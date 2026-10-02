---
status: documentation-review-complete
owner: project-maintainers
reviewed_at: 2026-10-01
baseline: e47f59e8b8abf34d7febe167423af33b72990a88
scope: UI quality rules and agent entrypoints; no runtime UI acceptance
---

# UI / UX Quality Standard 审查与落地

## 结论与范围

用户提出的十项 QA 适合作为质量方向；长期交给 Codex / Claude Code 执行还需要固定规则来源、任务边界、功能不变量、可复验方法、问题分级和停止条件。本次将它们落入唯一规范 [`docs/ui-规范.md` §11](../ui-规范.md#11-ui--ux-quality-standard)，同步代理入口和交付入口，保留现行组件与业务体系。

开始时 HEAD 为上述 baseline，工作树为 detached HEAD，暂存区与未暂存区均为空。本次只改 Markdown：`AGENTS.md`、`CLAUDE.md`、`CONTRIBUTING.md`、`UI-SYSTEM.md`、`HANDOFF.md`、PR 模板、UI 规范、设计覆盖文档及本记录。应用源码、配置、脚本、依赖、测试、数据库和打印基线没有修改，因此功能行为保持原样。

这是**规范审查与文档落地**，不是全站页面实屏验收；没有据此声明存量页面不存在 P0/P1。审查者为本次 Codex 执行代理，未冒充人工用户测试或另一次独立审查。

## 检查依据

- 现行约束：`AGENTS.md`、`CONTRIBUTING.md`、`SPEC-v1.2.md` 的现行补充与相关 `DECISIONS.md` 页面决定。
- 设计规则与采用情况：`docs/ui-规范.md`、`UI-SYSTEM.md`、`docs/UI-DESIGN-COVERAGE.md`、`docs/UI-REMEDIATION-BACKLOG.md`。
- 实际门禁与环境：`scripts/lib/playwright-config.ts`、`tests/visual/ui-gates.ts`、`tests/visual/admin-responsive.spec.ts`、`tests/visual/worker-responsive.spec.ts`、`vitest.browser.config.ts`、`DEVELOPMENT.md`。
- 外部原则：已核对 [Webby 官方评审维度](https://www.webbyawards.com/judging-criteria/)、[Awwwards 官方移动体验指南](https://www.awwwards.com/mobile-excellence-guidelines.pdf) 与 [W3C 文字对比](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)、[非文字对比](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)、[重排](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)。FWA 仅作为创意参考入口，未声称核验了其评审规则。奖项权重和历史 API 清单没有转成 ERP 门禁。

## 发现、修改与复核

以下是规范/覆盖问题，不是已在浏览器复现的页面缺陷；不套用运行时 P0/P1 结论。

| ID | 证据与问题 | 本次修改 | 复核与边界 |
|---|---|---|---|
| Q-01 | `UI-SYSTEM.md` 原「设计证据与优先级」把高保真稿列在全站状态规范前；UI 规范 §1.1 则规定规范优先于原型 | UI-SYSTEM、设计覆盖文档共同引用 §1.1，不另设优先级 | 对照入口，保留 A/B/C 证据深度；不重审或覆盖已确认页面决定 |
| Q-02 | 抽象的「3 秒」「足够可读」「反馈完整」缺统一检查方法；现有条款分散 | §11.1–11.4 增加任务定义、十项有序 QA、定量对比与实际操作方法 | 十项覆盖用户原要求；代理自查、axe、截图和用户测试分别记录，未声称自动化全部完成 |
| Q-03 | `scripts/lib/playwright-config.ts` 管理/师傅项目均只含 375/393/768/1024/1280/1920，缺 320/390/430 | §8 与 §11.3 区分已有六视口和完整九视口；要求新增宽度实际补测留证 | 未改测试配置，自动化缺口仍存在；不能以六视口结果验收九视口 |
| Q-04 | UI-SYSTEM 的交付清单缺统一 P 分级、明显 P2 的放行规则与停止条件；台账使用 S 分级 | §11.5 映射 P0–P3 与 S0–S3，明确零 P0/P1、无明显可用性/一致性/层级问题；§11.6 区分完成、范围决定、阻断、回归与诊断 | 旧迁移编号/历史证据保留；视觉分数和迭代次数不能替代硬门禁 |
| Q-05 | 「功能不变」缺任务前后对照；长期规则可能被解释为授权全站重构 | §11.1–11.2 固定入口、字段、默认值、校验、结果、恢复及业务不变量，限定消费者范围与权限边界 | 本次无运行代码修改；未来视觉任务必须实际做功能回归，不能只依赖截图 |
| Q-06 | Codex、Claude 与 PR 入口没有共同的完整 QA/停止协议 | AGENTS、CLAUDE、CONTRIBUTING、PR 模板与 UI-SYSTEM 统一指向 §11；§11.7 提供证据模板 | 规则可发现且只有一个权威清单；这是执行协议，不是新增自动测试或 CI 作业 |

## 实际验证

候选为 baseline 加本次文档增量；提交 SHA 通过 `git log` 获取，避免文档自引用 SHA。运行环境 Node.js v24.15.0，未启动 Next、浏览器、数据库或外部写入服务，未使用 mock 代替页面验收。

| 实际检查与命令 | 结果 | 证据 |
|---|---|---|
| `node /tmp/erp-ui-quality-standard.om2VT9/check-docs.mjs` | 9 个修改文件均为 Markdown；17 个新增/修改本地链接（含 PR 模板仓库链接）、11 个标题锚点、13 个事实源路径通过；错误 0 | 同目录 `document-check.json`；临时文件用于本次复核，长期结论保存在本表，不保证临时路径保留 |
| 同一文档检查脚本的结构断言 | QA 1–10 顺序完整；9 个目标视口均有定义；§11.1–11.8 完整；旧文档 frontmatter 与 `last_verified` 未被整体刷新 | 实际读取当前文档及 HEAD 版本对照 |
| `git diff --check`、`git diff --cached --check` | 均通过，空白错误 0 | 当前工作区与暂存区文档增量 |
| `git diff --name-only`、`git status --short` 与完整候选 diff 复核 | 仅本次 9 个文档文件，运行文件变化 0；无应用功能/测试/数据库/依赖/基线增量 | 初始工作树干净；提交前后核对实际文件清单 |

未执行、失败或跳过的页面检查未计入上述通过数量。首次临时链接检查遇到 Git 对中文路径的引号编码，检查脚本改用 NUL 分隔路径后按同一链接规则通过；该问题属于验证工具，不是应用回归。

未运行应用单测、lint、typecheck、构建、E2E 与实屏 QA：本次没有应用或测试改动，按 `CONTRIBUTING.md` 文档任务要求只需链接/路径和 diff 检查；本工作树也没有 `node_modules`。本次不涉及 Next API/路由/构建行为，不需要在缺安装依赖时以外部文档代替版本核验。

## 剩余覆盖与后续执行

- 320/390/430 自动项目尚未建立；后续 UI 任务执行者须按 §11.3 补浏览器实测。维护责任为该 UI 任务执行者/复核人，是否扩充自动配置另设测试任务，不在本次文档任务暗改 CI。
- 存量页面仍需按路由、角色、状态分批实屏 QA，现有覆盖表与历史测试不等于本次验收。3 秒层级、完整键盘流程、布局跳动与失败恢复均须实际留证；负责人为对应页面任务执行者。
- 本次规范审查及文档校验完成即可停止；功能等价以没有运行文件增量确认。页面 QA 未执行，状态保持「未验收」，不以这次规则落地宣称全站合格。
- 自动创建本地提交遵循项目技能；不 push、发布或更新像素基线。无遗留应用改动需要部署。
