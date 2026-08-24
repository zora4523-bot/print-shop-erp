import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerPriceCalculationType } from '@/generated/prisma/enums';

const {
  actionStateMock,
  effectMock,
  refreshMock,
  replaceMock,
} = vi.hoisted(() => ({
  actionStateMock: vi.fn(),
  effectMock: vi.fn(),
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: actionStateMock,
    useEffect: effectMock,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: replaceMock }),
}));

import {
  ExternalSalesPriceTierGroupEditor,
  applyExternalSalesTierPercentAdjustment,
  countExternalSalesTierDraftChanges,
  createExternalSalesTierDraftState,
  externalSalesPriceTierSaveInputFromFormData,
  formatDraftAmountDelta,
  undoExternalSalesTierDraftChange,
  type ExternalSalesPriceTier,
  type ExternalSalesPriceTierGroupEditorProps,
} from '../ExternalSalesPriceTierGroupEditor';

function tier(
  quantity: number,
  currentAmount: string,
  draftAmount = currentAmount,
  overrides: Partial<ExternalSalesPriceTier> = {},
): ExternalSalesPriceTier {
  return {
    ruleId: `private-rule-${quantity}`,
    quantity,
    currentAmount,
    draftAmount,
    expectedUpdatedAt: `2026-08-12T00:00:0${quantity % 10}.000Z`,
    isActive: true,
    changed: currentAmount !== draftAmount,
    ...overrides,
  };
}

const sevenTiers = [
  tier(1_000, '295'),
  tier(2_000, '420'),
  tier(3_000, '530'),
  tier(4_000, '680'),
  tier(5_000, '800'),
  tier(10_000, '1400'),
  tier(20_000, '2300'),
];

function props(
  overrides: Partial<ExternalSalesPriceTierGroupEditorProps> = {},
): ExternalSalesPriceTierGroupEditorProps {
  return {
    productTitle: '157克双铜纸彩印',
    paperLabel: '157克双铜纸',
    sizeLabel: '大号',
    calculationType: CustomerPriceCalculationType.FIXED_AMOUNT,
    priceBookId: 'private-draft-book',
    anchorRuleId: 'private-rule-1000',
    tiers: sevenTiers,
    saveAction: vi
      .fn()
      .mockResolvedValue({ status: 'success', priceBookId: 'private-draft-book' }),
    successHref:
      '/owner/prices/external-sales/items?purpose=processing&item=selected',
    ...overrides,
  };
}

let capturedAction:
  | ((previous: unknown, formData: FormData) => Promise<unknown>)
  | undefined;

beforeEach(() => {
  capturedAction = undefined;
  actionStateMock.mockReset();
  effectMock.mockReset();
  refreshMock.mockReset();
  replaceMock.mockReset();
  effectMock.mockImplementation(() => undefined);
  actionStateMock.mockImplementation((action, initialState) => {
    capturedAction = action;
    return [initialState, vi.fn(), false];
  });
});

describe('ExternalSalesPriceTierGroupEditor', () => {
  it('将同一产品的数量档合并为一个无重复标题的编辑器', () => {
    const html = renderToStaticMarkup(
      <ExternalSalesPriceTierGroupEditor {...props()} />,
    );

    expect(html.match(/157克双铜纸彩印/g)).toHaveLength(1);
    expect(html).toContain('157克双铜纸');
    expect(html).toContain('大号');
    expect(html).toContain('7 个数量档');
    expect(html).toContain('1,000 个');
    expect(html).toContain('20,000 个');
    expect(html.match(/name="tierAmount-\d"/g)).toHaveLength(7);
    expect(html).toContain('¥295');
    expect(html).toContain('折合单价会按数量档自动计算');
    expect(html).toContain('保存本组（0 档待保存）');
    expect(html).toContain('aria-label="1,000 个价格档启用"');
    expect(html).toContain('>当前<');
    expect(html).toContain('>草稿<');
    expect(html).toContain('>变化<');
    expect(html).toContain('启用');
    expect(html).toContain('撤销上一步');
    expect(html).toContain('放弃本地修改');
    expect(html).not.toContain('1,000 个草稿总价（元）');
  });

  it('shows amount and percent delta when the draft differs from the current price', () => {
    const html = renderToStaticMarkup(
      <ExternalSalesPriceTierGroupEditor
        {...props({ tiers: [tier(1_000, '100', '105.8')] })}
      />,
    );

    expect(html).toContain('+¥5.8');
    expect(html).toContain('+5.8%');
    expect(html).not.toContain('未修改');
    expect(formatDraftAmountDelta('100', '100')).toEqual({
      kind: 'none',
      amountLabel: '未修改',
      percentLabel: '',
    });
    expect(formatDraftAmountDelta('100', '97')).toEqual({
      kind: 'down',
      amountLabel: '−¥3',
      percentLabel: '−3%',
    });
  });

  it('固定金额明确显示总价，折合单价说明只出现一次', () => {
    const html = renderToStaticMarkup(
      <ExternalSalesPriceTierGroupEditor
        {...props({ tiers: [tier(1_000, '295', '310')] })}
      />,
    );

    expect(html).toContain('整批固定总价');
    expect(html).toContain('当前总价');
    expect(html).toContain('草稿总价（元）');
    expect(html).toContain('¥295 / 批');
    expect(html).toContain('折合单价会按数量档自动计算');
    expect(html).not.toContain('¥0.31 / 个');
    expect(html).toContain('修改每档整批总价');
  });

  it('按个计价显示元每个，不将 amount 再除以数量', () => {
    const html = renderToStaticMarkup(
      <ExternalSalesPriceTierGroupEditor
        {...props({
          calculationType: CustomerPriceCalculationType.PER_PIECE,
          tiers: [tier(1_000, '0.295', '0.31')],
        })}
      />,
    );

    expect(html).toContain('按个计价');
    expect(html).toContain('当前单价');
    expect(html).toContain('草稿单价（元/个）');
    expect(html).toContain('¥0.295 / 个');
    expect(html).toContain('每个成品');
    expect(html).toContain('不会将单价再除以数量');
    expect(html).toContain('保存本组（0 档待保存）');
    expect(html).not.toContain('¥0.0003');
    expect(html).not.toContain('折合单价');
    expect(html).not.toContain('当前总价');
  });

  it.each([
    [
      CustomerPriceCalculationType.PER_SHEET,
      '按张计价',
      '元/张',
      '¥1.25 / 张',
    ],
    [
      CustomerPriceCalculationType.PER_10K,
      '每万个计价',
      '元/万个',
      '¥1.25 / 万个',
    ],
    [
      CustomerPriceCalculationType.PER_ITEM,
      '每款一次',
      '元/款',
      '¥1.25 / 款',
    ],
  ])(
    '其他计价类型 %s 诚实显示自己的单位',
    (calculationType, label, unit, amount) => {
      const html = renderToStaticMarkup(
        <ExternalSalesPriceTierGroupEditor
          {...props({
            calculationType,
            tiers: [tier(1_000, '1.25')],
          })}
        />,
      );

      expect(html).toContain(label);
      expect(html).toContain(unit);
      expect(html).toContain(amount);
      expect(html).not.toContain('折合单价');
    },
  );

  it('只在提交时组装完整批次，页面不暴露规则标识和并发时间戳', async () => {
    const saveAction = vi
      .fn()
      .mockResolvedValue({ status: 'success', priceBookId: 'private-draft-book' });
    const html = renderToStaticMarkup(
      <ExternalSalesPriceTierGroupEditor
        {...props({ tiers: sevenTiers.slice(0, 2), saveAction })}
      />,
    );

    expect(html).not.toContain('private-rule-1000');
    expect(html).not.toContain('2026-08-12T00:00:00.000Z');
    expect(html).not.toContain('ruleId');
    expect(html).not.toContain('expectedUpdatedAt');
    expect(html).not.toContain('JSON');
    expect(html).not.toContain('SHA-256');
    expect(html).not.toContain('来源单元格');

    const formData = new FormData();
    formData.set('tierAmount-0', '305.5');
    formData.set('tierAmount-1', ' 430 ');
    expect(capturedAction).toBeTypeOf('function');
    await capturedAction?.(null, formData);

    expect(saveAction).toHaveBeenCalledWith({
      priceBookId: 'private-draft-book',
      anchorRuleId: 'private-rule-1000',
      rows: [
        {
          ruleId: 'private-rule-1000',
          amount: '305.5',
          expectedUpdatedAt: '2026-08-12T00:00:00.000Z',
          isActive: true,
        },
        {
          ruleId: 'private-rule-2000',
          amount: '430',
          expectedUpdatedAt: '2026-08-12T00:00:00.000Z',
          isActive: true,
        },
      ],
    });
  });

  it('客户端校验任意金额失败时不提交任何一行', async () => {
    const saveAction = vi
      .fn()
      .mockResolvedValue({ status: 'success', priceBookId: 'private-draft-book' });
    renderToStaticMarkup(
      <ExternalSalesPriceTierGroupEditor
        {...props({ tiers: sevenTiers.slice(0, 2), saveAction })}
      />,
    );
    const formData = new FormData();
    formData.set('tierAmount-0', '305');
    formData.set('tierAmount-1', '-1');

    const result = await capturedAction?.(null, formData);

    expect(saveAction).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'invalid',
      fieldErrors: {
        'rows.1.amount': ['金额必须是非负数字，最多 4 位小数'],
      },
    });
  });

  it('关联逐行错误、整组错误摘要和无障碍状态', () => {
    actionStateMock.mockImplementation((action) => {
      capturedAction = action;
      return [
        {
          status: 'invalid',
          fieldErrors: {
            'rows.1.amount': ['2,000 个的金额格式不正确'],
          },
        },
        vi.fn(),
        false,
      ];
    });

    const html = renderToStaticMarkup(
      <ExternalSalesPriceTierGroupEditor
        {...props({ tiers: sevenTiers.slice(0, 2) })}
      />,
    );
    const invalidInput = html.match(
      /<input[^>]*name="tierAmount-1"[^>]*>/,
    )?.[0];

    expect(html).toContain('role="alert"');
    expect(html).toContain('2,000 个的金额格式不正确');
    expect(invalidInput).toContain('aria-invalid="true"');
    expect(invalidInput).toMatch(/aria-describedby="[^"]+-error"/);
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('aria-busy="false"');
  });

  it('在保存中禁用提交，成功与服务端失败使用正确的播报区域', () => {
    actionStateMock.mockImplementation((action) => {
      capturedAction = action;
      return [null, vi.fn(), true];
    });
    const pendingHtml = renderToStaticMarkup(
      <ExternalSalesPriceTierGroupEditor
        {...props({ tiers: sevenTiers.slice(0, 1) })}
      />,
    );
    expect(pendingHtml).toContain('aria-busy="true"');
    expect(pendingHtml).toContain('正在原子保存本组总价…');
    expect(pendingHtml).toMatch(/<button[^>]*disabled=""[^>]*>/);

    actionStateMock.mockImplementation((action) => {
      capturedAction = action;
      return [
        { status: 'success', priceBookId: 'private-draft-book' },
        vi.fn(),
        false,
      ];
    });
    const successHtml = renderToStaticMarkup(
      <ExternalSalesPriceTierGroupEditor
        {...props({ tiers: sevenTiers.slice(0, 1) })}
      />,
    );
    expect(successHtml).toContain('role="status"');
    expect(successHtml).toContain('这一组总价已全部保存');

    actionStateMock.mockImplementation((action) => {
      capturedAction = action;
      return [
        { status: 'error', message: '价格已被其他管理员修改，请刷新后重试' },
        vi.fn(),
        false,
      ];
    });
    const errorHtml = renderToStaticMarkup(
      <ExternalSalesPriceTierGroupEditor
        {...props({ tiers: sevenTiers.slice(0, 1) })}
      />,
    );
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain('价格已被其他管理员修改');
    expect(errorHtml).toContain('刷新最新价格');
    expect(errorHtml).not.toMatch(
      /role="alert"[^>]*>[\s\S]*刷新最新价格[\s\S]*<\/p>/,
    );
  });

  it('使用窄屏纵向卡片与可收缩网格，不需要水平裁切容器', () => {
    const html = renderToStaticMarkup(
      <ExternalSalesPriceTierGroupEditor
        {...props({ tiers: sevenTiers.slice(0, 1) })}
      />,
    );

    expect(html).toContain('min-w-0');
    expect(html).toContain('@container');
    expect(html).toContain('@min-[31rem]:grid-cols-[');
    expect(html).toContain('w-full');
    expect(html).toContain('@min-[31rem]:w-auto');
    expect(html).toContain('pb-[max(1rem,env(safe-area-inset-bottom))]');
    expect(html).not.toContain('overflow-x-auto');
    expect(html).not.toContain('min-w-max');
  });

  it('keeps four-decimal money exact without IEEE-754 display drift', () => {
    const preciseTier = tier(3, '9999999999.9999');
    const html = renderToStaticMarkup(
      <ExternalSalesPriceTierGroupEditor
        {...props({ tiers: [preciseTier] })}
      />,
    );

    expect(html).toContain('¥9,999,999,999.9999');
    expect(html).toContain('折合单价会按数量档自动计算');
  });
});

describe('externalSalesPriceTierSaveInputFromFormData', () => {
  it('保留金额精度并为每行带上并发保护数据', () => {
    const formData = new FormData();
    formData.set('tierAmount-0', '295.1250');

    expect(
      externalSalesPriceTierSaveInputFromFormData(
        'private-draft-book',
        'private-rule-1000',
        sevenTiers.slice(0, 1),
        formData,
        [false],
      ),
    ).toEqual({
      success: true,
      input: {
        priceBookId: 'private-draft-book',
        anchorRuleId: 'private-rule-1000',
        rows: [
          {
            ruleId: 'private-rule-1000',
            amount: '295.1250',
            expectedUpdatedAt: '2026-08-12T00:00:00.000Z',
            isActive: false,
          },
        ],
      },
    });
  });
});

describe('阶梯价本地编辑状态', () => {
  it('批量百分比只修改启用档，并保持 Decimal 输入精度', () => {
    const result = applyExternalSalesTierPercentAdjustment(
      {
        amounts: ['1000', '2000', '300'],
        activeStates: [true, false, true],
      },
      '5.8',
    );

    expect(result).toEqual({
      success: true,
      state: {
        amounts: ['1058', '2000', '317.4'],
        activeStates: [true, false, true],
      },
    });
  });

  it.each([
    ['', '请输入调整百分比'],
    ['1.23456', '请输入有效百分比，最多 4 位小数'],
    ['-100', '降价幅度必须大于 -100%'],
  ])('百分比 %j 给出可操作的行内错误', (input, message) => {
    expect(
      applyExternalSalesTierPercentAdjustment(
        { amounts: ['100'], activeStates: [true] },
        input,
      ),
    ).toEqual({ success: false, message });
  });

  it('停用档的无效金额不会阻断启用档批量调整', () => {
    expect(
      applyExternalSalesTierPercentAdjustment(
        { amounts: ['100', '待设置'], activeStates: [true, false] },
        '5',
      ),
    ).toEqual({
      success: true,
      state: {
        amounts: ['105', '待设置'],
        activeStates: [true, false],
      },
    });
  });

  it('撤销恢复同一步中的金额与启用状态', () => {
    const first = {
      amounts: ['100', '200'],
      activeStates: [true, false],
    };
    const second = {
      amounts: ['110', '200'],
      activeStates: [false, false],
    };

    expect(undoExternalSalesTierDraftChange([first, second])).toEqual({
      state: second,
      history: [first],
    });
    expect(undoExternalSalesTierDraftChange([])).toBeNull();
  });

  it('待保存档数同时统计金额和启用状态变更', () => {
    const tiers = [tier(1_000, '100'), tier(2_000, '200')];
    const initial = createExternalSalesTierDraftState(tiers);
    expect(countExternalSalesTierDraftChanges(initial, tiers)).toBe(0);
    expect(
      countExternalSalesTierDraftChanges(
        {
          amounts: ['101', '200'],
          activeStates: [true, false],
        },
        tiers,
      ),
    ).toBe(2);
  });
});
