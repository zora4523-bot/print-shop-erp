import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';
import {
  ConfirmActionDialog,
  confirmationCanSubmit,
} from '@/components/ui-business';

describe('ConfirmActionDialog', () => {
  it('allows L2 after the impact scope is presented', () => {
    expect(confirmationCanSubmit('L2', '')).toBe(true);
  });

  it('requires a non-blank audit reason for L3', () => {
    expect(confirmationCanSubmit('L3', '')).toBe(false);
    expect(confirmationCanSubmit('L3', '   ')).toBe(false);
    expect(confirmationCanSubmit('L3', '客户要求停用旧规则')).toBe(true);
  });

  it('keeps the trigger in the accessible alert-dialog contract', () => {
    const html = renderToStaticMarkup(
      <ConfirmActionDialog
        level="L2"
        trigger={<Button variant="destructive">删除</Button>}
        title="删除通知群"
        description="请先核对影响。"
        impactItems={['删除后不能恢复', '已发送日志仍会保留']}
        confirmLabel="确认删除"
      />,
    );

    expect(html).toContain('data-slot="alert-dialog-trigger"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('删除');
  });

  it('keeps portal actions touch-sized and clears stale reasons after close', () => {
    const alertDialogSource = readFileSync(
      path.join(process.cwd(), 'components', 'ui', 'alert-dialog.tsx'),
      'utf8',
    );
    const confirmDialogSource = readFileSync(
      path.join(
        process.cwd(),
        'components',
        'ui-business',
        'ConfirmActionDialog.tsx',
      ),
      'utf8',
    );

    expect(alertDialogSource.match(/"min-h-11"/g)).toHaveLength(2);
    expect(alertDialogSource).not.toContain('"min-h-11 sm:min-h-8"');
    expect(confirmDialogSource).toContain("requestAnimationFrame(() => {");
    expect(confirmDialogSource).toContain("setReason('');");
  });
});
