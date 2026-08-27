import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { actionState } = vi.hoisted(() => ({
  actionState: {
    current: null as null | { status: 'error'; message: string },
    pending: false,
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn()],
    useTransition: () => [actionState.pending, vi.fn()],
  };
});

vi.mock('@/actions/order', () => ({
  finishOrderAction: vi.fn(),
}));

import {
  FinishOrderButton,
  finishOrderImpactItems,
} from '../FinishOrderButton';

const source = readFileSync(
  path.join(
    process.cwd(),
    'components',
    'business',
    'order',
    'FinishOrderButton.tsx',
  ),
  'utf8',
);

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('FinishOrderButton', () => {
  it('states only the verified irreversible completion effects', () => {
    expect(finishOrderImpactItems).toEqual([
      '确认后工单完成且不能恢复。',
      '工单不再接受生产或发货操作。',
      '历史金额、状态和操作记录仍会保留。',
    ]);
  });

  it('gates Enter and bare form submission behind the shared L2 confirmation', () => {
    const handleSubmitSource = source.slice(
      source.indexOf('function handleSubmit'),
      source.indexOf('function confirmFinish'),
    );
    const confirmFinishSource = source.slice(
      source.indexOf('function confirmFinish'),
      source.indexOf('return ('),
    );

    expect(source).toContain('<ConfirmActionDialog');
    expect(source).toContain('level="L2"');
    expect(source).toContain('onSubmit={handleSubmit}');
    expect(source).toContain('onConfirm={confirmFinish}');
    expect(source).not.toMatch(/<form[^>]*\saction=/);
    expect(handleSubmitSource).toContain('event.preventDefault()');
    expect(handleSubmitSource).not.toContain('action()');
    expect(confirmFinishSource).toContain('startTransition(() => action())');
    expect(source.match(/startTransition\(\(\) => action\(\)\)/g)).toHaveLength(1);
  });

  it('keeps the existing trigger and error feedback contract', () => {
    actionState.current = { status: 'error', message: '工单状态已变化' };

    const html = renderToStaticMarkup(
      <FinishOrderButton orderId="order-1" />,
    );

    expect(html).toContain('type="submit"');
    expect(html).toContain('确认完工');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('工单状态已变化');
  });
});
