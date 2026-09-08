import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  busy: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock('@/actions/design-upload', () => ({
  deleteOrderItemDesignAction: mocks.remove,
}));
vi.mock('@/components/business/order/design-upload-client', () => ({
  prepareDesignFile: (file: File) => ({ ok: true, value: { file } }),
  uploadOrderItemDesignFile: mocks.upload,
}));
import { DesignUploadPanel } from '../DesignUploadPanel';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() =>
    root.render(
      <DesignUploadPanel
        orderId="order-1"
        orderItemId="item-1"
        canEdit
        onBusyChange={mocks.busy}
        designs={[
          {
            id: 'design-1',
            fileName: 'production.cdr',
            fileType: 'CDR',
            fileSize: '1024',
            fileUrl: '',
          },
        ]}
      />,
    ),
  );
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

it('locks deletion and reports busy while uploading, then refreshes the saved file list', async () => {
  let complete!: (result: { ok: boolean }) => void;
  mocks.upload.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await page
    .getByLabelText('上传设计文件', { exact: true })
    .upload(new File(['design'], 'design.png', { type: 'image/png' }));
  await expect.poll(() => mocks.upload.mock.calls.length).toBe(1);
  await expect
    .element(page.getByRole('button', { name: '删除', exact: true }))
    .toBeDisabled();
  await expect.poll(() => mocks.busy.mock.lastCall?.[0]).toBe(true);
  complete({ ok: true });
  await expect.element(page.getByText('已上传 1 个设计文件')).toBeVisible();
  await expect.poll(() => mocks.refresh.mock.calls.length).toBe(1);
  await expect
    .element(page.getByRole('button', { name: '删除', exact: true }))
    .toBeEnabled();
  await expect.poll(() => mocks.busy.mock.lastCall?.[0]).toBe(false);
});

it('locks upload during deletion and recovers controls after an unconfirmed network result', async () => {
  let reject!: (error: Error) => void;
  mocks.remove.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect
    .element(page.getByRole('button', { name: '选择设计文件', exact: true }))
    .toBeDisabled();
  await expect
    .element(page.getByLabelText('上传设计文件', { exact: true }))
    .toBeDisabled();
  reject(new Error('network unavailable'));
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('删除结果未确认');
  await expect
    .element(page.getByRole('button', { name: '选择设计文件', exact: true }))
    .toBeEnabled();
  await expect.poll(() => mocks.busy.mock.lastCall?.[0]).toBe(false);
  expect(mocks.refresh).not.toHaveBeenCalled();
});
