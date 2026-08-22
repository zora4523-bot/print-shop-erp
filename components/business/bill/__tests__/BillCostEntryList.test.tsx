import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrderCostCategory } from '@/generated/prisma/enums';
import { BillCostEntryList } from '../BillCostEntryList';

describe('BillCostEntryList', () => {
  it('renders original and rework cost rows with source, creator, time, and included total', () => {
    const html = renderToStaticMarkup(
      <BillCostEntryList
        items={[
          {
            order: {
              id: 'order-1',
              orderNo: '20260802-0001',
              items: [],
              outsourceOrders: [],
              costEntries: [
                {
                  id: 'cost-original',
                  category: OrderCostCategory.MATERIAL,
                  description: '原单纸张',
                  quantity: '2.000',
                  unit: '包',
                  unitPrice: '20.0000',
                  amount: '40.00',
                  remark: null,
                  createdAt: new Date('2026-08-02T04:00:00.000Z'),
                  createdBy: { displayName: '小李' },
                },
              ],
              reworkOrders: [
                {
                  id: 'rework-1',
                  orderNo: 'RW-20260802-0001',
                  items: [{ tasks: [{ pieceworkAmount: '5.00' }] }],
                  outsourceOrders: [],
                  costEntries: [
                    {
                      id: 'cost-rework',
                      category: OrderCostCategory.SHIPPING,
                      description: '重做补发运费',
                      quantity: null,
                      unit: null,
                      unitPrice: null,
                      amount: '7.00',
                      remark: '物流损毁',
                      createdAt: new Date('2026-08-02T05:30:00.000Z'),
                      createdBy: { displayName: '小王' },
                    },
                    {
                      id: 'legacy-piecework',
                      category: OrderCostCategory.PIECEWORK,
                      description: '历史计件记录',
                      quantity: null,
                      unit: null,
                      unitPrice: null,
                      amount: '5.00',
                      remark: null,
                      createdAt: new Date('2026-08-02T06:00:00.000Z'),
                      createdBy: { displayName: '小王' },
                    },
                  ],
                },
              ],
            },
          },
        ]}
      />,
    );

    expect(html).toContain('20260802-0001');
    expect(html).toContain('原单');
    expect(html).toContain('RW-20260802-0001');
    expect(html).toContain('重做单');
    expect(html).toContain('重做补发运费');
    expect(html).toContain('备注：物流损毁');
    expect(html).toContain('录入人：小王');
    expect(html).toContain('已有自动流水，未重复计入合计');
    expect(html).toContain('本区已计入成本合计：');
    expect(html).toContain('¥ 47.00');
  });
});
