import { describe, it, expect } from 'vitest';
import {
  actionLabel,
  fieldLabel,
  formatLogValue,
  formatOrderLogChanges,
  orderStatusZh,
} from '../log-format';

describe('fieldLabel', () => {
  it('maps known field names to Chinese labels', () => {
    expect(fieldLabel('customerRef')).toBe('客户名称/简称');
    expect(fieldLabel('isUrgent')).toBe('急单');
    expect(fieldLabel('isSfCollect')).toBe('顺丰到付');
    expect(fieldLabel('status')).toBe('状态');
    expect(fieldLabel('isSelfClaimable')).toBe('抢单池状态');
    expect(fieldLabel('pricingStatus')).toBe('对客价格状态');
    expect(fieldLabel('priceRevision')).toBe('价格修订');
    expect(fieldLabel('priceBooks')).toBe('本次价目簿');
    expect(fieldLabel('completedAt')).toBe('生产完成时间');
    expect(fieldLabel('workOrderVersion')).toBe('纸质工单版本');
  });

  it('does not expose unknown field names', () => {
    expect(fieldLabel('mysteryField')).toBe('其他变更');
  });
});

describe('formatLogValue', () => {
  it('shows external account snapshots without exposing internal user ids', () => {
    expect(fieldLabel('submitterId')).toBe('关联外部销售');
    expect(formatLogValue('submitterId', { id: 'internal-id', displayName: '渠道张先生', username: 'zhang' })).toBe('渠道张先生 · zhang');
    expect(formatLogValue('submitterId', 'internal-id')).toBe('账号信息未记录');
  });
  it('renders booleans as 是 / 否', () => {
    expect(formatLogValue('isUrgent', true)).toBe('是');
    expect(formatLogValue('isUrgent', false)).toBe('否');
  });

  it('renders null / undefined / empty string as em-dash', () => {
    expect(formatLogValue('remark', null)).toBe('—');
    expect(formatLogValue('remark', undefined)).toBe('—');
    expect(formatLogValue('remark', '')).toBe('—');
  });

  it('translates status enum values to Chinese labels', () => {
    expect(formatLogValue('status', 'DRAFT')).toBe('草稿');
    expect(formatLogValue('status', 'IN_PRODUCTION')).toBe('生产中');
    expect(formatLogValue('status', 'CANCELLED')).toBe('已取消');
  });

  it('does not expose unknown status values', () => {
    expect(formatLogValue('status', 'NEW_STATE')).toBe('未识别工单状态');
    expect(formatLogValue('pricingStatus', 'NEW_PRICE_STATE')).toBe(
      '未识别价格状态',
    );
    expect(orderStatusZh('NEW_STATE')).toBe('未识别工单状态');
  });

  it('translates pricing review statuses', () => {
    expect(
      formatLogValue('pricingStatus', 'PENDING_ADMIN_CONFIRMATION'),
    ).toBe('待管理员确认价格');
    expect(formatLogValue('pricingStatus', 'ADMIN_CONFIRMED')).toBe(
      '管理员已确认',
    );
  });

  it('does not expose unknown fields or unexpected value shapes', () => {
    expect(formatLogValue('internalField', 'RAW_VALUE')).toBe(
      '未识别变更内容',
    );
    expect(formatLogValue('remark', { weird: 1 })).toBe('未识别变更内容');
  });

  it('coerces numeric values through String()', () => {
    expect(formatLogValue('trackingNo', 12345)).toBe('12345');
    expect(formatLogValue('workOrderVersion', 7)).toBe('7');
  });

  it('renders production completion timestamps in Shanghai time', () => {
    expect(
      formatLogValue('completedAt', '2026-09-02T02:03:00.000Z'),
    ).toBe('2026/09/02 10:03');
    expect(
      formatLogValue(
        'completedAt',
        new Date('2026-09-02T02:03:00.000Z'),
      ),
    ).toBe('2026/09/02 10:03');
    expect(formatLogValue('completedAt', 'not-a-date')).toBe(
      '未识别变更内容',
    );
  });
});

describe('formatOrderLogChanges', () => {
  it('returns a row per field with label + before / after', () => {
    const rows = formatOrderLogChanges({
      remark: { before: null, after: '新备注' },
      isUrgent: { before: false, after: true },
    });
    expect(rows).toHaveLength(2);
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(byField.remark).toMatchObject({
      label: '工单备注',
      before: '—',
      after: '新备注',
    });
    expect(byField.isUrgent).toMatchObject({
      label: '急单',
      before: '否',
      after: '是',
    });
  });

  it('translates a status transition row', () => {
    const rows = formatOrderLogChanges({
      status: { before: 'DRAFT', after: 'SUBMITTED' },
    });
    expect(rows).toEqual([
      { field: 'status', label: '状态', before: '草稿', after: '已提交' },
    ]);
  });

  it('formats a canonical production-completion audit row', () => {
    expect(
      formatOrderLogChanges({
        completedAt: {
          before: null,
          after: '2026-09-02T02:03:00.000Z',
        },
        workOrderVersion: { before: 7, after: 7 },
      }),
    ).toEqual([
      {
        field: 'completedAt',
        label: '生产完成时间',
        before: '—',
        after: '2026/09/02 10:03',
      },
      {
        field: 'workOrderVersion',
        label: '纸质工单版本',
        before: '7',
        after: '7',
      },
    ]);
  });

  it('keeps internal idempotency metadata out of the user-facing change list', () => {
    expect(
      formatOrderLogChanges({
        status: { before: 'COMPLETED', after: 'SHIPPED' },
        shipRequest: {
          before: null,
          after: {
            idempotencyKey: 'request-key',
            fingerprint: 'private-fingerprint',
          },
        },
      }),
    ).toEqual([
      {
        field: 'status',
        label: '状态',
        before: '已完工',
        after: '已发货',
      },
    ]);
  });

  it('handles null / undefined changedFields by returning []', () => {
    expect(formatOrderLogChanges(null)).toEqual([]);
    expect(formatOrderLogChanges(undefined)).toEqual([]);
  });

  it('skips malformed entries instead of throwing', () => {
    // before/after both missing = not a real diff entry; skip.
    // An older schema may have stored a string or number instead of
    // the `{ before, after }` shape — we don't want that to crash the
    // detail page.
    const rows = formatOrderLogChanges({
      legacy: 'just a string',
      broken: null,
      good: { before: 'a', after: 'b' },
      empty: {},
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].field).toBe('good');
  });
});

describe('actionLabel', () => {
  it('maps known actions', () => {
    expect(actionLabel('CREATE')).toBe('创建');
    expect(actionLabel('UPDATE')).toBe('编辑');
    expect(actionLabel('STATUS_CHANGE')).toBe('状态变更');
    expect(actionLabel('DELETE')).toBe('删除');
    expect(actionLabel('TASK_RELEASE_TO_POOL')).toBe('释放到抢单池');
    expect(actionLabel('TASK_SELF_CLAIM')).toBe('师傅抢单');
    expect(actionLabel('PRICING_ADMIN_CONFIRMED')).toBe('管理员终价确认');
    expect(actionLabel('ORDER_MANUAL_CHARGE_CREATED')).toBe('新增对客费用');
    expect(actionLabel('ORDER_PLATE_DETAIL_REMOVED')).toBe('移除制版明细');
    expect(actionLabel('PRODUCTION_COMPLETED')).toBe('生产完成');
  });

  it('does not expose unknown actions', () => {
    expect(actionLabel('EXPORT')).toBe('其他操作');
  });
});
