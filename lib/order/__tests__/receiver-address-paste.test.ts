import { describe, expect, it } from 'vitest';
import {
  parseExternalReceiverDisplay,
  parsePastedReceiverAddress,
  parseReceiverAddressInput,
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
