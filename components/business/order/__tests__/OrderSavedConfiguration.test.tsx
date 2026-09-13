import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/oss/read-url', () => ({
  signDesignReadUrl: (url: string) => `signed:${url}`,
}));
vi.mock('../DesignUploadPanel', () => ({
  DesignUploadPanel: ({
    designs,
    canEdit,
  }: {
    designs: Array<{ fileName: string; fileUrl: string }>;
    canEdit: boolean;
  }) => (
    <div data-editable={canEdit}>
      {designs.map((design) => (
        <span key={design.fileName}>
          {design.fileName} {design.fileUrl}
        </span>
      ))}
    </div>
  ),
}));
import {
  OrderSavedConfiguration,
  OrderSavedPackaging,
} from '../OrderSavedConfiguration';

function savedOrder() {
  // A deliberately historical paper/specification and non-default packing
  // composition catch accidental hydration from the current create catalog.
  return {
    id: 'order-1',
    isSfCollect: false,
    settlementType: 'EXTERNAL_SALES',
    processingAmount: '200.25',
    packagingAmount: '10.50',
    quotedFee: '280.75',
    confirmedFee: '300.75',
    settledFee: null,
    items: [
      {
        id: 'item-1',
        sequence: 1,
        name: '原单款式',
        quantity: 2100,
        product: { name: '历史产品组合' },
        pricingRoute: 'STOCK_BLANK',
        productStructure: 'STANDARD_ENVELOPE',
        specification: '历史规格 88×168',
        actualWidthMm: '88',
        actualHeightMm: '168',
        paperType: '历史纸张 157g',
        paperWeightGsm: 157,
        plateGroupId: '版组甲',
        lamination: 'SOFT_TOUCH',
        pack: null,
        artworkVersion: 3,
        pricingGroup: 'MID',
        foilTechnique: 'FLAT',
        frontFoilColors: ['哑金'],
        backFoilColors: ['红金'],
        foilColors: ['哑金', '红金'],
        isDoubleSided: true,
        hasLocalFoil: true,
        printColorsKnown: false,
        printColors: [],
        craftNames: ['局部烫金', '压纹'],
        remark: '保留原稿定位',
        unitPrice: '0.0625',
        fixedFee: '69.00',
        subtotal: '200.25',
        manualQuoteReason: '特殊工艺',
        priceOverrideReason: '客户约定',
        plateDetails: [
          {
            id: 'plate-1',
            name: '正面制版',
            isActive: true,
            specification: '原版尺寸',
            quantity: 1,
            unitPrice: '30',
            amount: '30',
            remark: '使用原版',
          },
        ],
        designs: [
          {
            id: 'image-1',
            fileType: 'IMAGE',
            fileName: '预览.jpg',
            fileUrl: 'image-object',
            fileSize: 100,
          },
          {
            id: 'cdr-1',
            fileType: 'CDR',
            fileName: '原稿.cdr',
            fileUrl: 'private-cdr-object',
            fileSize: 200,
          },
        ],
      },
    ],
    shipments: [1, 2].map((sequence) => ({
      id: `s${sequence}`,
      sequence,
      receiverName: `收件人${sequence}`,
      destinationProvince: sequence === 1 ? '广东' : '浙江',
      quotedWeightKg: '3.50',
      weightKg: null,
      trackingNo: `物流单号${sequence}`,
      lines: [
        {
          orderItem: { sequence: 1, name: '原单款式' },
          quantity: sequence === 1 ? 1000 : 1100,
        },
      ],
    })),
    packagingGroups: [
      {
        id: 'p1',
        sequence: 1,
        name: '礼盒混装',
        mode: 'MIXED_STYLE',
        actualBagCount: 210,
        unitPrice: '0.05',
        subtotal: '10.50',
        priceOverrideReason: null,
        lines: [{ orderItem: { sequence: 1 }, unitsPerBag: 10 }],
      },
    ],
    customerCharges: [
      {
        id: 'charge-1',
        category: { name: '物流费' },
        shipment: { sequence: 2 },
        description: '浙江寄付',
        amount: '50',
        overrideReason: '已核对重量',
      },
    ],
  } as unknown as ComponentProps<typeof OrderSavedConfiguration>['order'];
}

describe('saved order facts in editor', () => {
  it('retains historical item configuration, all shipments, packing, fees and design references', () => {
    const html = renderToStaticMarkup(
      <>
        <OrderSavedConfiguration order={savedOrder()} canEditDesigns={false} />
        <OrderSavedPackaging order={savedOrder()} />
      </>,
    );
    for (const fact of [
      '历史纸张 157g',
      '历史规格 88×168',
      '触感膜',
      '版组甲',
      '哑金',
      '红金',
      '保留原稿定位',
      '特殊工艺',
      '客户约定',
      '正面制版',
      '使用原版',
      '物流单号1',
      '物流单号2',
      '1,100',
      '礼盒混装',
      '210',
      '每袋 10 个',
      '物流费',
      '浙江寄付',
      '预览.jpg',
      '原稿.cdr',
    ])
      expect(html).toContain(fact);
    expect(html).toContain('signed:image-object');
    expect(html).not.toContain('private-cdr-object');
    expect(html).toContain('data-editable="false"');
  });
  it('makes missing historical data explicit without inventing default items or amounts', () => {
    const order = {
      ...savedOrder(),
      items: [],
      shipments: [],
      packagingGroups: [],
      quotedFee: null,
      confirmedFee: null,
    };
    const html = renderToStaticMarkup(
      <>
        <OrderSavedConfiguration order={order} canEditDesigns={false} />
        <OrderSavedPackaging order={order} />
      </>,
    );
    expect(html).toContain('未记录款式');
    expect(html).toContain('未记录包装明细');
    expect(html).toContain('待核定');
  });
});
