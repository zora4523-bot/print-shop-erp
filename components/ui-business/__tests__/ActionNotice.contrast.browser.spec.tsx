import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import '@/app/globals.css';
import { ActionNotice } from '@/components/ui-business';

// primary tone（待工厂核价，ui-规范 §4.3）：标题 / 说明文字对 AA 4.5:1，
// 图标（非文本）对 3:1，明暗两套主题都要满足。

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

const over = ([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba =>
  [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];

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

it.each([
  ['light', false],
  ['dark', true],
] as const)('%s：primary 提示的文字 ≥ 4.5:1、图标 ≥ 3:1', async (_mode, dark) => {
  document.documentElement.classList.toggle('dark', dark);
  flushSync(() =>
    root.render(
      <ActionNotice tone="primary" title="待工厂核价" description="工厂核价后显示确认金额。" />,
    ),
  );
  await Promise.all(document.getAnimations().map((animation) => animation.finished));

  const page = parseColor(getComputedStyle(host).backgroundColor);
  const notice = host.querySelector<HTMLElement>('[data-slot="action-notice"]')!;
  expect(notice.getAttribute('role')).toBe('status');
  const surface = over(parseColor(getComputedStyle(notice).backgroundColor), page);

  for (const slot of ['action-notice-title', 'action-notice-description']) {
    const text = host.querySelector(`[data-slot="${slot}"]`)!;
    const color = over(parseColor(getComputedStyle(text).color), surface);
    expect(contrast(color, surface), slot).toBeGreaterThanOrEqual(4.5);
  }

  const icon = notice.querySelector('svg')!;
  const iconColor = over(parseColor(getComputedStyle(icon).color), surface);
  expect(contrast(iconColor, surface)).toBeGreaterThanOrEqual(3);
});
