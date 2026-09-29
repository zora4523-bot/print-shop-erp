import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CustomerPriceBookPurpose,
  CustomerPriceCalculationType,
  CustomerPriceRuleKind,
  OrderItemPricingRoute,
  OrderLamination,
  OrderPackagingMode,
} from '@/generated/prisma/enums';
import { EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT } from '@/lib/price/customer-rule-condition';
import type {
  CustomerPriceRuleDraftEditorDto,
} from '@/lib/price/customer-price-book-admin';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

const {
  actionStateMock,
  cancelScheduledActionMock,
  createActionMock,
  discardActionMock,
  effectMock,
  publishActionMock,
  refreshMock,
  replaceMock,
  rescheduleActionMock,
  updateActionMock,
} = vi.hoisted(() => ({
  actionStateMock: vi.fn(),
  cancelScheduledActionMock: vi.fn(),
  createActionMock: vi.fn(),
  discardActionMock: vi.fn(),
  effectMock: vi.fn(),
  publishActionMock: vi.fn(),
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
  rescheduleActionMock: vi.fn(),
  updateActionMock: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: actionStateMock,
    useEffect: effectMock,
  };
});

vi.mock('@/actions/customer-price-books', () => ({
  cancelScheduledCustomerPriceBookAction: cancelScheduledActionMock,
  createCustomerPriceBookDraftAction: createActionMock,
  discardCustomerPriceBookDraftAction: discardActionMock,
  publishCustomerPriceBookDraftAction: publishActionMock,
  rescheduleCustomerPriceBookAction: rescheduleActionMock,
  updateCustomerPriceRuleDraftAction: updateActionMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: replaceMock }),
}));

import {
  cancelScheduledFromForm,
  CancelScheduledCustomerPriceBookForm,
  createDraftFromForm,
  CreateCustomerPriceBookDraftForm,
  customerPriceRuleInputFromFormData,
  CustomerPriceBookDraftRuleForm,
  discardDraftFromForm,
  PublishCustomerPriceBookDraftForm,
  publishDraftFromForm,
  rescheduleFromForm,
  RescheduleCustomerPriceBookForm,
  updateDraftRuleFromForm,
} from '../ExternalSalesPriceBookDraftForms';

const categories = [
  { id: 'processing-category', name: '彩印加工' },
];

function rule(
  overrides: Partial<CustomerPriceRuleDraftEditorDto['rule']> = {},
): CustomerPriceRuleDraftEditorDto['rule'] {
  return {
    id: 'rule-1',
    name: '彩印 100 个',
    categoryId: 'processing-category',
    categoryName: '彩印加工',
    productId: 'product-1',
    kind: CustomerPriceRuleKind.BASE,
    calculationType: CustomerPriceCalculationType.FIXED_AMOUNT,
    unitsPerSheet: null,
    match: {
      ...EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
      pricingRoutes: [OrderItemPricingRoute.COLOR_PRINT],
    },
    matchValidationErrors: [],
    amount: '130',
    includedUnits: null,
    incrementUnits: null,
    incrementAmount: null,
    minQty: 100,
    maxQty: 100,
    blocksAutomaticQuote: false,
    isActive: true,
    editorMode: 'PROCESSING',
    shippingScopeLabel: null,
    updatedAt: '2026-08-09T00:30:00.000Z',
    ...overrides,
  };
}

function ruleContext(
  purpose: CustomerPriceBookPurpose,
): CustomerPriceRuleDraftEditorDto['context'] {
  return {
    id: 'draft-1',
    purpose,
    categories: purpose === CustomerPriceBookPurpose.PROCESSING ? categories : [],
    products:
      purpose === CustomerPriceBookPurpose.PROCESSING
        ? [{ id: 'product-1', name: '彩印红包' }]
        : [],
    crafts:
      purpose === CustomerPriceBookPurpose.PROCESSING
        ? [
            { value: 'COLOR_PRINT', label: '彩印' },
            { value: 'FLAT_FOIL', label: '平烫' },
          ]
        : [],
  };
}

beforeEach(() => {
  actionStateMock.mockReset();
  createActionMock.mockReset();
  cancelScheduledActionMock.mockReset();
  discardActionMock.mockReset();
  effectMock.mockReset();
  effectMock.mockImplementation(() => undefined);
  publishActionMock.mockReset();
  refreshMock.mockReset();
  replaceMock.mockReset();
  rescheduleActionMock.mockReset();
  updateActionMock.mockReset();
  const success = { status: 'success', priceBookId: 'draft-1' };
  cancelScheduledActionMock.mockResolvedValue(success);
  createActionMock.mockResolvedValue(success);
  discardActionMock.mockResolvedValue(success);
  publishActionMock.mockResolvedValue(success);
  rescheduleActionMock.mockResolvedValue(success);
  updateActionMock.mockResolvedValue({ ...success, ruleId: 'rule-1' });
  actionStateMock.mockImplementation(
    (action: (state: unknown, payload: FormData) => unknown, initial: unknown) => [
      initial,
      action,
      false,
    ],
  );
});

describe('customer price-book draft form bindings', () => {
  it('submits visible business fields and drops injected technical metadata', () => {
    const formData = new FormData();
    for (const [name, value] of Object.entries({
      priceBookId: 'draft-1',
      ruleId: 'rule-1',
      expectedUpdatedAt: '2026-08-09T00:30:00.000Z',
      name: '新规则名',
      categoryId: 'category-1',
      productId: 'product-1',
      kind: CustomerPriceRuleKind.ADD_ON,
      calculationType: CustomerPriceCalculationType.PER_PIECE,
      unitsPerSheet: '8',
      amount: '0.2500',
      includedUnits: '1',
      incrementUnits: '0.5',
      incrementAmount: '3.5',
      minQty: '100',
      maxQty: '500',
      triggerCondition: '{"foilColorCount":2}',
      exclusiveGroup: 'FOIL',
      priority: '80',
      note: '测试备注',
      blocksAutomaticQuote: 'true',
      isActive: 'true',
    })) {
      formData.set(name, value);
    }

    expect(customerPriceRuleInputFromFormData(formData)).toEqual({
      priceBookId: 'draft-1',
      ruleId: 'rule-1',
      expectedUpdatedAt: '2026-08-09T00:30:00.000Z',
      name: '新规则名',
      categoryId: 'category-1',
      productId: 'product-1',
      kind: CustomerPriceRuleKind.ADD_ON,
      calculationType: CustomerPriceCalculationType.PER_PIECE,
      unitsPerSheet: 8,
      amount: '0.2500',
      includedUnits: '1',
      incrementUnits: '0.5',
      incrementAmount: '3.5',
      minQty: 100,
      maxQty: 500,
      blocksAutomaticQuote: true,
      match: EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
      isActive: true,
    });
  });

  it('保留工艺复选框的全部选中值并去重', () => {
    const formData = new FormData();
    for (const [name, value] of Object.entries({
      priceBookId: 'draft-1',
      ruleId: 'rule-1',
      expectedUpdatedAt: '2026-08-09T00:30:00.000Z',
      name: '组合工艺加价',
      categoryId: 'category-1',
      productId: '',
      kind: CustomerPriceRuleKind.ADD_ON,
      calculationType: CustomerPriceCalculationType.PER_PIECE,
      amount: '0.2',
    })) {
      formData.set(name, value);
    }
    formData.append('match.craftCodes', 'COLOR_PRINT');
    formData.append('match.craftCodes', 'FLAT_FOIL');
    formData.append('match.craftCodes', 'COLOR_PRINT');
    formData.append('match.noneOfCraftCodes', 'UV');
    formData.append('match.noneOfCraftCodes', 'DIE_CUT');
    formData.append('match.anyCraftCodeOutside', 'PACKING');
    formData.append('match.anyCraftCodeOutside', 'GLUING');

    const input = customerPriceRuleInputFromFormData(formData);

    expect(input.match?.craftCodes).toEqual(['COLOR_PRINT', 'FLAT_FOIL']);
    expect(input.match?.noneOfCraftCodes).toEqual(['UV', 'DIE_CUT']);
    expect(input.match?.anyCraftCodeOutside).toEqual(['PACKING', 'GLUING']);
  });

  it('将正反面合计的烫金道数结构化提交', () => {
    const formData = new FormData();
    for (const [name, value] of Object.entries({
      priceBookId: 'draft-1',
      ruleId: 'rule-1',
      expectedUpdatedAt: '2026-08-09T00:30:00.000Z',
      name: '机仔烫金费',
      categoryId: 'category-1',
      productId: '',
      kind: CustomerPriceRuleKind.ADD_ON,
      calculationType: CustomerPriceCalculationType.PER_PIECE,
      amount: '0.04',
      'match.target': 'ITEM',
      'match.foilPassCount': '3',
      'match.perFoilPass': 'true',
    })) {
      formData.set(name, value);
    }
    formData.append(
      'match.pricingRoutes',
      OrderItemPricingRoute.STOCK_BLANK,
    );

    expect(customerPriceRuleInputFromFormData(formData).match).toEqual({
      ...EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
      pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
      foilPassCount: 3,
      perFoilPass: true,
    });
  });

  it('binds create, save, publish, discard and schedule controls to their dedicated actions', async () => {
    const createData = new FormData();
    createData.set('purpose', CustomerPriceBookPurpose.PROCESSING);
    createData.set('changeReason', '原材料调价');
    await createDraftFromForm(null, createData);

    const updateData = new FormData();
    for (const [name, value] of Object.entries({
      priceBookId: 'draft-1',
      ruleId: 'rule-1',
      expectedUpdatedAt: '2026-08-09T00:30:00.000Z',
      name: '彩印 100 个',
      categoryId: 'category-1',
      productId: '',
      kind: CustomerPriceRuleKind.REFERENCE,
      calculationType: '',
      unitsPerSheet: '',
      amount: '',
      includedUnits: '',
      incrementUnits: '',
      incrementAmount: '',
      minQty: '',
      maxQty: '',
    })) {
      updateData.set(name, value);
    }
    await updateDraftRuleFromForm(null, updateData);

    const publishData = new FormData();
    publishData.set('priceBookId', 'draft-1');
    publishData.set('expectedDraftUpdatedAt', '2026-08-09T00:30:00.000Z');
    publishData.set('effectiveFrom', '2026-09-01T08:00');
    publishData.set('publishNote', '已完成价格复核');
    publishData.set('confirmedImpact', 'true');
    await publishDraftFromForm(null, publishData);

    const discardData = new FormData();
    discardData.set('priceBookId', 'draft-1');
    discardData.set('expectedDraftUpdatedAt', '2026-08-09T00:30:00.000Z');
    await discardDraftFromForm(null, discardData);

    const cancelData = new FormData();
    cancelData.set('priceBookId', 'scheduled-2');
    cancelData.set('expectedUpdatedAt', '2026-08-09T00:30:00.000Z');
    cancelData.set('reason', '取消错误计划');
    cancelData.set('confirmedImpact', 'true');
    await cancelScheduledFromForm(null, cancelData);

    const rescheduleData = new FormData();
    rescheduleData.set('priceBookId', 'scheduled-2');
    rescheduleData.set('expectedUpdatedAt', '2026-08-09T00:30:00.000Z');
    rescheduleData.set('effectiveFrom', '2026-09-02T08:00');
    rescheduleData.set('reason', '延后统一切换');
    rescheduleData.set('confirmedImpact', 'true');
    await rescheduleFromForm(null, rescheduleData);

    expect(createActionMock).toHaveBeenCalledWith({
      purpose: CustomerPriceBookPurpose.PROCESSING,
      changeReason: '原材料调价',
    });
    expect(updateActionMock).toHaveBeenCalledTimes(1);
    expect(publishActionMock).toHaveBeenCalledWith({
      priceBookId: 'draft-1',
      expectedDraftUpdatedAt: '2026-08-09T00:30:00.000Z',
      effectiveFrom: '2026-09-01T08:00',
      publishNote: '已完成价格复核',
      confirmedImpact: true,
      confirmedHighRisk: false,
    });
    expect(discardActionMock).toHaveBeenCalledWith({
      priceBookId: 'draft-1',
      expectedDraftUpdatedAt: '2026-08-09T00:30:00.000Z',
    });
    expect(cancelScheduledActionMock).toHaveBeenCalledWith({
      priceBookId: 'scheduled-2',
      expectedUpdatedAt: '2026-08-09T00:30:00.000Z',
      reason: '取消错误计划',
      confirmedImpact: true,
    });
    expect(rescheduleActionMock).toHaveBeenCalledWith({
      priceBookId: 'scheduled-2',
      expectedUpdatedAt: '2026-08-09T00:30:00.000Z',
      effectiveFrom: '2026-09-02T08:00',
      reason: '延后统一切换',
      confirmedImpact: true,
    });
  });
});

describe('scheduled price-book controls', () => {
  it('renders explicit L3 cancel and reschedule forms without deleting evidence', () => {
    const cancelHtml = renderToStaticMarkup(
      <CancelScheduledCustomerPriceBookForm
        priceBookId="scheduled-2"
        expectedUpdatedAt="2026-08-09T00:30:00.000Z"
        version={2}
      />,
    );
    const rescheduleHtml = renderToStaticMarkup(
      <RescheduleCustomerPriceBookForm
        priceBookId="scheduled-2"
        expectedUpdatedAt="2026-08-09T00:30:00.000Z"
        version={2}
        defaultEffectiveFrom="2026-09-02T08:00"
      />,
    );

    expect(cancelHtml).toContain('取消计划');
    expect(cancelHtml).toContain('name="confirmedImpact"');
    expect(cancelHtml).toContain('value="true"');
    expect(rescheduleHtml).toContain('name="effectiveFrom"');
    expect(rescheduleHtml).toContain('type="datetime-local"');
    expect(rescheduleHtml).toContain('value="2026-09-02T08:00"');
    expect(rescheduleHtml).toContain('调整生效时间');
  });
});

describe('CreateCustomerPriceBookDraftForm', () => {
  it('简明说明草稿影响，并将调价原因标为必填', () => {
    const html = renderToStaticMarkup(
      <CreateCustomerPriceBookDraftForm
        purpose={CustomerPriceBookPurpose.PROCESSING}
      />,
    );

    expect(html).toContain('发起调价');
    expect(html).toContain('草稿发布前不影响当前报价');
    expect(html).toContain('调价原因');
    expect(html).toContain('开始调价');
    expect(html).not.toContain('复制当前价目');

    const textarea = html.match(
      /<textarea[^>]*name="changeReason"[^>]*>/,
    )?.[0];
    expect(textarea).toContain('required=""');
    expect(textarea).toContain('aria-required="true"');
    expect(textarea).toContain('aria-invalid="false"');
    expect(textarea).toContain(
      'aria-describedby="changeReason-PROCESSING-hint"',
    );
  });

  it('在弹窗中复用表单时使用业务名称且不重复面板说明', () => {
    const html = renderToStaticMarkup(
      <CreateCustomerPriceBookDraftForm
        purpose={CustomerPriceBookPurpose.PROCESSING}
        purposeLabel="入袋费"
        presentation="dialog"
      />,
    );

    expect(html).toContain('aria-label="创建入袋费调价草稿"');
    expect(html).toContain('调价原因');
    expect(html).toContain('开始调价');
    expect(html).not.toContain('草稿发布前不影响当前报价');
    expect(html).not.toContain('<p class="text-sm font-medium">发起调价</p>');
  });

  it('将服务端字段错误关联到调价原因并用 alert 播报', () => {
    actionStateMock.mockImplementation((action) => [
      {
        status: 'invalid',
        fieldErrors: { changeReason: ['请填写至少 2 个字符的调价原因'] },
      },
      action,
      false,
    ]);

    const html = renderToStaticMarkup(
      <CreateCustomerPriceBookDraftForm
        purpose={CustomerPriceBookPurpose.PROCESSING}
      />,
    );
    const textarea = html.match(
      /<textarea[^>]*name="changeReason"[^>]*>/,
    )?.[0];

    expect(textarea).toContain('aria-invalid="true"');
    expect(textarea).toContain(
      'aria-describedby="changeReason-PROCESSING-hint changeReason-PROCESSING-error"',
    );
    expect(html).toContain('id="changeReason-PROCESSING-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('请填写至少 2 个字符的调价原因');
  });

  it('并发创建已产生草稿时提供相邻的刷新恢复操作', () => {
    actionStateMock.mockImplementation((action) => [
      {
        status: 'error',
        message: '该用途已有草稿版本，请刷新后继续编辑',
      },
      action,
      false,
    ]);

    const html = renderToStaticMarkup(
      <CreateCustomerPriceBookDraftForm
        purpose={CustomerPriceBookPurpose.PROCESSING}
      />,
    );

    expect(html).toMatch(
      /<p role="alert"[^>]*>该用途已有草稿版本，请刷新后继续编辑<\/p>/,
    );
    expect(html).toContain('刷新最新内容');
    expect(html).not.toMatch(/<div role="alert"[^>]*>/);
  });
});

describe('PublishCustomerPriceBookDraftForm', () => {
  it('默认立即发布，在一层确认中展示真实影响', () => {
    const html = renderToStaticMarkup(
      <PublishCustomerPriceBookDraftForm
        priceBookId="draft-1"
        expectedDraftUpdatedAt="2026-08-09T00:30:00.000Z"
        defaultEffectiveFrom=""
        changeReason="原材料调价"
        impact={{
          totalRuleCount: 121,
          changedItemCount: 2,
          changedRuleCount: 7,
          increasedRuleCount: 7,
          decreasedRuleCount: 0,
          highRiskRuleCount: 0,
          highRiskDeltaPercentThreshold: '50',
          deltaPercentMin: '2.8',
          deltaPercentMax: '5.8',
          validationStatus: 'PASS',
        }}
      />,
    );

    expect(html).toContain('确认本次价格变更');
    expect(html).toContain('2 个收费项目 · 7 条规则');
    expect(html).toContain('121 条规则已通过');
    expect(html).toContain('立即生效');
    expect(html).toContain('确认并立即发布');
    expect(html).toContain('预约生效或补充发布说明（可选）');
    const effectiveFrom = html.match(/<input[^>]*name="effectiveFrom"[^>]*>/)?.[0];
    const publishNote = html.match(/<textarea[^>]*name="publishNote"[^>]*>/)?.[0];
    expect(effectiveFrom).not.toContain('required=""');
    expect(publishNote).not.toContain('required=""');
    expect(html).toContain('name="confirmedImpact" value="true"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('校验通过，进入发布确认');
    expect(html).not.toContain('2 / 121');
  });

  it('零差异时禁止发布', () => {
    const html = renderToStaticMarkup(
      <PublishCustomerPriceBookDraftForm
        priceBookId="draft-empty"
        expectedDraftUpdatedAt="2026-08-09T00:30:00.000Z"
        defaultEffectiveFrom=""
        changeReason="检查价格"
        impact={{
          totalRuleCount: 121,
          changedItemCount: 0,
          changedRuleCount: 0,
          increasedRuleCount: 0,
          decreasedRuleCount: 0,
          highRiskRuleCount: 0,
          highRiskDeltaPercentThreshold: '50',
          deltaPercentMin: null,
          deltaPercentMax: null,
          validationStatus: 'PASS',
        }}
      />,
    );

    expect(html).toContain('草稿与当前版本一致，无需发布');
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain('含启停或非金额修改');
    expect(html).not.toContain('name="effectiveFrom"');
  });

  it('异常涨跌要求额外显式确认，未勾选时不能提交', () => {
    const html = renderToStaticMarkup(
      <PublishCustomerPriceBookDraftForm
        priceBookId="draft-risky"
        expectedDraftUpdatedAt="2026-08-09T00:30:00.000Z"
        defaultEffectiveFrom=""
        changeReason="修订单价"
        impact={{
          totalRuleCount: 145,
          changedItemCount: 1,
          changedRuleCount: 1,
          increasedRuleCount: 1,
          decreasedRuleCount: 0,
          highRiskRuleCount: 1,
          highRiskDeltaPercentThreshold: '50',
          deltaPercentMin: '515.4',
          deltaPercentMax: '515.4',
          validationStatus: 'PASS',
        }}
      />,
    );

    expect(html).toContain('检测到 1 条高风险报价变更');
    expect(html).toContain('name="confirmedHighRisk"');
    expect(html).toContain('我已逐条核对高风险变更');
    const checkbox = html.match(
      /<span[^>]*aria-label="我已逐条核对高风险变更，确认按当前新规则发布"[^>]*>/,
    )?.[0];
    expect(checkbox).toContain('data-slot="checkbox"');
    expect(checkbox).toContain('aria-checked="false"');
    expect(checkbox).not.toContain('aria-describedby');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it('高风险确认只在有错误时关联错误文案，且发布中锁定', () => {
    actionStateMock.mockImplementation((action) => [
      {
        status: 'invalid',
        fieldErrors: {
          confirmedHighRisk: ['请确认已核对高风险变更'],
        },
      },
      action,
      true,
    ]);

    const html = renderToStaticMarkup(
      <PublishCustomerPriceBookDraftForm
        priceBookId="draft-risky"
        expectedDraftUpdatedAt="2026-08-09T00:30:00.000Z"
        defaultEffectiveFrom=""
        changeReason="修订单价"
        impact={{
          totalRuleCount: 145,
          changedItemCount: 1,
          changedRuleCount: 1,
          increasedRuleCount: 1,
          decreasedRuleCount: 0,
          highRiskRuleCount: 1,
          highRiskDeltaPercentThreshold: '50',
          deltaPercentMin: '515.4',
          deltaPercentMax: '515.4',
          validationStatus: 'PASS',
        }}
      />,
    );
    const checkbox = html.match(
      /<span[^>]*aria-label="我已逐条核对高风险变更，确认按当前新规则发布"[^>]*>/,
    )?.[0];

    expect(checkbox).toContain('aria-invalid="true"');
    expect(checkbox).toContain(
      'aria-describedby="confirmedHighRisk-draft-risky-error"',
    );
    expect(checkbox).toContain('data-disabled=""');
    expect(checkbox).toContain('aria-disabled="true"');
    expect(html).toContain('id="confirmedHighRisk-draft-risky-error"');
    expect(html).toContain('请确认已核对高风险变更');
  });
});

describe('CustomerPriceBookDraftRuleForm', () => {
  it('shows only processing business fields and removes imported implementation metadata', () => {
    const selectedRule = rule({ name: '空封现货基础价（A4:C4）' });
    const html = renderToStaticMarkup(
      <CustomerPriceBookDraftRuleForm
        context={ruleContext(CustomerPriceBookPurpose.PROCESSING)}
        rule={selectedRule}
      />,
    );

    expect(html).toContain('收费项目名称');
    expect(html).toContain('value="空封现货基础价"');
    expect(html).toContain('费用分类');
    expect(html).toContain('彩印加工');
    expect(html).toContain('每张含几个');
    expect(html).toContain('name="unitsPerSheet"');
    expect(html).not.toContain('>快递费</option>');
    expect(html).not.toContain('>打包耗材</option>');
    expect(html).not.toContain('物流首重/续重');
    expect(html).not.toContain('高级条件与审计信息');
    expect(html).not.toContain('规则代码');
    expect(html).not.toContain('RULE-CODE-1');
    expect(html).not.toContain('SHA-256');
    expect(html).not.toContain('触发条件（JSON）');
    expect(html).not.toContain('互斥组');
    expect(html).not.toContain('>优先级<');
    expect(html).not.toContain('>规则说明<');
    expect(html).not.toContain('name="triggerCondition"');
    expect(html).not.toContain('name="exclusiveGroup"');
    expect(html).not.toContain('name="priority"');
    expect(html).not.toContain('name="note"');
    expect(html).toContain('min-h-11');
    expect(html).toContain('data-slot="checkbox"');
    expect(html).toContain('data-slot="checkbox-indicator"');
    expect(html).toContain(
      'name="expectedUpdatedAt" value="2026-08-09T00:30:00.000Z"',
    );
    expect(html).not.toContain('正在编辑调价草稿');
    expect(html).not.toContain('发布前不会改变当前报价或历史工单金额');
    expect(html).toContain('sticky bottom-0');
    expect(html).toContain('保存草稿');
  });

  it('保存中锁定全部共享复选框', () => {
    actionStateMock.mockImplementation((action, initial) => [
      initial,
      action,
      true,
    ]);

    const html = renderToStaticMarkup(
      <CustomerPriceBookDraftRuleForm
        context={ruleContext(CustomerPriceBookPurpose.PROCESSING)}
        rule={rule()}
      />,
    );
    const checkboxRoots =
      html.match(/<span[^>]*data-slot="checkbox"[^>]*>/g) ?? [];

    expect(checkboxRoots.length).toBeGreaterThan(0);
    for (const checkbox of checkboxRoots) {
      expect(checkbox).toContain('data-disabled=""');
      expect(checkbox).toContain('aria-disabled="true"');
    }
  });

  it('默认收起低频条件，并只向管理员展示中文工艺名称', () => {
    const html = renderToStaticMarkup(
      <CustomerPriceBookDraftRuleForm
        context={ruleContext(CustomerPriceBookPurpose.PROCESSING)}
        rule={rule({
          match: {
            ...EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
            pricingRoutes: [OrderItemPricingRoute.COLOR_PRINT],
            laminations: [OrderLamination.MATTE, OrderLamination.SOFT_TOUCH],
            craftCodes: ['COLOR_PRINT'],
            noneOfCraftCodes: ['FLAT_FOIL'],
            craftMode: 'ALL',
          },
        })}
      />,
    );
    const visibleText = html.replace(/<[^>]*>/g, ' ');

    expect(html).toMatch(
      /<details\b(?![^>]*\bopen(?:=|\s|>))[^>]*>[\s\S]*?<summary[^>]*>[\s\S]*?适用范围/,
    );
    expect(visibleText).toContain('适用工艺');
    expect(visibleText).toContain('彩印');
    expect(visibleText).toContain('平烫');
    expect(visibleText).toContain('覆膜方式');
    expect(visibleText).toContain('亚膜');
    expect(visibleText).toContain('触感膜');
    expect(visibleText).toContain('必须同时包含全部工艺');
    expect(visibleText).not.toContain('COLOR_PRINT');
    expect(visibleText).not.toContain('FLAT_FOIL');
    expect(visibleText).not.toContain('ANY');
    expect(visibleText).not.toContain('ALL');
    expect(visibleText).not.toContain('SOFT_TOUCH');
    expect(html).toContain('value="COLOR_PRINT"');
    expect(html).toContain('value="FLAT_FOIL"');
    expect(html).toContain('value="SOFT_TOUCH"');
  });

  it('展示烫金道数条件与乘算方式，不向管理员暴露内部值', () => {
    const html = renderToStaticMarkup(
      <CustomerPriceBookDraftRuleForm
        context={ruleContext(CustomerPriceBookPurpose.PROCESSING)}
        rule={rule({
          match: {
            ...EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
            pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
            foilPassCount: 3,
            perFoilPass: true,
          },
        })}
      />,
    );
    const visibleText = html.replace(/<[^>]*>/g, ' ');

    expect(visibleText).toContain('烫金精确道数（正面＋背面）');
    expect(visibleText).toContain('按实际烫金道数乘算');
    expect(html).toMatch(
      /<input[^>]*name="match\.foilPassCount"[^>]*value="3"/,
    );
    expect(html).toMatch(
      /<input[^>]*name="match\.perFoilPass"[^>]*checked=""/,
    );
    expect(visibleText).not.toMatch(
      /STOCK_BLANK|CUSTOM_SINGLE_FLAT_FOIL|COLOR_PRINT|foilPassCount|perFoilPass/,
    );
  });

  it('shows the safe sheet-capacity field without exposing matcher JSON', () => {
    const html = renderToStaticMarkup(
      <CustomerPriceBookDraftRuleForm
        context={ruleContext(CustomerPriceBookPurpose.PROCESSING)}
        rule={rule({
          calculationType: CustomerPriceCalculationType.PER_SHEET,
          unitsPerSheet: 4,
        })}
      />,
    );
    const input = html.match(
      /<input[^>]*name="unitsPerSheet"[^>]*>/,
    )?.[0];

    expect(input).toContain('type="number"');
    expect(input).toContain('value="4"');
    expect(input).toContain('min="1"');
    expect(input).toContain('step="1"');
    expect(html).toContain('选择“按张”计价时必填');
    expect(html).not.toContain('name="triggerCondition"');
  });

  it('offers only the three new-order pricing routes and shows historical manual rules read-only', () => {
    const html = renderToStaticMarkup(
      <CustomerPriceBookDraftRuleForm
        context={ruleContext(CustomerPriceBookPurpose.PROCESSING)}
        rule={rule({
          match: {
            ...EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
            pricingRoutes: [OrderItemPricingRoute.MANUAL_QUOTE],
          },
        })}
      />,
    );

    expect(html).toContain('局部烫金（通版现货）');
    expect(html).toContain('专版烫金');
    expect(html).toContain('彩印');
    expect(html).not.toContain('空封现货');
    expect(html).not.toContain('专版单色平烫');
    expect(html).not.toContain('value="MANUAL_QUOTE"');
    expect(html).not.toContain('完全人工报价');
    expect(html).toContain('历史规则仅可查看');
  });

  it('将包装组规则限定为单款装或混装，不显示款式工艺条件', () => {
    const html = renderToStaticMarkup(
      <CustomerPriceBookDraftRuleForm
        context={ruleContext(CustomerPriceBookPurpose.PROCESSING)}
        rule={rule({
          productId: null,
          kind: CustomerPriceRuleKind.ADD_ON,
          calculationType: CustomerPriceCalculationType.PER_BAG,
          amount: '0.1',
          minQty: null,
          maxQty: null,
          match: {
            ...EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
            target: 'PACKAGING_GROUP',
            packagingModes: [OrderPackagingMode.SINGLE_STYLE],
          },
        })}
      />,
    );

    expect(html).toContain('name="match.target" value="PACKAGING_GROUP"');
    expect(html).not.toMatch(/<select[^>]*name="match\.target"/);
    expect(html).toContain('\u5305\u88c5\u6a21\u5f0f\uff08\u5fc5\u9009\uff09');
    expect(html).toMatch(
      /<input[^>]*name="match\.packagingModes"[^>]*checked=""[^>]*value="SINGLE_STYLE"/,
    );
    expect(html).toContain('\u5355\u6b3e\u88c5');
    expect(html).toContain('\u6df7\u88c5');
    expect(html).not.toContain('name="match.pricingRoutes"');
    expect(html).not.toContain('name="match.foilTechniques"');
  });

  it('将编辑错误关联到对应字段并保留业务化编辑器', () => {
    actionStateMock.mockImplementation((action) => [
      {
        status: 'invalid',
        fieldErrors: {
          amount: ['金额必须是非负数字，最多 4 位小数'],
          unitsPerSheet: ['按张计价必须填写每张含几个'],
          maxQty: ['最大数量不能小于最小数量'],
        },
      },
      action,
      false,
    ]);

    const html = renderToStaticMarkup(
      <CustomerPriceBookDraftRuleForm
        context={ruleContext(CustomerPriceBookPurpose.PROCESSING)}
        rule={rule({
          calculationType: CustomerPriceCalculationType.PER_SHEET,
        })}
      />,
    );
    const amountInput = html.match(
      /<input[^>]*name="amount"[^>]*>/,
    )?.[0];
    const maxQtyInput = html.match(
      /<input[^>]*name="maxQty"[^>]*>/,
    )?.[0];
    const unitsPerSheetInput = html.match(
      /<input[^>]*name="unitsPerSheet"[^>]*>/,
    )?.[0];

    expect(amountInput).toContain('aria-invalid="true"');
    expect(amountInput).toContain(
      'aria-describedby="price-rule-rule-1-amount-error"',
    );
    expect(maxQtyInput).toContain('aria-invalid="true"');
    expect(unitsPerSheetInput).toContain('aria-invalid="true"');
    expect(unitsPerSheetInput).toContain(
      'aria-describedby="price-rule-rule-1-unitsPerSheet-hint price-rule-rule-1-unitsPerSheet-error"',
    );
    expect(html).toContain('id="price-rule-rule-1-amount-error"');
    expect(html).toContain('id="price-rule-rule-1-unitsPerSheet-error"');
    expect(html).toContain('id="price-rule-rule-1-maxQty-error"');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('触发条件（JSON）');
    expect(html).not.toContain('SHA-256');
  });

  it('适用条件报错时自动展开高级区域', () => {
    actionStateMock.mockImplementation((action) => [
      {
        status: 'invalid',
        fieldErrors: {
          'match.craftCodes': ['请重新选择适用工艺'],
        },
      },
      action,
      false,
    ]);

    const html = renderToStaticMarkup(
      <CustomerPriceBookDraftRuleForm
        context={ruleContext(CustomerPriceBookPurpose.PROCESSING)}
        rule={rule()}
      />,
    );

    expect(html).toMatch(
      /<details\b[^>]*\bopen=""[^>]*>[\s\S]*?适用范围/,
    );
    expect(html).toContain('请重新选择适用工艺');
    expect(html).toContain('id="price-rule-rule-1-craftCodes-error"');
  });

  it('将高级匹配错误关联到只读计价对象和复选项', () => {
    actionStateMock.mockImplementation((action) => [
      {
        status: 'invalid',
        fieldErrors: {
          'match.target': ['请重新选择计价对象'],
          'match.packagingModes': ['请选择包装模式'],
        },
      },
      action,
      false,
    ]);

    const html = renderToStaticMarkup(
      <CustomerPriceBookDraftRuleForm
        context={ruleContext(CustomerPriceBookPurpose.PROCESSING)}
        rule={rule({
          match: {
            ...EMPTY_CUSTOMER_RULE_CONDITION_EDITOR_INPUT,
            target: 'PACKAGING_GROUP',
            packagingModes: [OrderPackagingMode.SINGLE_STYLE],
          },
        })}
      />,
    );
    const packagingCheckbox = html.match(
      /<span[^>]*role="checkbox"[^>]*aria-label="单款装"[^>]*>/,
    )?.[0];

    expect(html).toContain('name="match.target" value="PACKAGING_GROUP"');
    expect(html).not.toMatch(/<select[^>]*name="match\.target"/);
    expect(html).toContain('id="price-rule-rule-1-match.target-error"');
    expect(packagingCheckbox).toContain('aria-invalid="true"');
    expect(packagingCheckbox).toContain(
      'aria-describedby="price-rule-rule-1-packagingModes-error"',
    );
  });

  it('并发修改冲突时提供刷新恢复入口且不移除版本锁', () => {
    actionStateMock.mockImplementation((action) => [
      {
        status: 'error',
        message: '该规则已被其他管理员修改，请刷新后重试',
      },
      action,
      false,
    ]);

    const html = renderToStaticMarkup(
      <CustomerPriceBookDraftRuleForm
        context={ruleContext(CustomerPriceBookPurpose.PROCESSING)}
        rule={rule()}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('刷新最新内容');
    expect(html).toContain('刷新后请核对其他管理员的修改');
    expect(html).toContain(
      'name="expectedUpdatedAt" value="2026-08-09T00:30:00.000Z"',
    );
  });

  it('保存成功后通过 status 播报草稿状态', () => {
    actionStateMock.mockImplementation((action) => [
      { status: 'success', priceBookId: 'draft-1', ruleId: 'rule-1' },
      action,
      false,
    ]);

    const html = renderToStaticMarkup(
      <CustomerPriceBookDraftRuleForm
        context={ruleContext(CustomerPriceBookPurpose.PROCESSING)}
        rule={rule()}
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('草稿已保存。');
  });

  it('保存成功后跳到不受旧筛选条件影响的详情地址', () => {
    actionStateMock.mockImplementation((action) => [
      { status: 'success', priceBookId: 'draft-1', ruleId: 'rule-1' },
      action,
      false,
    ]);
    effectMock.mockImplementation((effect: () => void) => effect());
    const successHref = `${RULE_CENTER_HREFS.customerPricing}?purpose=processing&item=rule-1#selected-charge-detail`;

    renderToStaticMarkup(
      <CustomerPriceBookDraftRuleForm
        context={ruleContext(CustomerPriceBookPurpose.PROCESSING)}
        rule={rule()}
        successHref={successHref}
      />,
    );

    expect(replaceMock).toHaveBeenCalledWith(successHref);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not show shipping weight fields for a packing-material rule', () => {
    const packingRule = rule({
      categoryId: 'packing-category',
      categoryName: '打包耗材',
      productId: null,
      kind: CustomerPriceRuleKind.REFERENCE,
      blocksAutomaticQuote: true,
      editorMode: 'PACKAGING',
    });
    const html = renderToStaticMarkup(
      <CustomerPriceBookDraftRuleForm
        context={ruleContext(CustomerPriceBookPurpose.LOGISTICS)}
        rule={packingRule}
      />,
    );

    expect(html).toContain('打包耗材');
    expect(html).toContain('最小数量');
    expect(html).toContain('最大数量');
    expect(html).toContain('金额（元）');
    expect(html).toContain('启用此规则');
    expect(html).not.toContain('物流首重/续重');
    expect(html).not.toContain('>适用产品<');
    expect(html).not.toContain('>规则类型<');
    expect(html).not.toContain('>计价方式<');
    expect(html).not.toContain('阻断自动报价');
    expect(html).not.toContain('>触发条件（JSON）<');
    expect(html).not.toContain('>互斥组<');
    expect(html).not.toContain('>优先级<');
    expect(html).not.toContain('name="kind"');
    expect(html).not.toContain('name="blocksAutomaticQuote"');
    expect(html).not.toContain('name="unitsPerSheet"');
    expect(html).not.toContain('name="triggerCondition"');
  });

  it('shows first-weight and increment fields only for shipping rules', () => {
    const shippingRule = rule({
      categoryId: 'shipping-category',
      categoryName: '快递费',
      productId: null,
      kind: CustomerPriceRuleKind.ADD_ON,
      amount: '2.8',
      includedUnits: '1',
      incrementUnits: '1',
      incrementAmount: '1.5',
      editorMode: 'SHIPPING',
      shippingScopeLabel: '中通 · 广东',
    });
    const html = renderToStaticMarkup(
      <CustomerPriceBookDraftRuleForm
        context={ruleContext(CustomerPriceBookPurpose.LOGISTICS)}
        rule={shippingRule}
      />,
    );

    expect(html).toContain('物流首重/续重');
    expect(html).toContain('首重单位（kg）');
    expect(html).toContain('续重单位（kg）');
    expect(html).toContain('续重金额（元）');
    expect(html).toContain('适用地区');
    expect(html).toContain('中通 · 广东');
    expect(html).toContain('启用此规则');
    expect(html).not.toContain('>适用产品<');
    expect(html).not.toContain('>最小数量<');
    expect(html).not.toContain('>最大数量<');
    expect(html).not.toContain('>规则类型<');
    expect(html).not.toContain('>计价方式<');
    expect(html).not.toContain('name="unitsPerSheet"');
    expect(html).not.toContain('阻断自动报价');
    expect(html).not.toContain('>互斥组<');
    expect(html).not.toContain('>优先级<');
    expect(html).not.toContain('JSON');
    expect(html).not.toContain('RULE-CODE-1');
    expect(html).not.toContain('SHA-256');
  });
});
