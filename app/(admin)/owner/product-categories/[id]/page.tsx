import {
  EditProductCategoryCatalogItem,
  getProductCategoryCatalogMetadata,
} from '@/components/business/rules/catalog/ProductCategoryCatalogPages';

type PageProps = { params: Promise<{ id: string }> };

export function generateMetadata(props: PageProps) {
  return getProductCategoryCatalogMetadata({
    ...props,
    titleScope: '产品分类',
  });
}

/** @deprecated 入站请求会被转到规则中心。 */
export default function LegacyEditProductCategoryPage(props: PageProps) {
  return EditProductCategoryCatalogItem({
    ...props,
    routeBase: '/owner/product-categories',
  });
}
