import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
import { WorkerType } from '@/generated/prisma/enums';

const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('@/actions/foreman-attendance', () => ({ recordAttendanceAction: mocks.record }));
import { AttendanceRecordDialog } from '../AttendanceRecordDialog';

let host: HTMLElement; let root: Root;
beforeEach(() => { vi.resetAllMocks(); host = document.createElement('main'); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

const date = '2026-09-10';
function renderFor(workerId: string, workerName: string, existing: { normalHours: string; remark: string }) {
  // 与考勤页同形：同一月份、同一日期位置，只换员工（next/form 软导航后的复用场景）。
  flushSync(() => root.render(
    <AttendanceRecordDialog
      workerId={workerId}
      workerName={workerName}
      workerType={WorkerType.PACKER}
      date={date}
      existing={{ ...existing, otHours: '0', workUnits: '1', leaveUnits: '0', leaveType: null }}
    />,
  ));
}

it('同月切换员工后，面板初值来自新员工，保存用新员工的 workerId 与数值', async () => {
  mocks.record.mockResolvedValue({ status: 'success' });
  renderFor('worker-a', '员工甲', { normalHours: '8', remark: '甲的备注' });
  const remark = page.getByRole('textbox', { name: '备注', exact: true });
  const normal = page.getByRole('spinbutton', { name: '正常工时', exact: true });
  await expect.element(remark).toHaveValue('甲的备注');
  // 在 A 的面板里改了但没保存。
  await remark.fill('甲未保存的改动');
  await normal.fill('3');

  renderFor('worker-b', '员工乙', { normalHours: '6.5', remark: '乙的备注' });
  await expect.element(page.getByText(`员工乙 · ${date}`)).toBeVisible();
  await expect.element(remark).toHaveValue('乙的备注');
  await expect.element(normal).toHaveValue(6.5);

  await page.getByRole('button', { name: '保存', exact: true }).click();
  await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(1));
  expect(mocks.record.mock.calls[0]![1]).toMatchObject({
    workerId: 'worker-b',
    date,
    normalHours: '6.5',
    remark: '乙的备注',
  });
});
