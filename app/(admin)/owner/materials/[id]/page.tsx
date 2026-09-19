import {
  EditMaterialCatalogItem,
  getMaterialCatalogMetadata,
  type MaterialCatalogDetailProps,
} from '@/components/business/rules/catalog/MaterialCatalogPages';
import { MaterialCategory } from '@/generated/prisma/enums';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

type PageProps = Pick<MaterialCatalogDetailProps, 'params' | 'searchParams'>;

export function generateMetadata(props: PageProps) {
  return getMaterialCatalogMetadata({ ...props, titleScope: '物料字典' });
}

export default function EditOwnerMaterialPage(props: PageProps) {
  return EditMaterialCatalogItem({
    ...props,
    routeBase: '/owner/materials',
    redirectCategory: MaterialCategory.PAPER,
    redirectBase: RULE_CENTER_HREFS.papers,
  });
}
