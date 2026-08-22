import { describe, expect, it } from 'vitest';
import { buildQrSvg } from '../qr';

// 把二维码的可扫描性钉住。这两条以前只是"看起来能扫"，域名一变就悄悄退化：
// 渲染宽度写死时，URL 越长 → QR 版本越高 → 模块越多 → 每个模块越小。
//
// 判据：
//   - 静区 ≥ 4 个模块（QR 标准硬要求，之前是 1）
//   - 每模块 ≥ 0.5mm（≈1.89px @96dpi），低于此值手机扫码开始不稳

const MM_PER_PX = 25.4 / 96;

function readViewBoxModules(svg: string): number {
  const m = svg.match(/viewBox="0 0 (\d+) \d+"/);
  if (!m) throw new Error('QR SVG 缺少 viewBox');
  return Number(m[1]);
}

function readWidthPx(svg: string): number {
  const m = svg.match(/width="(\d+)"/);
  if (!m) throw new Error('QR SVG 缺少 width');
  return Number(m[1]);
}

describe('buildQrSvg', () => {
  const shortUrl = 'http://localhost:3000/orders/cm5abcdefgh';
  // 真实生产域名会比 localhost 长不少，这是最容易踩的退化场景
  const longUrl =
    'https://erp.changkun-printing.example.com.cn/worker/tasks/cm5abcdefghijklmnopqrstuvw';

  it('静区是 4 个模块（QR 标准要求）', () => {
    // viewBox 的模块数 = 数据区 + 两侧静区。margin=4 → 比数据区多 8。
    return Promise.all([
      buildQrSvg(shortUrl, 95),
      buildQrSvg(longUrl, 55),
    ]).then(([shortSvg, longSvg]) => {
      for (const svg of [shortSvg, longSvg]) {
        const total = readViewBoxModules(svg);
        // 最小 QR（版本1）数据区 21 模块；加 8 静区 = 29
        expect(total).toBeGreaterThanOrEqual(29);
      }
    });
  });

  it('长 URL 不会把模块压到扫不动——每模块 ≥ 0.5mm', async () => {
    for (const url of [shortUrl, longUrl]) {
      const svg = await buildQrSvg(url, 55);
      const modules = readViewBoxModules(svg);
      const widthPx = readWidthPx(svg);
      const modulePx = widthPx / modules;
      const moduleMm = modulePx * MM_PER_PX;
      expect(
        moduleMm,
        `URL 长度 ${url.length} 时模块尺寸 ${moduleMm.toFixed(3)}mm 低于 0.5mm 下限`,
      ).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('内容越长渲染越大，不是把模块越挤越小', async () => {
    const shortSvg = await buildQrSvg(shortUrl, 55);
    const longSvg = await buildQrSvg(longUrl, 55);
    expect(readWidthPx(longSvg)).toBeGreaterThan(readWidthPx(shortSvg));
  });

  it('minSize 仍是下限，短内容不会缩得比调用方要求的还小', async () => {
    const svg = await buildQrSvg(shortUrl, 200);
    expect(readWidthPx(svg)).toBeGreaterThanOrEqual(200);
  });
});
