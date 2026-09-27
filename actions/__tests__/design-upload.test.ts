import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  record: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/oss/sign', () => ({ signDesignUpload: vi.fn() }));
vi.mock('@/lib/order-design', async (original) => ({
  ...await original<typeof import('@/lib/order-design')>(),
  recordOrderItemDesign: mocks.record,
}));
vi.mock('@/lib/db', () => ({ db: {} }));
import { recordDesignUploadAction } from '../design-upload';

const input = (fileName: string) => ({
  orderId: 'o1',
  orderItemId: 'i1',
  objectKey: 'design/o1/i1/cdr-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.cdr',
  fileType: 'CDR',
  fileName,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ id: 'sales1', role: 'SALES' });
  mocks.record.mockResolvedValue({ id: 'd1' });
});

it('登记合法的 CDR 文件名', async () => {
  await expect(recordDesignUploadAction(input('春节红包 终稿.cdr'))).resolves.toEqual({ ok: true });
  expect(mocks.permission).toHaveBeenCalledWith('design:upload');
  expect(mocks.record).toHaveBeenCalledWith(
    expect.objectContaining({ fileName: '春节红包 终稿.cdr' }),
    { id: 'sales1', role: 'SALES' },
  );
});

// 登记阶段的文件名会原样成为 CDR 下载包里的 ZIP 条目名，发给外协解压：
// 路径段、控制字符、双向覆盖字符（伪装扩展名）和非 .cdr 扩展名都不能落库。
it.each([
  ['Windows 路径穿越', '..\\..\\Startup\\a.cdr'],
  ['POSIX 路径穿越', '../../x.cdr'],
  ['子目录', 'sub/a.cdr'],
  ['控制字符', 'a\u0001b.cdr'],
  ['换行', 'a\nb.cdr'],
  ['RTL 覆盖伪装扩展名', '设计稿\u202Eexe.cdr'],
  ['双向隔离字符', 'a\u2066b.cdr'],
  ['扩展名与类型不符', '设计稿.exe'],
  ['没有扩展名', '设计稿'],
])('拒绝不安全的文件名：%s', async (_label, fileName) => {
  await expect(recordDesignUploadAction(input(fileName))).resolves.toMatchObject({
    ok: false,
    message: expect.stringMatching(/文件名|扩展名/),
  });
  expect(mocks.record).not.toHaveBeenCalled();
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
