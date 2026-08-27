import { NewProductCategoryCatalogItem } from '@/components/business/rules/catalog/ProductCategoryCatalogPages';

export const metadata = {
  title: '新建产品分类 · 红包印刷 ERP',
};

/** @deprecated 入站请求会被转到规则中心。 */
export default function LegacyNewProductCategoryPage() {
  return NewProductCategoryCatalogItem({
    routeBase: '/owner/product-categories',
  });
}
