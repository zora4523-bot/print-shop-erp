import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrderExportStatus } from '@/generated/prisma/enums';
import {
  ORDER_EXPORT_POLLING_TIMEOUT_MS,
  pendingOrderExportSignature,
} from '../order-export-polling';

describe('OrderExportControls polling recovery', () => {
  it('tracks the current pending set with a stable signature', () => {
    expect(
      pendingOrderExportSignature([
        { id: 'ready', status: OrderExportStatus.READY },
        { id: 'pending-b', status: OrderExportStatus.PENDING },
        { id: 'pending-a', status: OrderExportStatus.PENDING },
      ]),
    ).toBe('pending-a|pending-b');
    expect(ORDER_EXPORT_POLLING_TIMEOUT_MS).toBe(120_000);
  });

  it('shows a truthful paused state with an explicit manual recovery action', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components',
        'business',
        'order',
        'OrderExportControls.tsx',
      ),
      'utf8',
    );

    expect(source).toContain('setPausedSignature(pendingSignature)');
    expect(source).toContain('自动刷新已在 2 分钟后暂停');
    expect(source).toContain('刷新并继续自动检查');
    expect(source).toContain('setPausedSignature(null)');
    expect(source).toContain('router.refresh()');
    expect(source).toContain('<form action={formAction} aria-busy={pending}>');
  });
});
