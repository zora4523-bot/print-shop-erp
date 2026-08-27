import { NewProductCatalogItem } from '@/components/business/rules/catalog/ProductCatalogPages';

export const metadata = {
  title: '新建产品 · 红包印刷 ERP',
};

/** @deprecated 入站请求会被转到规则中心。 */
export default function LegacyNewProductPage() {
  return NewProductCatalogItem({ routeBase: '/owner/products' });
}
