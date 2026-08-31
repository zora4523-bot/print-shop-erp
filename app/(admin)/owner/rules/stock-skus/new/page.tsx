import { NewProductCatalogItem } from '@/components/business/rules/catalog/ProductCatalogPages';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';
import { QUOTE_PRODUCT_CATEGORIES } from '@/lib/product';

export const metadata = {
  title: '新建可建单组合 · 规则配置中心',
};

export default function NewStockSkuPage() {
  return NewProductCatalogItem({
    routeBase: RULE_CENTER_HREFS.stockSkus,
    categories: QUOTE_PRODUCT_CATEGORIES,
  });
}
