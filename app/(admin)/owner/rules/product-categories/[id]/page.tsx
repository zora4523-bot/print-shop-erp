import {
  EditProductCategoryCatalogItem,
  getProductCategoryCatalogMetadata,
} from '@/components/business/rules/catalog/ProductCategoryCatalogPages';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

type PageProps = { params: Promise<{ id: string }> };

export function generateMetadata(props: PageProps) {
  return getProductCategoryCatalogMetadata(props);
}

export default function EditProductCategoryPage(props: PageProps) {
  return EditProductCategoryCatalogItem({
    ...props,
    routeBase: RULE_CENTER_HREFS.productCategories,
  });
}
