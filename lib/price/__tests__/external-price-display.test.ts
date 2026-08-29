import { describe, expect, it } from 'vitest';
import {
  externalPriceBusinessText,
  externalPriceRuleDisplayName,
} from '../external-price-display';

describe('external price business display text', () => {
  it.each([
    ['纸张未标（烫金!B13/B7/B6）', '纸张未标'],
    ['纸张未标 (烫金!B13/B7/B6)', '纸张未标'],
    ['纸张未标 烫金!B13/B7/B6', '纸张未标'],
    ["纸张未标；'专版 烫金'!$B$13/$B$7", '纸张未标；'],
    ['空封现货基础价（A4:C4）', '空封现货基础价'],
  ])('移除导入来源标识：%s', (input, expected) => {
    expect(externalPriceBusinessText(input)).toBe(expected);
  });

  it.each(['A4', 'A4 规格', '信封（A4）', 'A4（210×297mm）'])(
    '保留正常业务规格：%s',
    (value) => {
      expect(externalPriceBusinessText(value)).toBe(value);
    },
  );

  it.each([
    ['外部销售加工费报价单', '客户加工费报价单'],
    ['内部兼容价格', '历史价格'],
    ['价格快照明细', '已保存价格明细'],
    ['计价快照', '已保存价格'],
  ])('将旧术语转为业务文案：%s', (input, expected) => {
    expect(externalPriceBusinessText(input)).toBe(expected);
  });

  it('为只包含来源标识的规则名提供业务兜底名称', () => {
    expect(externalPriceRuleDisplayName('（烫金!B13/B7/B6）')).toBe(
      '未命名收费项目',
    );
  });
});
