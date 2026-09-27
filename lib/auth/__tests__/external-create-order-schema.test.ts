import { describe, expect, it } from 'vitest';
import {
  externalCreateOrderDraftSchema,
  externalCreateOrderIssues,
  externalCreateOrderSubmitSchema,
  type ExternalCreateOrderSubmitInput,
} from '../external-create-order-schema';

function validInput(): ExternalCreateOrderSubmitInput {
  return {
    clientSubmissionId: '94e83491-f3a6-49f9-8f2f-3bf87c46d73a',
    customName: '新年款',
    customerPartyId: null,
    customerRef: null,
    receiverName: '张三',
    receiverPhone: '13800138000',
    receiverAddress: '上海市浦东新区测试路 1 号',
    destinationProvince: '上海',
    isSfCollect: false,
    packRaw: '十个一包',
    remark: null,
    styles: [
      {
        fig: 1,
        craft: 'PARTIAL',
        productId: 'product-1',
        paperType: '珠光艳闪',
        weight: 160,
        specification: '大号封',
        widthMm: 230,
        heightMm: 120,
        quantity: 1000,
        frontColors: ['亚金'],
        backColors: [],
        printFoilMode: 'NONE',
        foilTechnique: 'FLAT',
        lamination: 'NONE',
        pack: 10,
        remark: null,
      },
    ],
  };
}

describe('external create-order command contract', () => {
  it('accepts canonical business facts without derived counts', () => {
    const result = externalCreateOrderSubmitSchema.safeParse(validInput());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.styles[0]).not.toHaveProperty('colorCount');
    expect(result.data.styles[0]).not.toHaveProperty('sideCount');
  });

  it('keeps accepting the retired customer keys without validating them (业主 2026-09-27)', () => {
    const { customerPartyId: _party, customerRef: _ref, ...withoutCustomer } = validInput();
    expect([_party, _ref]).toEqual([null, null]);
    expect(externalCreateOrderSubmitSchema.safeParse(withoutCustomer).success).toBe(true);
    expect(externalCreateOrderSubmitSchema.safeParse({
      ...validInput(), customerPartyId: 'x'.repeat(200), customerRef: '客'.repeat(200),
    }).success).toBe(true);
  });

  it('rejects client supplied price, version and status facts', () => {
    const input = {
      ...validInput(),
      quotedFee: '180.00',
      priceVersion: 9,
      status: 'PENDING_FACTORY',
    };
    expect(externalCreateOrderSubmitSchema.safeParse(input).success).toBe(false);
  });

  it('keeps null pack in drafts but requires it at final submit', () => {
    const input = validInput();
    input.styles[0]!.pack = null;
    expect(externalCreateOrderDraftSchema.safeParse(input).success).toBe(true);
    const submitted = externalCreateOrderSubmitSchema.safeParse(input);
    expect(submitted.success).toBe(false);
    if (submitted.success) return;
    expect(externalCreateOrderIssues(submitted.error, input)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fig: 1, path: ['styles', 0, 'pack'] }),
      ]),
    );
  });

  // DECISIONS 2026-08-27：彩印反面烫金（叠加局部或专版）是合法事实，由计价引擎转人工核价。
  it('allows print plus partial or full foil on the back', () => {
    const partial = validInput();
    partial.styles[0] = {
      ...partial.styles[0]!,
      craft: 'PRINT',
      printFoilMode: 'PARTIAL',
      backColors: ['银色'],
    };
    expect(externalCreateOrderSubmitSchema.safeParse(partial).success).toBe(true);

    const full = {
      ...partial,
      styles: [{ ...partial.styles[0]!, printFoilMode: 'FULL' as const }],
    };
    expect(externalCreateOrderSubmitSchema.safeParse(full).success).toBe(true);
  });

  it('rejects duplicate fig values and reports the affected fig', () => {
    const input = validInput();
    input.styles.push({ ...input.styles[0]!, fig: 1 });
    const result = externalCreateOrderSubmitSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(externalCreateOrderIssues(result.error, input)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fig: 1, message: '款式编号 1 重复' }),
      ]),
    );
  });
});
