import {
  EditMaterialCatalogItem,
  getMaterialCatalogMetadata,
} from '@/components/business/rules/catalog/MaterialCatalogPages';
import { MaterialCategory } from '@/generated/prisma/enums';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

type PageProps = { params: Promise<{ id: string }> };

export function generateMetadata(props: PageProps) {
  return getMaterialCatalogMetadata(props);
}

export default function EditPaperPage(props: PageProps) {
  return EditMaterialCatalogItem({
    ...props,
    routeBase: RULE_CENTER_HREFS.papers,
    categoryScope: MaterialCategory.PAPER,
  });
}
