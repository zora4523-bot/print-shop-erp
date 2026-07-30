type DesignImage = {
  id: string;
  fileName: string;
  fileUrl: string;
};

type Props = {
  images: DesignImage[];
  heading?: string;
};

export function DesignImageGallery({
  images,
  heading = '设计图',
}: Props) {
  if (images.length === 0) return null;

  return (
    <section className="mt-3 rounded-lg border bg-muted/20 p-3">
      <h3 className="text-sm font-semibold">
        {heading}（{images.length}）
      </h3>
      <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {images.map((image) => (
          <li key={image.id} className="min-w-0 rounded-md border bg-card p-2">
            <a
              href={image.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="block rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label={`查看设计图：${image.fileName}`}
            >
              {/* OSS signed URLs use deployment-specific hosts. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.fileUrl}
                alt={image.fileName}
                className="aspect-square w-full rounded object-cover"
              />
            </a>
            <p
              className="worker-wrap-anywhere mt-1 line-clamp-2 text-xs text-muted-foreground"
              title={image.fileName}
            >
              {image.fileName}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
