import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
  CustomerPriceRuleKind,
} from '@/generated/prisma/enums';
import type {
  CustomerPriceBookDraftAdminDto,
  CustomerPriceBookDraftPublishPreviewDto,
} from '@/lib/price/customer-price-book-admin';

vi.mock('@/components/business/price/ExternalSalesPriceBookDraftForms', () => ({
  CancelScheduledCustomerPriceBookForm: ({ priceBookId }: { priceBookId: string }) => (
    <span>取消计划 {priceBookId}</span>
  ),
  CreateCustomerPriceBookDraftForm: () => null,
  DiscardCustomerPriceBookDraftForm: () => null,
  PublishCustomerPriceBookDraftForm: ({
    impact,
  }: {
    impact?: { validationIssues?: Array<{ message: string; href?: string }> };
  }) => (
    <section aria-label="发布确认">
      <h3>发布检查</h3>
      <p>已开工单价格不变</p>
      {impact?.validationIssues?.map((issue) => (
        <a key={issue.message} href={issue.href}>
          {issue.message}
        </a>
      ))}
    </section>
  ),
  RescheduleCustomerPriceBookForm: ({ priceBookId }: { priceBookId: string }) => (
    <span>调整生效时间 {priceBookId}</span>
  ),
}));

import {
  ExternalSalesPriceBookVersionPanel,
  externalPriceBookValidationMessage,
} from '../ExternalSalesPriceBookVersionPanel';

const FORBIDDEN_TECHNICAL_TEXT =
  /issue\.path|ADD_ON|PER_BAG|PACKAGING_GROUP_MODE|SINGLE_STYLE|MIXED_STYLE|exclusiveGroup|carrierCode|provinces|FIXED_AMOUNT|ZTO_PROVINCE_RATE|unitsPerSheet/;

describe('ExternalSalesPriceBookVersionPanel', () => {
  it('只为计划版提供改期和取消入口，并展示取消审计原因', () => {
    const base = {
      code: 'EXTERNAL_SALES_PROCESSING_RULES',
      name: '外部销售加工费',
      purpose: CustomerPriceBookPurpose.PROCESSING,
      effectiveTo: null,
      ruleCount: 145,
      basedOnVersion: 1,
      basedOnBookId: 'book-v1',
      changeReason: '调整价格',
      publishNote: '已复核',
      ruleSetSha256: 'a'.repeat(64),
      createdById: 'owner-1',
      workflowCreatedAt: '2026-08-09T00:00:00.000Z',
    };
    const html = renderToStaticMarkup(
      <ExternalSalesPriceBookVersionPanel
        versions={[
          {
            ...base,
            id: 'book-v2-scheduled',
            version: 2,
            status: 'SCHEDULED',
            effectiveFrom: '2026-08-10T01:30:00.000Z',
            scheduleChangeReason: null,
            scheduleChangedAt: null,
            updatedAt: '2026-08-09T02:00:00.000Z',
          },
          {
            ...base,
            id: 'book-v3-cancelled',
            version: 3,
            status: 'CANCELLED',
            effectiveFrom: '2026-08-11T01:30:00.000Z',
            scheduleChangeReason: '价格复核尚未完成',
            scheduleChangedAt: '2026-08-09T03:00:00.000Z',
            updatedAt: '2026-08-09T03:00:00.000Z',
          },
        ]}
        draft={null}
        preview={null}
        invalidDraftSelection={false}
        defaultPublishAt=""
      />,
    );

    expect(html).toContain('调整生效时间 book-v2-scheduled');
    expect(html).toContain('取消计划 book-v2-scheduled');
    expect(html).not.toContain('调整生效时间 book-v3-cancelled');
    expect(html).toContain('已取消');
    expect(html).toContain('价格复核尚未完成');
  });

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
      rules: [
        {
          id: 'rule-add',
          code: 'CUSTOM_PAPER_RED_CARD_180',
          name: '空封现货基础价（A4:C4）',
          categoryId: 'category-1',
          categoryCode: 'CUSTOM_ADD_ON',
          categoryName: '基础加工费',
          productId: null,
          productCode: null,
          productName: null,
          kind: CustomerPriceRuleKind.ADD_ON,
          calculationType: CustomerPriceCalculationType.PER_PIECE,
          amount: '0.2',
          includedUnits: null,
          incrementUnits: null,
          incrementAmount: null,
          minQty: null,
          maxQty: null,
          triggerCondition: null,
          exclusiveGroup: null,
          priority: 1,
          note: null,
          blocksAutomaticQuote: false,
          isActive: true,
          source: {
            name: null,
            sha256: null,
            sheet: null,
            range: null,
          },
          updatedAt: '2026-08-26T01:00:00.000Z',
        },
      ],
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
      highRiskRuleCount: 0,
      highRiskDeltaPercentThreshold: '50',
      deltaPercentMin: null,
      deltaPercentMax: null,
      changes: [
        {
          draftRuleId: 'rule-add',
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
            ruleId: 'rule-add',
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
    expect(html).toContain(
      'href="/owner/rules/customer-pricing?section=adds&amp;focus=rule-add"',
    );
    expect(html).not.toContain('基础加工费');
    expect(html).not.toContain('版本发布说明');
    expect(html).not.toMatch(/A4:C4|A14:C14|产品表!C2|互斥组|优先级/);
  });
});
