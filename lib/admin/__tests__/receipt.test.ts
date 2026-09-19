import { describe, expect, it } from 'vitest';
import {
  RECEIPT_KEYS,
  appendReceipt,
  hasReceipt,
  readReceipt,
  safeReturnTo,
} from '../receipt';

describe('appendReceipt', () => {
  it('adds receipt keys to a bare path', () => {
    expect(appendReceipt('/owner/boms/bom1', { created: '1' })).toBe(
      '/owner/boms/bom1?created=1',
    );
  });

  it('keeps the existing query string and overrides a same-named key', () => {
    expect(
      appendReceipt('/owner/salary/piecework?date=2026-09-18&locked=old', {
        locked: '张三',
      }),
    ).toBe('/owner/salary/piecework?date=2026-09-18&locked=%E5%BC%A0%E4%B8%89');
  });

  it('keeps the hash after the query', () => {
    expect(appendReceipt('/orders/o1#admin-fee-editor', { updated: '1' })).toBe(
      '/orders/o1?updated=1#admin-fee-editor',
    );
  });

  it('writes several keys in dictionary order', () => {
    expect(
      appendReceipt('/owner/salary/hourly', { markedPaid: '1', marked: '李四' }),
    ).toBe('/owner/salary/hourly?marked=%E6%9D%8E%E5%9B%9B&markedPaid=1');
  });

  it('keeps a literal ? inside the existing query string', () => {
    expect(
      appendReceipt('/owner/salary/hourly?workerId=w1&note=why?&month=2026-08', {
        marked: 'Alice',
      }),
    ).toBe('/owner/salary/hourly?workerId=w1&note=why%3F&month=2026-08&marked=Alice');
  });

  it('returns the path untouched when the receipt is empty', () => {
    expect(appendReceipt('/owner/notifications', {})).toBe('/owner/notifications');
  });
});

describe('readReceipt', () => {
  it('returns only dictionary keys, first value, trimmed', () => {
    expect(
      readReceipt({
        created: ['1', '2'],
        updated: '  channel ',
        page: '3',
        unknown: 'x',
      }),
    ).toEqual({ created: '1', updated: 'channel' });
  });

  it('drops blank values and tolerates a missing searchParams object', () => {
    expect(readReceipt({ created: '   ', paid: '' })).toEqual({});
    expect(readReceipt(undefined)).toEqual({});
    expect(readReceipt(null)).toEqual({});
  });

  it('only reads the whitelisted keys so page filters with the same name survive', () => {
    // 时薪页：paid=paid|unpaid 是筛选，不是计件回执。
    expect(
      readReceipt(
        { month: '2026-08', paid: 'unpaid', marked: 'Alice', markedPaid: '1' },
        ['marked', 'markedPaid'],
      ),
    ).toEqual({ marked: 'Alice', markedPaid: '1' });
  });

  it('round-trips through appendReceipt', () => {
    const href = appendReceipt('/x', { locked: '王 五', lockedCount: '3' });
    const query = Object.fromEntries(new URLSearchParams(href.split('?')[1]));
    expect(readReceipt(query)).toEqual({ locked: '王 五', lockedCount: '3' });
  });
});

describe('hasReceipt', () => {
  it('is true when any dictionary key is present', () => {
    expect(hasReceipt({})).toBe(false);
    for (const key of RECEIPT_KEYS) expect(hasReceipt({ [key]: '1' })).toBe(true);
  });
});

describe('safeReturnTo', () => {
  const base = '/owner/salary/piecework';

  it.each([
    base,
    `${base}?date=2026-09-18&status=LOCKED`,
    `${base}/detail`,
    `${base}#top`,
  ])('accepts %s', (value) => {
    expect(safeReturnTo(value, base)).toBe(value);
  });

  it.each([
    null,
    undefined,
    '',
    '/owner/salary/hourly',
    `${base}-archive`,
    'https://example.com/steal',
    '//example.com/steal',
    `https://example.com${base}`,
    `${base}/../hourly?marked=x`,
    `${base}/%2e%2e/hourly`,
    `${base}/%2E%2E%2Fhourly`,
    `${base}/./detail`,
    `${base}/..`,
    `${base}/\\..\\hourly`,
    `${base}/%E0%A4%A`,
  ])('falls back to base for %s', (value) => {
    expect(safeReturnTo(value as string | null | undefined, base)).toBe(base);
  });

  it('ignores File entries', () => {
    expect(safeReturnTo(new File([''], 'x.txt'), base)).toBe(base);
  });
});
