import { readSupplementContext } from '@/lib/form-drafts/return-context';
import { NewMaterialCatalogItem } from '@/components/business/rules/catalog/MaterialCatalogPages';
import { MaterialCategory } from '@/generated/prisma/enums';

export const metadata = {
  title: '新建物料',
};

export default async function NewOwnerMaterialPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = readSupplementContext(await searchParams);
  return NewMaterialCatalogItem({
    supplement: context?.entityType === 'MATERIAL' ? context : null,
    routeBase: '/owner/materials',
    excludedCategories: [MaterialCategory.PAPER],
  });
}
