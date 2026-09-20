import { blankPriceIdentity } from '@/lib/price/blank-price-identity';
import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CustomerPriceBookPurpose } from '@/generated/prisma/enums';
import type {
  CustomerPriceSection,
  CustomerPriceSectionRuleDto,
  CustomerPriceSectionWorkspaceDto,
  CustomerPriceSectionWorkspaceStateDto,
} from '@/lib/price/customer-price-section-workspace';

vi.mock('server-only', () => ({}));
vi.mock('@/actions/blank-paper', () => ({ updateBlankPriceMatrixFormAction: vi.fn() }));

vi.mock('@/actions/customer-price-books', () => ({
  updateCustomerPriceSectionDraftFormAction: vi.fn(),
}));

vi.mock(
  '@/components/business/price/ExternalSalesPriceBookDraftForms',
  () => ({
    CreateCustomerPriceBookDraftForm: ({
      purpose,
      presentation,
    }: {
      purpose: CustomerPriceBookPurpose;
      presentation?: string;
    }) => (
      <form
        data-draft-form-purpose={purpose.toLowerCase()}
        data-presentation={presentation}
      />
    ),
  }),
);

vi.mock('../CustomerPricingCreateDraftDialog', () => ({
  CustomerPricingCreateDraftDialog: ({
    children,
    dialogId,
    purposeLabel,
  }: {
    children: ReactNode;
    dialogId: string;
    purposeLabel: string;
  }) => (
    <aside id={dialogId} aria-label={`发起${purposeLabel}调价`}>
      {children}
    </aside>
  ),
}));

vi.mock('../CustomerPricingUrlCleanup', () => ({
  CustomerPricingUrlCleanup: ({ href }: { href: string }) => (
    <span data-customer-pricing-url-cleanup={href} />
  ),
}));

vi.mock('../CustomerPricingRuleFocus', () => ({
  CustomerPricingRuleFocus: ({ targetId }: { targetId: string }) => (
    <span data-price-rule-focus={targetId} />
  ),
}));

vi.mock(
  '@/components/business/price/PriceWorkspaceNavigationGuard',
  () => ({
    PriceWorkspaceNavigationGuardProvider: ({
      children,
    }: {
      children: ReactNode;
    }) => children,
    PriceWorkspaceLink: ({
      prefetch,
      ...props
    }: ComponentProps<'a'> & { prefetch?: boolean }) => {
      void prefetch;
      return <a {...props} />;
    },
  }),
);

vi.mock('@/components/business/price/RulePriceWorkspaceStatusBand', () => ({
  RulePriceWorkspaceStatusBand: ({
    ariaLabel,
    draft,
  }: {
    ariaLabel?: string;
    draft?: { version: number };
  }) => (
    <section aria-label={ariaLabel ?? '调价草稿状态'}>
      调价草稿 v{draft?.version}
    </section>
  ),
}));

vi.mock('../CustomerPricingSectionDraftForm', () => ({
  CustomerPricingSectionDraftForm: ({
    children,
    saveAction,
  }: {
    children: ReactNode;
    saveAction?: unknown;
  }) =>
    saveAction ? (
      <form data-section-draft-form="true">{children}</form>
    ) : (
      children
    ),
}));

import { CustomerPricingDedicatedSection } from '../CustomerPricingDedicatedSection';

function source(
  purpose: CustomerPriceBookPurpose,
  state: 'current' | 'draft' | 'scheduled' | 'unavailable' = 'current',
): CustomerPriceSectionWorkspaceStateDto {
  const currentBook =
    state === 'unavailable'
      ? null
      : ({ id: `${purpose}-current`, version: 4 } as NonNullable<
          CustomerPriceSectionWorkspaceStateDto['currentBook']
        >);
  return {
    purpose,
    currentBook,
    scheduledBook:
      state === 'scheduled'
        ? ({
            id: `${purpose}-scheduled`,
            version: 5,
            effectiveFrom: '2026-09-01T00:00:00.000Z',
          } as NonNullable<
            CustomerPriceSectionWorkspaceStateDto['scheduledBook']
          >)
        : null,
    draft:
      state === 'draft'
        ? ({
            id: `${purpose}-draft`,
            version: 5,
            changeReason: '材料调价',
            changedCount: 2,
            updatedAt: '2026-08-29T00:00:00.000Z',
          } as NonNullable<CustomerPriceSectionWorkspaceStateDto['draft']>)
        : null,
    draftCreation: {
      allowed: state === 'current',
      blockedReason:
        state === 'unavailable' ? '当前没有可复制的生效价格版本' : null,
    },
  };
}

function workspace(
  section: CustomerPriceSection,
  sources: CustomerPriceSectionWorkspaceStateDto[],
  rules: CustomerPriceSectionRuleDto[] = [],
): CustomerPriceSectionWorkspaceDto {
  return {
    section,
    sources,
    rules,
    shippingWeightPolicy: null,
  };
}

function editableBagRule(): CustomerPriceSectionRuleDto {
  return {
    id: 'packing-single-draft',
    purpose: CustomerPriceBookPurpose.PROCESSING,
    code: 'PACKAGING_SINGLE_STYLE_PER_BAG',
    current: null,
    draft: {
      id: 'packing-single-draft',
      code: 'PACKAGING_SINGLE_STYLE_PER_BAG',
      amount: '0.1',
      exclusiveGroup: null,
      product: null,
    } as NonNullable<CustomerPriceSectionRuleDto['draft']>,
    changed: false,
    expectedUpdatedAt: '2026-08-29T00:00:00.000Z',
  };
}

function editablePrintFoilRule(): CustomerPriceSectionRuleDto {
  return {
    id: 'print-foil-q1000-draft',
    purpose: CustomerPriceBookPurpose.PROCESSING,
    code: 'COLOR_SINGLE_FRONT_FOIL_Q1000',
    current: null,
    draft: {
      id: 'print-foil-q1000-draft',
      code: 'COLOR_SINGLE_FRONT_FOIL_Q1000',
      amount: '200',
      exclusiveGroup: 'COLOR_SINGLE_FRONT_FOIL',
      product: null,
    } as NonNullable<CustomerPriceSectionRuleDto['draft']>,
    changed: false,
    expectedUpdatedAt: '2026-08-29T00:00:00.000Z',
  };
}

describe('CustomerPricingDedicatedSection', () => {
  it('已有纸张的六种规格均可直接录价，空格显示未启用', () => {
    const data = workspace('blank', [source(CustomerPriceBookPurpose.PROCESSING, 'draft')]);
    data.blankPapers = [{ id: 'paper', label: '160g新纸张', available: true, issue: null }];
    const html = renderToStaticMarkup(<CustomerPricingDedicatedSection workspace={data} createDraftPurpose={null} />);
    expect(html).toContain('新纸张');
    expect(html).toContain('新增纸张 / 规格');
    expect(html).toContain('未启用');
    expect(html).not.toContain('不适用');
    expect([...html.matchAll(/<input/gu)]).toHaveLength(6);
  });

  it('新编码按规格进入正确列，同克重中文纸张的输入框不重名', () => {
    const rules = ['甲纸', '乙纸'].map((name, index) => ({
      ...editableBagRule(),
      id: `blank-${index}`, code: `NEW-CODE-${index}`,
      draft: { ...editableBagRule().draft, id: `blank-${index}`, code: `NEW-CODE-${index}`,
        exclusiveGroup: 'STOCK_BASE', blankIdentity: blankPriceIdentity({ paperType: `160g${name}`, specification: '中号封' }), product: { id: `product-${index}`, code: `NEW-CODE-${index}`, paperType: `160g${name}`, specification: '中号封80×115' } },
    } as CustomerPriceSectionRuleDto));
    const data = workspace('blank', [source(CustomerPriceBookPurpose.PROCESSING, 'draft')], rules);
    data.blankPapers = ['甲纸', '乙纸'].map((name, index) => ({ id: `paper-${index}`, label: `160g${name}`, available: true, issue: null }));
    const html = renderToStaticMarkup(<CustomerPricingDedicatedSection workspace={data} createDraftPurpose={null} />);
    expect(html).toContain('甲纸160g中号封单价');
    expect(html).toContain('乙纸160g中号封单价');
    const ids = [...html.matchAll(/<input[^>]*id="([^"]+)"/gu)].map(match => match[1]);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
  });

  it.each([
    [750, 1500, 2500, 3500, 4500, 7500, 15000, 25000, 42000, null],
    [499, 999, 1999, 2999, 3999, 4999, 9999, 19999, 29999, 49999, null],
  ])('历史十档和当前十一档均可编辑：%j', (...upper) => {
    const ninthUpper = upper[8];
    const codes = ['EXT-CUSTOM-MID', 'EXT-CUSTOM-SQUARE', 'EXT-CUSTOM-WEST-MID', 'EXT-CUSTOM-LARGE', 'EXT-CUSTOM-WEST-LARGE'];
    const rules = codes.flatMap(code => upper.map((maxQty, tier) => ({
      ...editableBagRule(), id: `${code}-${tier}`, code: `${code}-${tier}`,
      draft: { ...editableBagRule().draft, id: `${code}-${tier}`, code: `${code}-${tier}`,
        exclusiveGroup: 'CUSTOM_BASE', product: { code },
        minQty: tier === 0 ? 1 : upper[tier - 1]! + 1, maxQty,
      } as NonNullable<CustomerPriceSectionRuleDto['draft']>,
    })));
    const html = renderToStaticMarkup(<CustomerPricingDedicatedSection
      workspace={workspace('tiers', [source(CustomerPriceBookPurpose.PROCESSING, 'draft')], rules)}
      createDraftPurpose={null} />);
    expect(html).toContain('name="tiers.8.maxQuantity"');
    const input = html.match(/<input[^>]*name="tiers\.8\.maxQuantity"[^>]*>/u)?.[0];
    expect(input).toBeTruthy();
    expect(input).not.toMatch(/\sdisabled(?:=|\s|>)/u);
    expect(input).toContain(`value="${ninthUpper}"`);
    expect(html.includes('aria-label="200个档中号组单价"')).toBe(upper.length === 11);
  });

  it('彩印含版费原子套餐属于彩印草稿，可编辑并随表单发布', () => {
    const html = renderToStaticMarkup(
      <CustomerPricingDedicatedSection
        workspace={workspace(
          'print',
          [source(CustomerPriceBookPurpose.PROCESSING, 'draft')],
          [editablePrintFoilRule()],
        )}
        createDraftPurpose={null}
      />,
    );

    expect(html).toContain('data-section-draft-form="true"');
    expect(html).toMatch(
      /<input\b[^>]*aria-label="单色烫金1千档含版费套餐价"[^>]*value="200"/u,
    );
    expect(html).toContain('name="print.foil.Q1000"');
  });

  it('只将受信草稿规则 id 解析到所属价格输入框', () => {
    const html = renderToStaticMarkup(
      <CustomerPricingDedicatedSection
        workspace={workspace(
          'ship',
          [source(CustomerPriceBookPurpose.PROCESSING, 'draft')],
          [editableBagRule()],
        )}
        createDraftPurpose={null}
        focusRuleId="packing-single-draft"
      />,
    );

    expect(html).toContain(
      'data-price-rule-focus="customer-section-ship-bag-normalFee"',
    );

    const untrustedHtml = renderToStaticMarkup(
      <CustomerPricingDedicatedSection
        workspace={workspace(
          'ship',
          [source(CustomerPriceBookPurpose.PROCESSING, 'draft')],
          [editableBagRule()],
        )}
        createDraftPurpose={null}
        focusRuleId="unknown-rule"
      />,
    );
    expect(untrustedHtml).not.toContain('data-price-rule-focus');
  });

  it('当前生效态只在标题区提供调价入口，不再渲染正文状态卡', () => {
    const html = renderToStaticMarkup(
      <CustomerPricingDedicatedSection
        workspace={workspace('adds', [
          source(CustomerPriceBookPurpose.PROCESSING),
        ])}
        createDraftPurpose={null}
      />,
    );

    expect(html).toContain('>发起调价</a>');
    expect(html).toContain('start=1&amp;purpose=processing');
    expect(html).not.toContain('aria-label="价格状态"');
    expect(html).not.toContain('当前生效');
    expect(html).not.toContain('data-draft-form-purpose');
  });

  it('草稿创建完成后收敛已失效的调价弹窗地址', () => {
    const html = renderToStaticMarkup(
      <CustomerPricingDedicatedSection
        workspace={workspace('blank', [
          source(CustomerPriceBookPurpose.PROCESSING, 'draft'),
        ])}
        createDraftPurpose={CustomerPriceBookPurpose.PROCESSING}
      />,
    );

    expect(html).toContain(
      'data-customer-pricing-url-cleanup="/owner/rules/customer-pricing?section=blank"',
    );
    expect(html).not.toContain('data-draft-form-purpose="processing"');
  });

  it('包装与快递分别调价，且只展开 query 指定的一个表单', () => {
    const closedHtml = renderToStaticMarkup(
      <CustomerPricingDedicatedSection
        workspace={workspace('ship', [
          source(CustomerPriceBookPurpose.LOGISTICS),
          source(CustomerPriceBookPurpose.PROCESSING),
        ])}
        createDraftPurpose={null}
      />,
    );
    const html = renderToStaticMarkup(
      <CustomerPricingDedicatedSection
        workspace={workspace('ship', [
          source(CustomerPriceBookPurpose.LOGISTICS),
          source(CustomerPriceBookPurpose.PROCESSING),
        ])}
        createDraftPurpose={CustomerPriceBookPurpose.LOGISTICS}
      />,
    );

    expect(closedHtml).toContain('>调整物流费</a>');
    expect(closedHtml).toContain('>调整包装费</a>');
    expect(closedHtml).toContain('start=1&amp;purpose=logistics');
    expect(closedHtml).toContain('start=1&amp;purpose=processing');
    expect(html).toContain('>收起物流费调价</a>');
    expect(html).toContain('>调整包装费</a>');
    expect(html).toContain('href="/owner/rules/customer-pricing?section=ship"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain(
      'aria-controls="customer-pricing-ship-logistics-draft-dialog"',
    );
    expect(html).toContain('aria-label="发起物流费调价"');
    expect(html.match(/data-draft-form-purpose=/g)).toHaveLength(1);
    expect(html).toContain('data-draft-form-purpose="logistics"');
    expect(html).toContain('data-presentation="dialog"');
    expect(html).not.toContain('data-draft-form-purpose="processing"');

    const mixedStateHtml = renderToStaticMarkup(
      <CustomerPricingDedicatedSection
        workspace={workspace(
          'ship',
          [
            source(CustomerPriceBookPurpose.LOGISTICS),
            source(CustomerPriceBookPurpose.PROCESSING, 'draft'),
          ],
          [editableBagRule()],
        )}
        createDraftPurpose={CustomerPriceBookPurpose.LOGISTICS}
      />,
    );
    const saveFormStart = mixedStateHtml.indexOf('data-section-draft-form');
    const saveFormEnd = mixedStateHtml.indexOf('</form>', saveFormStart);
    const mixedCreateFormStart = mixedStateHtml.indexOf(
      'data-draft-form-purpose="logistics"',
    );

    expect(mixedStateHtml).toContain('>收起物流费调价</a>');
    expect(mixedStateHtml).toContain('aria-label="入袋费调价草稿状态"');
    expect(saveFormStart).toBeGreaterThanOrEqual(0);
    expect(saveFormEnd).toBeGreaterThan(saveFormStart);
    expect(mixedCreateFormStart).toBeGreaterThan(saveFormEnd);
  });

  it('保留草稿工作条和紧凑的计划/异常提示', () => {
    const draftHtml = renderToStaticMarkup(
      <CustomerPricingDedicatedSection
        workspace={workspace('adds', [
          source(CustomerPriceBookPurpose.PROCESSING, 'draft'),
        ])}
        createDraftPurpose={null}
      />,
    );
    const scheduledHtml = renderToStaticMarkup(
      <CustomerPricingDedicatedSection
        workspace={workspace('adds', [
          source(CustomerPriceBookPurpose.PROCESSING, 'scheduled'),
        ])}
        createDraftPurpose={null}
      />,
    );
    const unavailableHtml = renderToStaticMarkup(
      <CustomerPricingDedicatedSection
        workspace={workspace('adds', [
          source(CustomerPriceBookPurpose.PROCESSING, 'unavailable'),
        ])}
        createDraftPurpose={null}
      />,
    );
    const twoDraftsHtml = renderToStaticMarkup(
      <CustomerPricingDedicatedSection
        workspace={workspace('ship', [
          source(CustomerPriceBookPurpose.LOGISTICS, 'draft'),
          source(CustomerPriceBookPurpose.PROCESSING, 'draft'),
        ])}
        createDraftPurpose={null}
      />,
    );

    expect(draftHtml).toContain('aria-label="调价草稿状态"');
    expect(draftHtml).not.toContain('>发起调价</a>');
    expect(scheduledHtml).toContain('加工费 · 等待生效');
    expect(scheduledHtml).toContain('生效前不能再发起新调价');
    expect(unavailableHtml).toContain('加工费 · 暂无生效价');
    expect(unavailableHtml).toContain('当前没有可复制的生效价格版本');
    expect(twoDraftsHtml).toContain('aria-label="物流费调价草稿状态"');
    expect(twoDraftsHtml).toContain('aria-label="入袋费调价草稿状态"');
  });
});

it('hides retired 120g pricing rows while leaving persisted rules unchanged', () => {
  const retired = { ...editableBagRule(), id: 'retired-120', code: 'RETIRED-120', draft: { ...editableBagRule().draft, id: 'retired-120', code: 'RETIRED-120', exclusiveGroup: 'STOCK_BASE', blankIdentity: blankPriceIdentity({ paperType: '120g珠光艳闪', specification: '迷你封' }), product: { id: 'retired-product', code: 'RETIRED-120', name: '120g珠光艳闪', paperType: '120g珠光艳闪', specification: '迷你封50×80' } } } as CustomerPriceSectionRuleDto;
  const data = workspace('blank', [source(CustomerPriceBookPurpose.PROCESSING, 'draft')], [retired]);
  data.blankPapers = [{ id: 'retired', label: '120g珠光艳闪', available: true, issue: null }, { id: 'active', label: '160g珠光艳闪', available: true, issue: null }];
  const html = renderToStaticMarkup(<CustomerPricingDedicatedSection workspace={data} createDraftPurpose={null} />);
  expect(html).not.toContain('120g');
  expect(html).toContain('160g');
  expect(data.rules).toHaveLength(1);
});
