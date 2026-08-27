import {
  MaterialCatalogList,
  type MaterialCatalogListProps,
} from '@/components/business/rules/catalog/MaterialCatalogPages';
import { MaterialCategory } from '@/generated/prisma/enums';

export const metadata = {
  title: '物料字典 · 红包印刷 ERP',
};

type PageProps = Pick<MaterialCatalogListProps, 'searchParams'>;

export default function OwnerMaterialsPage(props: PageProps) {
  return MaterialCatalogList({
    ...props,
    routeBase: '/owner/materials',
    excludeCategory: MaterialCategory.PAPER,
  });
}
