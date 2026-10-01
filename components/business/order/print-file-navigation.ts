'use client';

/**
 * 批量打印文件的取得与交付（业主 2026-10-02 点打印即记已打印）：先取得文件，记录成功后再交给
 * 管理员，出错时页面留在原处。单独成模块，组件测试可替换真实网络与导航。
 */
export function openBlankPrintTab(): Window | null {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  return tab;
}

type FetchedPrintFile = { ok: true; blob: Blob } | { ok: false; message: string };

export async function fetchPrintFile(url: string): Promise<FetchedPrintFile> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '打印文件暂不可用，请重新生成';
      return { ok: false, message };
    }
    return { ok: true, blob: await response.blob() };
  } catch {
    return { ok: false, message: '网络异常' };
  }
}

/**
 * 交付已取得的文件：下载直接保存；预览打开到点击当下开好的标签页。标签页被浏览器拦截或已被
 * 关闭时返回文件地址，由页面给出「打开打印文件」链接（用户再点一次即可打开）。
 */
export function deliverPrintFile(blob: Blob, delivery: 'download' | 'inline', tab: Window | null, fileName: string): string | null {
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
  if (delivery === 'download') {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    return null;
  }
  if (tab && !tab.closed) {
    tab.location.href = url;
    return null;
  }
  return url;
}
