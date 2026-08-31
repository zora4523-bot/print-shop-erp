import {
  CraftCatalogList,
  type CraftCatalogListProps,
} from '@/components/business/rules/catalog/CraftCatalogPages';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';

export const metadata = {
  title: '建单工艺目录 · 规则配置中心',
};

type PageProps = Pick<CraftCatalogListProps, 'searchParams'>;

export default function RuleCenterCraftsPage(props: PageProps) {
  return CraftCatalogList({
    ...props,
    routeBase: RULE_CENTER_HREFS.crafts,
  });
}
