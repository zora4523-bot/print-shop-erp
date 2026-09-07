import { describe, expect, it } from 'vitest';
import {
  orderNoFromHash,
  resolveOrderHashDrawerView,
} from '../use-order-hash-drawer';

describe('orderNoFromHash', () => {
  it('reads and decodes the #wo deep-link contract', () => {
    expect(orderNoFromHash('#wo=GD-260902-001')).toBe('GD-260902-001');
    expect(orderNoFromHash('wo=%E6%B5%8B%E8%AF%95-1')).toBe('测试-1');
  });

  it('ignores unrelated, empty and oversized hashes', () => {
    expect(orderNoFromHash('#section=fees')).toBeNull();
    expect(orderNoFromHash('#wo=')).toBeNull();
    expect(orderNoFromHash(`#wo=${'x'.repeat(129)}`)).toBeNull();
  });
});

describe('resolveOrderHashDrawerView', () => {
  const pageOrder = { orderNo: 'GD-260902-001', source: 'list' };

  it('waits for the authoritative detail when alwaysFetchDetail is enabled', () => {
    expect(
      resolveOrderHashDrawerView({
        openOrderNo: pageOrder.orderNo,
        pageOrder,
        remoteResult: null,
        alwaysFetchDetail: true,
      }),
    ).toEqual({ openOrder: null, loading: true, error: '' });
  });

  it('does not let a stale page DTO mask a matching detail error', () => {
    expect(
      resolveOrderHashDrawerView({
        openOrderNo: pageOrder.orderNo,
        pageOrder,
        remoteResult: {
          orderNo: pageOrder.orderNo,
          error: '工单明细加载失败',
        },
        alwaysFetchDetail: true,
      }),
    ).toEqual({
      openOrder: null,
      loading: false,
      error: '工单明细加载失败',
    });
  });
});
