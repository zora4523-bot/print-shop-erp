import qrcode from 'qrcode';

// 工单 / 任务二维码的 SVG 预渲染。
//
// 单独成文件（不放 print-view.ts）是因为 print-view 顶层 import 了
// lib/db，会把整个 Prisma 运行时拉进来——纯尺寸逻辑就没法在 node 环境
// 单测了。CLAUDE.md §8.2：逻辑抽纯函数，用 Vitest 测。
//
// 布局侧通过 dangerouslySetInnerHTML 消费这里产出的 SVG 字符串，绕开
// qrcode.react 的 two-Reacts 问题：PDF 路由的 renderToStaticMarkup 会
// 动态 import react-dom/server，它加载的 React 与打包时那份不是同一个，
// hooks 直接炸「Invalid hook call」。
//
// 两个尺寸约束（师傅在车间用手机扫，扫不出这张纸就白印了）：
//   1. 静区（quiet zone）≥ 4 个模块，这是 QR 标准的硬要求。此前是
//      margin: 1，紧贴边框或深色背景时解码器会失败。
//   2. 模块本身不能太小。渲染宽度写死时，URL 越长 → 版本越高 → 模块数
//      越多 → 每个模块越小。此前订单码实测约 0.42mm/模块，换个稍长的
//      正式域名就掉到 0.37mm。所以按「模块数 × 目标模块尺寸」反算宽度。

const QR_QUIET_ZONE_MODULES = 4;

/** 每模块目标物理尺寸（px @96dpi ≈ 0.5mm）；低于此值手机扫码开始不稳。 */
const QR_MODULE_PX = 1.9;

export async function buildQrSvg(
  value: string,
  minSize: number,
): Promise<string> {
  // 先算这段内容需要多少模块，再反推能保住模块尺寸的渲染宽度。
  const modules =
    qrcode.create(value, { errorCorrectionLevel: 'M' }).modules.size +
    QR_QUIET_ZONE_MODULES * 2;
  const width = Math.max(minSize, Math.ceil(modules * QR_MODULE_PX));
  return qrcode.toString(value, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    width,
    margin: QR_QUIET_ZONE_MODULES,
  });
}
