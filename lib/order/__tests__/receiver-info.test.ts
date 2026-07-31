import { describe, expect, it } from 'vitest';
import { formatReceiverInfo } from '../receiver-info';

describe('formatReceiverInfo', () => {
  it('uses the single combined field for new orders', () => {
    expect(
      formatReceiverInfo({
        receiverName: null,
        receiverPhone: null,
        receiverAddress: '王小姐 13800000000 广州市番禺区',
      }),
    ).toBe('王小姐 13800000000 广州市番禺区');
  });

  it('keeps legacy split fields readable', () => {
    expect(
      formatReceiverInfo({
        receiverName: '王小姐',
        receiverPhone: '13800000000',
        receiverAddress: '广州市番禺区',
      }),
    ).toBe('王小姐 · 13800000000 · 广州市番禺区');
  });

  it('returns a display fallback when all parts are blank', () => {
    expect(
      formatReceiverInfo({
        receiverName: ' ',
        receiverPhone: null,
        receiverAddress: '',
      }),
    ).toBe('—');
  });
});
