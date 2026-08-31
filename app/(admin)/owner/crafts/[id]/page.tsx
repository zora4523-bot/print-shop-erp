import {
  EditCraftCatalogItem,
  getCraftCatalogMetadata,
  type CraftCatalogDetailProps,
} from '@/components/business/rules/catalog/CraftCatalogPages';

type PageProps = Pick<CraftCatalogDetailProps, 'params'>;

export function generateMetadata(props: PageProps) {
  return getCraftCatalogMetadata({ ...props, titleScope: '工艺字典' });
}

/** @deprecated 入站请求会被转到规则中心。 */
export default function LegacyEditCraftPage(props: PageProps) {
  return EditCraftCatalogItem({ ...props, routeBase: '/owner/crafts' });
}
