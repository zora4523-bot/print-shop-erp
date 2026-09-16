import { expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ db: {} }));
import { foilFeeData } from '../foil-wage-admin';
import { pieceworkDraftSchema } from '../piecework-admin-input';
import { calculatePieceworkRuleSetSha256, parsePieceworkPriceBookManifest } from '../piecework-price-book-admin';
const input = pieceworkDraftSchema.parse({ version: 1, updatedAt: '2026-09-17T00:00:00Z', partial: '0.007', full: '0.01', bag: '', box: '', sourceName: '', publishNote: '', effectiveFrom: '', partialSmall: '12', partialSetup: '5', fullSmall: '20', fullSetup: '10' });
it('局部、专版金额分开保存，包装不带烫金费', () => {
  expect(foilFeeData(input, 'PARTIAL').smallOrderAmount?.toFixed(4)).toBe('12.0000');
  expect(foilFeeData(input, 'FULL').setupAmount?.toFixed(4)).toBe('10.0000');
  expect(foilFeeData(input, 'PACKING')).toEqual({ smallOrderAmount: null, setupAmount: null });
});
it('小单金额与装版费必须同时填写', () => {
  expect(() => foilFeeData({ ...input, partialSetup: '' }, 'PARTIAL')).toThrow('同时填写');
  expect(foilFeeData({ ...input, partialSmall: '0', partialSetup: '0' }, 'PARTIAL').smallOrderAmount?.toString()).toBe('0');
});
it('费用进入价格摘要且金额格式不改变摘要', () => {
  const rule = { operationType: 'PARTIAL' as const, unit: 'PER_PASS' as const, amount: '0.0070', smallOrderAmount: '12', setupAmount: '5' };
  expect(calculatePieceworkRuleSetSha256([rule])).toBe(calculatePieceworkRuleSetSha256([{ ...rule, smallOrderAmount: '12.0000', setupAmount: '5.0000' }]));
  expect(calculatePieceworkRuleSetSha256([rule])).not.toBe(calculatePieceworkRuleSetSha256([{ ...rule, setupAmount: '6' }]));
});
it('发布文件接受成对的烫金金额', () => {
  const manifest = { schemaVersion: 1, priceBookVersion: 1, effectiveFrom: null, sourceName: '用户确认', publishNote: '分档工资', rules: [{ operationType: 'FULL', unit: 'PER_PIECE', amount: '0.01', smallOrderAmount: '20', setupAmount: '10' }] };
  expect(parsePieceworkPriceBookManifest(manifest).rules[0]).toMatchObject({ smallOrderAmount: '20', setupAmount: '10' });
});
