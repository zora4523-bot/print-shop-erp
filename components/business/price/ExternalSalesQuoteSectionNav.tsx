import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ExternalSalesQuoteSection =
  | 'processing'
  | 'logistics'
  | 'versions';

type ExternalSalesQuoteSectionNavProps = {
  activeSection: ExternalSalesQuoteSection;
  perspective: 'admin' | 'sales';
};

const SECTION_LABELS: Record<ExternalSalesQuoteSection, string> = {
  processing: '加工费',
  logistics: '快递与打包耗材',
  versions: '版本与发布',
};

export function resolveExternalSalesQuoteSection(
  value: string | string[] | undefined,
  options: { allowVersions: boolean },
): ExternalSalesQuoteSection {
  const section = Array.isArray(value) ? value[0] : value;
  if (section === 'logistics') return section;
  if (section === 'versions' && options.allowVersions) return section;
  return 'processing';
}

export function ExternalSalesQuoteSectionNav({
  activeSection,
  perspective,
}: ExternalSalesQuoteSectionNavProps) {
  const sections: readonly ExternalSalesQuoteSection[] =
    perspective === 'admin'
      ? ['processing', 'logistics', 'versions']
      : ['processing', 'logistics'];

  return (
    <nav
      aria-label="外部销售报价内容"
      className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border bg-card p-2 shadow-sm sm:grid-cols-2 lg:flex lg:flex-wrap"
    >
      {sections.map((section) => {
        const active = section === activeSection;
        const href =
          perspective === 'sales'
            ? `/sales/quote?section=${section}`
            : section === 'versions'
              ? '/owner/prices/external-sales/versions'
              : `/owner/prices/external-sales/items?purpose=${section}`;
        return (
          <Link
            key={section}
            href={href}
            prefetch={false}
            aria-current={active ? 'page' : undefined}
            className={cn(
              buttonVariants({ variant: active ? 'default' : 'ghost' }),
              'min-h-11 min-w-0 justify-start whitespace-normal text-left sm:justify-center lg:min-w-36',
            )}
          >
            {SECTION_LABELS[section]}
          </Link>
        );
      })}
    </nav>
  );
}
