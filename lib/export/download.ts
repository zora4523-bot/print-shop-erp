const ALLOWED_TYPES = new Set(['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
export class ExportDownloadError extends Error {}

/** Keep HTTP errors and login HTML on the page instead of saving them as files. */
export async function fetchExportFile(href: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(60_000);
  try {
    return await readExportFile(href, signal ? AbortSignal.any([signal, timeout]) : timeout);
  } catch (error) {
    if (timeout.aborted && !signal?.aborted) throw new ExportDownloadError('下载等待超时，请稍后重试。');
    throw error;
  }
}

async function readExportFile(href: string, signal: AbortSignal) {
  const response = await fetch(href, { cache: 'no-store', signal });
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? '登录已失效或没有导出权限，请重新登录后重试。'
      : response.status === 404 || response.status === 410
        ? '导出文件不存在或已过期，请重新生成。'
        : response.status === 409 ? '文件仍在生成，请稍后重试。'
          : response.status === 400 ? '筛选条件不合法或结果过多，请缩小范围后重试。'
            : '暂时无法下载，请稍后重试。';
    throw new ExportDownloadError(message);
  }
  const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (!type || !ALLOWED_TYPES.has(type)) throw new ExportDownloadError('未收到有效的导出文件，请刷新后重试。');
  const header = response.headers.get('Content-Disposition') ?? '';
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
  let name = header.match(/filename="([^"\r\n]+)"/iu)?.[1] ?? (type === 'text/csv' ? 'bills.csv' : 'bills.xlsx');
  if (encoded) {
    try { name = decodeURIComponent(encoded); } catch { /* Retain the safe ASCII fallback. */ }
  }
  const blob = await response.blob();
  if (!blob.size) throw new ExportDownloadError('导出文件为空，请重新生成。');
  return { blob, fileName: name.replace(/[\\/\p{Cc}]/gu, '_') };
}

export function saveExportFile(file: { blob: Blob; fileName: string }) {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke after the browser has started consuming the object URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
