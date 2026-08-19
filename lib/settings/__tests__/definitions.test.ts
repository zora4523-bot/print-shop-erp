import { describe, it, expect } from 'vitest';
import {
  RETIRED_SETTING_KEYS,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  formatSettingForInput,
  isSettingKey,
  parseSettingInput,
  resolveSetting,
} from '../definitions';

describe('SETTING_DEFINITIONS', () => {
  it('每一项的兜底值都能通过自己的 schema', () => {
    // 这条是真门禁而不是形式主义：resolveSetting 在校验失败时返回 fallback，
    // 一个不合法的 fallback 会被永远静默返回，而且写入侧用同一份 schema，
    // 业主根本无法把它改回合法值。
    for (const key of SETTING_KEYS) {
      const definition = SETTING_DEFINITIONS[key];
      const parsed = definition.schema.safeParse(definition.fallback);
      expect(parsed.success, `${key} 的 fallback 不合法`).toBe(true);
    }
  });

  it('每一项的 field.name 都是 schema 里真实存在的字段', () => {
    // field.name 写错时，parseSettingInput 会构造出 { 错的字段: 值 }，
    // schema 报「缺字段」，业主填什么都存不进去。
    for (const key of SETTING_KEYS) {
      const { field, fallback } = SETTING_DEFINITIONS[key];
      expect(Object.hasOwn(fallback as object, field.name), key).toBe(true);
    }
  });

  it('退役 key 不能和在用 key 重叠', () => {
    for (const retired of RETIRED_SETTING_KEYS) {
      expect(SETTING_KEYS).not.toContain(retired);
    }
  });

  it('isSettingKey 只认在用的 key', () => {
    expect(isSettingKey('factory_name')).toBe(true);
    expect(isSettingKey('order_no_prefix')).toBe(false);
    expect(isSettingKey('__proto__')).toBe(false);
  });
});

describe('resolveSetting', () => {
  it('解出库里存的合法值', () => {
    expect(resolveSetting('factory_name', { name: '示例印刷厂' })).toEqual({
      name: '示例印刷厂',
    });
    expect(resolveSetting('outsource_overdue_days', { days: 7 })).toEqual({
      days: 7,
    });
  });

  it.each([
    ['行不存在', undefined],
    ['值是 null', null],
    ['形状不对', { hours: 24 }],
    ['类型不对', { name: 123 }],
    ['空字符串', { name: '   ' }],
    ['超长', { name: 'x'.repeat(41) }],
  ])('%s 时退回内置默认值而不是抛错', (_label, raw) => {
    // 这三项都不碰金额，让一行改坏的配置把开单/打印/推送打挂才是事故。
    // 与 §15.5「没有生效规则就拒绝继续」的取向不同是刻意的，见 definitions.ts。
    expect(resolveSetting('factory_name', raw)).toEqual(
      SETTING_DEFINITIONS.factory_name.fallback,
    );
  });

  it('超出范围的数值也退回默认值', () => {
    expect(resolveSetting('cdr_link_expire_hours', { hours: 0 })).toEqual({
      hours: 24,
    });
    expect(resolveSetting('cdr_link_expire_hours', { hours: 999 })).toEqual({
      hours: 24,
    });
    expect(resolveSetting('cdr_link_expire_hours', { hours: 1.5 })).toEqual({
      hours: 24,
    });
  });
});

describe('parseSettingInput', () => {
  it('文本项去掉首尾空白', () => {
    const result = parseSettingInput('factory_name', '  佛山红包印刷厂  ');
    expect(result).toEqual({ ok: true, value: { name: '佛山红包印刷厂' } });
  });

  it('文本项拒绝空值和超长', () => {
    expect(parseSettingInput('factory_name', '   ').ok).toBe(false);
    expect(parseSettingInput('factory_name', 'x'.repeat(41)).ok).toBe(false);
  });

  it('整数项把字符串转成 number 再校验', () => {
    expect(parseSettingInput('outsource_overdue_days', '7')).toEqual({
      ok: true,
      value: { days: 7 },
    });
  });

  it.each([
    ['空字符串', ''],
    ['非数字', '七天'],
    ['带单位', '7天'],
    ['小数', '1.5'],
    ['负数', '-1'],
  ])('整数项拒绝 %s', (_label, raw) => {
    // Number('') === 0、Number('7天') === NaN：直接丢给 zod 会分别变成
    // 「悄悄存成 0」和一句看不懂的 NaN 报错，所以先自己挡一道。
    const result = parseSettingInput('outsource_overdue_days', raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain('NaN');
  });

  it('整数项拒绝越界值并给出可读原因', () => {
    const tooBig = parseSettingInput('cdr_link_expire_hours', '169');
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.message).toContain('168');
  });

  it('校验通过的值能原样写回输入框', () => {
    for (const key of SETTING_KEYS) {
      const fallback = SETTING_DEFINITIONS[key].fallback;
      const shown = formatSettingForInput(key, fallback as never);
      const reparsed = parseSettingInput(key, shown);
      expect(reparsed, `${key} 不能往返`).toEqual({ ok: true, value: fallback });
    }
  });
});
