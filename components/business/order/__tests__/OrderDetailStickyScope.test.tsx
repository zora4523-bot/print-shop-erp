import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderDetailStickyScope } from '../OrderDetailStickyScope';

describe('order detail heading', () => {
  it('keeps the title in normal flow and offsets sidebars only below the shell', () => {
    const html = renderToStaticMarkup(<OrderDetailStickyScope header={<h1>工单名称</h1>}><p>明细</p></OrderDetailStickyScope>);
    expect(html).not.toContain('class="sticky');
    expect(html).toContain('--order-detail-timeline-top:calc(var(--admin-header-offset, 0px) + 16px)');
    expect(html).toContain('<h1>工单名称</h1>');
    expect(html).toContain('<p>明细</p>');
  });
});
