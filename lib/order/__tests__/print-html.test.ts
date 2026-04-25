import { describe, it, expect } from 'vitest';
import { buildPrintHtml } from '../print-html';
import type { PrintOrder } from '../../../components/business/order/OrderPrintLayout.types';

function fixtureOrder(overrides: Partial<PrintOrder> = {}): PrintOrder {
  return {
    id: 'order_abc',
    orderNo: '20260423-0001',
    isUrgent: false,
    customerRef: '苹果福',
    receiverName: '张三',
    receiverPhone: '13800000000',
    receiverAddress: '佛山市南海区某街道 1 号',
    expressCode: null,
    packageRequirement: null,
    remark: null,
    submittedAt: new Date('2026-04-23T02:00:00Z'),
    createdAt: new Date('2026-04-23T02:00:00Z'),
    submitterDisplayName: '小王',
    submitterRoleLabel: '销售',
    items: [
      {
        id: 'item_1',
        sequence: 1,
        name: '红包款式 A',
        specification: '9cm × 17cm',
        paperType: '珠光纸',
        quantity: 5000,
        foilColor: null,
        isDoubleSided: true,
        isDoubleColor: false,
        craftNames: ['烫金', '压纹'],
        remark: null,
        designs: [],
        tasks: [],
      },
    ],
    ...overrides,
  };
}

describe('buildPrintHtml', () => {
  it('wraps the layout in a complete html document with charset + title', async () => {
    const html = await buildPrintHtml(fixtureOrder());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toMatch(/<html lang="zh-CN">/);
    expect(html).toMatch(/<meta charset="utf-8"/);
    expect(html).toContain('<title>工单 20260423-0001</title>');
    expect(html).toMatch(/<\/html>\s*$/);
  });

  it('renders the order number + submitter in the body', async () => {
    const html = await buildPrintHtml(fixtureOrder());
    expect(html).toContain('20260423-0001');
    expect(html).toContain('小王');
    expect(html).toContain('销售');
  });

  it('shows the urgent banner only when isUrgent is true', async () => {
    // Every order has "急单：否" in the metadata row AND the
    // .urgent-banner CSS rule in the inline <style> block, so the
    // discriminator is the rendered banner div (class + unique copy).
    const calm = await buildPrintHtml(fixtureOrder());
    expect(calm).not.toMatch(/<div class="urgent-banner">/);
    expect(calm).toContain('急单：否');

    const urgent = await buildPrintHtml(fixtureOrder({ isUrgent: true }));
    expect(urgent).toMatch(/<div class="urgent-banner">[^<]*急\s*单[^<]*请优先处理/);
    expect(urgent).toContain('急单：【是】');
  });

  it('escapes HTML-significant characters in the order number in the title', async () => {
    // orderNo is cuid-shaped in practice, but we still harden the
    // title injection path — a future custom orderNo shouldn't be able
    // to slip a </title><script> through the PDF pipeline.
    const html = await buildPrintHtml(fixtureOrder({ orderNo: '<script>x</script>' }));
    expect(html).toContain('<title>工单 &lt;script&gt;x&lt;/script&gt;</title>');
    expect(html).not.toContain('<title>工单 <script>');
  });

  it('renders craft names, not raw IDs', async () => {
    const html = await buildPrintHtml(
      fixtureOrder({
        items: [
          { ...fixtureOrder().items[0]!, craftNames: ['烫金', '起鼓'] },
        ],
      }),
    );
    expect(html).toContain('烫金');
    expect(html).toContain('起鼓');
    expect(html).toMatch(/烫金[^<]*、[^<]*起鼓/);
  });

  it('shows "无设计图" when the item has none', async () => {
    const html = await buildPrintHtml(fixtureOrder());
    expect(html).toContain('（无设计图）');
  });

  it('omits the task table when the item has no tasks', async () => {
    const html = await buildPrintHtml(fixtureOrder());
    expect(html).not.toContain('任务号');
  });

  it('renders the task table once tasks exist', async () => {
    const html = await buildPrintHtml(
      fixtureOrder({
        items: [
          {
            ...fixtureOrder().items[0]!,
            tasks: [
              {
                id: 'task_xyzabc',
                craftName: '烫金',
                workerDisplayName: '李师傅',
              },
            ],
          },
        ],
      }),
    );
    expect(html).toContain('任务号');
    // shortId takes the trailing 6 chars, uppercased.
    expect(html).toContain('XYZABC');
    expect(html).toContain('李师傅');
  });
});
