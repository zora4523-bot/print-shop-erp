import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerType } from '@/generated/prisma/enums';
import type { AttendanceMutationResult } from '@/actions/foreman-attendance.types';

// 保存成功此前完全没有回执：按钮从「保存中…」变回「保存」就结束了，
// 读屏器一个字都不播。这里注入 useActionState 的状态，把成功回执
// （role="status"）和失败提示（role="alert"）互斥的形状钉住。
const { actionState } = vi.hoisted(() => ({
  actionState: {
    // 类型是纯编译期的，vi.hoisted 提升到 import 之上也不会有运行时引用。
    current: null as AttendanceMutationResult | null,
    pending: false,
  },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [
      actionState.current,
      vi.fn(),
      actionState.pending,
    ],
  };
});

// 不 mock 会把 Prisma 运行时经 actions/ 拉进 node 环境。
vi.mock('@/actions/foreman-attendance', () => ({
  recordAttendanceAction: vi.fn(),
}));

import { AttendanceRecordDialog } from '../AttendanceRecordDialog';

function render(
  state: AttendanceMutationResult | null,
  options: { pending?: boolean } = {},
) {
  actionState.current = state;
  actionState.pending = options.pending ?? false;
  return renderToStaticMarkup(
    <AttendanceRecordDialog
      workerId="worker-1"
      workerName="张三"
      workerType={WorkerType.PACKER}
      date="2026-08-21"
    />,
  );
}

beforeEach(() => {
  actionState.current = null;
  actionState.pending = false;
});

describe('AttendanceRecordDialog 保存回执', () => {
  it('保存成功后给出 role="status" 回执，并写明是哪一天', () => {
    const html = render({ status: 'success' });

    expect(html).toMatch(/<p role="status"[^>]*>[\s\S]*?2026-08-21[\s\S]*?<\/p>/);
    expect(html).toContain('已保存');
  });

  it('连续两次得到相同 success 时，pending 期间先卸载旧 live region', () => {
    const success: AttendanceMutationResult = { status: 'success' };

    const firstSuccess = render(success);
    const duringSecondSave = render(success, { pending: true });
    const secondSuccess = render(success);

    expect(firstSuccess).toContain('role="status"');
    expect(duringSecondSave).not.toContain('role="status"');
    expect(duringSecondSave).not.toContain('已保存 2026-08-21 的考勤');
    // 完成后重新挂载；即使文案和第一次一样，读屏器也能把
    // 新插入的 status 当作新回执。
    expect(secondSuccess).toContain('role="status"');
    expect(secondSuccess).toContain('已保存 2026-08-21 的考勤');
  });

  it('一进面板不播报任何东西', () => {
    const html = render(null);

    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it('失败仍由 role="alert" 承载，且不与成功回执同时出现', () => {
    const html = render({ status: 'error', message: 'WORK_HOURS 规则未配置' });

    expect(html).toMatch(
      /<p role="alert"[^>]*>[\s\S]*?WORK_HOURS 规则未配置[\s\S]*?<\/p>/,
    );
    expect(html).not.toContain('role="status"');
  });

  it('字段校验失败作为单个原子 alert 播报全部错误', () => {
    const html = render({
      status: 'invalid',
      fieldErrors: {
        normalHours: ['正常工时不能超过 24'],
        leaveType: ['请填写请假类型'],
      },
    });

    const alert = html.match(/<ul[^>]*role="alert"[^>]*>/)?.[0];
    expect(alert).toBeDefined();
    expect(alert).toContain('aria-atomic="true"');
    expect(html).toContain('正常工时不能超过 24');
    expect(html).toContain('请填写请假类型');
    expect(html).not.toContain('role="status"');
  });

  it('重提时卸载上一轮字段错误和 aria-describedby', () => {
    const invalid: AttendanceMutationResult = {
      status: 'invalid',
      fieldErrors: {
        normalHours: ['正常工时不能超过 24'],
      },
    };

    const beforeRetry = render(invalid);
    const duringRetry = render(invalid, { pending: true });

    expect(beforeRetry).toContain('正常工时不能超过 24');
    expect(beforeRetry).toContain('aria-describedby=');
    expect(duringRetry).not.toContain('正常工时不能超过 24');
    expect(duringRetry).not.toContain('aria-describedby=');
  });
});
