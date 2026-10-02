import { PdfBrowserPool } from './browser-pool';
import { pdfLaunchOptions } from './launch-options';
import { PDFDocument } from 'pdf-lib';
import { renderHtmlToPdf } from './render';
import { checkPdfArtifactStorage, PdfArtifactStorageError } from './artifacts';
import { embeddedPrintFontCss } from '../order/print-fonts-server';
import { requirePrintFonts } from '../order/print-fonts';

export const PDF_PROBE_BUDGET_MS = 30_000;

/** Real rendering, font loading and private storage round trip, independently of worker liveness. */
export async function checkPdfRuntime(options: { reuseWorker?: boolean; strictProbeCleanup?: boolean } = {}) {
  const start = performance.now();
  const html = `<html lang="zh-CN"><head><meta charset="utf-8"><style>${await embeddedPrintFontCss()} body{font-family:"ERP Print Sans"}</style></head><body data-print-fonts="required"><h1>工单 PDF 中文检查</h1><p>GD-0123456789</p><script>(${requirePrintFonts.toString()})(document).finally(()=>{document.documentElement.dataset.printReady='true'})</script></body></html>`;
  // Worker probes share its serial pool; CLI probes own a bounded disposable pool.
  // The probe budget is a pool budget: it starts when the probe owns the browser,
  // so queueing behind a real render never fails the probe.
  if (options.reuseWorker) {
    return validatePdf(await renderHtmlToPdf({ html, budgetMs: PDF_PROBE_BUDGET_MS }), start, options.strictProbeCleanup);
  }
  const pool = new PdfBrowserPool(async () => {
    const { default: puppeteer } = await import('puppeteer');
    return puppeteer.launch(pdfLaunchOptions());
  });
  let pdf: Buffer;
  try {
    pdf = await pool.run((browser, context, signal) => renderHtmlToPdf({ html, browser, context, signal }), { budgetMs: PDF_PROBE_BUDGET_MS });
  } finally {
    await pool.close();
  }
  return validatePdf(pdf, start, options.strictProbeCleanup);
}

async function validatePdf(pdf: Buffer, start: number, strictProbeCleanup = false) {
  if (pdf.subarray(0, 5).toString() !== '%PDF-' || (await PDFDocument.load(pdf)).getPageCount() !== 1) throw new PdfRuntimeCheckError();
  try {
    const result = await checkPdfArtifactStorage(pdf);
    if (strictProbeCleanup && !result.probeRemoved) throw new PdfArtifactStorageError();
  }
  catch { throw new PdfArtifactStorageError(); }
  return { bytes: pdf.byteLength, elapsedMs: Math.round(performance.now() - start) };
}
class PdfRuntimeCheckError extends Error {
  constructor() { super('PDF runtime check failed'); this.name = 'PdfRuntimeCheckError'; }
}