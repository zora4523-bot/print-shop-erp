# 打印字体基线验收

## 范围与确认

上一轮已向用户提供 13 组“原基线 / 项目内字体 / 差异”对照。用户随后再次指示“提交代码到仓库并且合并到主分支”。本次据此采用已展示的打印效果，仅替换对应的 13 张 Darwin 基线；不混入工作区另行进行的打印布局或访问逻辑修改，不改变断言、分页算法或截图阈值。

应用代码起点：`fb8497652392a0de18112b0740c2eae2971b9525`，字体来自 `1f95fe5`。对照保存在 `/tmp/erp-pr16-20260911/print-review/new-font/`。

## 来源与核对

- CI run `34571002578`、print-darwin job `103172885391`、artifact `10187863836`。该组 8 通过、13 个截图差异；失败日志没有分页、内容、PDF 页数或浏览器错误断言失败。
- 运行环境：`macos-26-arm64` 镜像 `20260907.0351.1`，Playwright Chromium / Headless Shell `147.0.7727.15`（build 1217）。项目字体文件与许可保持原提交。
- 从 artifact 提取的 13 张 actual 图片，与已展示的本地生产构建 actual 图片逐字节一致。只复制这 13 张图片到已有 `order-print.spec.ts-snapshots` 路径，旧图由 Git 历史保留。
- 覆盖 1/2/3/5/8/10 张图稿、完整上下文、2/4 款完整工单、1/6/12 条工序及三款多地址工单。完整页内容、二维码、页脚与物理 PDF 页数继续由现有测试验证。

## 验证

在 `git archive fb84976` 加仅本任务图片/文档的独立副本执行生产构建打印门禁，使用专用测试库 `erp_e2e_pr16_20260911`。实际命令为 `pnpm exec playwright test --config=playwright.release.config.ts tests/visual/order-print.spec.ts --project=chromium --update-snapshots=none`，21/21 通过、零跳过；包含 13 张像素基线、长文本/多地址续页、二维码与 PDF 页数断言。日志：`/tmp/erp-pr16-merge-20260911/print-validation.log`。未使用开发工作区的未提交打印实现来验证这些基线。

此记录只接受已展示字体效果，不代表真实打印机、真实设备、生产部署或未展示的新布局通过验收。最终 PR 仍须核对远端完整 Quality 结果。
