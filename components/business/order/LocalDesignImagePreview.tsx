'use client';

import { useEffect, useRef } from 'react';
import { DesignFileType } from '@/generated/prisma/enums';
import { cn } from '@/lib/utils';
import type { PreparedDesignFile } from './design-upload-client';

export function LocalDesignImagePreview({
  image,
  alt,
  className,
}: {
  image: PreparedDesignFile;
  alt: string;
  className?: string;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const { file, fileType, mimeType } = image;

  useEffect(() => {
    const imageElement = imageRef.current;
    if (!imageElement || fileType !== DesignFileType.IMAGE) return;

    const nextPreviewUrl = URL.createObjectURL(
      new Blob([file], { type: mimeType }),
    );
    imageElement.src = nextPreviewUrl;

    return () => {
      imageElement.removeAttribute('src');
      URL.revokeObjectURL(nextPreviewUrl);
    };
  }, [file, fileType, mimeType]);

  if (fileType !== DesignFileType.IMAGE) return null;

  return (
    <>
      {/* Blob previews are local and cannot be handled by next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        data-slot="local-design-image-preview"
        alt={alt}
        decoding="async"
        draggable={false}
        className={cn('h-full w-full object-contain', className)}
      />
    </>
  );
}
