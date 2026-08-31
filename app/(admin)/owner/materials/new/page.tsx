import { NewMaterialCatalogItem } from '@/components/business/rules/catalog/MaterialCatalogPages';
import { MaterialCategory } from '@/generated/prisma/enums';

export const metadata = {
  title: '新建物料 · 红包印刷 ERP',
};

export default function NewOwnerMaterialPage() {
  return NewMaterialCatalogItem({
    routeBase: '/owner/materials',
    excludedCategories: [MaterialCategory.PAPER],
  });
}
