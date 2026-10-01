import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import '@/app/globals.css';
import { StatusBadge } from '../StatusBadge';
import { TableScrollArea } from '../TableScrollArea';
import { collectGeometryIssues } from '@/tests/visual/ui-gates-geometry';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('main');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

it('keeps short status text and its dot intact in a constrained table and flex row', () => {
  flushSync(() => root.render(<>
    <div style={{ width: 100, overflowX: 'auto' }}>
      <table style={{ width: '100%' }}><tbody><tr>
        <td style={{ padding: 16 }}><StatusBadge tone="warning" dot>已确认·待收</StatusBadge></td>
        <td style={{ whiteSpace: 'nowrap' }}>¥ 123,456.78</td>
      </tr></tbody></table>
    </div>
    <div style={{ display: 'flex', width: 40, overflowX: 'auto' }}>
      <StatusBadge tone="info" dot>待工厂处理</StatusBadge>
    </div>
  </>));
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('badge-text-overflow'))).toEqual([]);
  for (const badge of host.querySelectorAll('[data-slot="badge"]')) {
    const range = document.createRange();
    range.selectNodeContents(badge.lastChild!);
    const rects = [...range.getClientRects()].filter((r) => r.width && r.height);
    expect(new Set(rects.map((r) => Math.round(r.top))).size).toBe(1);
    const dot = badge.querySelector('[aria-hidden]')!.getBoundingClientRect();
    expect(dot.width).toBeCloseTo(dot.height, 1);
  }
});


it('keeps column headings readable and the narrow table keyboard-scrollable', () => {
  flushSync(() => root.render(<div style={{ width: 120 }}>
    <TableScrollArea label="外协单测试">
      <table className="w-full"><thead><tr>
        <th className="p-3">工艺</th><th className="p-3">预计回货</th><th className="p-3">状态</th>
      </tr></thead><tbody><tr>
        <td>烫金</td><td>2026/10/02</td><td><StatusBadge tone="info" dot>已发出</StatusBadge></td>
      </tr></tbody></table>
    </TableScrollArea>
  </div>));
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('table-heading-stacked') || issue.startsWith('badge-text-overflow'))).toEqual([]);
  const region = host.querySelector<HTMLElement>('[role="region"]')!;
  expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
  region.focus();
  expect(document.activeElement).toBe(region);
});
