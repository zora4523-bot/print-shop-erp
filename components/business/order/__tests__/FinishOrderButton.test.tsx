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
  it('states only the verified SHIPPED to FINISHED terminal effects', () => {
    expect(finishOrderImpactItems).toEqual([
      '工单将从 SHIPPED（已发货）进入 FINISHED（已完成）终态；该状态不可回退。',
      '工单业务台账（ledger）将关闭，不再接受后续生产或发货处理。',
      '工单将退出活跃工作区；历史金额、状态和审计记录仍会保留。',
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
