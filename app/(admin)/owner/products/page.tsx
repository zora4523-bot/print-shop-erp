import {
  ProductCatalogList,
  type ProductCatalogListProps,
} from '@/components/business/rules/catalog/ProductCatalogPages';

export const metadata = {
  title: '产品字典 · 红包印刷 ERP',
};

type PageProps = Pick<ProductCatalogListProps, 'searchParams'>;

/** @deprecated 入站请求会被转到规则中心；保留薄页面供过渡期构建契约。 */
export default function LegacyProductsPage(props: PageProps) {
  return ProductCatalogList({ ...props, routeBase: '/owner/products' });
}
