'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
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
  onBusyChange?: (busy: boolean) => void;
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
  onBusyChange,
}: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const mutationInFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const [deleting, startDelete] = useTransition();
  useEffect(() => {
    onBusyChange?.(busy || deleting);
    return () => onBusyChange?.(false);
  }, [busy, deleting, onBusyChange]);
  const operationPending = busy || deleting;
  const imageDesigns = designs.filter((design) => design.fileType === 'IMAGE');
  const cdrDesigns = designs.filter((design) => design.fileType === 'CDR');

  async function handleFiles(files: Iterable<File>) {
    if (!canEdit || mutationInFlight.current) return;
    const candidates = Array.from(files);
    if (candidates.length === 0) return;
    mutationInFlight.current = true;
    setBusy(true);
    setMessage(null);
    const failures: string[] = [];
    let uploaded = 0;
    try {
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
        if (result.ok) uploaded += 1;
        else failures.push(`${prepared.value.file.name}：${result.message}`);
      }
      setMessage(
        failures.length > 0
          ? {
              tone: 'error',
              text: `${uploaded > 0 ? `已上传 ${uploaded} 个；` : ''}${failures.join('；')}`,
            }
          : { tone: 'success', text: `已上传 ${uploaded} 个设计文件` },
      );
    } catch {
      setMessage({
        tone: 'error',
        text: '上传结果未确认，请刷新核对文件后再操作。',
      });
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
      if (uploaded > 0) router.refresh();
    }
  }

  function handleDelete(designId: string) {
    if (!canEdit || mutationInFlight.current) return;
    mutationInFlight.current = true;
    setMessage(null);
    startDelete(async () => {
      try {
        const result = await deleteOrderItemDesignAction({ designId });
        if (!result.ok) {
          setMessage({ tone: 'error', text: result.message });
          return;
        }
        router.refresh();
      } catch {
        setMessage({
          tone: 'error',
          text: '删除结果未确认，请刷新核对文件后再操作。',
        });
      } finally {
        mutationInFlight.current = false;
      }
    });
  }

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          设计文件（{designs.length}）
        </span>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              aria-label="上传设计文件"
              disabled={operationPending}
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
              disabled={operationPending}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? '上传中…' : '选择设计文件'}
            </Button>
          </div>
        ) : null}
      </div>
      {canEdit ? (
        <div
          tabIndex={operationPending ? -1 : 0}
          role="button"
          aria-disabled={operationPending}
          aria-label="粘贴或拖入设计图"
          className="rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-4 text-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onPaste={(event) => {
            if (operationPending) return;
            const files = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith('image/'),
            );
            if (files.length === 0) return;
            event.preventDefault();
            void handleFiles(files);
          }}
          onDragOver={(event) => {
            if (!operationPending) event.preventDefault();
          }}
          onDrop={(event) => {
            if (operationPending) return;
            event.preventDefault();
            void handleFiles(Array.from(event.dataTransfer.files));
          }}
          onKeyDown={(event) => {
            if (
              !operationPending &&
              (event.key === 'Enter' || event.key === ' ')
            ) {
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
        <div className="space-y-4">
          {imageDesigns.length > 0 ? (
            <section aria-labelledby={`design-preview-${orderItemId}`}>
              <p
                id={`design-preview-${orderItemId}`}
                className="mb-2 text-xs font-medium text-foreground"
              >
                效果图预览（{imageDesigns.length}）
              </p>
              <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {imageDesigns.map((design) => (
                  <li
                    key={design.id}
                    className="min-w-0 overflow-hidden rounded-lg border bg-card"
                  >
                    <a
                      href={design.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`查看原图：${design.fileName}`}
                      className="group block bg-muted/30 p-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="flex h-72 items-center justify-center overflow-hidden rounded-md sm:h-96">
                        {/* 预签/公网 URL 域名不固定，next/image 需要穷举
                            remotePatterns；直接使用原地址也避免代理重复下载。 */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={design.fileUrl}
                          alt={design.fileName}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-contain transition-transform group-hover:scale-[1.01]"
                        />
                      </span>
                    </a>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-t px-3 py-2 text-xs">
                      <span
                        className="admin-wrap-anywhere min-w-0 flex-1 font-medium"
                        title={design.fileName}
                      >
                        {design.fileName}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatSize(design.fileSize)}
                      </span>
                      <span className="shrink-0 text-primary">
                        点击图片查看原图
                      </span>
                      {canEdit ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={operationPending}
                          onClick={() => handleDelete(design.id)}
                        >
                          删除
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {cdrDesigns.length > 0 ? (
            <section aria-labelledby={`cdr-files-${orderItemId}`}>
              <p
                id={`cdr-files-${orderItemId}`}
                className="mb-2 text-xs font-medium text-foreground"
              >
                CDR 源文件（{cdrDesigns.length}）
              </p>
              <ul className="flex flex-wrap gap-3">
                {cdrDesigns.map((design) => (
                  <li
                    key={design.id}
                    className="flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs">
                      CDR
                    </span>
                    <span
                      className="admin-wrap-anywhere min-w-0"
                      title={design.fileName}
                    >
                      {design.fileName}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatSize(design.fileSize)}
                    </span>
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={operationPending}
                        onClick={() => handleDelete(design.id)}
                      >
                        删除
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
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
