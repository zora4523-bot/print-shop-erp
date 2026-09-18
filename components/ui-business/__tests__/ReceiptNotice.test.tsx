import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReceiptNotice } from '@/components/ui-business';
import { readReceipt } from '@/lib/admin/receipt';

describe('ReceiptNotice', () => {
  it('renders nothing without a receipt', () => {
    expect(renderToStaticMarkup(<ReceiptNotice receipt={{}} noun="账号" />)).toBe('');
  });

  it('announces a created receipt politely with the page noun', () => {
    const html = renderToStaticMarkup(
      <ReceiptNotice receipt={readReceipt({ created: '1' })} noun="账号" />,
    );
    expect(html).toContain('data-slot="receipt-notice"');
    expect(html).toContain('data-slot="action-notice"');
    expect(html).toContain('data-tone="success"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('账号已创建');
    expect(html).not.toContain('text-destructive');
  });

  it('uses 已保存 for an updated receipt', () => {
    const html = renderToStaticMarkup(
      <ReceiptNotice receipt={{ updated: '1' }} noun="工单" />,
    );
    expect(html).toContain('工单已保存');
  });

  it('falls back to the receipt value as subject when no noun is given', () => {
    const html = renderToStaticMarkup(<ReceiptNotice receipt={{ created: '供应商' }} />);
    expect(html).toContain('供应商已创建');
  });

  it('lets a page override copy, tone and description per key', () => {
    const html = renderToStaticMarkup(
      <ReceiptNotice
        receipt={{ locked: '张三', lockedCount: '3' }}
        messages={{
          locked: (name) => ({
            title: '计件结算已锁定',
            description: `${name} 的报工已结算。`,
          }),
          lockedCount: (count) => ({
            tone: 'info',
            title: '当日结算处理完成',
            description: `本次新锁定 ${count} 人。`,
          }),
        }}
      />,
    );
    expect(html).toContain('计件结算已锁定');
    expect(html).toContain('张三 的报工已结算。');
    expect(html).toContain('data-tone="info"');
    expect(html).toContain('本次新锁定 3 人。');
  });

  it('skips keys whose resolver returns null and keys without a default', () => {
    expect(
      renderToStaticMarkup(
        <ReceiptNotice
          receipt={{ marked: '李四', markedPaid: '1' }}
          messages={{ marked: () => null }}
        />,
      ),
    ).toBe('');
    expect(renderToStaticMarkup(<ReceiptNotice receipt={{ issued: '1' }} />)).toBe('');
  });

  it('renders one notice per present key in dictionary order', () => {
    const html = renderToStaticMarkup(
      <ReceiptNotice receipt={{ updated: '1', created: '1' }} noun="规则" />,
    );
    expect(html.indexOf('规则已创建')).toBeLessThan(html.indexOf('规则已保存'));
    expect(html.match(/data-slot="action-notice"/g)).toHaveLength(2);
  });

  it('does not emit DOM for the client-side URL cleanup during SSR', () => {
    const html = renderToStaticMarkup(
      <ReceiptNotice receipt={{ created: '1' }} noun="账号" />,
    );
    expect(html.match(/<div/g)).toHaveLength(3);
  });
});
