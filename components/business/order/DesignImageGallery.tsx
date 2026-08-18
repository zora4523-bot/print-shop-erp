type DesignImage = {
  id: string;
  fileName: string;
  fileUrl: string;
};

type Props = {
  images: DesignImage[];
  heading?: string;
  // 标题层级由调用方定：/worker/orders/[id] 里外层是 h2「款式」，
  // 设计图作为它的子块用 h3 是对的；而 /worker/tasks/[id] 里设计图是
  // 页面的一级分区（同级还有 h2「任务规格」「报工」），继续用 h3 会
  // 造成 h1 → h3 → h2 的跳级+倒置。
  headingLevel?: 2 | 3;
};

export function DesignImageGallery({
  images,
  heading = '设计图',
  headingLevel = 3,
}: Props) {
  if (images.length === 0) return null;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    <section className="mt-3 rounded-lg border bg-muted/20 p-3">
      <Heading className="text-sm font-semibold">
        {heading}（{images.length}）
      </Heading>
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
