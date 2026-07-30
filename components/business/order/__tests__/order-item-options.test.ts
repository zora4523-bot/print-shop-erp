import { describe, expect, it } from 'vitest';
import {
  ORDER_FOIL_COLOR_OPTIONS,
  ORDER_PAPER_OPTIONS,
  ORDER_SPECIFICATION_OPTIONS,
} from '../order-item-options';

describe('order item quick options', () => {
  it('keeps all requested specifications in common-first order', () => {
    expect(ORDER_SPECIFICATION_OPTIONS.map((option) => option.value)).toEqual([
      '迷你',
      '大号',
      '中号',
      '方形',
      '万元封',
      '大号西封',
    ]);
  });

  it('contains the complete paper catalog without duplicates', () => {
    const values = ORDER_PAPER_OPTIONS.map((option) => option.value);
    expect(values).toEqual([
      '艳红珠光纸',
      '暗红珠光纸',
      '触感纸',
      '铜版纸',
      '冰白纸',
      '红卡纸',
      '金葱纸',
      '紫色珠光纸',
      '黄色珠光纸',
      '米金珠光纸',
      '酒红',
      '玫红',
      '粉色',
      '莱尼纹',
    ]);
    expect(new Set(values).size).toBe(values.length);
  });

  it('contains every foil color plus the explicit pure-print option', () => {
    expect(ORDER_FOIL_COLOR_OPTIONS.map((option) => option.value)).toEqual([
      '哑金',
      '浅金',
      '红金',
      '黑金',
      '银色',
      '黄金',
      '蓝金',
      '透明金',
      '无颜色（纯彩印）',
    ]);
  });
});
