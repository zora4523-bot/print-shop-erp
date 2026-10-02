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

it('flags badge glyphs outside the pill even inside a horizontal table scroller', () => {
  mount('<div style="width:30px;overflow-x:auto"><span data-slot="badge" style="display:inline-flex;width:32px;height:24px;font-size:12px;line-height:16px;align-items:center">已确认·待收</span></div>');
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('badge-text-overflow'))).toHaveLength(1);
});

it('accepts a complete badge that scrolls with its table', () => {
  mount('<div style="width:30px;overflow-x:auto"><span data-slot="badge" style="display:inline-flex;white-space:nowrap;height:24px;font-size:12px;line-height:16px;align-items:center">已确认·待收</span></div>');
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('badge-text-overflow'))).toEqual([]);
});

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

const breadcrumbItemStyle = 'display:inline-flex;align-items:center;min-width:0';
const breadcrumbTextStyle = 'display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

function mountBreadcrumb(items: string) {
  mount(`<nav aria-label="面包屑导航">
    <ol data-slot="breadcrumb-list" style="display:flex;align-items:center;gap:8px;list-style:none;margin:0;padding:0;font-size:14px;line-height:20px">
      ${items}
    </ol>
  </nav>`);
}

function textCenter(selector: string): number {
  const range = document.createRange();
  range.selectNodeContents(host!.querySelector(selector)!);
  const rect = range.getClientRects()[0];
  return rect.top + rect.height / 2;
}

it('flags the 12px text offset inside a 44px block breadcrumb link', () => {
  mountBreadcrumb(`
    <li data-slot="breadcrumb-item" style="${breadcrumbItemStyle}">
      <a href="/orders" style="${breadcrumbTextStyle};min-height:44px">工单列表</a>
    </li>
    <li data-slot="breadcrumb-item" style="${breadcrumbItemStyle}">
      <span data-slot="breadcrumb-page" style="display:block">新建工单</span>
    </li>
  `);
  expect(textCenter('[data-slot="breadcrumb-page"]') - textCenter('a')).toBeCloseTo(12, 1);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('breadcrumb-misaligned'))).toHaveLength(1);
});

it('accepts centered breadcrumb links with truncated inner text and a plain ancestor', () => {
  mountBreadcrumb(`
    <li data-slot="breadcrumb-item" style="${breadcrumbItemStyle}"><span>管理</span></li>
    <li data-slot="breadcrumb-separator" aria-hidden="true"><span style="position:relative;top:8px">›</span></li>
    <li data-slot="breadcrumb-item" style="${breadcrumbItemStyle};max-width:80px">
      <a href="/orders" style="display:inline-flex;align-items:center;min-height:44px;min-width:0">
        <span style="${breadcrumbTextStyle};min-width:0" title="很长的工单列表名称需要省略">很长的工单列表名称需要省略</span>
      </a>
    </li>
    <li data-slot="breadcrumb-item" style="${breadcrumbItemStyle}">
      <span data-slot="breadcrumb-page" style="display:block">新建工单</span>
    </li>
  `);
  const label = host!.querySelector<HTMLElement>('a span')!;
  expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
  expect(textCenter('[data-slot="breadcrumb-page"]') - textCenter('a span')).toBeCloseTo(0, 1);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('breadcrumb-misaligned'))).toEqual([]);
});

it('flags a misaligned visible layout-only ancestor without requiring a link', () => {
  mountBreadcrumb(`
    <li data-slot="breadcrumb-item" style="${breadcrumbItemStyle}">
      <span style="display:block;min-height:44px">规则配置中心</span>
    </li>
    <li data-slot="breadcrumb-item" style="${breadcrumbItemStyle}">
      <span data-slot="breadcrumb-page">新建价格</span>
    </li>
  `);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('breadcrumb-misaligned'))).toHaveLength(1);
});

it('ignores hidden ancestors and screen-reader-only text when aligning visible breadcrumbs', () => {
  mountBreadcrumb(`
    <li data-slot="breadcrumb-item" style="display:none"><a href="/owner" style="display:block;min-height:44px">后台管理</a></li>
    <li data-slot="breadcrumb-item" style="${breadcrumbItemStyle}">
      <a href="/orders" style="display:inline-flex;align-items:center;min-height:44px">
        <span class="sr-only" style="position:absolute;top:0;left:0">返回上级</span>
        <span style="visibility:hidden;position:absolute;top:0">隐藏说明</span>
        <span>工单列表</span>
      </a>
    </li>
    <li data-slot="breadcrumb-item" style="${breadcrumbItemStyle}"><span data-slot="breadcrumb-page">新建工单</span></li>
  `);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('breadcrumb-misaligned'))).toEqual([]);
});

it.each([[2, 0], [3, 1]])('allows at most 2px between breadcrumb text centers: %ipx', (offset, issueCount) => {
  mountBreadcrumb(`
    <li data-slot="breadcrumb-item" style="${breadcrumbItemStyle}"><span>工单列表</span></li>
    <li data-slot="breadcrumb-item" style="${breadcrumbItemStyle}">
      <span data-slot="breadcrumb-page" style="position:relative;top:${offset}px">新建工单</span>
    </li>
  `);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('breadcrumb-misaligned'))).toHaveLength(issueCount);
});

it('flags cumulative drift across the full breadcrumb even when adjacent offsets are only 2px', () => {
  mountBreadcrumb(`
    <li data-slot="breadcrumb-item" style="${breadcrumbItemStyle}"><span>工单列表</span></li>
    <li data-slot="breadcrumb-item" style="${breadcrumbItemStyle}"><span style="position:relative;top:2px">工单详情</span></li>
    <li data-slot="breadcrumb-item" style="${breadcrumbItemStyle}"><span data-slot="breadcrumb-page" style="position:relative;top:4px">编辑工单</span></li>
  `);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('breadcrumb-misaligned')))
    .toEqual(['breadcrumb-misaligned:工单列表→编辑工单:dy4.0']);
});

// 2026-10-01：看板卡金额在窄卡里被 overflow-wrap:anywhere 折成「¥ / 15,395.2 / 9」。
const narrowCard = 'style="width:40px;font-size:16px;line-height:24px;font-variant-numeric:tabular-nums"';

it('flags a money amount whose digits are split across lines', () => {
  mount(`<div ${narrowCard}><span style="display:block;overflow-wrap:anywhere">¥ 15,395.29</span></div>`);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('number-split'))).toEqual([
    'number-split:span「15,395.29」',
  ]);
});

it('accepts a money amount that only wraps at the space after the currency sign', () => {
  mount(`<div style="width:64px;font-size:16px;line-height:24px"><span style="display:block">¥ 15,395.29</span></div>`);
  // 64px 放不下整串：只在「¥」后换行，数字整体在第二行。
  expect(host!.querySelector('span')!.getBoundingClientRect().height).toBe(48);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('number-split'))).toEqual([]);
});

it('ignores long digit runs that are identifiers or addresses, not quantities', () => {
  mount(`<p style="width:60px;overflow-wrap:anywhere;font-size:16px">A座12345678901234567890</p>
    <p style="width:60px;overflow-wrap:anywhere;font-size:16px">GD-260824-001</p>
    <p style="width:60px;overflow-wrap:anywhere;font-size:16px">13800138000</p>`);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('number-split'))).toEqual([]);
});

it('ignores numbers inside code and configuration blocks', () => {
  mount(`<code style="display:block;width:40px;overflow-wrap:anywhere;white-space:pre-wrap;font-size:16px">port=15432,5000</code>`);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('number-split'))).toEqual([]);
});

it('checks negative amounts and quantities that sit directly against a Chinese unit', () => {
  mount(`<div style="width:40px;font-size:16px;line-height:24px"><span style="display:block;overflow-wrap:anywhere">¥ -1,999.00</span></div>
    <div style="width:40px;font-size:16px;line-height:24px"><span style="display:block;overflow-wrap:anywhere">12,345件</span></div>`);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('number-split'))).toEqual([
    'number-split:span「-1,999.00」',
    'number-split:span「12,345」',
  ]);
});

it('still ignores hyphenated identifiers whose segments wrap', () => {
  mount(`<p style="width:40px;overflow-wrap:anywhere;font-size:16px">GD-260824-001</p>
    <p style="width:40px;overflow-wrap:anywhere;font-size:16px">e2e-sales-16d7ca8d-5532-40d8</p>`);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('number-split'))).toEqual([]);
});


it('flags single-character column headings and currency separated from table amounts', () => {
  mount('<table style="width:40px;table-layout:fixed"><thead><tr><th style="font-size:16px;padding:12px">预计回货</th></tr></thead><tbody><tr><td style="font-size:16px">¥ 123,456.78</td></tr></tbody></table>');
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('table-heading-stacked'))).toHaveLength(1);
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('table-money-split'))).toHaveLength(1);
});

it('allows readable two-line headings and intact amounts inside a local scroller', () => {
  mount('<div style="width:40px;overflow-x:auto"><table style="min-width:140px"><thead><tr><th>预计<br>回货</th></tr></thead><tbody><tr><td style="white-space:nowrap">¥ 123,456.78</td></tr></tbody></table></div>');
  expect(collectGeometryIssues().filter((issue) => issue.startsWith('table-heading-stacked') || issue.startsWith('table-money-split'))).toEqual([]);
});
