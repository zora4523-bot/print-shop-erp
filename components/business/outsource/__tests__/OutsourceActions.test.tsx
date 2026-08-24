import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OutsourceReceiveFeedback } from '../OutsourceReceiveFeedback';

describe('OutsourceReceiveFeedback', () => {
  it('收货表单被刷新卸载后，覆盖缺口 notice 仍可独立渲染', () => {
    const notice =
      '工单尚未完工：款式 2「红包 B」还没有对应的外协单';
    const html = renderToStaticMarkup(
      <OutsourceReceiveFeedback
        state={{ status: 'success', id: 'outsource-1', notice }}
      />,
    );

    expect(html).toContain(notice);
    expect(html).toContain('text-warning-foreground');
    expect(html).not.toContain('<form');
  });
});
