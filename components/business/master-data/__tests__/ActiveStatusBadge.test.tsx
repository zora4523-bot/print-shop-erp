import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActiveStatusBadge } from '../ActiveStatusBadge';

describe('ActiveStatusBadge', () => {
  it('启用态用 success 药丸', () => {
    const html = renderToStaticMarkup(<ActiveStatusBadge active />);

    expect(html).toContain('data-slot="badge"');
    expect(html).toContain('data-tone="success"');
    expect(html).toContain('启用');
  });

  it('停用态用 neutral 而不是 danger', () => {
    const html = renderToStaticMarkup(<ActiveStatusBadge active={false} />);

    expect(html).toContain('data-slot="badge"');
    expect(html).toContain('data-tone="neutral"');
    expect(html).toContain('停用');
    expect(html).not.toContain('data-tone="danger"');
  });

  it('两态都不带 dot（启停是稳态）', () => {
    for (const active of [true, false]) {
      const html = renderToStaticMarkup(<ActiveStatusBadge active={active} />);
      expect(html).not.toContain('aria-hidden');
    }
  });
});
