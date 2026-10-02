'use client';

import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExportDownloadError, fetchExportFile, saveExportFile } from '@/lib/export/download';

export function SalesBillExportButton({ href, label = '导出 CSV', pendingLabel = '正在导出…' }: { href: string; label?: string; pendingLabel?: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function download() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setMessage('');
    try {
      const file = await fetchExportFile(href, controller.signal);
      if (!controller.signal.aborted) saveExportFile(file);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof ExportDownloadError ? error.message : '网络连接失败，请重试下载。');
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setPending(false);
      }
    }
  }

  return <div className="min-w-0 space-y-2">
    <Button type="button" onClick={download} disabled={pending} aria-busy={pending} variant="outline" className="min-h-11 shrink-0">
      <Download aria-hidden="true" />{pending ? pendingLabel : label}
    </Button>
    <noscript><a href={href}>{label}</a></noscript>
    {message ? <p role="alert" className="max-w-md text-sm text-destructive">{message}</p> : null}
  </div>;
}
