import { NewCraftCatalogItem } from '@/components/business/rules/catalog/CraftCatalogPages';

export const metadata = {
  title: '新建工艺 · 红包印刷 ERP',
};

/** @deprecated 入站请求会被转到规则中心。 */
export default function LegacyNewCraftPage() {
  return NewCraftCatalogItem({ routeBase: '/owner/crafts' });
}
