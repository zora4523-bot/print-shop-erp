import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
} from '@/generated/prisma/enums';
import type {
  CustomerPriceBookDraftAdminDto,
  CustomerPriceBookDraftPublishPreviewDto,
} from '@/lib/price/customer-price-book-admin';

vi.mock('@/components/business/price/ExternalSalesPriceBookDraftForms', () => ({
  CreateCustomerPriceBookDraftForm: () => null,
  DiscardCustomerPriceBookDraftForm: () => null,
  PublishCustomerPriceBookDraftForm: () => null,
}));

import {
  ExternalSalesPriceBookVersionPanel,
  externalPriceBookValidationMessage,
} from '../ExternalSalesPriceBookVersionPanel';

const FORBIDDEN_TECHNICAL_TEXT =
  /issue\.path|ADD_ON|PER_BAG|PACKAGING_GROUP_MODE|SINGLE_STYLE|MIXED_STYLE|exclusiveGroup|carrierCode|provinces|FIXED_AMOUNT|ZTO_PROVINCE_RATE|unitsPerSheet/;

describe('ExternalSalesPriceBookVersionPanel', () => {
  it('把历史校验结果中的内部字段和枚举转换为业务文案', () => {
    const message = externalPriceBookValidationMessage(
      'issue.path：ADD_ON / PER_BAG，PACKAGING_GROUP_MODE 包含 SINGLE_STYLE、MIXED_STYLE；exclusiveGroup；carrierCode；provinces；ADD_ON / FIXED_AMOUNT；ZTO_PROVINCE_RATE；unitsPerSheet',
    );

    expect(message).toContain('问题位置');
    expect(message).toContain('自动按实际袋数计价');
    expect(message).toContain('包装方式');
    expect(message).toContain('单款装');
    expect(message).toContain('混装');
    expect(message).toContain('适用范围');
    expect(message).toContain('承运商');
    expect(message).toContain('省份');
    expect(message).toContain('自动固定金额计价');
    expect(message).toContain('中通地区费率');
    expect(message).toContain('每张成品数');
    expect(message).not.toMatch(FORBIDDEN_TECHNICAL_TEXT);
  });

  it('不向管理员展示第三方校验器的英文错误', () => {
    const message = externalPriceBookValidationMessage(
      'Unrecognized key: "futureField"；Invalid option: expected one of "A"|"B"',
    );

    expect(message).toContain('存在系统无法识别的适用条件');
    expect(message).toContain('选项设置无效');
    expect(message).not.toMatch(/futureField|Unrecognized key|Invalid option/i);
  });

  it('发布页只展示业务名称和简洁变更标签，不展示导入坐标或内部字段名', () => {
    const draft: CustomerPriceBookDraftAdminDto = {
      id: 'draft-2',
      code: 'processing-v2',
      name: '加工费价目表',
      purpose: CustomerPriceBookPurpose.PROCESSING,
      version: 2,
      basedOn: { id: 'current-1', code: 'processing-v1', version: 1 },
      changeReason: '调整加工费',
      createdBy: '管理员',
      createdAt: '2026-08-26T01:00:00.000Z',
      ruleSetSha256: null,
      updatedAt: '2026-08-26T01:00:00.000Z',
      categories: [],
      products: [],
      rules: [],
    };
    const preview: CustomerPriceBookDraftPublishPreviewDto = {
      priceBookId: draft.id,
      purpose: draft.purpose,
      version: draft.version,
      basedOnVersion: 1,
      totalRuleCount: 1,
      activeRuleCount: 1,
      changedItemCount: 1,
      changedRuleCount: 1,
      increasedRuleCount: 0,
      decreasedRuleCount: 0,
      deltaPercentMin: null,
      deltaPercentMax: null,
      changes: [
        {
          draftRuleId: null,
          name: '空封现货基础价（A4:C4）',
          categoryName: '基础加工费',
          productName: '现货大号（产品表!C2）',
          quantityLabel: '1,000 个',
          calculationType: CustomerPriceCalculationType.PER_PIECE,
          current: {
            amount: '0.2',
            includedUnits: null,
            incrementUnits: null,
            incrementAmount: null,
            isActive: true,
          },
          draft: {
            amount: '0.2',
            includedUnits: null,
            incrementUnits: null,
            incrementAmount: null,
            isActive: true,
          },
          changedFields: ['适用范围', '应用顺序'],
          direction: 'OTHER',
          deltaAmount: null,
          deltaPercent: null,
        },
      ],
      validation: {
        status: 'FAIL',
        issues: [
          {
            path: 'rules.rule-overlap.minQty',
            message: '基础报价数量区间与“空封现货基础价（A14:C14）”重叠',
          },
        ],
      },
    };

    const html = renderToStaticMarkup(
      <ExternalSalesPriceBookVersionPanel
        versions={[]}
        draft={draft}
        preview={preview}
        invalidDraftSelection={false}
        defaultPublishAt="2026-08-27T09:00"
      />,
    );

    expect(html).toContain('空封现货基础价');
    expect(html).toContain('现货大号');
    expect(html).toContain('变更：适用范围、应用顺序');
    expect(html).toContain('基础报价数量区间与“空封现货基础价”重叠');
    expect(html).toContain('发布检查');
    expect(html).toContain('已开工单价格不变');
    expect(html).not.toContain('基础加工费');
    expect(html).not.toContain('版本发布说明');
    expect(html).not.toMatch(/A4:C4|A14:C14|产品表!C2|互斥组|优先级/);
  });
});
