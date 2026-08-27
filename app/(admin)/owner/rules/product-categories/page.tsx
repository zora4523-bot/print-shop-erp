import { ProductCategoryCatalogList } from '@/components/business/rules/catalog/ProductCategoryCatalogPages';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

export const metadata = {
  title: '产品结构分类 · 规则配置中心',
};

export default function ProductCategoriesPage() {
  return ProductCategoryCatalogList({
    routeBase: RULE_CENTER_HREFS.productCategories,
  });
}
