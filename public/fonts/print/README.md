# 打印字体资产

- Noto Sans SC variable：上游 `notofonts/noto-cjk` 的 `Sans2.004`，文件 `Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf`。
- Noto Sans Mono variable：上游 `google/fonts` commit `a23c2cd328ea51097b6e32d8f9e0241261e2495e` 的 `ofl/notosansmono/NotoSansMono[wdth,wght].ttf`，2026-09-11 获取；原始 SHA-256 见 manifest。
- 来源：https://github.com/notofonts/noto-cjk 和 https://github.com/google/fonts/tree/main/ofl/notosansmono。
- 保留各自 SIL OFL 1.1 许可。使用 fontTools 4.60.2 将原 TTF 无删字压缩成 WOFF2，保留原字体命名与字形；不是按现有订单裁剪字符。
- `manifest.json` 固定原文件与发布文件摘要、cmap 字符数量；单测验证发布文件未漂移。正常构建、部署和访问均不下载外部字体。
- 主字体包含简体中文及拉丁字符，等宽字体用于工单编号；不承诺覆盖所有 Unicode、emoji 或特殊生僻字。新增语种/字形须验收并同步字体资产、摘要及打印基线。
