import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ run: vi.fn(), render: vi.fn() }));
vi.mock('../browser-pool', () => ({ PdfBrowserPool: class { run = mocks.run; } }));
vi.mock('../render', () => ({ renderHtmlToPdf: mocks.render }));
import { renderDirectOrderPdf } from '../direct';

afterEach(() => vi.restoreAllMocks());

it('binds actual cached bytes to actor, role, full content and base URL', async () => {
  mocks.run.mockImplementation((task) => task({}, {}));
  mocks.render.mockImplementation(async () => Buffer.from(`pdf-${mocks.render.mock.calls.length}`));
  const input = { orderId: 'scope-order', actorId: 'a', actorRole: 'ADMIN', snapshotKey: 'v1', baseUrl: 'https://erp.test', html: async () => '<html/>', signal: new AbortController().signal, regenerate: false };
  const initial = await renderDirectOrderPdf(input);
  expect(await renderDirectOrderPdf(input)).toEqual(initial);
  for (const change of [{ actorId: 'b' }, { actorRole: 'OWNER' }, { snapshotKey: 'v2' }, { baseUrl: 'https://other.test' }]) {
    expect(await renderDirectOrderPdf({ ...input, ...change })).not.toEqual(initial);
  }
  expect(mocks.render).toHaveBeenCalledTimes(5);
});

it('bounds waiting and does not cache an expired render', async () => {
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  let finish!: (bytes: Buffer) => void;
  mocks.run.mockImplementationOnce(() => new Promise<Buffer>((resolve) => { finish = resolve; }));
  const input = { orderId: 'timeout-order', actorId: 'a', actorRole: 'ADMIN', snapshotKey: 'v1', baseUrl: 'https://erp.test', html: async () => '<html/>', signal: new AbortController().signal, regenerate: false };
  const pending = renderDirectOrderPdf(input);
  await Promise.resolve();
  controller.abort(new DOMException('expired', 'TimeoutError'));
  await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  finish(Buffer.from('late-pdf'));
  await Promise.resolve();
  vi.mocked(AbortSignal.timeout).mockReturnValue(new AbortController().signal);
  mocks.run.mockResolvedValueOnce(Buffer.from('fresh-pdf'));
  expect(await renderDirectOrderPdf(input)).toEqual(Buffer.from('fresh-pdf'));
});
