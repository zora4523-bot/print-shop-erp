import { PDFDocument } from 'pdf-lib';
import { renderHtmlToPdf } from './render';
import { checkPdfArtifactStorage, PdfArtifactStorageError } from './artifacts';
import { embeddedPrintFontCss } from '../order/print-fonts-server';
import { requirePrintFonts } from '../order/print-fonts';

/** Real rendering, font loading and private storage round trip, before worker heartbeat. */
export async function checkPdfRuntime() {
  const start = performance.now();
  const html = `<html lang="zh-CN"><head><meta charset="utf-8"><style>${await embeddedPrintFontCss()} body{font-family:"ERP Print Sans"}</style></head><body data-print-fonts="required"><h1>工单 PDF 中文检查</h1><p>GD-0123456789</p><script>(${requirePrintFonts.toString()})(document).finally(()=>{document.documentElement.dataset.printReady='true'})</script></body></html>`;
  const pdf = await renderHtmlToPdf({ html, signal: AbortSignal.timeout(30_000) });
  if (pdf.subarray(0, 5).toString() !== '%PDF-' || (await PDFDocument.load(pdf)).getPageCount() !== 1) throw new PdfRuntimeCheckError();
  try { await checkPdfArtifactStorage(pdf); }
  catch { throw new PdfArtifactStorageError(); }
  return { bytes: pdf.byteLength, elapsedMs: Math.round(performance.now() - start) };
}
class PdfRuntimeCheckError extends Error {
  constructor() { super('PDF runtime check failed'); this.name = 'PdfRuntimeCheckError'; }
}