import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';
import {
  ConfirmActionController, ConfirmActionDialog,
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
      <ConfirmActionController level="L2"
        trigger={<Button variant="destructive">删除</Button>}>
        <ConfirmActionDialog action="删除通知群" changes={[]} consequences={['删除后不能恢复', '已发送日志仍会保留']} confirmText="确认删除" />
      </ConfirmActionController>,
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

it('rejects arbitrary controller content at runtime', () => {
  expect(() => renderToStaticMarkup(
    <ConfirmActionController level="L2"><p>自由段落</p></ConfirmActionController>,
  )).toThrow('accepts one ConfirmActionDialog only');
});

// Compile-time contract: presentation cannot regain free-form prose slots.
const facts = { action: '删除', changes: [], consequences: ['删除后不可恢复'], confirmText: '删除' };
// @ts-expect-error description is deliberately not a presentation prop
const rejectedDescription = <ConfirmActionDialog {...facts} description="机制说明" />;
// @ts-expect-error notice is deliberately not a presentation prop
const rejectedNotice = <ConfirmActionDialog {...facts} notice="重复后果" />;
// @ts-expect-error arbitrary children are deliberately not a presentation prop
const rejectedChildren = <ConfirmActionDialog {...facts}><p>自由段落</p></ConfirmActionDialog>;
void [rejectedDescription, rejectedNotice, rejectedChildren];
