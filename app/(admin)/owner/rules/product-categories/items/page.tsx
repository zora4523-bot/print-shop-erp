import {
  ProductCatalogList,
  type ProductCatalogListProps,
} from '@/components/business/rules/catalog/ProductCatalogPages';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';
import { QUOTE_PRODUCT_CATEGORIES } from '@/lib/product';

export const metadata = {
  title: '产品资料 · 规则配置中心',
};

type PageProps = Pick<ProductCatalogListProps, 'searchParams'>;

export default function ProductReferencesPage(props: PageProps) {
  return ProductCatalogList({
    ...props,
    routeBase: RULE_CENTER_HREFS.productReferences,
    categories: QUOTE_PRODUCT_CATEGORIES,
  });
}
