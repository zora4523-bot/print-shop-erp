import {
  EditProductCatalogItem,
  getProductCatalogMetadata,
} from '@/components/business/rules/catalog/ProductCatalogPages';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';
import { QUOTE_PRODUCT_CATEGORIES } from '@/lib/product';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export function generateMetadata(props: PageProps) {
  return getProductCatalogMetadata(props);
}

export default function EditStockSkuPage(props: PageProps) {
  return EditProductCatalogItem({
    ...props,
    routeBase: RULE_CENTER_HREFS.stockSkus,
    categories: QUOTE_PRODUCT_CATEGORIES,
  });
}
