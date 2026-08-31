import { NewCraftCatalogItem } from '@/components/business/rules/catalog/CraftCatalogPages';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

export const metadata = {
  title: '新建工艺 · 规则配置中心',
};

export default function NewRuleCenterCraftPage() {
  return NewCraftCatalogItem({ routeBase: RULE_CENTER_HREFS.crafts });
}
