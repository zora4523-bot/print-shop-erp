import {
  EditProductCatalogItem,
  getProductCatalogMetadata,
  type ProductCatalogDetailProps,
} from '@/components/business/rules/catalog/ProductCatalogPages';

type PageProps = Pick<ProductCatalogDetailProps, 'params'>;

export function generateMetadata(props: PageProps) {
  return getProductCatalogMetadata({ ...props, titleScope: '产品字典' });
}

/** @deprecated 入站请求会被转到规则中心。 */
export default function LegacyEditProductPage(props: PageProps) {
  return EditProductCatalogItem({
    ...props,
    routeBase: '/owner/products',
  });
}
