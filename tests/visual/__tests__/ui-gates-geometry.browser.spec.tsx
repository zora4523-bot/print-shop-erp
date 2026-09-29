import { afterEach, expect, it } from 'vitest';
import { collectGeometryIssues } from '../ui-gates-geometry';

// The geometry gate runs inside Playwright pages; these cases pin its row rule
// against hand-built DOM so a threshold change cannot silently stop catching
// the misalignment it exists for.

let host: HTMLElement | null = null;

afterEach(() => {
  host?.remove();
  host = null;
});

function mount(html: string) {
  host = document.createElement('main');
  host.innerHTML = html;
  document.body.appendChild(host);
}

const control = 'style="height:44px;width:120px;box-sizing:border-box"';

it('flags equal-height controls whose bottoms are offset in one row', () => {
  mount(`<div style="display:flex;align-items:flex-start;gap:8px">
    <input ${control} aria-label="名称" />
    <select style="height:44px;width:120px;box-sizing:border-box;margin-top:8px" aria-label="类型"><option>全部</option></select>
  </div>`);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('row-misaligned'))).toHaveLength(1);
});

it('flags different-height controls whose bottoms differ', () => {
  mount(`<div style="display:flex;align-items:flex-start;gap:8px">
    <input ${control} aria-label="名称" />
    <button style="height:32px;width:80px">搜索</button>
  </div>`);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('row-misaligned'))).toHaveLength(1);
});

it('accepts controls that share a bottom edge', () => {
  mount(`<div style="display:flex;align-items:flex-end;gap:8px">
    <input ${control} aria-label="名称" />
    <select ${control} aria-label="类型"><option>全部</option></select>
    <button style="height:44px;width:80px">搜索</button>
  </div>`);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('row-misaligned'))).toEqual([]);
});
