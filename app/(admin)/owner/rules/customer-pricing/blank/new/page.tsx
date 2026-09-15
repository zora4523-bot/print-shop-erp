import Link from 'next/link';
import { requirePermission } from '@/lib/auth/permissions';
import { getCustomerPriceSectionWorkspace } from '@/lib/price/customer-price-section-workspace';
import { listExternalCreateOrderPaperOptions } from '@/lib/material';
import { blankPaperFact } from '@/lib/price/blank-paper';
import { BlankPaperForm } from '@/components/business/rules/pricing/BlankPaperForm';
import { PageHeader } from '@/components/ui-business';
import { buttonVariants } from '@/components/ui/button';

export const metadata = { title: '新增纸张与规格价格' };

export default async function NewBlankPaperPage() {
  await requirePermission('dict:price:manage');
  await requirePermission('material:manage');
  await requirePermission('dict:product:manage');
  const [workspace, papers] = await Promise.all([
    getCustomerPriceSectionWorkspace('blank'),
    listExternalCreateOrderPaperOptions(),
  ]);
  const draft = workspace.sources.find(
    (source) => source.purpose === 'PROCESSING',
  )?.draft;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="新增纸张与规格价格"
        actions={
          <Link
            href="/owner/rules/customer-pricing?section=blank"
            className={buttonVariants({ variant: 'outline' })}
          >
            返回价格表
          </Link>
        }
      />
      {draft ? (
        <BlankPaperForm
          priceBookId={draft.id}
          expectedUpdatedAt={draft.updatedAt}
          papers={papers.flatMap((paper) => {
            const fact = blankPaperFact(paper);
            return !paper.outOfStock && fact
              ? [
                  {
                    id: paper.id,
                    name: `${fact.paperWeightGsm}g${fact.paperType}`,
                  },
                ]
              : [];
          })}
        />
      ) : (
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <p>请先发起加工费调价，再添加纸张与规格价格。</p>
          <Link
            href="/owner/rules/customer-pricing?section=blank&start=1&purpose=processing"
            className={buttonVariants()}
          >
            发起调价
          </Link>
        </div>
      )}
    </div>
  );
}
