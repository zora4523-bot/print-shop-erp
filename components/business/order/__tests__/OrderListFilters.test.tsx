import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  MachineType,
  OrderKind,
  OrderStatus,
  OutsourceStatus,
  ShipmentStatus,
  TaskStatus,
} from '@/generated/prisma/enums';
import type {
  OrderListFilterOptions,
  OrderListQuery,
} from '@/lib/order/list-query';
import { decodeFoilColorFilterValues } from '@/lib/order/foil-color-filter-codec';
import { Button } from '@/components/ui/button';
import { OrderListFilters } from '../OrderListFilters';

const options: OrderListFilterOptions = {
  submitters: [{ id: 'sales-1', label: '销售小王' }],
  workers: [{ id: 'worker-1', label: '张师傅' }],
  crafts: [
    { id: 'craft-foil', label: '烫金' },
    { id: 'craft-cut', label: '模切' },
  ],
};

const fullQuery: OrderListQuery = {
  filters: {
    q: '苹果福',
    orderNo: 'GD-260807',
    customName: '中秋红包',
    customerRef: '客户甲',
    receiverName: '张三',
    receiverPhone: '13800000000',
    receiverAddress: '佛山市',
    submitterId: 'sales-1',
    workerId: 'worker-1',
    statuses: [OrderStatus.SUBMITTED, OrderStatus.IN_PRODUCTION],
    kinds: [OrderKind.REWORK],
    isUrgent: true,
    isSfCollect: false,
    addressMode: 'multiple',
    amountMin: '10.00',
    amountMax: '5000.00',
    createdFrom: '2026-08-01',
    createdTo: '2026-08-07',
    promisedFrom: '2026-08-08',
    promisedTo: '2026-08-10',
    trackingNo: 'SF123',
    expressCode: '菜鸟',
    shipmentStatuses: [ShipmentStatus.PLANNED],
    itemName: '款式 A',
    productName: '万元封',
    specification: '大号',
    paperType: '艳红珠光纸',
    quantityMin: 100,
    quantityMax: 5000,
    craftIds: ['craft-foil', 'retired-craft'],
    foilColors: ['哑金', '银色'],
    taskStatuses: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
    machineTypes: [MachineType.HAND_PRESS, MachineType.WINDMILL],
    requiresOutsource: true,
    outsourceStatuses: [OutsourceStatus.SENT, OutsourceStatus.IN_PROGRESS],
    supplierName: '外协厂甲',
  },
  page: 7,
  pageSize: 50,
  sort: 'totalAmount',
  dir: 'asc',
};

describe('OrderListFilters', () => {
  it('keeps the filter controls collapsed by default', () => {
    const html = renderToStaticMarkup(
      <OrderListFilters
        query={emptyQuery()}
        options={{ submitters: [], workers: [], crafts: [] }}
        issues={[]}
        total={30}
      />,
    );

    expect(filterPanelTag(html)).not.toContain('open=""');
    expect(html.indexOf('id="order-list-filter-controls"')).toBeLessThan(
      html.indexOf('<form'),
    );
    expect(html).not.toContain('需要修正');
    expect(html).not.toContain('项已启用');
  });

  it('places the optional export entry in the filter header outside the GET form', () => {
    const html = renderToStaticMarkup(
      <OrderListFilters
        query={emptyQuery()}
        options={{ submitters: [], workers: [], crafts: [] }}
        issues={[]}
        total={30}
        exportControls={<Button type="button">导出工单</Button>}
      />,
    );

    const exportIndex = html.indexOf('>导出工单</button>');
    const filterFormIndex = html.indexOf('<form');
    expect(exportIndex).toBeGreaterThan(-1);
    expect(exportIndex).toBeLessThan(filterFormIndex);
    expect(html.slice(filterFormIndex, html.indexOf('</form>'))).not.toContain(
      '导出工单',
    );
  });

  it('renders every normalized business filter and clears the old page on GET submit', () => {
    const html = renderToStaticMarkup(
      <OrderListFilters
        query={fullQuery}
        options={options}
        issues={[]}
        total={123}
      />,
    );

    const form = html.match(/<form\b[^>]*>/)?.[0];
    expect(form).toBeDefined();
    expect(form).toContain('action="/orders"');
    expect(form).toContain('method="get"');
    expect(html).toContain('共找到 <span');
    expect(html).toContain('>123</span> 条工单');
    expect(html).toContain('筛选条件');
    expect(filterPanelTag(html)).not.toContain('open=""');
    expect(html).toContain('项已启用');

    const expectedNames = [
      'q',
      'orderNo',
      'customName',
      'customerRef',
      'receiverName',
      'receiverPhone',
      'receiverAddress',
      'submitterId',
      'workerId',
      'status',
      'kind',
      'isUrgent',
      'isSfCollect',
      'addressMode',
      'amountMin',
      'amountMax',
      'createdFrom',
      'createdTo',
      'promisedFrom',
      'promisedTo',
      'trackingNo',
      'expressCode',
      'shipmentStatus',
      'itemName',
      'productName',
      'specification',
      'paperType',
      'quantityMin',
      'quantityMax',
      'craftId',
      'foilColor',
      'taskStatus',
      'machineType',
      'requiresOutsource',
      'outsourceStatus',
      'supplierName',
    ];
    for (const name of expectedNames) {
      expect(html, `missing filter control ${name}`).toContain(`name="${name}"`);
    }

    expect(html).toContain('name="pageSize" value="50"');
    expect(html).toContain('name="sort" value="totalAmount"');
    expect(html).toContain('name="dir" value="asc"');
    expect(html).not.toMatch(/name="page"(?:\s|>)/);
    const retiredCraft = html
      .match(/<input\b[^>]*>/g)
      ?.find((input) => input.includes('id="order-filter-craftId-retired-craft"'));
    expect(retiredCraft).toContain('value="retired-craft"');
    expect(retiredCraft).toContain('checked=""');
    expect(html).toContain('工艺（retired-craft）');
  });

  it('shows issues and only renders submitter/worker controls when options exist', () => {
    const query = emptyQuery();
    const html = renderToStaticMarkup(
      <OrderListFilters
        query={query}
        options={{ submitters: [], workers: [], crafts: [] }}
        issues={['创建开始日期不合法']}
        total={0}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toMatch(
      /role="alert"[^>]*class="[^"]*admin-wrap-anywhere[^"]*"/,
    );
    expect(html).toContain('创建开始日期不合法');
    expect(html).not.toContain('name="submitterId"');
    expect(html).not.toContain('name="workerId"');
    expect(html).toContain('name="craftId" value=""');
    expect(filterPanelTag(html)).toContain('open=""');
    expect(html).toContain('需要修正');
    expect(html).not.toContain('清除全部筛选');
  });

  it('removes amount controls, chips, and amount sort state from the WORKER view', () => {
    const html = renderToStaticMarkup(
      <OrderListFilters
        query={fullQuery}
        options={options}
        issues={[]}
        total={12}
        showCommercialAmounts={false}
      />,
    );

    expect(html).not.toContain('name="amountMin"');
    expect(html).not.toContain('name="amountMax"');
    expect(html).not.toContain('最低金额（元）');
    expect(html).not.toContain('最高金额（元）');
    expect(html).not.toContain('金额 ≥');
    expect(html).not.toContain('金额 ≤');
    expect(html).not.toContain('name="sort" value="totalAmount"');
    expect(html).toContain('name="sort" value="createdAt"');
    expect(html).toContain('name="dir" value="desc"');
  });

  it('keeps active chips visible while the main filter panel stays collapsed', () => {
    const html = renderToStaticMarkup(
      <OrderListFilters
        query={fullQuery}
        options={options}
        issues={[]}
        total={12}
      />,
    );

    const chipsIndex = html.indexOf('aria-label="已启用的筛选条件"');
    const panelIndex = html.indexOf('id="order-list-filter-controls"');
    expect(chipsIndex).toBeGreaterThan(-1);
    expect(panelIndex).toBeGreaterThan(chipsIndex);
    expect(filterPanelTag(html)).not.toContain('open=""');
  });

  it('renders independently removable chips while retaining table preferences and other filters', () => {
    const html = renderToStaticMarkup(
      <OrderListFilters
        query={fullQuery}
        options={options}
        issues={[]}
        total={12}
      />,
    );

    expect(html).toContain('aria-label="已启用的筛选条件"');
    expect(html).toContain('aria-label="清除筛选：状态：已提交"');
    expect(html).toContain('aria-label="清除筛选：烫金色：哑金"');

    const statusHref = anchorHref(html, '清除筛选：状态：已提交');
    const statusUrl = new URL(statusHref, 'https://erp.example.test');
    expect(statusUrl.pathname).toBe('/orders');
    expect(statusUrl.searchParams.get('status')).toBe(OrderStatus.IN_PRODUCTION);
    expect(statusUrl.searchParams.get('q')).toBe('苹果福');
    expect(statusUrl.searchParams.get('pageSize')).toBe('50');
    expect(statusUrl.searchParams.get('sort')).toBe('totalAmount');
    expect(statusUrl.searchParams.get('dir')).toBe('asc');
    expect(statusUrl.searchParams.has('page')).toBe(false);

    const clearAllHref = anchorHref(html, '清除全部筛选');
    const clearAllUrl = new URL(clearAllHref, 'https://erp.example.test');
    expect([...clearAllUrl.searchParams.entries()]).toEqual([
      ['pageSize', '50'],
      ['sort', 'totalAmount'],
      ['dir', 'asc'],
    ]);
  });

  it('preserves commas and backslashes inside custom foil colors in the form and chip links', () => {
    const customFoilColors = ['红,金渐变', 'PANTONE\\871 C', '哑金'];
    const query: OrderListQuery = {
      ...fullQuery,
      filters: { ...fullQuery.filters, foilColors: customFoilColors },
    };
    const html = renderToStaticMarkup(
      <OrderListFilters
        query={query}
        options={options}
        issues={[]}
        total={12}
      />,
    );

    const foilInput = html
      .match(/<input\b[^>]*>/g)
      ?.find((input) => input.includes('id="order-filter-foil-colors"'));
    expect(foilInput).toContain(
      'value="红\\,金渐变,PANTONE\\\\871 C,哑金"',
    );
    expect(foilInput).toContain('颜色名内的逗号写成 \\,');

    const removePresetHref = anchorHref(html, '清除筛选：烫金色：哑金');
    const remainingRaw = new URL(
      removePresetHref,
      'https://erp.example.test',
    ).searchParams.get('foilColor');
    expect(remainingRaw).toBe('红\\,金渐变,PANTONE\\\\871 C');
    expect(decodeFoilColorFilterValues([remainingRaw!])).toEqual(
      customFoilColors.slice(0, 2),
    );
  });

  it('remounts the uncontrolled form when chip navigation changes filter state', () => {
    const activeForm = findForm(
      OrderListFilters({
        query: fullQuery,
        options,
        issues: [],
        total: 12,
      }),
    );
    const clearedQuery = emptyQuery();
    const clearedForm = findForm(
      OrderListFilters({
        query: clearedQuery,
        options,
        issues: [],
        total: 30,
      }),
    );
    const repeatedClearedForm = findForm(
      OrderListFilters({
        query: clearedQuery,
        options,
        issues: [],
        total: 30,
      }),
    );

    expect(activeForm.key).toBeTypeOf('string');
    expect(activeForm.key).not.toBe(clearedForm.key);
    expect(clearedForm.key).toBe(repeatedClearedForm.key);
  });

  it('associates every visible single-value control with an explicit label', () => {
    const html = renderToStaticMarkup(
      <OrderListFilters
        query={fullQuery}
        options={options}
        issues={[]}
        total={1}
      />,
    );
    const ids = [
      'order-filter-q',
      'order-filter-created-from',
      'order-filter-created-to',
      'order-filter-submitter',
      'order-filter-worker',
      'order-filter-urgent',
      'order-filter-order-no',
      'order-filter-custom-name',
      'order-filter-customer',
      'order-filter-receiver-name',
      'order-filter-receiver-phone',
      'order-filter-receiver-address',
      'order-filter-sf-collect',
      'order-filter-address-mode',
      'order-filter-tracking-no',
      'order-filter-express-code',
      'order-filter-amount-min',
      'order-filter-amount-max',
      'order-filter-promised-from',
      'order-filter-promised-to',
      'order-filter-item-name',
      'order-filter-product-name',
      'order-filter-specification',
      'order-filter-paper-type',
      'order-filter-quantity-min',
      'order-filter-quantity-max',
      'order-filter-foil-colors',
      'order-filter-requires-outsource',
      'order-filter-supplier',
    ];
    for (const id of ids) {
      expect(html, `missing label for ${id}`).toContain(`for="${id}"`);
      expect(html, `missing control ${id}`).toContain(`id="${id}"`);
    }
  });
});

function emptyQuery(): OrderListQuery {
  return {
    filters: {
      statuses: [],
      kinds: [],
      shipmentStatuses: [],
      craftIds: [],
      foilColors: [],
      taskStatuses: [],
      machineTypes: [],
      outsourceStatuses: [],
    },
    page: 1,
    pageSize: 20,
    sort: 'createdAt',
    dir: 'desc',
  };
}

function anchorHref(html: string, ariaLabel: string): string {
  const anchor = html
    .match(/<a\b[^>]*>/g)
    ?.find((candidate) => candidate.includes(`aria-label="${ariaLabel}"`));
  const href = anchor?.match(/href="([^"]+)"/)?.[1];
  if (!href) throw new Error(`找不到链接：${ariaLabel}`);
  return href.replaceAll('&amp;', '&');
}

function filterPanelTag(html: string): string {
  const tag = html
    .match(/<details\b[^>]*>/g)
    ?.find((candidate) => candidate.includes('id="order-list-filter-controls"'));
  if (!tag) throw new Error('找不到工单筛选面板');
  return tag;
}

function findForm(node: ReactNode): ReactElement {
  if (!isValidElement(node)) throw new Error('找不到工单筛选表单');
  if (node.type === 'form') return node;

  const children = (node.props as { children?: ReactNode }).children;
  for (const child of Children.toArray(children)) {
    try {
      return findForm(child);
    } catch {
      // Continue through sibling branches until the form is found.
    }
  }
  throw new Error('找不到工单筛选表单');
}
