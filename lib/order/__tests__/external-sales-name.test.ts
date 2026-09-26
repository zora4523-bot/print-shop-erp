import { describe, expect, it } from 'vitest';
import { OrderSettlementType } from '../../../generated/prisma/enums';
import { orderExternalSalesName } from '../external-sales-name';

describe('orderExternalSalesName', () => {
  it('uses the submitting external salesperson for charged orders', () => {
    expect(orderExternalSalesName({
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      submitter: { displayName: ' 桂林 ' },
      sourceOrder: { submitter: { displayName: '别人' } },
    })).toBe('桂林');
  });

  it('uses the source order salesperson for admin-created free rework', () => {
    expect(orderExternalSalesName({
      settlementType: OrderSettlementType.NO_CHARGE,
      submitter: { displayName: '管理员' },
      sourceOrder: { submitter: { displayName: '桂林' } },
    })).toBe('桂林');
  });

  it('returns null when nothing usable is known', () => {
    expect(orderExternalSalesName({ settlementType: OrderSettlementType.NO_CHARGE, submitter: { displayName: '管理员' }, sourceOrder: null })).toBeNull();
    expect(orderExternalSalesName({ settlementType: OrderSettlementType.EXTERNAL_SALES, submitter: { displayName: '  ' } })).toBeNull();
    expect(orderExternalSalesName({ settlementType: undefined })).toBeNull();
  });
});
