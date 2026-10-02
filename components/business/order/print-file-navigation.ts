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

/** 合并文件最大约 100 MB，慢网也要能取完；超时或主动取消都会释放界面并允许重试。 */
const PRINT_FILE_TIMEOUT_MS = 5 * 60_000;

type FetchedPrintFile = { ok: true; blob: Blob } | { ok: false; message: string };

export async function fetchPrintFile(url: string, signal: AbortSignal): Promise<FetchedPrintFile> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), PRINT_FILE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.any([signal, timeout.signal]) });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '打印文件暂不可用，请重新生成';
      return { ok: false, message };
    }
    return { ok: true, blob: await response.blob() };
  } catch {
    if (signal.aborted) return { ok: false, message: '已取消' };
    if (timeout.signal.aborted) return { ok: false, message: '取得文件超时，请检查网络后重试' };
    return { ok: false, message: '网络异常' };
  } finally {
    clearTimeout(timer);
  }
}

function saveFile(url: string, fileName: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * 交付已取得的文件：下载直接保存；预览打开到点击当下开好的标签页。标签页被浏览器拦截或已被
 * 关闭时改为下载（下载不受弹窗拦截），文件总能交到管理员手上，离开列表也一样。
 */
export function deliverPrintFile(blob: Blob, delivery: 'download' | 'inline', tab: Window | null, fileName: string): 'opened' | 'downloaded' | 'downloaded-instead' {
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
  if (delivery === 'inline' && tab && !tab.closed) {
    tab.location.href = url;
    return 'opened';
  }
  saveFile(url, fileName);
  return delivery === 'download' ? 'downloaded' : 'downloaded-instead';
}
