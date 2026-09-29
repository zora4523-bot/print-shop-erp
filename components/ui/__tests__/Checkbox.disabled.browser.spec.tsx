import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import '@/app/globals.css';
import { Checkbox } from '@/components/ui/checkbox';

// WCAG 1.4.11 非文本对比：禁用勾选框的边框（未选）/ 实底（已选）必须能从周围背景
// 中辨认出来。旧实现整体 opacity-50，暗色下 `--input`（15% 白）减半后与页面底色
// 几乎同色（审查：暗色禁用指示框不可见）。

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('main');
  host.className = 'bg-background p-4 text-foreground';
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
});

type Rgba = [number, number, number, number];

/** 用 canvas 把任意 CSS 颜色（含 oklch / 透明度）解析成 sRGB 0–255 + alpha 0–1。 */
function parseColor(color: string): Rgba {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!, a! / 255];
}

function over([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** 祖先链上的 opacity 连乘（元素自身包含在内）。 */
function effectiveOpacity(element: Element): number {
  let opacity = 1;
  for (let node: Element | null = element; node; node = node.parentElement) {
    opacity *= Number(getComputedStyle(node).opacity);
  }
  return opacity;
}

function indicator(label: string): HTMLElement {
  return host.querySelector(`[aria-label="${label}"] [data-slot="checkbox-indicator"]`)!;
}

it.each([
  ['light', false],
  ['dark', true],
] as const)('%s：禁用勾选框的边框与已选实底对背景对比 ≥ 3:1', async (_mode, dark) => {
  document.documentElement.classList.toggle('dark', dark);
  flushSync(() =>
    root.render(
      <>
        <Checkbox aria-label="禁用未选" disabled />
        <Checkbox aria-label="禁用已选" disabled defaultChecked />
        <Checkbox aria-label="可用未选" />
      </>,
    ),
  );
  // 等主题切换的颜色过渡结束，读到的是终值。
  await Promise.all(document.getAnimations().map((animation) => animation.finished));

  const background = parseColor(getComputedStyle(host).backgroundColor);
  expect(background[3]).toBe(1);

  const unchecked = indicator('禁用未选');
  const uncheckedStyle = getComputedStyle(unchecked);
  const opacity = effectiveOpacity(unchecked);
  const border = over(parseColor(uncheckedStyle.borderTopColor), background);
  const borderOnSurface = over([...border.slice(0, 3), opacity] as Rgba, background);
  expect(contrast(borderOnSurface, background)).toBeGreaterThanOrEqual(3);
  // 与可用态可区分：虚线（只读/不可编辑同一语言）。
  expect(uncheckedStyle.borderTopStyle).toBe('dashed');
  expect(getComputedStyle(indicator('可用未选')).borderTopStyle).toBe('solid');

  const checked = indicator('禁用已选');
  const fill = over(parseColor(getComputedStyle(checked).backgroundColor), background);
  const fillOnSurface = over([...fill.slice(0, 3), effectiveOpacity(checked)] as Rgba, background);
  expect(contrast(fillOnSurface, background)).toBeGreaterThanOrEqual(3);
});
