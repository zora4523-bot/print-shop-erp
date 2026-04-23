import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getOrderForPrint } from '@/lib/order/print-view';
import { buildPrintHtml } from '@/lib/order/print-html';
import { renderHtmlToPdf } from '@/lib/pdf/render';

// Node runtime: Puppeteer needs it (spawns Chromium).
export const runtime = 'nodejs';
// PDFs are per-order, generated on demand. No caching yet — once we
// know what staleness window is acceptable we can turn on
// `export const revalidate = N;` or an ETag.
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Params) {
  const session = await getSession();
  if (!session) {
    // API routes don't go through the page-redirect middleware; return
    // JSON 401 so a failed download is an obvious error in the
    // download manager / devtools instead of a silent empty file.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const order = await getOrderForPrint(id, {
    id: session.user.id,
    role: session.user.role,
  });
  if (!order) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let pdf: Buffer;
  try {
    const html = buildPrintHtml(order);
    pdf = await renderHtmlToPdf({ html });
  } catch (err) {
    // Most likely cause here is Chromium not yet installed on the
    // host (pnpm may skip puppeteer's postinstall). Return a 500 with
    // a hint so the owner knows to run `npx puppeteer browsers install`
    // instead of guessing at the browser side.
    const hint =
      err instanceof Error && /Could not find (Chromium|browser)/i.test(err.message)
        ? '请在服务器上运行 `npx puppeteer browsers install chrome` 下载渲染所需的 Chromium。'
        : null;
    return NextResponse.json(
      {
        error: 'PDF 生成失败',
        message: err instanceof Error ? err.message : String(err),
        hint,
      },
      { status: 500 },
    );
  }

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': buildAttachmentHeader(`${order.orderNo}.pdf`),
      'Content-Length': String(pdf.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}

// RFC 5987 / 6266: ship an ASCII fallback for legacy clients and the
// UTF-8 spelling via filename*= for anything modern. orderNo is ASCII
// today (YYYYMMDD-XXXX) but the factory name prefix might leak into
// future naming, and the extra header is cheap.
function buildAttachmentHeader(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()]/g, escape);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
