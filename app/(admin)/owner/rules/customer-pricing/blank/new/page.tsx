import Link from 'next/link';
import { requirePermission } from '@/lib/auth/permissions';
import { getCustomerPriceSectionWorkspace } from '@/lib/price/customer-price-section-workspace';
import { listExternalCreateOrderPaperOptions } from '@/lib/material';
import { blankPaperFact } from '@/lib/price/blank-paper';
import { BlankPaperForm } from '@/components/business/rules/pricing/BlankPaperForm';
import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';
import { FormPage } from '@/app/_components/FormPage';
import { buttonVariants } from '@/components/ui/button';

export const metadata = { title: '新建纸张与规格价格' };

export default async function NewBlankPaperPage() {
  await requirePermission('dict:price:manage');
  const [workspace, papers] = await Promise.all([
    getCustomerPriceSectionWorkspace('blank'),
    listExternalCreateOrderPaperOptions(),
  ]);
  const draft = workspace.sources.find(
    (source) => source.purpose === 'PROCESSING',
  )?.draft;
  return (
    <FormPage>
      <RuleCenterPageHeader
        title="新建纸张与规格价格"
        back={{ href: '/owner/rules/customer-pricing?section=blank', label: '返回客户计价规则' }}
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
    </FormPage>
  );
}
