import { PDFDocument } from 'pdf-lib';
import { expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ render: vi.fn(), storage: vi.fn() }));
vi.mock('../render', () => ({ renderHtmlToPdf: m.render }));
vi.mock('../artifacts', () => ({ checkPdfArtifactStorage: m.storage, PdfArtifactStorageError: class extends Error {} }));
vi.mock('../../order/print-fonts-server', () => ({ embeddedPrintFontCss: async () => '' }));

import { checkPdfRuntime, PDF_PROBE_BUDGET_MS } from '../preflight';

it('the worker probe uses a pool budget (starts on browser ownership), not a wall-clock signal that runs while queued', async () => {
  const doc = await PDFDocument.create(); doc.addPage();
  m.render.mockResolvedValue(Buffer.from(await doc.save()));
  m.storage.mockResolvedValue({ probeRemoved: true });
  await expect(checkPdfRuntime({ reuseWorker: true })).resolves.toMatchObject({ bytes: expect.any(Number) });
  const [options] = m.render.mock.calls[0]!;
  expect(options).toMatchObject({ budgetMs: PDF_PROBE_BUDGET_MS });
  expect(options.signal).toBeUndefined();
});

it('keeps deployment cleanup strict while worker capability only requires read/write', async () => {
  const doc = await PDFDocument.create(); doc.addPage(); m.render.mockResolvedValue(Buffer.from(await doc.save()));
  m.storage.mockResolvedValue({ probeRemoved: false });
  await expect(checkPdfRuntime({ reuseWorker: true })).resolves.toMatchObject({ bytes: expect.any(Number) });
  await expect(checkPdfRuntime({ reuseWorker: true, strictProbeCleanup: true })).rejects.toThrow();
});
