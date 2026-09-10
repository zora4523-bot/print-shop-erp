import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { OpsReadinessBadge } from '../OpsReadinessBadge';
import { SensitiveColumnMaskingBadge } from '../SensitiveColumnMaskingBadge';

// 这两个徽章取代了 app/(admin)/owner/pigsty/page.tsx 里的本地 tone 函数与
// 行内三元文案。断言锁住「文案 + 色档」都来自 lib/ui/status-registry.ts。

describe('OpsReadinessBadge', () => {
  it('renders the ready state without a dot', () => {
    const html = renderToStaticMarkup(
      <OpsReadinessBadge ready blockers={[]} />,
    );
    expect(html).toContain('就绪');
    expect(html).toContain('data-tone="success"');
  });

  it('separates blocked from not-enabled', () => {
    const blocked = renderToStaticMarkup(
      <OpsReadinessBadge ready={false} blockers={['缺少扩展']} />,
    );
    expect(blocked).toContain('有阻塞');
    expect(blocked).toContain('data-tone="warning"');

    const notEnabled = renderToStaticMarkup(
      <OpsReadinessBadge ready={false} blockers={[]} />,
    );
    expect(notEnabled).toContain('未启用');
    expect(notEnabled).toContain('data-tone="neutral"');
  });
});

describe('SensitiveColumnMaskingBadge', () => {
  it('distinguishes applied labels from pending ones', () => {
    const applied = renderToStaticMarkup(
      <SensitiveColumnMaskingBadge
        maskingStrategy="anon_security_label"
        anonLabelApplied
      />,
    );
    expect(applied).toContain('标签已应用');
    expect(applied).toContain('data-tone="success"');

    const pending = renderToStaticMarkup(
      <SensitiveColumnMaskingBadge
        maskingStrategy="anon_security_label"
        anonLabelApplied={false}
      />,
    );
    expect(pending).toContain('待应用标签');
    expect(pending).toContain('data-tone="warning"');
  });

  it('falls back to the export-handled copy for other strategies', () => {
    const html = renderToStaticMarkup(
      <SensitiveColumnMaskingBadge
        maskingStrategy="export_pipeline"
        anonLabelApplied={false}
      />,
    );
    expect(html).toContain('需导出流程处理');
    expect(html).toContain('data-tone="success"');
  });
});
