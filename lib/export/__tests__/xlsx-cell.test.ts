import { describe, expect, it } from 'vitest';
import { xlsxCellXml } from '../xlsx-cell';

describe('xlsxCellXml', () => {
  it('escapes inline strings without changing surrounding whitespace', () => {
    expect(xlsxCellXml(` A&B <C> "D" 'E' `, 2, 1)).toBe(
      '<c r="B2" t="inlineStr"><is><t xml:space="preserve"> A&amp;B &lt;C&gt; &quot;D&quot; &apos;E&apos; </t></is></c>',
    );
  });

  it('serializes empty, numeric, boolean, and date cells', () => {
    expect(xlsxCellXml(null, 1, 0)).toBe('<c r="A1"/>');
    expect(xlsxCellXml(12.5, 1, 1)).toBe(
      '<c r="B1" s="2"><v>12.5</v></c>',
    );
    expect(xlsxCellXml(true, 1, 2)).toBe(
      '<c r="C1" t="b"><v>1</v></c>',
    );
    expect(
      xlsxCellXml(new Date('2026-08-30T00:00:00.000Z'), 1, 3),
    ).toContain('2026-08-30T00:00:00.000Z');
  });
});
