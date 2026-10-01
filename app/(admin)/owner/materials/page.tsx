import {
  MaterialCatalogList,
  type MaterialCatalogListProps,
} from '@/components/business/rules/catalog/MaterialCatalogPages';
import { MaterialCategory } from '@/generated/prisma/enums';

export const metadata = {
  title: '物料',
};

type PageProps = Pick<MaterialCatalogListProps, 'searchParams'>;

export default function OwnerMaterialsPage(props: PageProps) {
  return MaterialCatalogList({
    ...props,
    routeBase: '/owner/materials',
    excludeCategory: MaterialCategory.PAPER,
  });
}
