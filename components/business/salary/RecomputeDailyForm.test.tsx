import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecomputeDailyResult } from '@/actions/owner-salary.types';

const { actionState } = vi.hoisted(() => ({
  actionState: { current: null as RecomputeDailyResult | null },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn(), false],
  };
});
vi.mock('@/actions/owner-salary', () => ({
  recomputeDailySalaryAction: vi.fn(),
}));

import {
  RecomputeDailyForm,
  canUseDailyRecomputePreview,
  dailyRecomputeImpactItems,
} from './RecomputeDailyForm';

function render() {
  return renderToStaticMarkup(
    <RecomputeDailyForm defaultDate="2026-08-23" maxDate="2026-08-24" />,
  );
}

beforeEach(() => {
  actionState.current = null;
});

describe('RecomputeDailyForm', () => {
  it('makes the first submit a direct read-only impact preview', () => {
    const html = render();

    expect(html).toMatch(/<input[^>]*type="date"[^>]*required=""/);
    expect(html).toContain('查看影响');
    expect(html).toContain('预检只读取影响范围');
    expect(html).toContain('确认时会按最新数据重新核对');
    expect(html).not.toContain('服务端');
    expect(html).not.toContain('重算理由');
    expect(html).not.toContain('data-risk-level="L3"');
  });

  it('turns only the server preview into the L3 confirmation entry', () => {
    actionState.current = {
      status: 'confirm',
      date: '2026-08-23',
      reason: '',
      impact: {
        candidateWorkerCount: 6,
        affectedWorkerCount: 4,
        createCount: 2,
        overwriteUnpaidCount: 2,
        paidSkippedCount: 2,
      },
    };

    const html = render();

    expect(html).toContain('data-risk-level="L3"');
    expect(html).toContain('已完成 2026-08-23 影响预检');
    expect(html).toContain('data-slot="alert-dialog-trigger"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('确认重算…');
  });

  it('lists exactly the counts returned by the server impact preview', () => {
    expect(
      dailyRecomputeImpactItems({
        candidateWorkerCount: 5,
        affectedWorkerCount: 3,
        createCount: 1,
        overwriteUnpaidCount: 2,
        paidSkippedCount: 2,
      }),
    ).toEqual([
      '候选师傅：5 位',
      '实际受影响：3 位',
      '将新建日薪记录：1 位',
      '将覆盖未发放记录：2 位',
      '跳过已发放记录：2 位（不会修改）',
    ]);
  });

  it('invalidates an old preview permanently after the selected date changes', () => {
    expect(
      canUseDailyRecomputePreview({
        previewDate: '2026-08-23',
        selectedDate: '2026-08-23',
        invalidated: false,
        pending: false,
      }),
    ).toBe(true);
    expect(
      canUseDailyRecomputePreview({
        previewDate: '2026-08-23',
        selectedDate: '2026-08-23',
        invalidated: true,
        pending: false,
      }),
    ).toBe(false);
    expect(
      canUseDailyRecomputePreview({
        previewDate: '2026-08-23',
        selectedDate: '2026-08-24',
        invalidated: false,
        pending: false,
      }),
    ).toBe(false);
  });

  it('uses structured success and error feedback', () => {
    actionState.current = {
      status: 'success',
      date: '2026-08-23',
      workerCount: 3,
      errorCount: 1,
      errors: [{ workerId: 'w1', workerName: '张师傅', message: '缺少规则' }],
      impact: {
        candidateWorkerCount: 4,
        affectedWorkerCount: 3,
        createCount: 1,
        overwriteUnpaidCount: 2,
        paidSkippedCount: 1,
      },
    };
    const successHtml = render();
    expect(successHtml).toContain('data-slot="action-notice"');
    expect(successHtml).toContain('data-tone="warning"');
    expect(successHtml).toContain('张师傅：缺少规则');

    actionState.current = { status: 'error', message: '不能结算未来日期' };
    const errorHtml = render();
    expect(errorHtml).toContain('data-tone="error"');
    expect(errorHtml).toContain('不能结算未来日期');
  });
});
