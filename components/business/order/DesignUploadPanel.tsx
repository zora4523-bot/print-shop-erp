'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { deleteOrderItemDesignAction } from '@/actions/design-upload';
import {
  prepareDesignFile,
  uploadOrderItemDesignFile,
} from './design-upload-client';

// 款式级设计图管理（A06 延伸）。上传三步：
//   1. signDesignUploadAction → 预签 PUT URL（服务端校验类型/大小/路径）
//   2. 浏览器 fetch PUT 直传 OSS（文件不经过我们的服务器）
//   3. recordDesignUploadAction → 服务端 HEAD 确认后写 OrderItemDesign
// 仅 DRAFT 状态渲染上传/删除控件（服务端 lib 层同样强校验）。

export type DesignItem = {
  id: string;
  fileName: string;
  fileType: 'IMAGE' | 'CDR';
  // IMAGE：30min 预签 GET（页面层签）。CDR：空串——面板只显示 chip，
  // 不提供下载链接（受控下载口在 CDR 汇总）。
  fileUrl: string;
  // BigInt 不能过 RSC 序列化边界，页面层先转 string
  fileSize: string;
};

type Props = {
  orderId: string;
  orderItemId: string;
  designs: DesignItem[];
  canEdit: boolean;
};

function formatSize(size: string): string {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DesignUploadPanel({
  orderId,
  orderItemId,
  designs,
  canEdit,
}: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const [deleting, startDelete] = useTransition();

  async function handleFiles(files: Iterable<File>) {
    const candidates = Array.from(files);
    if (candidates.length === 0) return;
    setBusy(true);
    setMessage(null);
    const failures: string[] = [];
    let uploaded = 0;

    for (const file of candidates) {
      const prepared = prepareDesignFile(file);
      if (!prepared.ok) {
        failures.push(`${file.name || '剪贴板图片'}：${prepared.message}`);
        continue;
      }
      const result = await uploadOrderItemDesignFile({
        orderId,
        orderItemId,
        prepared: prepared.value,
      });
      if (result.ok) {
        uploaded += 1;
      } else {
        failures.push(`${prepared.value.file.name}：${result.message}`);
      }
    }

    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
    if (failures.length > 0) {
      setMessage({
        tone: 'error',
        text: `${uploaded > 0 ? `已上传 ${uploaded} 个；` : ''}${failures.join('；')}`,
      });
    } else {
      setMessage({ tone: 'success', text: `已上传 ${uploaded} 个设计文件` });
    }
    if (uploaded > 0) router.refresh();
  }

  function handleDelete(designId: string) {
    setMessage(null);
    startDelete(async () => {
      const r = await deleteOrderItemDesignAction({ designId });
      if (!r.ok) {
        setMessage({ tone: 'error', text: r.message });
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          设计图（{designs.length}）
        </span>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.cdr"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleFiles(Array.from(e.target.files ?? []));
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? '上传中…' : '选择设计文件'}
            </Button>
          </div>
        ) : null}
      </div>
      {canEdit ? (
        <div
          tabIndex={busy ? -1 : 0}
          role="button"
          aria-disabled={busy}
          aria-label="粘贴或拖入设计图"
          className="rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-4 text-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onPaste={(event) => {
            if (busy) return;
            const files = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith('image/'),
            );
            if (files.length === 0) return;
            event.preventDefault();
            void handleFiles(files);
          }}
          onDragOver={(event) => {
            if (!busy) event.preventDefault();
          }}
          onDrop={(event) => {
            if (busy) return;
            event.preventDefault();
            void handleFiles(Array.from(event.dataTransfer.files));
          }}
          onKeyDown={(event) => {
            if (!busy && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
        >
          <p className="text-xs font-medium text-foreground">
            可直接粘贴截图或拖入设计文件
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            JPG / PNG / WEBP 图片，或 CDR 源文件
          </p>
        </div>
      ) : null}
      {designs.length > 0 ? (
        <ul className="flex flex-wrap gap-3">
          {designs.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
            >
              {d.fileType === 'IMAGE' ? (
                // 预签/公网 URL 域名不固定，next/image 需要 remotePatterns
                // 白名单；缩略图用原生 img 即可。
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={d.fileUrl}
                  alt={d.fileName}
                  className="h-10 w-10 rounded object-cover"
                />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded bg-muted font-mono text-[10px]">
                  CDR
                </span>
              )}
              <span className="max-w-40 truncate" title={d.fileName}>
                {d.fileName}
              </span>
              <span className="text-muted-foreground">{formatSize(d.fileSize)}</span>
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={deleting}
                  onClick={() => handleDelete(d.id)}
                >
                  删除
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          暂无设计图{canEdit ? '，可上传 JPG/PNG/WEBP 图片或 CDR 源文件' : ''}
        </p>
      )}
      {message ? (
        <p
          role={message.tone === 'success' ? 'status' : 'alert'}
          className={
            message.tone === 'success'
              ? 'text-xs text-primary'
              : 'text-xs text-destructive'
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
