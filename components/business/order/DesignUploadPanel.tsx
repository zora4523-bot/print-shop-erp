'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  signDesignUploadAction,
  recordDesignUploadAction,
  deleteOrderItemDesignAction,
} from '@/actions/design-upload';

// 款式级设计图管理（A06 延伸）。上传三步：
//   1. signDesignUploadAction → 预签 PUT URL（服务端校验类型/大小/路径）
//   2. 浏览器 fetch PUT 直传 OSS（文件不经过我们的服务器）
//   3. recordDesignUploadAction → 服务端 HEAD 确认后写 OrderItemDesign
// 仅 DRAFT 状态渲染上传/删除控件（服务端 lib 层同样强校验）。

export type DesignItem = {
  id: string;
  fileName: string;
  fileType: 'IMAGE' | 'CDR';
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

const EXT_TO_TYPE: Record<string, { fileType: 'IMAGE' | 'CDR'; mime: string }> = {
  jpg: { fileType: 'IMAGE', mime: 'image/jpeg' },
  jpeg: { fileType: 'IMAGE', mime: 'image/jpeg' },
  png: { fileType: 'IMAGE', mime: 'image/png' },
  webp: { fileType: 'IMAGE', mime: 'image/webp' },
  cdr: { fileType: 'CDR', mime: 'application/octet-stream' },
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
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  async function handleFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const mapped = EXT_TO_TYPE[ext];
    if (!mapped) {
      setMessage('仅支持 jpg / jpeg / png / webp / cdr 文件');
      // 不清 value 的话，再次选同一个文件不会触发 onChange
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const signed = await signDesignUploadAction({
        orderId,
        orderItemId,
        fileType: mapped.fileType,
        fileName: file.name,
        fileSize: file.size,
        // 浏览器对 .cdr 常给空 mime；统一用映射值，与预签 URL 绑定的
        // Content-Type 保持一致（不一致 OSS 会 403）。
        mimeType: mapped.mime,
      });
      if (signed.status === 'not-configured') {
        setMessage(signed.message);
        return;
      }
      if (signed.status === 'invalid') {
        setMessage(Object.values(signed.fieldErrors).flat().join('；'));
        return;
      }
      if (signed.status === 'error') {
        setMessage(signed.message);
        return;
      }
      const putResp = await fetch(signed.putUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mapped.mime },
        body: file,
      });
      if (!putResp.ok) {
        setMessage(`上传失败（OSS ${putResp.status}），请重试`);
        return;
      }
      // fileSize 不传——服务端以 OSS HEAD 的 Content-Length 为准
      const recorded = await recordDesignUploadAction({
        orderId,
        orderItemId,
        objectKey: signed.objectKey,
        fileType: mapped.fileType,
        fileName: file.name,
      });
      if (!recorded.ok) {
        setMessage(recorded.message);
        return;
      }
      router.refresh();
    } catch {
      setMessage('上传过程中断（网络错误），请重试');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function handleDelete(designId: string) {
    setMessage(null);
    startDelete(async () => {
      const r = await deleteOrderItemDesignAction({ designId });
      if (!r.ok) {
        setMessage(r.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          设计图（{designs.length}）
        </span>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.cdr"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? '上传中…' : '上传设计图'}
            </Button>
          </div>
        ) : null}
      </div>
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
                <button
                  type="button"
                  className="text-destructive hover:underline disabled:opacity-50"
                  disabled={deleting}
                  onClick={() => handleDelete(d.id)}
                >
                  删除
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          暂无设计图{canEdit ? '，可上传 JPG/PNG/WEBP 图片或 CDR 源文件' : ''}
        </p>
      )}
      {message ? <p className="text-xs text-destructive">{message}</p> : null}
    </div>
  );
}
