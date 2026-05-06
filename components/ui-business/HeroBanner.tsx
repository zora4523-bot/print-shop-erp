import { cn } from '@/lib/utils';

// 欢迎横幅——首页那条&ldquo;欢迎回来，老板&rdquo;的渐变红 banner，含右侧装饰位
// （screenshot 是印刷机 + 红包插画）。
//
// 视觉契约：左 title/subtitle + ctaLink 链接，右 decoration slot。
// 渐变背景用 primary 品牌色（globals.css 改红了这里也变）。

export type HeroBannerProps = {
  title: string;
  subtitle?: React.ReactNode;
  // CTA 链接区——业务侧自己决定渲染 <Link href> 还是别的。
  cta?: React.ReactNode;
  // 右侧装饰位，建议放 SVG / Image。null 时 banner 只占左侧空间。
  decoration?: React.ReactNode;
  className?: string;
};

export function HeroBanner({
  title,
  subtitle,
  cta,
  decoration,
  className,
}: HeroBannerProps) {
  return (
    <div
      data-slot="hero-banner"
      className={cn(
        'relative overflow-hidden rounded-xl border bg-gradient-to-r from-primary/15 via-primary/5 to-transparent px-6 py-6 shadow-sm',
        className,
      )}
    >
      <div className="relative z-10 flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {subtitle ? (
            <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
          ) : null}
          {cta ? <div className="mt-3">{cta}</div> : null}
        </div>
        {decoration ? (
          <div
            aria-hidden
            className="hidden shrink-0 items-center sm:flex"
          >
            {decoration}
          </div>
        ) : null}
      </div>
    </div>
  );
}
