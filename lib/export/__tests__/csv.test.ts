import { expect, it } from 'vitest';
import { csvDecimal, csvDocument } from '../csv';

it('writes Chinese Excel CSV with BOM, CRLF and quoted commas/newlines', () => {
  expect(csvDocument([['工单', '含,逗号', '含"引号', '两\n行']])).toBe('\uFEFF"工单","含,逗号","含""引号","两\n行"\r\n');
});
it.each(['=SUM(A1)', '+cmd', '-cmd', '@cmd', ' \t=cmd', '\u0000=cmd', '\ttext', '\ntext'])('protects untrusted spreadsheet input %j', (value) => {
  expect(csvDocument([[value]])).toContain('"\'' + value + '"');
});
it('keeps precise signed financial decimals numeric without exposing arbitrary text', () => {
  expect(csvDocument([[csvDecimal('9999999999.99'), csvDecimal('-12.30'), '-12.30']])).toBe('\uFEFF"9999999999.99","-12.30","\'-12.30"\r\n');
  expect(() => csvDecimal('Infinity')).toThrow();
});
