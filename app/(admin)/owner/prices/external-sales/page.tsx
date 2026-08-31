import { redirect } from 'next/navigation';
import { firstSearchParam } from '@/lib/admin/table';
import {
  RULE_CENTER_HREFS,
  customerPricingHref,
  priceVersionsHref,
} from '@/lib/navigation/rule-center';

type PageProps = {
  searchParams: Promise<{
    section?: string | string[];
    draft?: string | string[];
  }>;
};

export default async function LegacyExternalSalesPriceBookPage({
  searchParams,
}: PageProps) {
  const sp = await searchParams;
  const section = firstSearchParam(sp.section);
  if (section === 'versions') {
    const draft = firstSearchParam(sp.draft).trim();
    redirect(
      draft
        ? priceVersionsHref(draft)
        : RULE_CENTER_HREFS.priceVersions,
    );
  }
  redirect(
    customerPricingHref(
      section === 'logistics' ? 'logistics' : 'processing',
    ),
  );
}
