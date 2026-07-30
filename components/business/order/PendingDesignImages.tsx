'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { prepareDesignFile, type PreparedDesignFile } from './design-upload-client';

export type PendingDesignImage = {
  id: string;
  prepared: PreparedDesignFile;
};

type Props = {
  itemNumber: number;
  images: PendingDesignImage[];
  disabled?: boolean;
  onChange: (images: PendingDesignImage[]) => void;
};

function createPendingId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function PendingDesignImages({
  itemNumber,
  images,
  disabled = false,
  onChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const previews = useMemo(
    () =>
      images.map((image) => ({
        ...image,
        previewUrl: URL.createObjectURL(image.prepared.file),
      })),
    [images],
  );

  useEffect(
    () => () => {
      for (const preview of previews) URL.revokeObjectURL(preview.previewUrl);
    },
    [previews],
  );

  function addFiles(files: Iterable<File>) {
    const next: PendingDesignImage[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      const prepared = prepareDesignFile(file, {
        imagesOnly: true,
        fallbackStem: `pasted-design-${Date.now()}-${next.length + 1}`,
      });
      if (!prepared.ok) {
        rejected.push(`${file.name || '剪贴板图片'}：${prepared.message}`);
        continue;
      }
      next.push({
        id: createPendingId(),
        prepared: prepared.value,
      });
    }

    if (next.length > 0) onChange([...images, ...next]);
    setMessage(rejected.length > 0 ? rejected.join('；') : null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
      <div
        data-testid={`pending-design-paste-${itemNumber - 1}`}
        tabIndex={disabled ? -1 : 0}
        role="button"
        aria-disabled={disabled}
        aria-label={`款式 ${itemNumber} 设计图粘贴与拖放区域`}
        className="rounded-md px-2 py-3 text-center outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50"
        onPaste={(event) => {
          if (disabled) return;
          const files = Array.from(event.clipboardData.files).filter((file) =>
            file.type.startsWith('image/'),
          );
          if (files.length === 0) return;
          event.preventDefault();
          addFiles(files);
        }}
        onDragOver={(event) => {
          if (!disabled) event.preventDefault();
        }}
        onDrop={(event) => {
          if (disabled) return;
          event.preventDefault();
          addFiles(Array.from(event.dataTransfer.files));
        }}
        onKeyDown={(event) => {
          if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <p className="font-medium text-foreground">
          在这里粘贴、拖入或选择设计图
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          支持 JPG / PNG / WEBP，单张不超过 10 MiB；图片会在草稿创建后上传
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          aria-label={`款式 ${itemNumber} 选择设计图`}
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          disabled={disabled}
          onChange={(event) => addFiles(Array.from(event.target.files ?? []))}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          选择图片
        </Button>
        <span className="text-xs text-muted-foreground">
          CDR 源文件可在草稿详情页上传
        </span>
      </div>

      {previews.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {previews.map((image) => (
            <li key={image.id} className="min-w-0 rounded-md border bg-card p-2">
              {/* Blob previews are local and cannot be handled by next/image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.previewUrl}
                alt={`待上传设计图：${image.prepared.file.name}`}
                className="aspect-square w-full rounded object-cover"
              />
              <p
                className="mt-1 truncate text-xs text-muted-foreground"
                title={image.prepared.file.name}
              >
                {image.prepared.file.name}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1 w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={disabled}
                onClick={() => onChange(images.filter((entry) => entry.id !== image.id))}
              >
                移除
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {message ? (
        <p role="alert" className="text-xs text-destructive">
          {message}
        </p>
      ) : null}
    </div>
  );
}
