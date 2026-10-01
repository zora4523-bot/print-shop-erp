import { EmptyState } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { listProductSpecificationFacts } from '@/lib/product';
import { BLANK_SPECIFICATIONS } from '@/lib/price/blank-paper';
import { REQUIRED_FULL_SPECIFICATIONS } from '@/lib/order/create-order-published-rule-adapter';
import { canonicalizeCreateOrderSpecification } from '@/lib/price/create-order/canonical-facts';
import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

export const metadata = { title: '规格目录' };
export default async function SpecificationsPage() {
  await requirePermission('dict:product:manage');
  const products = await listProductSpecificationFacts();
  const full = [...REQUIRED_FULL_SPECIFICATIONS].map((name) => ({
    label: name,
    values: [...new Set(products.filter((product) => product.category === 'CUSTOM_FLAT_FOIL' &&
      product.specification && canonicalizeCreateOrderSpecification(product.specification) === name)
      .map((product) => externalPriceBusinessText(product.specification!)))],
  }));
  const print = [...new Set(products.filter((product) => product.category === 'COLOR_PRINT')
    .map((product) => externalPriceBusinessText(product.specification ?? '')).filter(Boolean))];
  return <div className="space-y-6">
    <RuleCenterPageHeader title="规格目录" back={{ href: '/owner/rules/papers', label: '返回纸张' }} />
    <section className="space-y-3 rounded-xl border bg-card p-4"><h2 className="font-semibold">空白封</h2>
      <ul className="grid gap-3 sm:grid-cols-2">{BLANK_SPECIFICATIONS.map((spec) => <li key={spec.key}>{spec.specification} mm</li>)}</ul>
    </section>
    <section className="space-y-3 rounded-xl border bg-card p-4"><h2 className="font-semibold">专版烫金</h2>
      <ul className="space-y-2">{full.map((spec) => <li key={spec.label}>{spec.label}：{spec.values.join('、') || '暂无产品尺寸'}</li>)}</ul>
    </section>
    <section className="space-y-3 rounded-xl border bg-card p-4"><h2 className="font-semibold">彩印</h2>
      {print.length > 0 ? <ul className="space-y-2">{print.map((spec) => <li key={spec}>{spec}</li>)}</ul> : <EmptyState title="暂无彩印规格" />}
    </section>
  </div>;
}
