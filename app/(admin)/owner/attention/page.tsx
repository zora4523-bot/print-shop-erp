import Link from 'next/link';
import { Suspense } from 'react';
import { requirePermission } from '@/lib/auth/permissions';
import { ErrorBoundary, LinkPendingHint, PageHeader } from '@/components/ui-business';
import { buttonVariants } from '@/components/ui/button';
import { DashboardSectionLoading } from '@/components/business/dashboard/DashboardSectionLoading';
import { AttentionContent } from '@/components/business/dashboard/OwnerAttentionContent';
import {
  ATTENTION_KINDS,
  ATTENTION_TITLES,
} from '@/lib/dashboard/attention';
import { parsePositiveInt } from '@/lib/admin/table';

export const metadata = { title: '关注事项 · 工作台' };
type Props = {
  searchParams: Promise<{
    kind?: string | string[];
    page?: string | string[];
  }>;
};

export default async function OwnerAttentionPage({ searchParams }: Props) {
  await requirePermission('report:all');
  const raw = await searchParams;
  const requestedKind = Array.isArray(raw.kind) ? raw.kind[0] : raw.kind;
  const kind = ATTENTION_KINDS.find((item) => item === requestedKind) ?? 'due';
  const page = parsePositiveInt(raw.page, { defaultValue: 1 });

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="关注事项"
        back={{ href: '/owner', label: '返回工作台' }}
      />
      <nav aria-label="关注事项分类" className="flex flex-wrap gap-2">
        {ATTENTION_KINDS.map((item) => (
          <Link
            key={item}
            prefetch={false}
            scroll={false}
            href={`/owner/attention?kind=${item}`}
            aria-current={item === kind ? 'page' : undefined}
            className={buttonVariants({
              variant: item === kind ? 'secondary' : 'outline',
              className: 'relative',
            })}
          >
            {ATTENTION_TITLES[item]}
            <LinkPendingHint />
          </Link>
        ))}
      </nav>
      <ErrorBoundary
        key={`${kind}:${page}`}
        scope="section"
        title={`${ATTENTION_TITLES[kind]}暂时无法加载`}
        description="请重试当前列表，或返回工作台。"
      >
        <Suspense
          fallback={<DashboardSectionLoading label={ATTENTION_TITLES[kind]} />}
        >
          <AttentionContent kind={kind} page={page} />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
