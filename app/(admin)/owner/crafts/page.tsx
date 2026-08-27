import {
  CraftCatalogList,
  type CraftCatalogListProps,
} from '@/components/business/rules/catalog/CraftCatalogPages';

export const metadata = {
  title: '工艺字典 · 红包印刷 ERP',
};

type PageProps = Pick<CraftCatalogListProps, 'searchParams'>;

/** @deprecated 入站请求会被转到规则中心。 */
export default function LegacyCraftsPage(props: PageProps) {
  return CraftCatalogList({ ...props, routeBase: '/owner/crafts' });
}
