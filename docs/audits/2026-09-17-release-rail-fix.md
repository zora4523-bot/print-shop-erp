# 生产发布前：建单费用栏超高修复

候选基线 `ac63cddc`，工作区原本干净；本次仅修改费用栏自适应、对应浏览器测试和文档。

## 原因与修复

PR #21 的 GitHub run `35080892903`：221 个发布浏览器用例通过，3 个管理端 1280×800 用例失败。共同错误为固定费用栏底部达到 820px，超过 800px 视口。费用栏新增收费入口和缺项后高度变长，原样固定无法完整展示。

现在按实际可用高度决定 sticky；放不下则随文档滚动，保留全部收费和提交入口，不压缩触控尺寸、不隐藏内容。补充长栏底部按钮可点击、内容变短后恢复 sticky 的浏览器回归；布局断言按可用空间检查预期定位，原 overflow/clipping/axe 门禁不变。

## 验证

- 浏览器组件 `OrderFormBNavigation.browser.spec.tsx`：70 项通过（包含新增回归）。
- release build/start，隔离库 `erp_e2e_foil_20260917`：管理端建单、详情及编辑六视口明暗主题 6 项通过；1280×800 聚焦复验通过。
- 生产构建（含 TypeScript）通过；lint 通过，保留两条既存内部导航警告。
- 本地证据目录 `/tmp/erp-production-20260917/`：`rail-browser.log`、`pr-six-rail-visual.log`、`pr-rail-visual.log`、`pr-lint.log`。
- 此记录只说明界面修复已验证，不表示生产已切换；生产部署另记实际版本、迁移、备份和 smoke。
