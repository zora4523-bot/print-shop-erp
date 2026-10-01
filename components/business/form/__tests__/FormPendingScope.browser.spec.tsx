import type { AnchorHTMLAttributes } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';

vi.mock('next/link', () => ({
  __esModule: true,
  default: (
    props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string },
  ) => (
    <a
      href={props.href}
      data-slot={(props as unknown as Record<string, string>)['data-slot']}
      aria-disabled={props['aria-disabled']}
      tabIndex={props.tabIndex}
      onClick={props.onClick}
      className={props.className}
    >
      {props.children}
    </a>
  ),
}));

import {
  FormPendingScope,
  ScopedPageHeader,
  useReportFormPending,
} from '../FormPendingScope';

function FakeForm({ pending }: { pending: boolean }) {
  useReportFormPending(pending);
  return <Button type="submit">保存</Button>;
}

function Page({ pending }: { pending: boolean }) {
  return (
    <FormPendingScope>
      <ScopedPageHeader title="新建工艺" back={{ href: '/rules/crafts', label: '返回工艺' }} />
      <FakeForm pending={pending} />
    </FormPendingScope>
  );
}

it('locks the page-header back link while the scoped form is pending', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(<Page pending={false} />));
  const link = () => host.querySelector<HTMLAnchorElement>('[data-slot="page-header-back"]')!;

  expect(link().getAttribute('aria-disabled')).toBeNull();

  flushSync(() => root.render(<Page pending />));
  await vi.waitFor(() => expect(link().getAttribute('aria-disabled')).toBe('true'));
  expect(link().tabIndex).toBe(-1);
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  link().dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);

  flushSync(() => root.render(<Page pending={false} />));
  await vi.waitFor(() => expect(link().getAttribute('aria-disabled')).toBeNull());

  root.unmount();
  host.remove();
});
