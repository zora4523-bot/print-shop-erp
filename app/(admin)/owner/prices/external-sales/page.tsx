import { redirect } from 'next/navigation';
import { firstSearchParam } from '@/lib/admin/table';

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
        ? `/owner/prices/external-sales/versions?draft=${encodeURIComponent(
            draft,
          )}`
        : '/owner/prices/external-sales/versions',
    );
  }
  redirect(
    `/owner/prices/external-sales/items?purpose=${
      section === 'logistics' ? 'logistics' : 'processing'
    }`,
  );
}
