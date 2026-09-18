import { describe, expect, it } from 'vitest';
import {
  applyParsedReceiverFact,
  parseExternalReceiverDisplay,
  parsePastedReceiverAddress,
  parseReceiverAddressInput,
  stripProvincePrefix,
} from '../receiver-address-paste';

describe('parseReceiverAddressInput', () => {
  it('combines contact facts, province and a display address from one pasted string', () => {
    const parsed = parseReceiverAddressInput('张三，13800000000，浙江省杭州市西湖区测试路1号 [AB12]');
    expect(parsed).toEqual({
      receiverName: '张三',
      receiverPhone: '13800000000',
      province: '浙江',
      address: '浙江省杭州市西湖区测试路1号',
      platformCode: '[AB12]',
    });
  });

  it('keeps the two underlying parsers reachable for existing callers', () => {
    expect(parsePastedReceiverAddress('李四 13900139000 江西省南昌市测试路2号').province).toBe('江西');
    expect(parseExternalReceiverDisplay('').address).toBe('');
    expect(parseReceiverAddressInput('   ')).toMatchObject({ receiverName: null, receiverPhone: null, province: null, address: '' });
  });
});

describe('applyParsedReceiverFact', () => {
  it('lets a paste replace the fact and typing only fill a blank', () => {
    expect(applyParsedReceiverFact('北京', '广东', 'input')).toBe('北京');
    expect(applyParsedReceiverFact('', '广东', 'input')).toBe('广东');
    expect(applyParsedReceiverFact('北京', '广东', 'paste')).toBe('广东');
    expect(applyParsedReceiverFact('北京', null, 'paste')).toBe('北京');
    expect(applyParsedReceiverFact(null, null, 'input')).toBe('');
  });
});

describe('stripProvincePrefix', () => {
  it('drops the province the structured address already carries', () => {
    expect(stripProvincePrefix('上海市浦东新区世纪大道1号', '上海')).toBe('浦东新区世纪大道1号');
    expect(stripProvincePrefix('浙江省杭州市西湖区测试路1号', '浙江')).toBe('杭州市西湖区测试路1号');
    expect(stripProvincePrefix('广西壮族自治区南宁市青秀区', '广西')).toBe('南宁市青秀区');
    expect(stripProvincePrefix('测试路1号', null)).toBe('测试路1号');
  });
});
