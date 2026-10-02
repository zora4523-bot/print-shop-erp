import { createHash } from 'node:crypto';

/** Public allowlist: never interpolate renderer diagnostics or persisted error text. */
function failureDetails(code: string | null) {
  switch (code) {
    case 'PdfBusyError': return { code: 'PDF_BUSY', message: '当前下载较多，请稍后重试；也可以使用网页打印。' };
    case 'PdfBrowserUnavailableError': return { code: 'PDF_BROWSER_UNAVAILABLE', message: 'PDF 浏览器未就绪，可以使用网页打印，或联系管理员检查服务。' };
    case 'TimeoutError': return { code: 'PDF_RENDER_TIMEOUT', message: '生成超过等待时间，可以使用网页打印，或稍后重新生成。' };
    case 'PrintFontUnavailableError': return { code: 'PDF_FONT_UNAVAILABLE', message: '打印字体未就绪，请联系管理员检查 PDF 服务。' };
    case 'PDF_BROWSER_VERSION_MISMATCH': return { code: 'PDF_BROWSER_VERSION_MISMATCH', message: '打印服务版本不匹配，请联系管理员检查 PDF 服务。' };
    case 'PrintLayoutOverflowError': return { code: 'PDF_LAYOUT_OVERFLOW', message: '内容超出打印页面，请检查过长的内容后重新生成。' };
    case 'PrintArtworkUnavailableError': return { code: 'PDF_ARTWORK_UNAVAILABLE', message: '设计图未加载完整，请检查设计文件后重新生成。' };
    case 'OrderPdfVersionStaleError': return { code: 'PDF_VERSION_CHANGED', message: '工单内容已更新，请重新生成当前版本。' };
    case 'PdfArtifactStorageError': return { code: 'PDF_STORAGE_UNAVAILABLE', message: '生成结果暂时无法保存，请联系管理员检查 PDF 服务。' };
    default: return { code: 'PDF_GENERATION_FAILED', message: '生成失败，请重新生成；如仍失败，请联系管理员。' };
  }
}

export function pdfFailure(code: string | null) {
  const failure = failureDetails(code);
  const status = ['PDF_BUSY', 'PDF_BROWSER_UNAVAILABLE', 'PDF_FONT_UNAVAILABLE',
    'PDF_STORAGE_UNAVAILABLE', 'PDF_BROWSER_VERSION_MISMATCH'].includes(failure.code) ? 503 : 500;
  return { ...failure, status };
}

export type PdfStatus = {
  title: string;
  message: string;
  status: number;
  retryUrl: string;
  code?: string;
  requestId?: string;
};
type Presentation = { orderId: string; operator: boolean; json: boolean; worker?: boolean };

export function pdfRetryUrl(requestUrl: string, jobId?: string): string {
  const url = new URL(requestUrl);
  const inline = url.searchParams.get('view') === 'inline';
  url.search = '';
  if (inline) url.searchParams.set('view', 'inline');
  if (jobId) url.searchParams.set('jobId', jobId);
  else url.searchParams.set('regenerate', '1');
  return `${url.pathname}${url.search}`;
}

// Poll status without replacing the document or stealing keyboard focus.
// A completed download still goes through the authenticated PDF route again.
const POLL_SCRIPT = `(() => {
const panel = document.querySelector('main');
const retry = document.getElementById('retry');
const title = document.getElementById('title');
const message = document.getElementById('message');
const code = document.getElementById('code');
const started = Date.now();
let stopped = false;
let failures = 0;
addEventListener('pagehide', () => { stopped = true; }, { once: true });
async function poll() {
 if (stopped) return;
 try {
  const url = new URL(retry.href); url.searchParams.set('status', '1');
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (response.status === 401 || response.status === 403) {
   panel.removeAttribute('aria-busy');
   message.textContent = '登录已失效或无权查看，请返回工单重新登录。'; return;
  }
  const data = await response.json();
  if (stopped) return;
  if (!['ready', 'pending', 'failed'].includes(data.state)) throw new Error('status');
  if (data.state === 'ready') {
   title.textContent = 'PDF 已生成'; message.textContent = '正在打开生成结果；未自动打开时可点击下方按钮。';
   retry.textContent = '打开 PDF'; panel.removeAttribute('aria-busy');
   location.replace(retry.href); return;
  }
  failures = 0;
  title.textContent = data.title; message.textContent = data.message;
  code.textContent = data.code ? '错误码：' + data.code : '';
  retry.href = data.retryUrl;
  const recovering = response.status === 503 && data.code === 'PDF_WORKER_UNAVAILABLE';
  if ((data.state === 'pending' || recovering) && Date.now() - started < 120000) { setTimeout(poll, recovering ? 10000 : 3000); return; }
  panel.removeAttribute('aria-busy');
  retry.textContent = '立即重试';
  if (data.state === 'pending' || recovering) message.textContent = '等待时间较长，已停止自动查询。可以手动查询或使用网页打印。';
 } catch {
  if (stopped) return;
  failures += 1;
  if (failures < 3 && Date.now() - started < 120000) { setTimeout(poll, 10000); return; }
  panel.removeAttribute('aria-busy');
  message.textContent = '暂时无法查询生成结果，请重试；登录过期时请返回工单重新登录。';
 }
}
setTimeout(poll, 3000);
})();`;

export function pdfStatusResponse(input: PdfStatus, view: Presentation): Response {
  const pending = input.status === 202;
  const payload = { state: pending ? 'pending' : 'failed', title: input.title, message: input.message, code: input.code, retryUrl: input.retryUrl };
  const headers = { 'Cache-Control': 'private, no-store', ...(input.requestId ? { 'X-Request-Id': input.requestId } : {}), ...(pending ? { 'Retry-After': '3' } : {}) };
  if (view.json) return Response.json(payload, { status: input.status, headers });
  const id = encodeURIComponent(view.orderId);
  const polling = pending || (input.status === 503 && input.code === 'PDF_WORKER_UNAVAILABLE' && new URL(input.retryUrl, 'https://local.invalid').searchParams.has('jobId'));
  const script = polling ? `<script>${POLL_SCRIPT}</script>` : '';
  const hash = createHash('sha256').update(POLL_SCRIPT).digest('base64');
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title>
<style>:root{color-scheme:light dark}*{box-sizing:border-box}body{font-family:system-ui,sans-serif;background:Canvas;color:CanvasText;line-height:1.65;margin:0}main{max-width:44rem;margin:10vh auto;padding:1.5rem}h1{font-size:1.5rem}p{overflow-wrap:anywhere}nav{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.5rem}a{display:inline-flex;align-items:center;min-height:44px;padding:.5rem .875rem;border:1px solid currentColor;border-radius:.5rem;color:LinkText;text-decoration:none}a:focus-visible{outline:3px solid Highlight;outline-offset:3px}.code{font-size:.875rem}</style></head>
<body><main${polling ? ' aria-busy="true"' : ''}><div role="status" aria-live="polite"><h1 id="title">${escapeHtml(input.title)}</h1><p id="message">${escapeHtml(input.message)}</p><p id="code" class="code">${input.code ? `错误码：${escapeHtml(input.code)}` : ''}</p></div>
<nav aria-label="PDF 恢复操作"><a id="retry" href="${escapeHtml(input.retryUrl)}">${pending ? '查询生成结果' : '立即重试'}</a><a href="/print/orders/${id}">网页打印</a><a href="${view.worker ? '/worker/orders' : '/orders'}/${id}">返回工单</a>${view.operator ? '<a href="/owner/background-jobs">查看后台任务与服务状态</a>' : ''}</nav><noscript><p>请点击“查询生成结果”或“立即重试”手动查询。</p></noscript></main>${script}</body></html>`, {
    status: input.status,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'`, 'X-Content-Type-Options': 'nosniff' },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
